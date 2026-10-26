import { ENTIRE_PORTFOLIO_FILTER_ID } from "@/lib/chart-constants";
import { readStoredEntry, writeStoredEntry } from "@/lib/client-data-cache";

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

/** @param dataVersion 交易資料指紋（由 /api/portfolio/holdings-page 提供）。
 *   放進快取鍵而不是「異動時去清快取」，是因為異動的入口太多（交易頁、標的
 *   詳情頁、CSV 匯入、分割改寫…），漏掉任何一個就會讓走勢圖顯示過期數字；
 *   指紋一變舊鍵自然查不到，不需要任何人記得。 */
export function buildHoldingsValueCacheKey(
  accountIds: string,
  startDate: string,
  showEntire: boolean,
  includeCashFlows: boolean,
  dataVersion: string,
): string {
  return `${CACHE_VERSION}|start:${startDate}|entire:${showEntire ? 1 : 0}|flows:${includeCashFlows ? 1 : 0}|acc:${accountIds}|tx:${dataVersion}`;
}

/** 市值走勢起算日的預設值：一年前 */
export function defaultTrendStartDate(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 1);
  return d.toISOString().slice(0, 10);
}

/** 把持股頁的走勢選擇（帳戶篩選 + 起算日）換算成 value-history 的查詢參數。
 *
 *  持股頁與背景預熱**必須**共用這支：server 端的 PortfolioValueSnapshot 是
 *  以 (起算日, 帳戶組合) 當快取鍵的，只要兩邊組出來的參數差一個字元，預熱就
 *  會算出一把頁面永遠不會查的快取，白跑 47～92 秒還完全沒有效果。 */
export function resolveValueHistoryQuery(
  trendAccountFilters: string[],
  trendStartDate: string,
): { start: string; accountIds: string; showEntire: boolean } {
  const showEntire = trendAccountFilters.includes(ENTIRE_PORTFOLIO_FILTER_ID);
  const accountIds = trendAccountFilters.filter(
    (id) => id !== ENTIRE_PORTFOLIO_FILTER_ID,
  );
  return {
    start: trendStartDate || defaultTrendStartDate(),
    accountIds: accountIds.length > 0 ? accountIds.join(",") : "all",
    showEntire,
  };
}

export function buildValueHistoryUrl(
  query: { start: string; accountIds: string; showEntire: boolean },
  options?: { force?: boolean },
): string {
  const params = new URLSearchParams({
    start: query.start,
    accountIds: query.accountIds,
  });
  if (query.showEntire) params.set("entire", "1");
  params.set("includeCashFlows", "1");
  if (options?.force) params.set("force", "1");
  return `/api/portfolio/value-history?${params.toString()}`;
}

export function loadHoldingsValueCache(
  cacheKey: string,
): HoldingsValueCacheEntry | null {
  const hit = readStoredEntry<HoldingsValueCacheEntry>(
    HOLDINGS_VALUE_CACHE_KEY,
    cacheKey,
  );
  if (!hit?.lines?.length || !Array.isArray(hit.chartData)) return null;
  return hit;
}

export function saveHoldingsValueCache(entry: HoldingsValueCacheEntry): void {
  writeStoredEntry(HOLDINGS_VALUE_CACHE_KEY, entry, 12);
}
