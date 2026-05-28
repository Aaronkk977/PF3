export const HOLDINGS_VALUE_CACHE_KEY = "portfolio-holdings-value-cache";

export type ValueHistoryPoint = { date: string; value: number };

export type ValueTrendLine = {
  dataKey: string;
  label: string;
  color: string;
  kind: "account" | "entire";
  points: ValueHistoryPoint[];
};

export type CashFlowEvent = {
  date: string;
  deposit: number;
  withdrawal: number;
};

export type HoldingsValueCacheEntry = {
  cacheKey: string;
  cachedAt: string;
  lines: ValueTrendLine[];
  cashFlows: CashFlowEvent[];
  chartData: Record<string, string | number>[];
};

const CACHE_VERSION = "v14";

/** 同日快取視為仍有效，避免每次進頁都重算 */
export function isHoldingsValueCacheFresh(cachedAt: string): boolean {
  const cached = new Date(cachedAt);
  if (Number.isNaN(cached.getTime())) return false;
  const now = new Date();
  return (
    cached.getFullYear() === now.getFullYear() &&
    cached.getMonth() === now.getMonth() &&
    cached.getDate() === now.getDate()
  );
}

export function buildHoldingsValueCacheKey(
  accountIds: string,
  startDate: string,
  showEntire: boolean,
  includeCashFlows: boolean,
): string {
  return `${CACHE_VERSION}|start:${startDate}|entire:${showEntire ? 1 : 0}|flows:${includeCashFlows ? 1 : 0}|acc:${accountIds}`;
}

export function loadHoldingsValueCache(
  cacheKey: string,
): HoldingsValueCacheEntry | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(HOLDINGS_VALUE_CACHE_KEY);
    if (!raw) return null;
    const entries = JSON.parse(raw) as HoldingsValueCacheEntry[];
    if (!Array.isArray(entries)) return null;
    const hit = entries.find((e) => e.cacheKey === cacheKey);
    if (!hit?.lines?.length || !Array.isArray(hit.chartData)) return null;
    return hit;
  } catch {
    return null;
  }
}

export function saveHoldingsValueCache(entry: HoldingsValueCacheEntry): void {
  if (typeof window === "undefined") return;
  try {
    const raw = localStorage.getItem(HOLDINGS_VALUE_CACHE_KEY);
    let entries: HoldingsValueCacheEntry[] = [];
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) entries = parsed;
    }
    const next = [entry, ...entries.filter((e) => e.cacheKey !== entry.cacheKey)];
    localStorage.setItem(
      HOLDINGS_VALUE_CACHE_KEY,
      JSON.stringify(next.slice(0, 12)),
    );
  } catch {
    // ignore quota errors
  }
}
