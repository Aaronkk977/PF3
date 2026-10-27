import "server-only";

import { dbWriteLimiter } from "@/lib/concurrency-limiter";
import { toLocalDateKey } from "@/lib/date-keys";
import { prisma } from "@/lib/db";
import type { OhlcBar } from "@/lib/market-data/yahoo-chart";
import { resolveYahooQuoteSymbol } from "@/lib/market-utils";

/** PriceCache 資料表的讀寫：各資料來源抓到的日收盤都存在這裡，網路失敗時
 *  也從這裡退回舊資料。 */

const PRICE_CACHE_UPSERT_CHUNK = 50;

/** PriceCache 寫入一律排進全域共用的 dbWriteLimiter，避免多標的並行 upsert
 *  造成 SQLite 鎖定逾時——不 await（呼叫端不用等寫入真的完成），但仍佔用
 *  dbWriteLimiter 的名額，所以會跟其他批次寫入（例如股票分割）正確共享同一個
 *  全域上限，不會加總超標。 */
export function enqueuePriceCacheWrite(work: () => Promise<void>): void {
  dbWriteLimiter.run(work).catch((e) => {
    console.error("priceCache persist failed", e);
  });
}

/** 寫入單一日收盤（open=high=low=close），給只有收盤值的來源用（台灣 VIX、
 *  證交所的加權指數校正值）。dateKey 為 YYYYMMDD。 */
export function persistDailyClose(symbol: string, dateKey: string, value: number): void {
  enqueuePriceCacheWrite(() => upsertDailyClose(symbol, dateKey, value));
}

/** 同 persistDailyClose，但會等寫入完成（給需要接著讀回的同步流程與腳本用） */
export async function upsertDailyClose(
  symbol: string,
  dateKey: string,
  value: number,
): Promise<void> {
  const date = dateFromKey(dateKey);
  await prisma.priceCache.upsert({
    where: { symbol_date: { symbol, date } },
    create: { symbol, date, open: value, high: value, low: value, close: value },
    update: { open: value, high: value, low: value, close: value, cachedAt: new Date() },
  });
}

/** YYYYMMDD → PriceCache 使用的 UTC 午夜日期 */
export function dateFromKey(dateKey: string): Date {
  return startOfDay(
    new Date(`${dateKey.slice(0, 4)}-${dateKey.slice(4, 6)}-${dateKey.slice(6, 8)}`),
  );
}

/**
 * @param maxAgeDays 快取最舊可以是幾天前，超過就不採用。
 *   兩種呼叫情境需要不同寬鬆度：
 *   - 純備援（其他資料來源都已失敗）：傳 Infinity，再舊的快取也比完全沒有好
 *     （呼叫端會自行標記 stale，使用者看得出來這不是即時資料）。
 *   - 決定要不要拿快取「覆蓋」剛成功拿到的即時報價：必須夠新（幾天內）才能
 *     覆蓋，否則會變成用陳年舊資料蓋掉這次明明抓到的新資料。
 */
export async function getDayChangeFromCache(
  symbol: string,
  maxAgeDays: number,
): Promise<{ price: number; change: number; changePercent: number } | null> {
  const quoteSymbol = resolveYahooQuoteSymbol(symbol);
  const candidates = [...new Set([symbol.trim(), quoteSymbol])];
  const now = Date.now();

  for (const sym of candidates) {
    const rows = await prisma.priceCache.findMany({
      where: { symbol: sym },
      orderBy: { date: "desc" },
      take: 2,
    });
    if (rows.length < 2) continue;
    const [latest, previous] = rows;

    const ageDays = (now - latest.date.getTime()) / (24 * 60 * 60 * 1000);
    if (ageDays > maxAgeDays) {
      continue;
    }

    if (latest.close <= 0 || previous.close <= 0) continue;
    const change = latest.close - previous.close;
    return {
      price: latest.close,
      change,
      changePercent: change / previous.close,
    };
  }
  return null;
}

export async function getLatestCachedClose(symbol: string): Promise<number | null> {
  const quoteSymbol = resolveYahooQuoteSymbol(symbol);
  const candidates = [...new Set([symbol.trim(), quoteSymbol])];
  for (const sym of candidates) {
    const row = await prisma.priceCache.findFirst({
      where: { symbol: sym },
      orderBy: { date: "desc" },
    });
    if (row?.close != null) return row.close;
  }
  return null;
}

export async function getWeekChangeFromCache(symbol: string): Promise<number | null> {
  const quoteSymbol = resolveYahooQuoteSymbol(symbol);
  const candidates = [...new Set([symbol.trim(), quoteSymbol])];
  const target = new Date();
  target.setDate(target.getDate() - 7);
  const targetKey = toLocalDateKey(target);

  for (const sym of candidates) {
    const rows = await prisma.priceCache.findMany({
      where: { symbol: sym },
      orderBy: { date: "desc" },
      take: 15,
    });
    if (rows.length < 2) continue;

    const latest = rows[0]!;
    let ref = rows[rows.length - 1]!;
    for (const row of rows) {
      if (toLocalDateKey(row.date) <= targetKey) {
        ref = row;
        break;
      }
    }
    if (toLocalDateKey(ref.date) === toLocalDateKey(latest.date)) {
      ref = rows[Math.min(rows.length - 1, 5)]!;
    }
    if (latest.close <= 0 || ref.close <= 0) continue;
    return (latest.close - ref.close) / ref.close;
  }
  return null;
}

/** 某段期間內 PriceCache 的日線，轉成 OhlcBar */
export async function getCachedBars(
  symbol: string,
  start: Date,
  end: Date,
): Promise<OhlcBar[]> {
  return toOhlcBars(await getCachedHistory(symbol, start, end));
}

export function toOhlcBars(
  rows: {
    date: Date;
    open: number | null;
    high: number | null;
    low: number | null;
    close: number;
    volume: number | null;
  }[],
): OhlcBar[] {
  return rows.map((r) => ({
    date: toLocalDateKey(r.date),
    open: r.open ?? r.close,
    high: r.high ?? r.close,
    low: r.low ?? r.close,
    close: r.close,
    volume: r.volume ?? undefined,
  }));
}

export async function getCachedHistory(symbol: string, start: Date, end: Date) {
  return prisma.priceCache.findMany({
    where: {
      symbol,
      date: { gte: startOfLocalDay(start), lte: startOfLocalDay(end) },
    },
    orderBy: { date: "asc" },
  });
}

export async function persistPriceHistory(
  symbol: string,
  history: OhlcBar[],
): Promise<void> {
  if (history.length === 0) return;

  for (let i = 0; i < history.length; i += PRICE_CACHE_UPSERT_CHUNK) {
    const slice = history.slice(i, i + PRICE_CACHE_UPSERT_CHUNK);
    await prisma.$transaction(
      async (tx) => {
        for (const row of slice) {
          const date = startOfDay(new Date(row.date));
          await tx.priceCache.upsert({
            where: {
              symbol_date: { symbol, date },
            },
            create: {
              symbol,
              date,
              open: row.open,
              high: row.high,
              low: row.low,
              close: row.close,
              volume: row.volume,
            },
            update: {
              open: row.open,
              high: row.high,
              low: row.low,
              close: row.close,
              volume: row.volume,
              cachedAt: new Date(),
            },
          });
        }
      },
      { timeout: 60_000 },
    );
  }
}

export function startOfDay(d: Date): Date {
  const copy = new Date(d);
  copy.setUTCHours(0, 0, 0, 0);
  return copy;
}

/** 用本地日曆日（而非 UTC）轉成 UTC 午夜，避免凌晨 0:00~08:00 台灣時間跨日偏移 */
export function startOfLocalDay(d: Date): Date {
  return new Date(toLocalDateKey(d) + "T00:00:00.000Z");
}
