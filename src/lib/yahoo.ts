import "server-only";

import YahooFinance from "yahoo-finance2";
import { toLocalDateKey } from "@/lib/date-keys";
import { prisma } from "@/lib/db";
import { isTaiwanMarketClosed } from "@/lib/market-session";
import { fetchWithShortTimeout } from "@/lib/http-fetch";
import {
  isCryptoSymbol,
  isTaiwanStockSymbol,
  reconcileTaiwanQuoteFromPreviousClose,
} from "@/lib/market-utils";

const yahooFinance = new YahooFinance();

const CACHE_TTL_MS = 15 * 60 * 1000;
/** 網路不穩時快速失敗，改走 DB 快取 */
const YAHOO_FETCH_TIMEOUT_MS = 6_000;
const PRICE_CACHE_UPSERT_CHUNK = 50;
const TAIWAN_VIX_SYMBOL = "VIXTWN";
const TAIWAN_VIX_QUOTE_LIST_URL =
  "https://mis.taifex.com.tw/futures/api/getQuoteListVIX";
const TAIWAN_VIX_LIST_URL = "https://www.bq888.taifex.com.tw/cht/7/vixMinNew";

/** 序列化 PriceCache 寫入，避免多標的並行 upsert 造成 SQLite 鎖定逾時 */
let priceCacheWriteChain: Promise<void> = Promise.resolve();

function enqueuePriceCacheWrite(work: () => Promise<void>): void {
  priceCacheWriteChain = priceCacheWriteChain.then(work).catch((e) => {
    console.error("priceCache persist failed", e);
  });
}

async function fetchWithTimeout(
  url: string,
  init?: RequestInit & { next?: { revalidate?: number } },
): Promise<Response | null> {
  return fetchWithShortTimeout(url, init, YAHOO_FETCH_TIMEOUT_MS);
}

async function yahooQuote(symbol: string) {
  try {
    return await Promise.race([
      yahooFinance.quote(symbol),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("Yahoo quote timeout")), YAHOO_FETCH_TIMEOUT_MS);
      }),
    ]);
  } catch {
    return null;
  }
}

export type QuoteResult = {
  symbol: string;
  name?: string;
  price: number;
  currency?: string;
  change?: number;
  changePercent?: number;
  /** 昨收（台股漲停／收盤價校正用） */
  previousClose?: number;
  /** 即時報價來源（Yahoo）本次呼叫失敗，此結果為本機快取的舊價 */
  stale?: boolean;
};

export type OhlcBar = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

/** Yahoo 漲跌幅：多為百分比（9.9），少數已為小數（0.099） */
export function normalizeYahooChangePercent(
  pct: number | null | undefined,
): number | undefined {
  if (pct == null || !Number.isFinite(pct)) return undefined;
  if (Math.abs(pct) <= 0.2) return pct;
  return pct / 100;
}

/** 交易代號 → Yahoo 查價代號（例：AVAX → AVAX-USD） */
export function resolveYahooQuoteSymbol(symbol: string): string {
  const s = symbol.trim().toUpperCase();
  if (s === TAIWAN_VIX_SYMBOL) return TAIWAN_VIX_SYMBOL;
  if (!s || s.includes("-") || s.endsWith(".TW") || s.endsWith(".TWO")) {
    return symbol.trim();
  }
  if (isCryptoSymbol(s)) return `${s}-USD`;
  return symbol.trim();
}

function inferAssetClass(symbol: string): string {
  if (isCryptoSymbol(symbol)) return "crypto";
  if (symbol.startsWith("^")) return "index";
  if (symbol.endsWith(".TW") && /^\d{4}/.test(symbol)) return "stock";
  return "stock";
}

type ChartResponse = {
  chart?: {
    result?: Array<{
      meta?: { currency?: string; shortName?: string; longName?: string };
      timestamp?: number[];
      indicators?: {
        quote?: Array<{
          open?: (number | null)[];
          high?: (number | null)[];
          low?: (number | null)[];
          close?: (number | null)[];
          volume?: (number | null)[];
        }>;
      };
    }>;
  };
};

async function fetchChartForQuoteSymbol(
  quoteSymbol: string,
  periodStart: Date,
  periodEnd: Date,
): Promise<OhlcBar[]> {
  const period1 = Math.floor(periodStart.getTime() / 1000);
  const period2 = Math.floor(periodEnd.getTime() / 1000);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(quoteSymbol)}?period1=${period1}&period2=${period2}&interval=1d`;

  const res = await fetchWithTimeout(url, { next: { revalidate: 900 } });
  if (!res?.ok) return [];

  const data = (await res.json()) as ChartResponse;
  const result = data.chart?.result?.[0];
  if (!result?.timestamp?.length) return [];

  const quotes = result.indicators?.quote?.[0];
  if (!quotes) return [];

  const bars: OhlcBar[] = [];
  for (let i = 0; i < result.timestamp.length; i++) {
    const close = quotes.close?.[i];
    if (close == null) continue;
    const date = new Date(result.timestamp[i] * 1000);
    bars.push({
      date: toLocalDateKey(date),
      open: quotes.open?.[i] ?? close,
      high: quotes.high?.[i] ?? close,
      low: quotes.low?.[i] ?? close,
      close,
      volume: quotes.volume?.[i] ?? undefined,
    });
  }

  return bars;
}

async function fetchChart(
  symbol: string,
  periodStart: Date,
  periodEnd: Date,
): Promise<OhlcBar[]> {
  try {
    const primary = resolveYahooQuoteSymbol(symbol);
    let bars = await fetchChartForQuoteSymbol(primary, periodStart, periodEnd);
    if (
      bars.length === 0 &&
      primary !== symbol.trim() &&
      !symbol.includes("-")
    ) {
      bars = await fetchChartForQuoteSymbol(symbol.trim(), periodStart, periodEnd);
    }
    return bars;
  } catch {
    return [];
  }
}

function computeChangeFromBars(bars: OhlcBar[]): {
  price: number;
  change: number;
  changePercent: number;
} | null {
  if (bars.length < 2) return null;
  const last = bars[bars.length - 1];
  const prev = bars[bars.length - 2];
  if (last.close <= 0 || prev.close <= 0) return null;
  const change = last.close - prev.close;
  return {
    price: last.close,
    change,
    changePercent: change / prev.close,
  };
}

async function getDayChangeFromChart(
  symbol: string,
): Promise<{ price: number; change: number; changePercent: number } | null> {
  try {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 14);
  const bars = await fetchChart(symbol, start, end);
  if (bars.length < 2) return null;
  
  // Only compute today's change if we have today's bar.
  // Otherwise, if today has no data yet (market not open), return null.
  const today = toLocalDateKey(end);
  const lastBar = bars[bars.length - 1];
  if (lastBar.date !== today) {
    // Today's market has not yet reported; don't use previous day's change.
    return null;
  }
  
  return computeChangeFromBars(bars);
  } catch {
    return null;
  }
}

async function getDayChangeFromCache(
  symbol: string,
): Promise<{ price: number; change: number; changePercent: number } | null> {
  const quoteSymbol = resolveYahooQuoteSymbol(symbol);
  const candidates = [...new Set([symbol.trim(), quoteSymbol])];
  const today = toLocalDateKey(new Date());
  
  for (const sym of candidates) {
    const rows = await prisma.priceCache.findMany({
      where: { symbol: sym },
      orderBy: { date: "desc" },
      take: 2,
    });
    if (rows.length < 2) continue;
    const [latest, previous] = rows;
    
    // Only use this data if latest is from today.
    // Otherwise, if today has no data yet (market not open), return null.
    const latestDateStr = toLocalDateKey(latest.date);
    if (latestDateStr !== today) {
      // Today's market has not yet reported; don't use previous day's change.
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

type YahooQuotePayload = {
  regularMarketPrice?: number | null;
  postMarketPrice?: number | null;
  preMarketPrice?: number | null;
  regularMarketPreviousClose?: number | null;
};

/** 盤後／週末時 regularMarketPrice 可能為空，改取其他欄位或昨收 */
function extractYahooPrice(quote: YahooQuotePayload): number {
  const candidates = [
    quote.regularMarketPrice,
    quote.postMarketPrice,
    quote.preMarketPrice,
    quote.regularMarketPreviousClose,
  ];
  for (const p of candidates) {
    if (typeof p === "number" && p > 0) return p;
  }
  return 0;
}

async function getLatestCachedClose(symbol: string): Promise<number | null> {
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

function isTaiwanVixSymbol(symbol: string): boolean {
  return symbol.trim().toUpperCase() === TAIWAN_VIX_SYMBOL;
}

function parseLatestVixValue(rawText: string): number | null {
  const lines = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const match = lines[i]?.match(/(\d+(?:\.\d+)?)\s*$/);
    if (!match) continue;
    const value = Number(match[1]);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return null;
}

async function fetchTaiwanVixDailyClose(dateKey: string): Promise<number | null> {
  const url = `https://www.bq888.taifex.com.tw/cht/7/getVixData?filesname=${encodeURIComponent(dateKey)}`;
  const res = await fetchWithTimeout(url, { next: { revalidate: 30 } });
  if (!res?.ok) return null;
  const text = await res.text();
  return parseLatestVixValue(text);
}

/** 取得 bq888 上所有可用的 VIXTWN 日期清單（YYYYMMDD 格式，降冪排列） */
async function fetchTaiwanVixAvailableDates(): Promise<string[]> {
  const listRes = await fetchWithTimeout(TAIWAN_VIX_LIST_URL, {
    next: { revalidate: 3600 },
  });
  if (!listRes?.ok) return [];
  const html = await listRes.text();
  return Array.from(
    new Set(
      Array.from(html.matchAll(/getVixData\?filesname=(\d{8})/g)).map(
        (m) => m[1]!,
      ),
    ),
  );
}

/** 將 VIXTWN 日收盤值寫入 PriceCache（open=high=low=close=value） */
async function persistVixClose(dateKey: string, value: number): Promise<void> {
  const date = startOfDay(
    new Date(
      `${dateKey.slice(0, 4)}-${dateKey.slice(4, 6)}-${dateKey.slice(6, 8)}`,
    ),
  );
  enqueuePriceCacheWrite(async () => {
    await prisma.priceCache.upsert({
      where: { symbol_date: { symbol: TAIWAN_VIX_SYMBOL, date } },
      create: {
        symbol: TAIWAN_VIX_SYMBOL,
        date,
        open: value,
        high: value,
        low: value,
        close: value,
      },
      update: { open: value, high: value, low: value, close: value, cachedAt: new Date() },
    });
  });
}

/**
 * 抓取 VIXTWN 歷史日收盤並寫入 PriceCache。
 * 只抓 DB 中尚缺少的日期，並行數限制為 8。
 */
export async function syncVixHistory(
  periodStart: Date,
  periodEnd: Date,
): Promise<OhlcBar[]> {
  const startKey = toLocalDateKey(periodStart).replace(/-/g, "");
  const endKey = toLocalDateKey(periodEnd).replace(/-/g, "");

  // 先從 DB 取已有的資料
  const existing = await prisma.priceCache.findMany({
    where: {
      symbol: TAIWAN_VIX_SYMBOL,
      date: { gte: startOfLocalDay(periodStart), lte: startOfLocalDay(periodEnd) },
    },
    orderBy: { date: "asc" },
  });

  const existingKeys = new Set(
    existing.map((r) => toLocalDateKey(r.date).replace(/-/g, "")),
  );

  // 取 bq888 可用日期，篩出範圍內且 DB 缺少的
  const allDates = await fetchTaiwanVixAvailableDates();
  const missing = allDates.filter(
    (d) => d >= startKey && d <= endKey && !existingKeys.has(d),
  );

  // 並行抓取（concurrency=8）
  const CONCURRENCY = 8;
  for (let i = 0; i < missing.length; i += CONCURRENCY) {
    const batch = missing.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async (dateKey) => {
        const value = await fetchTaiwanVixDailyClose(dateKey);
        if (value != null && value > 0) {
          await persistVixClose(dateKey, value);
        }
      }),
    );
  }

  // 重新從 DB 讀取（含剛寫入的）
  const rows = await prisma.priceCache.findMany({
    where: {
      symbol: TAIWAN_VIX_SYMBOL,
      date: { gte: startOfLocalDay(periodStart), lte: startOfLocalDay(periodEnd) },
    },
    orderBy: { date: "asc" },
  });

  return rows.map((r) => ({
    date: toLocalDateKey(r.date),
    open: r.open ?? r.close,
    high: r.high ?? r.close,
    low: r.low ?? r.close,
    close: r.close,
    volume: r.volume ?? undefined,
  }));
}

async function fetchTaiwanVixQuote(): Promise<QuoteResult | null> {
  const liveRes = await fetchWithTimeout(TAIWAN_VIX_QUOTE_LIST_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ SortColumn: "", AscDesc: "A" }),
    next: { revalidate: 15 },
  });
  if (liveRes?.ok) {
    type TaifexVixItem = {
      SymbolID?: string;
      DispEName?: string;
      CLastPrice?: string;
      CRefPrice?: string;
      CDiff?: string;
      CDiffRate?: string;
    };
    type TaifexVixResponse = {
      RtCode?: string;
      RtData?: { QuoteList?: TaifexVixItem[] };
    };
    try {
      const payload = (await liveRes.json()) as TaifexVixResponse;
      const list = payload.RtData?.QuoteList ?? [];
      const item = list.find((row) => row.SymbolID?.toUpperCase() === "TAIWANVIX");
      if (item?.CLastPrice) {
        const price = Number(item.CLastPrice.replace(/,/g, ""));
        if (Number.isFinite(price) && price > 0) {
          const parseOptionalNumber = (value: string | undefined): number | undefined => {
            if (!value || !value.trim()) return undefined;
            const n = Number(value.replace("%", "").replace(/,/g, ""));
            return Number.isFinite(n) ? n : undefined;
          };
          const ref = parseOptionalNumber(item.CRefPrice);
          const diffRaw = parseOptionalNumber(item.CDiff);
          const diffRateRaw = parseOptionalNumber(item.CDiffRate);
          const change =
            diffRaw !== undefined && Number.isFinite(diffRaw)
              ? diffRaw
              : undefined;
          const changePercent =
            diffRateRaw !== undefined && Number.isFinite(diffRateRaw)
              ? diffRateRaw / 100
              : ref !== undefined && Number.isFinite(ref) && ref > 0
                ? (price - ref) / ref
                : undefined;

          const todayKey = toLocalDateKey(new Date()).replace(/-/g, "");
          void persistVixClose(todayKey, price);
          return {
            symbol: TAIWAN_VIX_SYMBOL,
            name: item.DispEName ?? "TAIWAN VIX",
            price,
            currency: "TWD",
            change,
            changePercent,
          };
        }
      }
    } catch {
      // Fall through to historical file fallback.
    }
  }

  // Fallback source: daily download pages (not realtime).
  const listRes = await fetchWithTimeout(TAIWAN_VIX_LIST_URL, {
    next: { revalidate: 30 },
  });
  if (!listRes?.ok) return null;
  const html = await listRes.text();

  const dates = Array.from(
    new Set(
      Array.from(html.matchAll(/getVixData\?filesname=(\d{8})/g)).map(
        (m) => m[1],
      ),
    ),
  );
  if (dates.length === 0) return null;

  const latest = await fetchTaiwanVixDailyClose(dates[0]!);
  if (latest == null || latest <= 0) return null;

  let change: number | undefined;
  let changePercent: number | undefined;
  if (dates[1]) {
    const previous = await fetchTaiwanVixDailyClose(dates[1]);
    if (previous != null && previous > 0) {
      change = latest - previous;
      changePercent = change / previous;
    }
  }

  return {
    symbol: TAIWAN_VIX_SYMBOL,
    name: "TAIWAN VIX",
    price: latest,
    currency: "TWD",
    change,
    changePercent,
  };
}

async function getWeekChangeFromCache(symbol: string): Promise<number | null> {
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

/**
 * 以日線收盤比較「約 calendarDays 個曆日前」至今的漲跌幅（與週漲跌邏輯相同）。
 * bars 會依日期排序後計算。
 */
export function computePeriodChangePercent(
  bars: OhlcBar[],
  calendarDays: number,
): number | null {
  if (bars.length < 2 || calendarDays <= 0) return null;

  const sorted = [...bars].sort((a, b) => a.date.localeCompare(b.date));
  const latest = sorted[sorted.length - 1]!;
  const target = new Date();
  target.setDate(target.getDate() - calendarDays);
  const targetKey = toLocalDateKey(target);

  let ref: OhlcBar | null = null;
  for (const bar of sorted) {
    if (bar.date <= targetKey) ref = bar;
  }
  const fallbackSteps = Math.max(1, Math.ceil((calendarDays * 5) / 7));
  if (!ref || ref.date === latest.date) {
    ref = sorted[Math.max(0, sorted.length - 1 - fallbackSteps)]!;
  }
  if (ref.date === latest.date || ref.close <= 0 || latest.close <= 0) {
    return null;
  }
  return (latest.close - ref.close) / ref.close;
}

function weekChangeFromBars(bars: OhlcBar[]): number | null {
  return computePeriodChangePercent(bars, 7);
}

async function getWeekChangeViaRangeApi(symbol: string): Promise<number | null> {
  const quoteSymbol = resolveYahooQuoteSymbol(symbol);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(quoteSymbol)}?interval=1d&range=1mo`;
  const res = await fetchWithTimeout(url, { next: { revalidate: 900 } });
  if (!res?.ok) return null;

  const data = (await res.json()) as ChartResponse;
  const result = data.chart?.result?.[0];
  if (!result) return null;
  const quotes = result.indicators?.quote?.[0];
  if (!quotes?.close?.length) return null;

  const timestamps = result.timestamp ?? [];
  const bars: OhlcBar[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const close = quotes.close[i];
    if (close == null || close <= 0) continue;
    bars.push({
      date: toLocalDateKey(new Date(timestamps[i]! * 1000)),
      open: close,
      high: close,
      low: close,
      close,
    });
  }
  return weekChangeFromBars(bars);
}

async function getWeekChangeFromChart(symbol: string): Promise<number | null> {
  try {
    const fromRange = await getWeekChangeViaRangeApi(symbol);
    if (fromRange != null) return fromRange;

    const end = new Date();
    const start = new Date(end);
    start.setDate(start.getDate() - 30);
    const bars = await fetchChart(symbol, start, end);
    const fromChart = weekChangeFromBars(bars);
    if (fromChart != null) return fromChart;
    return getWeekChangeFromCache(symbol);
  } catch {
    return getWeekChangeFromCache(symbol);
  }
}

async function getLatestCloseFromChart(symbol: string): Promise<number | null> {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 10);
  const bars = await fetchChart(symbol, start, end);
  const last = bars[bars.length - 1];
  return last && last.close > 0 ? last.close : null;
}

export async function getWeekChangePercents(
  symbols: string[],
): Promise<Map<string, number | null>> {
  const unique = [...new Set(symbols.map((s) => s.trim().toUpperCase()))];
  const entries = await Promise.all(
    unique.map(async (sym) => [sym, await getWeekChangeFromChart(sym)] as const),
  );
  return new Map(entries);
}

export async function validateSymbol(symbol: string): Promise<QuoteResult | null> {
  try {
    if (isTaiwanVixSymbol(symbol)) {
      return fetchTaiwanVixQuote();
    }
    const quote = await yahooQuote(resolveYahooQuoteSymbol(symbol));
    const price = quote ? extractYahooPrice(quote) : 0;
    if (!quote || price <= 0) return null;
    return {
      symbol: quote.symbol ?? symbol,
      name: quote.shortName ?? quote.longName,
      price,
      currency: quote.currency,
      change: quote.regularMarketChange,
      changePercent: normalizeYahooChangePercent(
        quote.regularMarketChangePercent,
      ),
    };
  } catch {
    return null;
  }
}

/** 追蹤清單加入：盤後／週末仍盡力取得可驗證報價 */
export async function resolveQuoteForWatchlist(
  symbol: string,
): Promise<QuoteResult | null> {
  const sym = symbol.trim();
  if (!sym) return null;
  const upper = sym.toUpperCase();

  const validated = await validateSymbol(sym);
  if (validated && validated.price > 0) return validated;

  const quote = await getQuote(sym);
  if (quote.price > 0) return quote;

  const chartClose = await getLatestCloseFromChart(sym);
  if (chartClose != null && chartClose > 0) {
    return { symbol: upper, price: chartClose };
  }

  const cached = await getLatestCachedClose(sym);
  if (cached != null && cached > 0) {
    return { symbol: upper, price: cached };
  }

  return null;
}

/** 搜尋可找到代碼即可加入（不必有即時報價） */
export async function canAddSymbolToWatchlist(
  symbol: string,
): Promise<{ symbol: string; name?: string; price?: number } | null> {
  const sym = symbol.trim().toUpperCase();
  if (!sym) return null;

  const quote = await resolveQuoteForWatchlist(sym);
  if (quote?.price && quote.price > 0) {
    return { symbol: sym, name: quote.name, price: quote.price };
  }

  const { searchInstruments } = await import("@/lib/instrument-search");
  const results = await searchInstruments(sym);
  const hit = results.find((r) => r.symbol.toUpperCase() === sym);
  if (hit) {
    return {
      symbol: hit.symbol.toUpperCase(),
      name: hit.name,
      price: quote?.price,
    };
  }

  return quote ? { symbol: sym, name: quote.name, price: quote.price } : null;
}

function applyTaiwanQuoteClose(
  symbol: string,
  result: QuoteResult,
  prevClose: number | null | undefined,
): QuoteResult {
  if (!isTaiwanStockSymbol(symbol) || prevClose == null || prevClose <= 0) {
    return result;
  }
  const reconciled = reconcileTaiwanQuoteFromPreviousClose(result, prevClose);
  return {
    ...result,
    ...reconciled,
    previousClose: prevClose,
  };
}

export async function getQuote(symbol: string): Promise<QuoteResult> {
  if (isTaiwanVixSymbol(symbol)) {
    const twVix = await fetchTaiwanVixQuote();
    return twVix ?? { symbol: TAIWAN_VIX_SYMBOL, price: 0 };
  }

  const quoteSymbol = resolveYahooQuoteSymbol(symbol);
  const cached = await getLatestCachedClose(symbol);
  const isTw = isTaiwanStockSymbol(symbol);

  const fromChartOrCache = async (): Promise<QuoteResult | null> => {
    try {
      const fromChart = await getDayChangeFromChart(symbol);
      if (fromChart) {
        return {
          symbol,
          price: fromChart.price,
          change: fromChart.change,
          changePercent: fromChart.changePercent,
        };
      }
      const fromCache = await getDayChangeFromCache(symbol);
      if (fromCache) {
        return {
          symbol,
          price: fromCache.price,
          change: fromCache.change,
          changePercent: fromCache.changePercent,
        };
      }
      if (cached != null) {
        return { symbol, price: cached };
      }
    } catch {
      if (cached != null) {
        return { symbol, price: cached };
      }
    }
    return null;
  };

  if (isTw && isTaiwanMarketClosed()) {
    const fromChart = await getDayChangeFromChart(symbol);
    if (fromChart) {
      const meta = await yahooQuote(quoteSymbol);
      return {
        symbol,
        name: meta?.shortName ?? meta?.longName,
        currency: meta?.currency,
        price: fromChart.price,
        change: fromChart.change,
        changePercent: fromChart.changePercent,
        previousClose:
          fromChart.price > 0 && fromChart.change != null
            ? fromChart.price - fromChart.change
            : undefined,
      };
    }
  }

  try {
    const quote = await yahooQuote(quoteSymbol);
    if (!quote) {
      const fallback = await fromChartOrCache();
      const base = fallback ?? { symbol, price: cached ?? 0 };
      return applyTaiwanQuoteClose(symbol, { ...base, stale: true }, undefined);
    }
    const price = extractYahooPrice(quote) || cached || 0;
    let change = quote.regularMarketChange ?? undefined;
    const prev = quote.regularMarketPreviousClose ?? null;

    // PriceCache has reliable daily closes written by our own fetcher.
    // Yahoo's regularMarketPreviousClose can lag by a day when a bar is missing
    // in Yahoo's own chart (e.g. ^TWII on public holidays where Yahoo stores null).
    // If our cache has today's close AND a previous close, prefer that for the
    // change/changePercent calculation — it's unambiguous.
    const cacheChange = await getDayChangeFromCache(symbol);
    let changePercent: number | undefined;
    if (cacheChange?.changePercent != null) {
      change = cacheChange.change;
      changePercent = cacheChange.changePercent;
    } else if (change != null && prev != null && prev > 0) {
      changePercent = change / prev;
    } else if (change == null && prev != null && price > 0) {
      change = price - prev;
      changePercent = prev > 0 ? change / prev : undefined;
    } else {
      changePercent = normalizeYahooChangePercent(quote.regularMarketChangePercent);
    }

    if (change === undefined || change === null) {
      const fallback = await fromChartOrCache();
      if (fallback?.change != null) {
        return applyTaiwanQuoteClose(
          symbol,
          {
            symbol: quote.symbol ?? symbol,
            name: quote.shortName ?? quote.longName,
            price: price > 0 ? price : fallback.price,
            currency: quote.currency,
            change: fallback.change,
            changePercent: fallback.changePercent,
          },
          prev,
        );
      }
    }

    return applyTaiwanQuoteClose(
      symbol,
      {
        symbol: quote.symbol ?? symbol,
        name: quote.shortName ?? quote.longName,
        price,
        currency: quote.currency,
        change,
        changePercent,
      },
      prev,
    );
  } catch {
    const fallback = await fromChartOrCache();
    if (fallback) {
      return applyTaiwanQuoteClose(symbol, { ...fallback, stale: true }, undefined);
    }
    return { symbol, price: 0, stale: true };
  }
}

export async function getQuotes(symbols: string[]): Promise<Map<string, QuoteResult>> {
  const map = new Map<string, QuoteResult>();
  await Promise.all(
    symbols.map(async (symbol) => {
      try {
        map.set(symbol, await getQuote(symbol));
      } catch {
        const cached = await getLatestCachedClose(symbol);
        map.set(symbol, { symbol, price: cached ?? 0, stale: true });
      }
    }),
  );
  return map;
}

export async function getHistoricalPrices(
  symbol: string,
  periodStart: Date,
  periodEnd: Date,
): Promise<OhlcBar[]> {
  if (isTaiwanVixSymbol(symbol)) {
    return syncVixHistory(periodStart, periodEnd);
  }

  const cached = await getCachedHistory(symbol, periodStart, periodEnd);
  const needsRefresh =
    cached.length === 0 ||
    !cacheCoversRange(cached, periodStart, periodEnd) ||
    Date.now() - (cached[cached.length - 1]?.cachedAt?.getTime() ?? 0) >
      CACHE_TTL_MS;

  if (!needsRefresh && cached.length > 0) {
    return cached.map((c) => ({
      date: toLocalDateKey(c.date),
      open: c.open ?? c.close,
      high: c.high ?? c.close,
      low: c.low ?? c.close,
      close: c.close,
      volume: c.volume ?? undefined,
    }));
  }

  const cachedBars = cached.map((c) => ({
    date: toLocalDateKey(c.date),
    open: c.open ?? c.close,
    high: c.high ?? c.close,
    low: c.low ?? c.close,
    close: c.close,
    volume: c.volume ?? undefined,
  }));

  try {
    const history = await fetchChart(symbol, periodStart, periodEnd);

    // fetchChart swallows errors and returns [] on timeout / network failure.
    // If we got nothing back but have stale cached rows, serve the cache rather
    // than returning an empty chart.
    if (history.length === 0) {
      return cachedBars;
    }

    const sorted = history.sort((a, b) => a.date.localeCompare(b.date));
    enqueuePriceCacheWrite(() => persistPriceHistory(symbol, sorted));
    return sorted;
  } catch {
    return cachedBars;
  }
}

function cacheCoversRange(
  cached: { date: Date }[],
  periodStart: Date,
  periodEnd: Date,
): boolean {
  if (cached.length === 0) return false;
  const startMs = startOfLocalDay(periodStart).getTime();
  const endMs = startOfLocalDay(periodEnd).getTime();
  const firstMs = startOfDay(cached[0].date).getTime();
  const lastMs = startOfDay(cached[cached.length - 1].date).getTime();
  const startSlack = 7 * 24 * 60 * 60 * 1000;
  const endSlack = 3 * 24 * 60 * 60 * 1000;
  return firstMs <= startMs + startSlack && lastMs >= endMs - endSlack;
}

async function getCachedHistory(symbol: string, start: Date, end: Date) {
  return prisma.priceCache.findMany({
    where: {
      symbol,
      date: { gte: startOfLocalDay(start), lte: startOfLocalDay(end) },
    },
    orderBy: { date: "asc" },
  });
}

async function persistPriceHistory(
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

function startOfDay(d: Date): Date {
  const copy = new Date(d);
  copy.setUTCHours(0, 0, 0, 0);
  return copy;
}

/** 用本地日曆日（而非 UTC）轉成 UTC 午夜，避免凌晨 0:00~08:00 台灣時間跨日偏移 */
function startOfLocalDay(d: Date): Date {
  return new Date(toLocalDateKey(d) + "T00:00:00.000Z");
}

export { inferAssetClass };
