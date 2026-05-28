import type { PerformancePeriodPreset } from "@/lib/performance-period-presets";
import { normalizeCustomPresets } from "@/lib/performance-period-presets";

export type CachedPerformanceResult = Record<string, unknown> & {
  periodStart: string;
  periodEnd: string;
};

export const PERFORMANCE_PREFS_KEY = "portfolio-performance-prefs";

export type MetricPanelId = "key" | "calculation" | "trading" | "risk";

export const DEFAULT_METRIC_PANEL_ORDER: MetricPanelId[] = [
  "key",
  "calculation",
  "trading",
  "risk",
];

const METRIC_PANEL_IDS = new Set<MetricPanelId>(DEFAULT_METRIC_PANEL_ORDER);

export function isValidMetricPanelOrder(
  order: unknown,
): order is MetricPanelId[] {
  return (
    Array.isArray(order) &&
    order.length === 4 &&
    order.every((id) => METRIC_PANEL_IDS.has(id as MetricPanelId)) &&
    new Set(order).size === 4
  );
}

/** 舊版三欄排序 → 插入 Calculation 面板 */
export function migrateMetricPanelOrder(order: unknown): MetricPanelId[] {
  if (isValidMetricPanelOrder(order)) return order;
  if (
    Array.isArray(order) &&
    order.length === 3 &&
    order.every((id) => typeof id === "string")
  ) {
    const legacy = order as MetricPanelId[];
    const hasCalc = legacy.includes("calculation");
    if (!hasCalc) {
      const keyIdx = legacy.indexOf("key");
      const next = [...legacy];
      next.splice(keyIdx >= 0 ? keyIdx + 1 : 1, 0, "calculation");
      if (isValidMetricPanelOrder(next)) return next;
    }
  }
  return DEFAULT_METRIC_PANEL_ORDER;
}

export type PerformancePrefs = {
  start: string;
  end: string;
  benchmark?: string;
  portfolios?: string[];
  accountIds?: string[];
  benchmarks?: string[];
  metricPanelOrder?: MetricPanelId[];
  activePeriodPresetId?: string | null;
  customPeriodPresets?: PerformancePeriodPreset[];
  settingsExpanded?: boolean;
  /** 累積報酬圖是否顯示全帳戶合計線 */
  showEntirePortfolio?: boolean;
  cachedResult?: CachedPerformanceResult;
  cachedAt?: string;
  cacheKey?: string;
};

export function loadCustomPeriodPresets(
  prefs: PerformancePrefs | null | undefined,
): PerformancePeriodPreset[] {
  return normalizeCustomPresets(prefs?.customPeriodPresets);
}

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

export function loadPerformancePrefs(): PerformancePrefs | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(PERFORMANCE_PREFS_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PerformancePrefs;
  } catch {
    return null;
  }
}

export function savePerformancePrefs(prefs: PerformancePrefs): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(PERFORMANCE_PREFS_KEY, JSON.stringify(prefs));
}
