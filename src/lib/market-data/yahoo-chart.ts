import "server-only";

import YahooFinance from "yahoo-finance2";
import { toLocalDateKey } from "@/lib/date-keys";
import { fetchWithShortTimeout } from "@/lib/http-fetch";
import { isCryptoSymbol, resolveYahooQuoteSymbol } from "@/lib/market-utils";

export { resolveYahooQuoteSymbol };

/** Yahoo Finance 的 HTTP 存取：chart 端點（不需要 crumb）與 yahoo-finance2 的
 *  .quote()。只負責抓資料跟解析，不碰資料庫；快取讀寫在 price-cache.ts。 */

const yahooFinance = new YahooFinance();

/** 網路不穩時快速失敗，改走 DB 快取 */
const YAHOO_FETCH_TIMEOUT_MS = 6_000;
export { TAIWAN_VIX_SYMBOL } from "@/lib/custom-series-symbols";

export async function fetchWithTimeout(
  url: string,
  init?: RequestInit & { next?: { revalidate?: number } },
): Promise<Response | null> {
  return fetchWithShortTimeout(url, init, YAHOO_FETCH_TIMEOUT_MS);
}

export async function yahooQuote(symbol: string) {
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


export function inferAssetClass(symbol: string): string {
  if (isCryptoSymbol(symbol)) return "crypto";
  if (symbol.startsWith("^")) return "index";
  if (symbol.endsWith(".TW") && /^\d{4}/.test(symbol)) return "stock";
  return "stock";
}

type ChartResponse = {
  chart?: {
    result?: Array<{
      meta?: {
        currency?: string;
        shortName?: string;
        longName?: string;
        regularMarketPrice?: number;
      };
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
      events?: {
        splits?: Record<string, { date: number; numerator: number; denominator: number }>;
      };
    }>;
  };
};

export type SplitEvent = { date: Date; numerator: number; denominator: number };

/** 抓某標的完整歷史的股票分割事件（不只是最近的，避免第一次跑漏掉舊分割）
 *
 *  `events.splits` 是完整回傳的，跟 interval 疏密無關，但價格陣列會照 interval
 *  一起送過來——用 1d 等於為了幾個分割事件下載整份日線（實測 AAPL 1.24 MB、
 *  LMT 1.40 MB，開機維護光這段就要拉幾十 MB）。改用 1wk 後同樣的資料只剩約
 *  五分之一（AAPL 265 KB）。不再往下調是因為實測 1mo／3mo 的序列起點會被
 *  Yahoo 砍到 1985 年，早於此的分割會整筆消失（BA 的 1977-09-13 2:1 就是這樣
 *  掉的，1d 與 1wk 都抓得到，1mo／3mo 抓不到）。 */
export async function fetchSplitEvents(symbol: string): Promise<SplitEvent[]> {
  try {
    const quoteSymbol = resolveYahooQuoteSymbol(symbol);
    const period2 = Math.floor(Date.now() / 1000);
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(quoteSymbol)}?period1=0&period2=${period2}&interval=1wk&events=split`;
    const res = await fetchWithTimeout(url, { next: { revalidate: 86400 } });
    if (!res?.ok) return [];

    const data = (await res.json()) as ChartResponse;
    const splits = data.chart?.result?.[0]?.events?.splits;
    if (!splits) return [];

    return Object.values(splits).map((s) => ({
      date: new Date(s.date * 1000),
      numerator: s.numerator,
      denominator: s.denominator,
    }));
  } catch {
    return [];
  }
}

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

export async function fetchChart(
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

export function computeChangeFromBars(bars: OhlcBar[]): {
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

export async function getDayChangeFromChart(
  symbol: string,
): Promise<{ price: number; change: number; changePercent: number } | null> {
  try {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 14);
  const bars = await fetchChart(symbol, start, end);
  if (bars.length < 2) return null;

  // 不再要求「最新一根必須等於伺服器本地日曆的今天」：這個比較用的是台灣
  // 本地時區，對美股來說幾乎永遠對不上（美股交易日換算成台灣日期時，幾乎
  // 都落在「昨天」），會導致明明剛抓到最新資料卻被判定為不可用、白白退回
  // 舊快取。改為直接信任 Yahoo 回傳的最後兩根，不論它們對應到哪個日曆日。
  return computeChangeFromBars(bars);
  } catch {
    return null;
  }
}

type ChartSnapshot = {
  meta: { currency?: string; name?: string; price?: number } | null;
  bars: OhlcBar[];
  /** 若最新一根有效 close 前面緊鄰著一個 null（缺口），這裡是那個缺口日期
   *  的 YYYYMMDD；否則是 undefined。目前只給 ^TWII 拿去查證交所校正用。 */
  gapDateKey?: string;
  /** 時間軸最後一格（最新交易日）的 close 是不是 null——盤中會即時更新這格
   *  （美股尤其明顯，跟 meta.regularMarketPrice 幾乎同步），但有些市場（實測
   *  台股尤其明顯）收盤後這格常常要好幾個小時才補上真正的收盤價，這段空窗期
   *  這裡會是 true，代表 bars 陣列裡最新一根有效 close 其實還停在「前一個」
   *  交易日，比 meta.regularMarketPrice 舊了一整天。 */
  latestBarPending: boolean;
};

/** 單一請求同時取得 meta（名稱／幣別／現價）與日線 K 棒，避免多打一次請求。 */
export async function fetchChartSnapshot(quoteSymbol: string): Promise<ChartSnapshot | null> {
  try {
    const end = new Date();
    const start = new Date(end);
    start.setDate(start.getDate() - 14);
    const period1 = Math.floor(start.getTime() / 1000);
    const period2 = Math.floor(end.getTime() / 1000);
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(quoteSymbol)}?period1=${period1}&period2=${period2}&interval=1d`;
    const res = await fetchWithTimeout(url, { next: { revalidate: 900 } });
    if (!res?.ok) return null;

    const data = (await res.json()) as ChartResponse;
    const result = data.chart?.result?.[0];
    if (!result) return null;

    const meta = result.meta
      ? {
          currency: result.meta.currency,
          name: result.meta.longName ?? result.meta.shortName,
          price: result.meta.regularMarketPrice,
        }
      : null;

    const bars: OhlcBar[] = [];
    const quotes = result.indicators?.quote?.[0];
    const rawCloses = quotes?.close ?? [];
    if (result.timestamp && quotes) {
      for (let i = 0; i < result.timestamp.length; i++) {
        const close = quotes.close?.[i];
        if (close == null) continue;
        bars.push({
          date: toLocalDateKey(new Date(result.timestamp[i] * 1000)),
          open: quotes.open?.[i] ?? close,
          high: quotes.high?.[i] ?? close,
          low: quotes.low?.[i] ?? close,
          close,
          volume: quotes.volume?.[i] ?? undefined,
        });
      }
    }

    let gapDateKey: string | undefined;
    let lastValidIdx = -1;
    for (let i = rawCloses.length - 1; i >= 0; i--) {
      if (rawCloses[i] != null) {
        lastValidIdx = i;
        break;
      }
    }
    if (lastValidIdx > 0 && rawCloses[lastValidIdx - 1] == null) {
      const gapTs = result.timestamp?.[lastValidIdx - 1];
      if (gapTs != null) {
        gapDateKey = toLocalDateKey(new Date(gapTs * 1000)).replace(/-/g, "");
      }
    }

    const latestBarPending =
      rawCloses.length > 0 && rawCloses[rawCloses.length - 1] == null;

    return { meta, bars, gapDateKey, latestBarPending };
  } catch {
    return null;
  }
}

type YahooQuotePayload = {
  regularMarketPrice?: number | null;
  postMarketPrice?: number | null;
  preMarketPrice?: number | null;
  regularMarketPreviousClose?: number | null;
};

/** 盤後／週末時 regularMarketPrice 可能為空，改取其他欄位或昨收 */
export function extractYahooPrice(quote: YahooQuotePayload): number {
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

export function weekChangeFromBars(bars: OhlcBar[]): number | null {
  return computePeriodChangePercent(bars, 7);
}

export async function getWeekChangeViaRangeApi(symbol: string): Promise<number | null> {
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

export async function getLatestCloseFromChart(symbol: string): Promise<number | null> {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 10);
  const bars = await fetchChart(symbol, start, end);
  const last = bars[bars.length - 1];
  return last && last.close > 0 ? last.close : null;
}
