const TAIPEI = "Asia/Taipei";
const NEW_YORK = "America/New_York";

function getZonedTimeParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(date);

  const map = Object.fromEntries(
    parts.filter((p) => p.type !== "literal").map((p) => [p.type, p.value]),
  );

  return {
    weekday: map.weekday ?? "",
    hour: Number(map.hour ?? 0),
    minute: Number(map.minute ?? 0),
  };
}

function isWeekday(weekday: string) {
  return weekday !== "Sat" && weekday !== "Sun";
}

export function isTaiwanOpen(now: Date = new Date()): boolean {
  const { weekday, hour, minute } = getZonedTimeParts(now, TAIPEI);
  if (!isWeekday(weekday)) return false;
  const minutes = hour * 60 + minute;
  return minutes >= 9 * 60 && minutes < 13 * 60 + 30;
}

export function isTaiwanMarketClosed(now: Date = new Date()): boolean {
  return !isTaiwanOpen(now);
}

function isUsOpen(now: Date): boolean {
  const { weekday, hour, minute } = getZonedTimeParts(now, NEW_YORK);
  if (!isWeekday(weekday)) return false;
  const minutes = hour * 60 + minute;
  return minutes >= 9 * 60 + 30 && minutes < 16 * 60;
}

export type OpenMarket = {
  id: "tw" | "us";
  label: string;
};

export type MarketFilter = "all" | "tw" | "us" | "crypto";

/** 點擊循環順序：台股 → 美股 → 加密 → 全部 */
export const MARKET_FILTER_CYCLE: MarketFilter[] = ["tw", "us", "crypto", "all"];

export function nextMarketFilter(current: MarketFilter): MarketFilter {
  const i = MARKET_FILTER_CYCLE.indexOf(current);
  const next = i < 0 ? 0 : (i + 1) % MARKET_FILTER_CYCLE.length;
  return MARKET_FILTER_CYCLE[next] ?? "all";
}

/** 目前開市中的市場（不含國定假日） */
export function getOpenMarkets(now: Date = new Date()): OpenMarket[] {
  const open: OpenMarket[] = [];
  if (isTaiwanOpen(now)) open.push({ id: "tw", label: "TWSE" });
  if (isUsOpen(now)) open.push({ id: "us", label: "US" });
  return open;
}

/**
 * 依開市狀態決定本日持倉篩選（自動模式）：
 * - 僅台股時段 → 台股
 * - 僅美股時段 → 美股
 * - 其餘（皆休市或同時開市）→ 全部
 */
export function getScheduledMarketFilter(now: Date = new Date()): MarketFilter {
  const tw = isTaiwanOpen(now);
  const us = isUsOpen(now);
  if (tw && !us) return "tw";
  if (us && !tw) return "us";
  return "all";
}
