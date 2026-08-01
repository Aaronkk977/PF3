import "server-only";

import YahooFinance from "yahoo-finance2";
import { mapWithConcurrency } from "@/lib/async-pool";
import { dbWriteLimiter, externalReadLimiter } from "@/lib/concurrency-limiter";
import { toLocalDateKey } from "@/lib/date-keys";
import { prisma } from "@/lib/db";
import { fetchWithShortTimeout } from "@/lib/http-fetch";
import {
  isCryptoSymbol,
  isTaiwanStockSymbol,
  reconcileTaiwanQuoteFromPreviousClose,
} from "@/lib/market-utils";

const yahooFinance = new YahooFinance();

const CACHE_TTL_MS = 15 * 60 * 1000;
/** 尾端過期時只重抓最近這幾天（涵蓋週末與遲報的收盤價），其餘信任快取 */
const RECENT_REFRESH_DAYS = 7;
/** 每天至少做一次全區間重抓，接住分割／減資造成的歷史回溯調整 */
const FULL_REFRESH_MS = 24 * 60 * 60 * 1000;
/** 網路不穩時快速失敗，改走 DB 快取 */
const YAHOO_FETCH_TIMEOUT_MS = 6_000;
const PRICE_CACHE_UPSERT_CHUNK = 50;
const TAIWAN_VIX_SYMBOL = "VIXTWN";
const TAIWAN_VIX_QUOTE_LIST_URL =
  "https://mis.taifex.com.tw/futures/api/getQuoteListVIX";
const TAIWAN_VIX_LIST_URL = "https://www.bq888.taifex.com.tw/cht/7/vixMinNew";
/** 加權指數：Yahoo 的日線 chart 偶爾會漏掉某個交易日（close 為 null），
 *  導致算漲跌幅時誤用更早之前的收盤價當「昨收」。缺口出現時改查證交所
 *  官方「大盤統計資訊」報表校正。 */
const TAIEX_SYMBOL = "^TWII";

/** PriceCache 寫入一律排進全域共用的 dbWriteLimiter，避免多標的並行 upsert
 *  造成 SQLite 鎖定逾時——不 await（呼叫端不用等寫入真的完成），但仍佔用
 *  dbWriteLimiter 的名額，所以會跟其他批次寫入（例如股票分割）正確共享同一個
 *  全域上限，不會加總超標。 */
function enqueuePriceCacheWrite(work: () => Promise<void>): void {
  dbWriteLimiter.run(work).catch((e) => {
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
async function fetchChartSnapshot(quoteSymbol: string): Promise<ChartSnapshot | null> {
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

function isTaiexSymbol(symbol: string): boolean {
  return symbol.trim().toUpperCase() === TAIEX_SYMBOL;
}

/** 查證交所官方「大盤統計資訊」報表，取得指定日期的加權指數收盤值 */
async function fetchTaiexOfficialClose(dateKey: string): Promise<number | null> {
  try {
    const url = `https://www.twse.com.tw/exchangeReport/MI_INDEX?response=json&date=${dateKey}&type=IND`;
    const res = await fetchWithTimeout(url, { next: { revalidate: 3600 } });
    if (!res?.ok) return null;
    const data = (await res.json()) as { tables?: Array<{ data?: string[][] }> };
    const rows = data.tables?.[0]?.data;
    const row = rows?.find((r) => r[0] === "發行量加權股價指數");
    const closeStr = row?.[1];
    if (!closeStr) return null;
    const close = Number(closeStr.replace(/,/g, ""));
    return Number.isFinite(close) && close > 0 ? close : null;
  } catch {
    return null;
  }
}

/** 把校正過的加權指數缺口收盤值補進 PriceCache，避免歷史圖表也留著同一個洞 */
function persistTaiexGapClose(dateKey: string, close: number): void {
  const date = startOfDay(
    new Date(`${dateKey.slice(0, 4)}-${dateKey.slice(4, 6)}-${dateKey.slice(6, 8)}`),
  );
  enqueuePriceCacheWrite(async () => {
    await prisma.priceCache.upsert({
      where: { symbol_date: { symbol: TAIEX_SYMBOL, date } },
      create: { symbol: TAIEX_SYMBOL, date, open: close, high: close, low: close, close },
      update: { open: close, high: close, low: close, close, cachedAt: new Date() },
    });
  });
}

/**
 * 不需要 crumb 的即時報價：價格／名稱／幣別／漲跌全部來自單一 chart 端點請求
 * （不受 .quote() 的 crumb 限流影響）。當作 getQuote 的主要資料來源，
 * .quote() 只在這條路失敗時當備援用。
 */
async function getLiveQuoteFromChart(symbol: string): Promise<QuoteResult | null> {
  const primary = resolveYahooQuoteSymbol(symbol);
  let snapshot = await fetchChartSnapshot(primary);
  if (
    (!snapshot || snapshot.bars.length === 0) &&
    primary !== symbol.trim() &&
    !symbol.includes("-")
  ) {
    snapshot = await fetchChartSnapshot(symbol.trim());
  }
  if (!snapshot) return null;

  let dayChange = computeChangeFromBars(snapshot.bars);
  let price = dayChange?.price ?? snapshot.meta?.price;
  if (!price || price <= 0) return null;

  // Yahoo 的日線 K 棒收盤值有時會比 meta.regularMarketPrice 慢好幾個小時才
  // 補齊——尤其台股收盤後到隔天凌晨這段時間，常常已經查得到「今天」這根
  // K 棒的時間戳記，但 close 欄位還是 null（latestBarPending），於是
  // computeChangeFromBars 只能拿「前一天 vs 前兩天」這組舊資料算漲跌，等於
  // 把漲跌幅算成整整多一個交易日的落差（實測看過因此把 -1% 左右的正常波動
  // 算成快要漲停的離譜數字）。這種情況才改用 meta 的即時價格當現價、K 棒的
  // 價格當昨收，重新算一次漲跌。
  //
  // 這裡刻意不是「meta 跟 K 棒價格對不上就換」——美股盤中 Yahoo 會把「今天」
  // 這根還沒收盤的 K 棒即時更新到幾乎等於 meta（只差浮點誤差），若用價格差
  // 當判斷依據，會把這點誤差誤判成「K 棒落後」，結果把本來就是今天的 K 棒
  // 錯當成昨天，拿今天的即時價跟自己相減，把真正的當日漲跌洗成 0%。
  // latestBarPending 是 Yahoo 明確告訴我們「最新這格是 null」的訊號，不受
  // 這種盤中即時更新的雜訊影響。
  if (dayChange && snapshot.latestBarPending && snapshot.meta?.price != null && snapshot.meta.price > 0) {
    const metaPrice = snapshot.meta.price;
    const prevClose = dayChange.price;
    const change = metaPrice - prevClose;
    dayChange = {
      price: metaPrice,
      change,
      changePercent: prevClose > 0 ? change / prevClose : 0,
    };
    price = metaPrice;
  }

  if (isTaiexSymbol(symbol) && snapshot.gapDateKey) {
    const officialPrevClose = await fetchTaiexOfficialClose(snapshot.gapDateKey);
    if (officialPrevClose) {
      const change = price - officialPrevClose;
      dayChange = { price, change, changePercent: change / officialPrevClose };
      persistTaiexGapClose(snapshot.gapDateKey, officialPrevClose);
    }
  }

  return {
    symbol,
    name: snapshot.meta?.name,
    currency: snapshot.meta?.currency,
    price,
    change: dayChange?.change,
    changePercent: dayChange?.changePercent,
    previousClose: dayChange ? price - dayChange.change : undefined,
  };
}

/**
 * @param maxAgeDays 快取最舊可以是幾天前，超過就不採用。
 *   兩種呼叫情境需要不同寬鬆度：
 *   - 純備援（其他資料來源都已失敗）：傳 Infinity，再舊的快取也比完全沒有好
 *     （呼叫端會自行標記 stale，使用者看得出來這不是即時資料）。
 *   - 決定要不要拿快取「覆蓋」剛成功拿到的即時報價：必須夠新（幾天內）才能
 *     覆蓋，否則會變成用陳年舊資料蓋掉這次明明抓到的新資料。
 */
async function getDayChangeFromCache(
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

  // 並行抓取，共用全域對外讀取上限
  await mapWithConcurrency(missing, externalReadLimiter, async (dateKey) => {
    const value = await fetchTaiwanVixDailyClose(dateKey);
    if (value != null && value > 0) {
      await persistVixClose(dateKey, value);
    }
  });

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
  const entries = await mapWithConcurrency(
    unique,
    externalReadLimiter,
    async (sym) => [sym, await getWeekChangeFromChart(sym)] as const,
  );
  return new Map(entries);
}

export async function validateSymbol(symbol: string): Promise<QuoteResult | null> {
  if (isTaiwanVixSymbol(symbol)) {
    return fetchTaiwanVixQuote();
  }
  try {
    const quote = await yahooQuote(resolveYahooQuoteSymbol(symbol));
    const price = quote ? extractYahooPrice(quote) : 0;
    if (quote && price > 0) {
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
    }
  } catch {
    // 退回不需要 crumb 的 chart 端點，見下方
  }
  // .quote() 失敗或被限流時，改用不需要 crumb 的 chart 端點驗證，
  // 確保 .quote() 被擋期間仍能正常新增追蹤標的。
  return getLiveQuoteFromChart(symbol).catch(() => null);
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

  // fetchChart 打的是不需要 crumb 的 v8/finance/chart 端點，即使 yahoo-finance2
  // 的 .quote()（需要 crumb）被限流，這條路仍可能正常拿到即時資料——因此只有
  // 真的退回資料庫舊快取時才標記 stale，chart 端點成功時不算 stale。
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
      const fromCache = await getDayChangeFromCache(symbol, Infinity);
      if (fromCache) {
        return {
          symbol,
          price: fromCache.price,
          change: fromCache.change,
          changePercent: fromCache.changePercent,
          stale: true,
        };
      }
      if (cached != null) {
        return { symbol, price: cached, stale: true };
      }
    } catch {
      if (cached != null) {
        return { symbol, price: cached, stale: true };
      }
    }
    return null;
  };

  // 主要資料來源：不需要 crumb 的 chart 端點，price/change/name/currency 都從
  // 這裡拿，平時穩定、也不受 .quote() 被限流影響；只有它失敗時才退回
  // .quote()／資料庫快取的舊邏輯當備援。
  const live = await getLiveQuoteFromChart(symbol);
  if (live) {
    return live;
  }

  try {
    const quote = await yahooQuote(quoteSymbol);
    if (!quote) {
      const fallback = await fromChartOrCache();
      const base = fallback ?? { symbol, price: cached ?? 0, stale: true };
      return applyTaiwanQuoteClose(symbol, base, undefined);
    }
    const price = extractYahooPrice(quote) || cached || 0;
    let change = quote.regularMarketChange ?? undefined;
    const prev = quote.regularMarketPreviousClose ?? null;

    // PriceCache has reliable daily closes written by our own fetcher.
    // Yahoo's regularMarketPreviousClose can lag by a day when a bar is missing
    // in Yahoo's own chart (e.g. ^TWII on public holidays where Yahoo stores null).
    // If our cache has today's close AND a previous close, prefer that for the
    // change/changePercent calculation — it's unambiguous. 這裡的快取要「夠新」
    // 才能拿來覆蓋剛成功拿到的即時報價，避免用陳年舊資料蓋掉新資料。
    const cacheChange = await getDayChangeFromCache(symbol, 2);
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
            stale: fallback.stale,
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
      return applyTaiwanQuoteClose(symbol, fallback, undefined);
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
  const cachedBars = cached.map((c) => ({
    date: toLocalDateKey(c.date),
    open: c.open ?? c.close,
    high: c.high ?? c.close,
    low: c.low ?? c.close,
    close: c.close,
    volume: c.volume ?? undefined,
  }));

  const covers = cacheCoversRange(cached, periodStart, periodEnd);
  // cachedAt 讀「日期最新那一列」，剛好就是下面只重抓的那段尾巴，兩者一致。
  const cacheAgeMs =
    Date.now() - (cached[cached.length - 1]?.cachedAt?.getTime() ?? 0);

  if (cached.length > 0 && covers && cacheAgeMs <= CACHE_TTL_MS) {
    return cachedBars;
  }

  // 已收盤日的日線是不可變的，沒必要為了「最新那根過了 15 分鐘」就把整段歷史
  // 重抓一次——那正是市值走勢冷啟動要 47～92 秒的原因（126 檔 × 完整歷史）。
  // 快取已經涵蓋整個區間、只是尾端過期時，只補最近幾天就好。
  //
  // 但分割／減資會讓 Yahoo 回溯調整**整段**歷史價，只補尾端會讓舊數字永遠停在
  // 調整前，所以保留每日一次的全區間重抓當逃生口。
  const fullRefresh =
    cached.length === 0 || !covers || cacheAgeMs > FULL_REFRESH_MS;
  const fetchStart = fullRefresh
    ? periodStart
    : new Date(
        Math.max(
          periodStart.getTime(),
          periodEnd.getTime() - RECENT_REFRESH_DAYS * 24 * 60 * 60 * 1000,
        ),
      );

  try {
    const history = await fetchChart(symbol, fetchStart, periodEnd);

    // fetchChart swallows errors and returns [] on timeout / network failure.
    // If we got nothing back but have stale cached rows, serve the cache rather
    // than returning an empty chart.
    if (history.length === 0) {
      return cachedBars;
    }

    const sorted = history.sort((a, b) => a.date.localeCompare(b.date));
    enqueuePriceCacheWrite(() => persistPriceHistory(symbol, sorted));

    // 以日期取聯集：這次抓到的優先，抓不到的沿用快取。
    //
    // 千萬不能寫成「快取前半 + 這次抓到的尾端」——Yahoo 對最新一個交易日很常
    // 先回 close=null（實測 0050.TW 在 2026-07-31 就是這樣，而快取裡早就存了
    // 當天的 101.25），而 fetchChart 會跳過 null。若用切割式合併，那根已經在
    // 資料庫裡的最新報價會整根消失，走勢圖與分析頁的基準線就會停在前一天，
    // 看起來像「大漲那天完全沒反應」。
    const merged = new Map<string, OhlcBar>(
      cachedBars.map((b) => [b.date, b] as const),
    );
    for (const bar of sorted) merged.set(bar.date, bar);
    return [...merged.values()].sort((a, b) => a.date.localeCompare(b.date));
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
