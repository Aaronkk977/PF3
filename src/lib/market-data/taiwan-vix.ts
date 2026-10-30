import "server-only";

import { mapWithConcurrency } from "@/lib/async-pool";
import { dbWriteLimiter, externalReadLimiter } from "@/lib/concurrency-limiter";
import { toLocalDateKey } from "@/lib/date-keys";
import { prisma } from "@/lib/db";
import {
  dateFromKey,
  getCachedBars,
  getCachedHistory,
  getDayChangeFromCache,
  persistDailyClose,
  upsertDailyClose,
} from "@/lib/market-data/price-cache";
import { TAIWAN_VIX_SYMBOL } from "@/lib/custom-series-symbols";
import { fetchWithShortTimeout } from "@/lib/http-fetch";
import type { OhlcBar, QuoteResult } from "@/lib/market-data/yahoo-chart";
import {
  parseVixDailyFile,
  parseVixIndexHistory,
  parseVixMonthlyFile,
} from "@/lib/market-series-parsers";

/** 台灣 VIX（VIXTWN）：Yahoo 沒有。即時值抓期交所 MIS；歷史日收盤用
 *  1. 期交所主站近 3 個月的月檔（一個檔案一整個月，最省請求）
 *  2. 主站當月的單日分鐘檔（月檔還沒更新到的最近幾天）
 *  3. 期交所指數專區的歷史查詢（最近 3 年），只補資料庫裡還沒有的日期
 *  官方收盤值是「收盤前 1 分鐘平均指數」；指數專區給的是 13:45 指數
 *  （差 0.1 點內），所以只拿來補洞，月檔有的日期一律以月檔為準。
 *  3 年以前的歷史期交所沒有免費提供。
 *
 *  不要再用 www.bq888.taifex.com.tw：舊版曾從那裡抓歷史，但它的資料是壞的
 *  （連續數週同一個值、0.51 這種不可能的點數，2026-07-01 與官方月檔差 12 點）。 */

const FETCH_TIMEOUT_MS = 10_000;
const TAIFEX_BASE = "https://www.taifex.com.tw";
const TAIWAN_VIX_QUOTE_LIST_URL =
  "https://mis.taifex.com.tw/futures/api/getQuoteListVIX";
/** 主站月檔只保留最近 3 個月（含當月），多抓一個月當緩衝 */
const MONTHLY_FILE_MONTHS = 4;
/** 最近幾天的單日檔每次都重抓，蓋掉盤中存下來的即時快照 */
const RECENT_DAYS_REFRESH = 7;
const TAIFEX_INDEX_HISTORY_URL = `${TAIFEX_BASE}/indes/index.aspx/GetStockDayPrices`;
/** 指數專區網頁標示「可查詢資料範圍為最近三年」 */
const INDEX_HISTORY_YEARS = 3;
/** 區間開頭缺超過這麼多天，才去指數專區補（連假不算缺） */
const INDEX_HISTORY_GAP_DAYS = 10;

export function isTaiwanVixSymbol(symbol: string): boolean {
  return symbol.trim().toUpperCase() === TAIWAN_VIX_SYMBOL;
}

const compactKey = (d: Date) => toLocalDateKey(d).replace(/-/g, "");

async function fetchText(url: string, revalidate: number): Promise<string | null> {
  const res = await fetchWithShortTimeout(url, { next: { revalidate } }, FETCH_TIMEOUT_MS);
  if (!res?.ok) return null;
  return res.text();
}

async function fetchMonthlyCloses(yyyymm: string): Promise<Map<string, number> | null> {
  const text = await fetchText(
    `${TAIFEX_BASE}/file/taifex/Dailydownload/vix/log2data/${yyyymm}new.txt`,
    3600,
  );
  if (!text) return null;
  const closes = parseVixMonthlyFile(text);
  return closes.size > 0 ? closes : null;
}

async function fetchDailyClose(dateKey: string): Promise<number | null> {
  const text = await fetchText(
    `${TAIFEX_BASE}/cht/7/getVixData?filesname=${encodeURIComponent(dateKey)}`,
    600,
  );
  return text ? parseVixDailyFile(text) : null;
}

const slashDate = (d: Date) => toLocalDateKey(d).replace(/-/g, "/");

/** 指數專區的歷史查詢；範圍夾在網站允許的最近 3 年內 */
async function fetchIndexHistory(start: Date, end: Date): Promise<Map<string, number>> {
  // 結束日期是今天（含）以後會被拒絕：「結束日期不能大於或等於今天！」
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (end > yesterday) end = yesterday;
  if (start > end) return new Map();
  const res = await fetchWithShortTimeout(
    TAIFEX_INDEX_HISTORY_URL,
    {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        syid: "TAIWANVIX",
        flag: "MS",
        startDate: slashDate(start),
        endDate: slashDate(end),
      }),
    },
    FETCH_TIMEOUT_MS,
  );
  if (!res?.ok) return new Map();
  try {
    return parseVixIndexHistory(await res.json());
  } catch {
    return new Map();
  }
}

/** 主站「分鐘檔」頁面列出的日期（當月，YYYYMMDD，降冪） */
async function fetchDailyFileDates(): Promise<string[]> {
  const html = await fetchText(`${TAIFEX_BASE}/cht/7/vixMinNew`, 3600);
  if (!html) return [];
  const dates = new Set(
    Array.from(html.matchAll(/getVixData\?filesname=(\d{8})/g), (m) => m[1]!),
  );
  return [...dates].sort().reverse();
}

function monthsBetween(start: Date, end: Date): string[] {
  const out: string[] = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  while (cursor <= end) {
    out.push(`${cursor.getFullYear()}${String(cursor.getMonth() + 1).padStart(2, "0")}`);
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return out;
}

/**
 * 抓 VIXTWN 官方日收盤寫入 PriceCache，並回傳區間內的日線。
 * 與資料庫不同的值會被官方值覆蓋（盤中快照、舊版程式存錯日期的值）；
 * 月檔完整涵蓋的月份裡、官方沒有的日期（週末、假日的錯誤列）會被刪掉。
 */
export async function syncVixHistory(
  periodStart: Date,
  periodEnd: Date,
): Promise<OhlcBar[]> {
  const startKey = compactKey(periodStart);
  const endKey = compactKey(periodEnd);
  const inRange = (k: string) => k >= startKey && k <= endKey;

  const existing = new Map(
    (await getCachedHistory(TAIWAN_VIX_SYMBOL, periodStart, periodEnd)).map(
      (r) => [compactKey(r.date), r.close] as const,
    ),
  );
  const official = new Map<string, number>();
  /** 月檔成功取得的月份 → 該月檔最後一個交易日 */
  const coveredMonths = new Map<string, string>();

  const monthlyFrom = new Date();
  monthlyFrom.setMonth(monthlyFrom.getMonth() - (MONTHLY_FILE_MONTHS - 1));
  const months = monthsBetween(
    periodStart > monthlyFrom ? periodStart : monthlyFrom,
    periodEnd,
  );
  await mapWithConcurrency(months, externalReadLimiter, async (yyyymm) => {
    const closes = await fetchMonthlyCloses(yyyymm);
    if (!closes) return;
    coveredMonths.set(yyyymm, [...closes.keys()].sort().at(-1)!);
    for (const [k, v] of closes) if (inRange(k)) official.set(k, v);
  });

  const recentKey = compactKey(new Date(Date.now() - RECENT_DAYS_REFRESH * 86_400_000));
  const needsDailyFile = (k: string) =>
    inRange(k) && !official.has(k) && (!existing.has(k) || k >= recentKey);

  const dailyDates = (await fetchDailyFileDates()).filter(needsDailyFile);
  await mapWithConcurrency(dailyDates, externalReadLimiter, async (k) => {
    const value = await fetchDailyClose(k);
    if (value != null) official.set(k, value);
  });

  // 區間開頭（月檔涵蓋不到的舊日期）缺一段時，從指數專區補洞。補過之後最早
  // 一筆就在區間開頭附近，之後的同步不會再打這支。
  const indexFrom = new Date();
  indexFrom.setFullYear(indexFrom.getFullYear() - INDEX_HISTORY_YEARS);
  indexFrom.setDate(indexFrom.getDate() + 1);
  const indexStart = periodStart > indexFrom ? periodStart : indexFrom;
  const earliestKnown = [...existing.keys(), ...official.keys()].sort()[0];
  const gapLimitKey = compactKey(
    new Date(indexStart.getTime() + INDEX_HISTORY_GAP_DAYS * 86_400_000),
  );
  if (indexStart < monthlyFrom && (earliestKnown == null || earliestKnown > gapLimitKey)) {
    const history = await externalReadLimiter.run(() =>
      fetchIndexHistory(indexStart, periodEnd),
    );
    for (const [k, v] of history) {
      if (inRange(k) && !official.has(k) && !existing.has(k)) official.set(k, v);
    }
  }

  const toWrite = [...official].filter(([k, v]) => {
    const cached = existing.get(k);
    return cached == null || Math.abs(cached - v) > 0.005;
  });
  const toDelete = [...existing.keys()].filter((k) => {
    const lastInMonth = coveredMonths.get(k.slice(0, 6));
    return lastInMonth != null && k <= lastInMonth && !official.has(k);
  });
  if (toWrite.length > 0 || toDelete.length > 0) {
    await dbWriteLimiter.run(async () => {
      for (const [k, v] of toWrite) await upsertDailyClose(TAIWAN_VIX_SYMBOL, k, v);
      if (toDelete.length > 0) {
        await prisma.priceCache.deleteMany({
          where: {
            symbol: TAIWAN_VIX_SYMBOL,
            date: {
              in: toDelete.map(dateFromKey),
            },
          },
        });
      }
    });
  }

  return getCachedBars(TAIWAN_VIX_SYMBOL, periodStart, periodEnd);
}

type TaifexVixItem = {
  SymbolID?: string;
  DispEName?: string;
  CLastPrice?: string;
  CRefPrice?: string;
  CDiff?: string;
  CDiffRate?: string;
  CDate?: string;
};

function parseOptionalNumber(value: string | undefined): number | undefined {
  if (!value || !value.trim()) return undefined;
  const n = Number(value.replace("%", "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : undefined;
}

async function fetchLiveVix(): Promise<QuoteResult | null> {
  const res = await fetchWithShortTimeout(
    TAIWAN_VIX_QUOTE_LIST_URL,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ SortColumn: "", AscDesc: "A" }),
      next: { revalidate: 15 },
    },
    FETCH_TIMEOUT_MS,
  );
  if (!res?.ok) return null;
  try {
    const payload = (await res.json()) as { RtData?: { QuoteList?: TaifexVixItem[] } };
    const item = payload.RtData?.QuoteList?.find(
      (row) => row.SymbolID?.toUpperCase() === "TAIWANVIX",
    );
    const price = parseOptionalNumber(item?.CLastPrice);
    if (!item || price == null || price <= 0) return null;

    const ref = parseOptionalNumber(item.CRefPrice);
    const change =
      parseOptionalNumber(item.CDiff) ??
      (ref != null && ref > 0 ? price - ref : undefined);
    // CDiffRate 已經是小數（"0.0454" 代表 +4.54%），不可再除以 100
    const changePercent =
      ref != null && ref > 0 ? (price - ref) / ref : parseOptionalNumber(item.CDiffRate);

    // 用期交所標示的資料日期存，不能用「今天」——週末、開盤前打開 App
    // 拿到的是上一個交易日的值。
    if (item.CDate && /^\d{8}$/.test(item.CDate)) {
      persistDailyClose(TAIWAN_VIX_SYMBOL, item.CDate, price);
    }
    return {
      symbol: TAIWAN_VIX_SYMBOL,
      name: item.DispEName ?? "TAIWAN VIX",
      price,
      currency: "TWD",
      change,
      changePercent,
    };
  } catch {
    return null;
  }
}

export async function fetchTaiwanVixQuote(): Promise<QuoteResult | null> {
  const live = await fetchLiveVix();
  if (live) return live;

  // MIS 失敗：補齊最近兩週的官方收盤，再用快取的最後兩筆算漲跌
  const end = new Date();
  const start = new Date(end.getTime() - 14 * 86_400_000);
  await syncVixHistory(start, end).catch(() => []);
  const cached = await getDayChangeFromCache(TAIWAN_VIX_SYMBOL, Infinity);
  if (!cached) return null;
  return {
    symbol: TAIWAN_VIX_SYMBOL,
    name: "TAIWAN VIX",
    currency: "TWD",
    ...cached,
    stale: true,
  };
}
