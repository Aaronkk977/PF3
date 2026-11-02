import { TAIWAN_VIX_SYMBOL } from "@/lib/custom-series-symbols";
import { isCryptoSymbol } from "@/lib/market-utils";

/** 即時報價要不要重抓：開盤中每檔最多每 QUOTE_REFRESH_MS 抓一次；
 *  已收盤且已經拿過收盤後的報價就不再抓，直到下一個交易時段。
 *  純函式、不碰網路，方便測試；快取本身在 lib/yahoo.ts。 */

/** 開盤中（或無法判斷收盤時）同一檔報價的重抓間隔 */
export const QUOTE_REFRESH_MS = 60_000;
/** 時鐘說開盤、但 Yahoo 最後成交時間停在前一天（國定假日或整天沒成交）時的重抓間隔 */
export const QUOTE_HOLIDAY_REFRESH_MS = 30 * 60_000;

/** 有固定交易時段的市場；always：24 小時交易、自組序列或不認得的交易所，只看間隔 */
export type QuoteMarket = "tw" | "us" | "jp" | "kr" | "hk" | "always";

type Session = {
  timeZone: string;
  /** 開盤（當地分鐘數） */
  open: number;
  /** 收盤後多久內仍當作盤中：收盤價要一陣子才定案，這段時間照間隔重抓 */
  activeUntil: number;
};

const SESSIONS: Record<Exclude<QuoteMarket, "always">, Session> = {
  tw: { timeZone: "Asia/Taipei", open: 9 * 60, activeUntil: 13 * 60 + 45 },
  us: { timeZone: "America/New_York", open: 9 * 60 + 30, activeUntil: 16 * 60 + 15 },
  jp: { timeZone: "Asia/Tokyo", open: 9 * 60, activeUntil: 15 * 60 + 45 },
  kr: { timeZone: "Asia/Seoul", open: 9 * 60, activeUntil: 15 * 60 + 45 },
  hk: { timeZone: "Asia/Hong_Kong", open: 9 * 60 + 30, activeUntil: 16 * 60 + 15 },
};

/** 開盤後多久還沒有今天的成交，才當作休市 */
const HOLIDAY_DETECT_AFTER_OPEN_MIN = 15;

export function quoteMarketOf(symbol: string): QuoteMarket {
  const s = symbol.trim().toUpperCase();
  if (s.endsWith(".TW") || s.endsWith(".TWO") || /^\d{4}$/.test(s)) return "tw";
  if (s === "^TWII" || s === TAIWAN_VIX_SYMBOL) return "tw";
  if (s.endsWith(".T") || s === "^N225") return "jp";
  if (s.endsWith(".KS") || s.endsWith(".KQ") || s === "^KS11") return "kr";
  if (s.endsWith(".HK") || s === "^HSI") return "hk";
  // 加密貨幣（BTC-USD、持倉裡沒後綴的 BTC）、匯率（USDTWD=X）、期貨（CL=F）幾乎全天交易
  if (isCryptoSymbol(s) || s.endsWith("=X") || s.endsWith("=F")) return "always";
  // 融資序列不走 Yahoo，有自己的冷卻邏輯，這裡只擋重複呼叫
  if (s.startsWith("TWMARGIN")) return "always";
  // 其他交易所後綴（.L、.DE、DX-Y.NYB…）時段不一，不猜，只看間隔
  if (s.includes(".")) return "always";
  return "us";
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function zonedParts(date: Date, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      hour12: false,
    })
      .formatToParts(date)
      .filter((p) => p.type !== "literal")
      .map((p) => [p.type, p.value]),
  );
  const hour = Number(parts.hour ?? 0) % 24;
  return {
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: WEEKDAYS.indexOf(parts.weekday ?? ""),
    /** 當地從午夜起算的分鐘數（含秒的小數） */
    minutes: hour * 60 + Number(parts.minute ?? 0) + Number(parts.second ?? 0) / 60,
  };
}

const isWeekday = (weekday: number) => weekday >= 1 && weekday <= 5;

/** 最近一次「交易時段結束」（activeUntil）的時間；週末往前找到週五。
 *  夏令時間切換都發生在週末，跨週末時差一小時不影響判斷。 */
function lastSessionEnd(now: Date, session: Session): number {
  const { weekday, minutes } = zonedParts(now, session.timeZone);
  let daysBack = isWeekday(weekday) && minutes >= session.activeUntil ? 0 : 1;
  while (!isWeekday((weekday - daysBack + 7 * 2) % 7)) daysBack++;
  const elapsedMin = minutes - session.activeUntil + daysBack * 1440;
  return now.getTime() - elapsedMin * 60_000;
}

export type CachedQuoteState = {
  /** 上次抓取完成的時間（epoch ms） */
  fetchedAt: number;
  /** 上次是否只拿到本機舊快取（Yahoo 失敗）；失敗的照間隔重試 */
  stale?: boolean;
  /** Yahoo 回報的最後成交時間（epoch ms），用來辨識國定假日 */
  marketTime?: number;
};

/** 這一檔現在是不是在交易時段（含收盤後等收盤價定案的那 15 分鐘）；
 *  24 小時交易的一律算。頁面的自動更新用這個決定要不要跑。 */
export function isQuoteMarketActive(symbol: string, now: Date = new Date()): boolean {
  const market = quoteMarketOf(symbol);
  if (market === "always") return true;
  const session = SESSIONS[market];
  const { weekday, minutes } = zonedParts(now, session.timeZone);
  return isWeekday(weekday) && minutes >= session.open && minutes < session.activeUntil;
}

/** 上次抓的報價現在還能不能直接用。refreshMs 是盤中的重抓間隔，
 *  算出來的結果（例如績效的「今天」那一點）可以傳更長的間隔共用同一套規則。 */
export function isQuoteFresh(
  symbol: string,
  cached: CachedQuoteState,
  now: Date = new Date(),
  refreshMs: number = QUOTE_REFRESH_MS,
): boolean {
  const age = now.getTime() - cached.fetchedAt;
  if (age < 0) return false;
  const market = quoteMarketOf(symbol);
  if (cached.stale || market === "always") return age < refreshMs;

  const session = SESSIONS[market];
  const { dateKey, minutes } = zonedParts(now, session.timeZone);

  if (!isQuoteMarketActive(symbol, now)) {
    // 已收盤：上次抓取在最近一次收盤之後，就是收盤價了
    return cached.fetchedAt >= lastSessionEnd(now, session);
  }

  // 盤中，但最後成交還停在前一天：多半是國定假日，拉長間隔
  if (
    cached.marketTime != null &&
    minutes >= session.open + HOLIDAY_DETECT_AFTER_OPEN_MIN &&
    zonedParts(new Date(cached.marketTime), session.timeZone).dateKey !== dateKey
  ) {
    const fetched = zonedParts(new Date(cached.fetchedAt), session.timeZone);
    const fetchedAfterDetect =
      fetched.dateKey === dateKey &&
      fetched.minutes >= session.open + HOLIDAY_DETECT_AFTER_OPEN_MIN;
    if (fetchedAfterDetect) return age < QUOTE_HOLIDAY_REFRESH_MS;
  }

  return age < refreshMs;
}

/** 用一群標的「今天」報價算出來的結果，computedAt 之後還能不能沿用：
 *  每一檔都還新鮮才算——盤中滿 refreshMs、或收盤後還沒拿過收盤價，就該重算。 */
export function isComputedAtFresh(
  symbols: readonly string[],
  computedAt: number,
  now: Date = new Date(),
  refreshMs: number = QUOTE_REFRESH_MS,
): boolean {
  return symbols.every((s) =>
    isQuoteFresh(s, { fetchedAt: computedAt }, now, refreshMs),
  );
}
