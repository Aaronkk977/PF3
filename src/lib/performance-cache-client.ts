/** 分析頁績效結果的快取鍵與「舊格式快取要丟掉」的判斷，client／server 共用。
 *  分析頁的使用者偏好（期間、帳戶、面板順序…）在 ui-prefs.ts。 */

export type CachedPerformanceResult = Record<string, unknown> & {
  periodStart: string;
  periodEnd: string;
};

const CACHE_VERSION = "v19";

export function buildPerformanceCacheKey(
  start: string,
  end: string,
  portfolios: string,
  benchmarks: string,
): string {
  return `${CACHE_VERSION}|${start}|${end}|p:${portfolios}|b:${benchmarks}`;
}

/** 缺少風險分析／基準比較欄位的舊快取應丟棄 */
export function isStalePerformanceCache(
  cached: CachedPerformanceResult | undefined,
): boolean {
  if (!cached) return true;
  const risk = cached.riskIndicators as
    | { sharpeRatio?: unknown; maxDrawdownDurationDays?: unknown }
    | undefined;
  if (typeof risk?.sharpeRatio !== "number") return true;
  if (typeof risk?.maxDrawdownDurationDays !== "number") return true;
  if (!("maxDrawdownRecoveryDate" in (risk ?? {}))) return true;
  if (!Array.isArray(cached.drawdownSeries)) return true;
  const benchmarks = cached.benchmarks as
    | { returnBeat?: unknown }[]
    | undefined;
  if (benchmarks?.length && typeof benchmarks[0]?.returnBeat !== "number") {
    return true;
  }
  const calc = cached.calculation as { endValue?: unknown } | undefined;
  if (!calc || typeof calc.endValue !== "number") return true;
  return false;
}

/** 舊版標準化 100 快取應丟棄 */
export function isLegacyNormalizedChart(
  chartData: Record<string, string | number>[] | undefined,
): boolean {
  if (!chartData?.length) return false;
  const first = chartData[0];
  for (const [key, v] of Object.entries(first)) {
    if (key === "date" || typeof v !== "number") continue;
    if (Math.abs(v - 100) < 0.5) return true;
  }
  return false;
}
