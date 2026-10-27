import "server-only";

import {
  TAIWAN_MARGIN_BALANCE_SYMBOL,
  TAIWAN_MARGIN_RATIO_SYMBOL,
} from "@/lib/custom-series-symbols";
import { dbWriteLimiter } from "@/lib/concurrency-limiter";
import { toLocalDateKey } from "@/lib/date-keys";
import { fetchWithShortTimeout } from "@/lib/http-fetch";
import {
  getCachedBars,
  getCachedHistory,
  getDayChangeFromCache,
  upsertDailyClose,
} from "@/lib/market-data/price-cache";
import type { OhlcBar, QuoteResult } from "@/lib/market-data/yahoo-chart";
import {
  combineMarginMarket,
  maintenanceRatioPercent,
  parseTpexCloses,
  parseTpexMargin,
  parseTwseCloses,
  parseTwseMarginAll,
} from "@/lib/market-series-parsers";

/** 台股融資餘額與大盤融資維持率（上市＋上櫃）。
 *  官方只公布融資餘額；維持率是自己算的：Σ(各股融資餘額股數 × 收盤價) ÷ 融資金額。
 *  一個交易日要打 4 個請求（證交所、櫃買中心各兩個），證交所請求太密會被封 IP，
 *  所以每個交易所各自排隊、請求間隔拉開。資料在交易日晚上才公布。 */

const BALANCE_UNIT = 1e8; // 億元
const FETCH_TIMEOUT_MS = 30_000;
const TWSE_GAP_MS = 2_500;
const TPEX_GAP_MS = 1_000;
/** 晚上幾點後才當作當日資料已公布 */
const PUBLISH_HOUR = 21;
/** 同一天抓不到（假日、尚未公布、網路失敗）之後隔多久再試 */
const RETRY_COOLDOWN_MS = 6 * 60 * 60 * 1000;
/** 開圖表／報價時最多補幾個交易日；完整歷史用 scripts/backfill-market-series.ts */
const ON_DEMAND_MAX_DAYS = 3;
const ON_DEMAND_LOOKBACK_DAYS = 30;

const lastAttempt = new Map<string, number>();

function createGate(gapMs: number) {
  let nextAt = 0;
  let chain: Promise<unknown> = Promise.resolve();
  return function run<T>(fn: () => Promise<T>): Promise<T> {
    const result = chain.then(async () => {
      const wait = nextAt - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      try {
        return await fn();
      } finally {
        nextAt = Date.now() + gapMs;
      }
    });
    chain = result.catch(() => undefined);
    return result;
  };
}

const twseGate = createGate(TWSE_GAP_MS);
const tpexGate = createGate(TPEX_GAP_MS);

async function fetchJson<T>(url: string, gate: ReturnType<typeof createGate>): Promise<T | null> {
  return gate(async () => {
    const res = await fetchWithShortTimeout(url, { cache: "no-store" }, FETCH_TIMEOUT_MS);
    if (!res?.ok) return null;
    try {
      return (await res.json()) as T;
    } catch {
      return null;
    }
  });
}

async function fetchTwseDay(dateKey: string) {
  const margin = parseTwseMarginAll(
    (await fetchJson(
      `https://www.twse.com.tw/rwd/zh/marginTrading/MI_MARGN?date=${dateKey}&selectType=ALL&response=json`,
      twseGate,
    )) ?? {},
  );
  if (!margin) return null;
  const closes = parseTwseCloses(
    (await fetchJson(
      `https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?date=${dateKey}&type=ALLBUT0999&response=json`,
      twseGate,
    )) ?? {},
  );
  return closes ? combineMarginMarket(margin, closes) : null;
}

async function fetchTpexDay(dateKey: string) {
  const date = encodeURIComponent(
    `${dateKey.slice(0, 4)}/${dateKey.slice(4, 6)}/${dateKey.slice(6, 8)}`,
  );
  const margin = parseTpexMargin(
    (await fetchJson(
      `https://www.tpex.org.tw/www/zh-tw/margin/balance?date=${date}&response=json`,
      tpexGate,
    )) ?? {},
  );
  if (!margin) return null;
  const closes = parseTpexCloses(
    (await fetchJson(
      `https://www.tpex.org.tw/www/zh-tw/afterTrading/otc?date=${date}&type=EW&response=json`,
      tpexGate,
    )) ?? {},
  );
  return closes ? combineMarginMarket(margin, closes) : null;
}

/** 抓某交易日（YYYYMMDD）並寫入兩個序列；當天沒資料（假日、尚未公布）回傳 false */
export async function syncMarginDay(dateKey: string): Promise<boolean> {
  lastAttempt.set(dateKey, Date.now());
  const [twse, tpex] = await Promise.all([fetchTwseDay(dateKey), fetchTpexDay(dateKey)]);
  if (!twse || !tpex) return false;
  const ratio = maintenanceRatioPercent([twse, tpex]);
  if (ratio == null) return false;
  const balance = (twse.loanAmount + tpex.loanAmount) / BALANCE_UNIT;
  await dbWriteLimiter.run(async () => {
    await upsertDailyClose(TAIWAN_MARGIN_BALANCE_SYMBOL, dateKey, Math.round(balance * 100) / 100);
    await upsertDailyClose(TAIWAN_MARGIN_RATIO_SYMBOL, dateKey, Math.round(ratio * 100) / 100);
  });
  return true;
}

const compactKey = (d: Date) => toLocalDateKey(d).replace(/-/g, "");

/** 區間內兩個序列有缺的工作日（YYYYMMDD，降冪）；當天要到晚上公布後才算 */
export async function findMissingMarginDays(start: Date, end: Date): Promise<string[]> {
  const [balance, ratio] = await Promise.all([
    getCachedHistory(TAIWAN_MARGIN_BALANCE_SYMBOL, start, end),
    getCachedHistory(TAIWAN_MARGIN_RATIO_SYMBOL, start, end),
  ]);
  const haveBalance = new Set(balance.map((r) => compactKey(r.date)));
  const haveRatio = new Set(ratio.map((r) => compactKey(r.date)));

  const now = new Date();
  const lastDay = new Date(Math.min(end.getTime(), now.getTime()));
  if (compactKey(lastDay) === compactKey(now) && now.getHours() < PUBLISH_HOUR) {
    lastDay.setDate(lastDay.getDate() - 1);
  }
  const missing: string[] = [];
  for (const d = new Date(lastDay); d >= start; d.setDate(d.getDate() - 1)) {
    if (d.getDay() === 0 || d.getDay() === 6) continue;
    const key = compactKey(d);
    if (!haveBalance.has(key) || !haveRatio.has(key)) missing.push(key);
  }
  return missing;
}

/** 補最近幾個缺的交易日（有冷卻時間，假日不會每次開頁都重打） */
async function syncRecentMarginDays(end: Date): Promise<void> {
  const start = new Date(end.getTime() - ON_DEMAND_LOOKBACK_DAYS * 86_400_000);
  const now = Date.now();
  const due = (await findMissingMarginDays(start, end))
    .filter((k) => now - (lastAttempt.get(k) ?? 0) > RETRY_COOLDOWN_MS)
    .slice(0, ON_DEMAND_MAX_DAYS);
  // 選定就先標記，避免報價與圖表同時觸發時重複抓同一天
  for (const key of due) lastAttempt.set(key, now);
  for (const key of due) await syncMarginDay(key).catch(() => false);
}

export async function syncMarginHistory(
  symbol: string,
  periodStart: Date,
  periodEnd: Date,
): Promise<OhlcBar[]> {
  await syncRecentMarginDays(periodEnd);
  return getCachedBars(symbol, periodStart, periodEnd);
}

export async function fetchTaiwanMarginQuote(symbol: string): Promise<QuoteResult | null> {
  const name =
    symbol === TAIWAN_MARGIN_BALANCE_SYMBOL ? "台股融資餘額（億元）" : "大盤融資維持率（%）";
  let cached = await getDayChangeFromCache(symbol, Infinity);
  if (cached) {
    // 已有資料就先回快取，背景補最新一天，不讓報價等證交所的慢請求
    void syncRecentMarginDays(new Date()).catch(() => undefined);
  } else {
    await syncRecentMarginDays(new Date());
    cached = await getDayChangeFromCache(symbol, Infinity);
  }
  return cached ? { symbol, name, currency: "TWD", ...cached } : null;
}
