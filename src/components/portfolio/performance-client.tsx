"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  PerformanceChart,
  type ChartLineConfig,
} from "@/components/charts/performance-chart";
import { PageSection } from "@/components/layout/page-sections";
import { PerformanceMetricPanels } from "@/components/portfolio/performance-metric-panels";
import { BenchmarkSelector } from "@/components/portfolio/benchmark-selector";
import { PerformancePeriodPresets } from "@/components/portfolio/performance-period-presets";
import type { BenchmarkRecord } from "@/lib/benchmarks";
import type { DrawdownPoint } from "@/lib/metrics";
import type { BenchmarkComparison } from "@/lib/performance";
import { StatCard } from "@/components/portfolio/stat-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CollapsibleCard } from "@/components/ui/collapsible-card";
import { Input } from "@/components/ui/input";
import {
  ENTIRE_PORTFOLIO_DATA_KEY,
  ENTIRE_PORTFOLIO_LABEL,
  benchmarkDataKey,
} from "@/lib/chart-constants";
import { accountDataKey } from "@/lib/standard-accounts";
import { normalizePeriodRange, toLocalDateKey } from "@/lib/date-keys";
import {
  applyPeriodPreset,
  mergePeriodPresets,
  presetMatchesRange,
  type PerformancePeriodPreset,
} from "@/lib/performance-period-presets";
import {
  buildPerformanceCacheKey,
  isLegacyNormalizedChart,
  isStalePerformanceCache,
  loadCustomPeriodPresets,
  loadPerformancePrefs,
  savePerformancePrefs,
} from "@/lib/performance-cache-client";
import { useChartTheme } from "@/hooks/use-chart-theme";
import { resolveAccountSwatchColor } from "@/lib/chart-palette";
import { PageRefreshBanner } from "@/components/ui/page-refresh-banner";
import { changePositive, formatPercent, isFlatChange } from "@/lib/utils";

type TodayChangeBreakdown = {
  overall: { change: number; changePct: number; marketValue: number };
  accounts: {
    accountId: string;
    name: string;
    change: number;
    changePct: number;
    marketValue: number;
  }[];
};

type AccountOption = {
  id: string;
  name: string;
  currency: string;
  color: string;
  cash: number;
};

type PerformanceData = {
  periodStart: string;
  periodEnd: string;
  chartData: Record<string, string | number>[];
  chartLines: ChartLineConfig[];
  drawdownSeries: DrawdownPoint[];
  benchmarks: BenchmarkComparison[];
  todayChange: number;
  todayChangePct: number;
  fromCache?: boolean;
  keyIndicators: {
    periodReturn: number;
    absoluteReturn: number;
    xirr: number | null;
    startValue: number;
    endValue: number;
  };
  riskIndicators: {
    maxDrawdown: number;
    maxDrawdownPeakDate: string | null;
    maxDrawdownTroughDate: string | null;
    maxDrawdownRecoveryDate: string | null;
    maxDrawdownDurationDays: number;
    sharpeRatio: number;
    volatility: number;
    semiVariance: number;
    semiDeviation: number;
  };
  tradingIndicators: {
    winRate: number;
    profitLossRatio: number;
    feeRate: number;
    taxRate: number;
    turnover: number;
    annualizedTurnover: number;
    avgHoldingDays: number;
    closedTrades: number;
  };
  calculation: {
    baseCurrency: string;
    startValue: number;
    netDeposits: number;
    realizedPnl: number;
    fees: number;
    taxes: number;
    dividends: number;
    capitalGains: number;
    fxDifference: number;
    endValue: number;
  };
};

function toggleInList<T>(list: T[], item: T): T[] {
  return list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
}

function beatPositive(value: number | undefined): boolean | undefined {
  if (value == null || Number.isNaN(value)) return undefined;
  return changePositive(value);
}

function formatBeat(value: number | undefined, asPercent = false): string {
  if (value == null || Number.isNaN(value)) return "—";
  if (asPercent) {
    const pct = value * 100;
    if (isFlatChange(value)) return "0.00%";
    return pct > 0 ? `+${pct.toFixed(2)}%` : `${pct.toFixed(2)}%`;
  }
  if (isFlatChange(value)) return "0.00";
  return value > 0 ? `+${value.toFixed(2)}` : value.toFixed(2);
}

export function PerformanceClient({
  accounts,
  benchmarks,
  defaultStart,
  defaultEnd,
  portfolioEarliest,
}: {
  accounts: AccountOption[];
  benchmarks: BenchmarkRecord[];
  defaultStart: string;
  defaultEnd: string;
  portfolioEarliest: string;
}) {
  const [start, setStart] = useState(defaultStart);
  const [end, setEnd] = useState(defaultEnd);
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>(
    () => accounts.map((a) => a.id),
  );
  const [showEntirePortfolio, setShowEntirePortfolio] = useState(true);
  const [benchmarkList, setBenchmarkList] =
    useState<BenchmarkRecord[]>(benchmarks);
  const [selectedBenchmarks, setSelectedBenchmarks] = useState<string[]>([]);
  const [data, setData] = useState<PerformanceData | null>(null);
  const [loading, setLoading] = useState(false);
  const [bgRefreshing, setBgRefreshing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressPhase, setProgressPhase] = useState<string | null>(null);
  const [cacheHint, setCacheHint] = useState<string | null>(null);
  const initialBgLoadDone = useRef(false);
  const [prefsReady, setPrefsReady] = useState(false);
  const [todayBreakdown, setTodayBreakdown] =
    useState<TodayChangeBreakdown | null>(null);
  const [customPeriodPresets, setCustomPeriodPresets] = useState<
    PerformancePeriodPreset[]
  >([]);
  const [activePeriodPresetId, setActivePeriodPresetId] = useState<
    string | null
  >(null);
  const [settingsExpanded, setSettingsExpanded] = useState(true);
  const chartTheme = useChartTheme();

  const syncPeriodEndToToday = useCallback(
    (
      rangeStart: string,
      rangeEnd: string,
      presetId: string | null,
      customPresets: PerformancePeriodPreset[],
    ) => {
      const today = toLocalDateKey(new Date());
      if (rangeEnd >= today) {
        return { start: rangeStart, end: rangeEnd, presetId };
      }
      const presets = mergePeriodPresets(customPresets);
      const preset =
        (presetId ? presets.find((p) => p.id === presetId) : null) ??
        presets.find((p) =>
          presetMatchesRange(p, rangeStart, rangeEnd, portfolioEarliest),
        );
      if (preset) {
        const applied = applyPeriodPreset(preset, {
          end: new Date(),
          portfolioEarliest,
        });
        return { start: applied.start, end: applied.end, presetId: preset.id };
      }
      const normalized = normalizePeriodRange(rangeStart, today);
      return {
        start: normalized.start,
        end: normalized.end,
        presetId: null as string | null,
      };
    },
    [portfolioEarliest],
  );

  useEffect(() => {
    const prefs = loadPerformancePrefs();
    const customPresets = loadCustomPeriodPresets(prefs);
    let rangeStart = prefs?.start ?? defaultStart;
    let rangeEnd = prefs?.end ?? defaultEnd;
    let presetId = prefs?.activePeriodPresetId ?? null;

    const synced = syncPeriodEndToToday(
      rangeStart,
      rangeEnd,
      presetId,
      customPresets,
    );
    rangeStart = synced.start;
    rangeEnd = synced.end;
    presetId = synced.presetId;

    const normalized = normalizePeriodRange(rangeStart, rangeEnd);
    setStart(normalized.start);
    setEnd(normalized.end);
    if (presetId) setActivePeriodPresetId(presetId);

    const prefsStart = prefs?.start ?? defaultStart;
    const prefsEnd = prefs?.end ?? defaultEnd;
    if (
      normalized.start !== prefsStart ||
      normalized.end !== prefsEnd ||
      presetId !== (prefs?.activePeriodPresetId ?? null)
    ) {
      savePerformancePrefs({
        ...prefs,
        start: normalized.start,
        end: normalized.end,
        activePeriodPresetId: presetId,
      });
    }
    if (prefs?.accountIds?.length) {
      const valid = prefs.accountIds.filter((id) =>
        accounts.some((a) => a.id === id),
      );
      if (valid.length > 0) setSelectedAccountIds(valid);
    } else if (prefs?.benchmark) {
      setSelectedBenchmarks([prefs.benchmark]);
    }
    if (prefs?.benchmarks?.length) setSelectedBenchmarks(prefs.benchmarks);
    setCustomPeriodPresets(customPresets);
    if (typeof prefs?.settingsExpanded === "boolean") {
      setSettingsExpanded(prefs.settingsExpanded);
    }
    if (typeof prefs?.showEntirePortfolio === "boolean") {
      setShowEntirePortfolio(prefs.showEntirePortfolio);
    }
    if (prefs?.cachedResult) {
      const cached = prefs.cachedResult as PerformanceData;
      const legacy = isLegacyNormalizedChart(cached.chartData);
      if (
        !legacy &&
        !isStalePerformanceCache(cached) &&
        Array.isArray(cached.chartData) &&
        Array.isArray(cached.chartLines)
      ) {
        setData(cached);
        if (prefs.cachedAt) {
          setCacheHint(
            `已載入 ${new Date(prefs.cachedAt).toLocaleString("zh-TW")} 的快取結果`,
          );
        }
      }
    }
    setPrefsReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- init local prefs once on mount
  }, []);

  useEffect(() => {
    void fetch("/api/portfolio/today-change")
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (json?.overall) setTodayBreakdown(json as TodayChangeBreakdown);
      })
      .catch(() => {});
  }, []);

  const [todayLoading, setTodayLoading] = useState(false);

  const persistPeriodPrefs = useCallback(
    (
      patch: Partial<{
        start: string;
        end: string;
        activePeriodPresetId: string | null;
        customPeriodPresets: PerformancePeriodPreset[];
      }>,
    ) => {
      const prefs = loadPerformancePrefs();
      savePerformancePrefs({
        start: prefs?.start ?? start,
        end: prefs?.end ?? end,
        ...prefs,
        ...patch,
      });
    },
    [start, end],
  );

  const applyPeriodRange = useCallback(
    (range: { start: string; end: string }, presetId: string | null) => {
      const normalized = normalizePeriodRange(range.start, range.end);
      setStart(normalized.start);
      setEnd(normalized.end);
      setActivePeriodPresetId(presetId);
      persistPeriodPrefs({
        start: normalized.start,
        end: normalized.end,
        activePeriodPresetId: presetId,
      });
    },
    [persistPeriodPrefs],
  );

  useEffect(() => {
    if (!prefsReady) return;
    const onFocus = () => {
      const today = toLocalDateKey(new Date());
      if (end >= today) return;
      const synced = syncPeriodEndToToday(
        start,
        end,
        activePeriodPresetId,
        customPeriodPresets,
      );
      applyPeriodRange(
        { start: synced.start, end: synced.end },
        synced.presetId,
      );
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [
    prefsReady,
    start,
    end,
    activePeriodPresetId,
    customPeriodPresets,
    syncPeriodEndToToday,
    applyPeriodRange,
  ]);

  const handleCustomPresetsChange = useCallback(
    (presets: PerformancePeriodPreset[]) => {
      setCustomPeriodPresets(presets);
      persistPeriodPrefs({ customPeriodPresets: presets });
    },
    [persistPeriodPrefs],
  );

  const refreshToday = useCallback(async () => {
    setTodayLoading(true);
    try {
      const res = await fetch("/api/portfolio/today-change");
      if (!res.ok) return;
      const json = await res.json();
      if (json?.overall) setTodayBreakdown(json as TodayChangeBreakdown);
    } finally {
      setTodayLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!prefsReady) return;
    const prefs = loadPerformancePrefs();
    savePerformancePrefs({
      ...prefs,
      start,
      end,
      accountIds: selectedAccountIds,
      benchmarks: selectedBenchmarks,
      showEntirePortfolio,
    });
  }, [
    start,
    end,
    selectedAccountIds,
    selectedBenchmarks,
    showEntirePortfolio,
    prefsReady,
  ]);

  const visibleChartLines =
    data?.chartLines?.filter((line) => {
      if (line.dataKey === ENTIRE_PORTFOLIO_DATA_KEY) return showEntirePortfolio;
      if (line.kind === "portfolio") {
        return selectedAccountIds.some(
          (id) => line.dataKey === accountDataKey(id),
        );
      }
      return selectedBenchmarks.some(
        (sym) => line.dataKey === benchmarkDataKey(sym),
      );
    }) ?? [];

  const load = useCallback(
    async (opts?: { force?: boolean; silent?: boolean }) => {
      const force = opts?.force ?? false;
      const silent = opts?.silent ?? false;
      if (selectedAccountIds.length === 0) {
        if (!silent) alert("請至少選擇一個帳戶");
        return;
      }
      if (silent) setBgRefreshing(true);
      else {
        setLoading(true);
        setProgress(0);
        setProgressPhase("準備計算…");
      }
      try {
        const normalized = normalizePeriodRange(start, end);
        if (normalized.swapped) {
          setStart(normalized.start);
          setEnd(normalized.end);
          persistPeriodPrefs({
            start: normalized.start,
            end: normalized.end,
          });
        }
        const params = new URLSearchParams({
          start: normalized.start,
          end: normalized.end,
          accounts: selectedAccountIds.join(","),
          benchmarks: selectedBenchmarks.join(","),
          stream: "1",
        });
        if (force) params.set("force", "1");

        const res = await fetch(`/api/performance?${params}`);
        if (!res.ok || !res.body) {
          throw new Error("績效計算失敗");
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let result: PerformanceData | null = null;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.trim()) continue;
            const msg = JSON.parse(line) as {
              type: string;
              phase?: string;
              percent?: number;
              result?: PerformanceData;
              message?: string;
            };
            if (msg.type === "progress" && !silent) {
              const pct = msg.percent ?? 0;
              setProgress((prev) => Math.max(prev, pct));
              setProgressPhase(msg.phase ?? null);
            } else if (msg.type === "done" && msg.result) {
              result = msg.result;
            } else if (msg.type === "error") {
              throw new Error(msg.message ?? "績效計算失敗");
            }
          }
        }

        if (!result) throw new Error("未取得績效結果");

        setData(result);
        if (!silent) setProgress(100);
        const cacheKey = buildPerformanceCacheKey(
          start,
          end,
          selectedAccountIds.join(","),
          selectedBenchmarks.join(","),
        );
        const cachedAt = new Date().toISOString();
        const existingPrefs = loadPerformancePrefs();
        savePerformancePrefs({
          ...existingPrefs,
          start,
          end,
          accountIds: selectedAccountIds,
          benchmarks: selectedBenchmarks,
          showEntirePortfolio,
          cachedResult: result,
          cachedAt,
          cacheKey,
        });
        setCacheHint(
          result.fromCache
            ? silent
              ? `背景更新完成 · ${new Date(cachedAt).toLocaleString("zh-TW")}`
              : "已使用伺服器快取"
            : `已重新計算 · ${new Date(cachedAt).toLocaleString("zh-TW")}`,
        );
      } finally {
        if (silent) setBgRefreshing(false);
        else {
          setLoading(false);
          setProgressPhase(null);
        }
      }
    },
    [
      start,
      end,
      selectedAccountIds,
      selectedBenchmarks,
      showEntirePortfolio,
      persistPeriodPrefs,
    ],
  );

  useEffect(() => {
    if (!prefsReady || selectedAccountIds.length === 0 || initialBgLoadDone.current) {
      return;
    }
    initialBgLoadDone.current = true;
    void load({ silent: true });
  }, [prefsReady, selectedAccountIds.length, load]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-mono text-2xl font-bold text-[var(--color-primary)] glow-text">
          Performance
        </h1>
        <p className="mt-1 text-sm text-[var(--color-muted)]">期間績效與基準比較</p>
        {cacheHint && (
          <p className="mt-1 text-xs text-[var(--color-muted)]">{cacheHint}</p>
        )}
      </div>

      <PageRefreshBanner refreshing={bgRefreshing} />

      <PageSection id="performance-today" title="今日漲跌" navOrder={0}>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-muted)]">
              今日漲跌
            </p>
            <div>
              <Button size="sm" variant="ghost" onClick={refreshToday} disabled={todayLoading}>
                {todayLoading ? "更新中…" : "更新今日漲跌"}
              </Button>
            </div>
          </div>
          {todayBreakdown ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard
                title="整體組合"
                value={todayBreakdown.overall.change}
                isCurrency
                positive={changePositive(todayBreakdown.overall.changePct)}
                subtitle={formatPercent(todayBreakdown.overall.changePct)}
                invertDisplay
              />
              {todayBreakdown.accounts.map((row) => (
                <StatCard
                  key={row.accountId}
                  title={row.name}
                  value={row.change}
                  isCurrency
                  positive={changePositive(row.changePct)}
                  subtitle={formatPercent(row.changePct)}
                  invertDisplay
                />
              ))}
            </div>
          ) : (
            <p className="text-sm text-[var(--color-muted)]">載入今日漲跌中…</p>
          )}
        </div>
      </PageSection>

      <PageSection id="performance-period" title="設定" className="mt-8" navOrder={10}>
        <CollapsibleCard
          title="設定"
          variant="settings"
          expanded={settingsExpanded}
          onToggle={() => {
            setSettingsExpanded((v) => {
              const next = !v;
              const prefs = loadPerformancePrefs();
              savePerformancePrefs({
                start: prefs?.start ?? start,
                end: prefs?.end ?? end,
                ...prefs,
                settingsExpanded: next,
              });
              return next;
            });
          }}
        >
          <div className="space-y-5">

            {/* ── 分析區間 ──────────────────────────────────────────── */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-widest text-[var(--color-muted)]/70">
                  分析區間
                </span>
                <div className="h-px flex-1 bg-[var(--color-card-border)]/40" />
              </div>
              <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
                <div className="flex items-end gap-4">
                  <div>
                    <label className="mb-1 block text-xs text-[var(--color-muted)]">起始</label>
                    <Input
                      type="date"
                      value={start}
                      onChange={(e) => {
                        setStart(e.target.value);
                        setActivePeriodPresetId(null);
                        persistPeriodPrefs({
                          start: e.target.value,
                          activePeriodPresetId: null,
                        });
                      }}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-[var(--color-muted)]">結束</label>
                    <Input
                      type="date"
                      value={end}
                      onChange={(e) => {
                        setEnd(e.target.value);
                        setActivePeriodPresetId(null);
                        persistPeriodPrefs({
                          end: e.target.value,
                          activePeriodPresetId: null,
                        });
                      }}
                    />
                  </div>
                </div>
                <PerformancePeriodPresets
                  compact
                  start={start}
                  end={end}
                  activePresetId={activePeriodPresetId}
                  customPresets={customPeriodPresets}
                  portfolioEarliest={portfolioEarliest}
                  onApply={applyPeriodRange}
                  onCustomPresetsChange={handleCustomPresetsChange}
                />
              </div>
            </div>

            {/* ── 帳戶 & 基準 ──────────────────────────────────────── */}
            <div className="grid gap-5 md:grid-cols-2">

              {/* 帳戶 */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-widest text-[var(--color-muted)]/70">
                    帳戶
                  </span>
                  <div className="h-px flex-1 bg-[var(--color-card-border)]/40" />
                </div>
                <p className="text-[11px] leading-relaxed text-[var(--color-muted)]">
                  Entire Portfolio 為全部帳戶合計，其餘帳戶用於指標拆解
                </p>
                {accounts.length === 0 ? (
                  <p className="text-xs text-[var(--color-muted)]">
                    尚無帳戶，請先執行 npm run accounts:ensure
                  </p>
                ) : (
                  <div className="mt-1 flex flex-col gap-0.5">
                    <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium transition-colors hover:bg-[var(--color-primary)]/5">
                      <input
                        type="checkbox"
                        checked={showEntirePortfolio}
                        onChange={() => setShowEntirePortfolio((v) => !v)}
                        className="rounded border-[var(--color-card-border)] accent-[var(--color-foreground)]"
                      />
                      <span
                        className="inline-block h-2 w-2 rounded-full border border-[var(--color-foreground)]/40"
                        style={{ background: "var(--color-foreground)" }}
                      />
                      {ENTIRE_PORTFOLIO_LABEL}
                      <span className="ml-auto text-[11px] font-normal text-[var(--color-muted)]">
                        全部帳戶
                      </span>
                    </label>
                    {accounts.map((acc, index) => (
                      <label
                        key={acc.id}
                        className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-[var(--color-primary)]/5"
                      >
                        <input
                          type="checkbox"
                          checked={selectedAccountIds.includes(acc.id)}
                          onChange={() =>
                            setSelectedAccountIds((prev) =>
                              toggleInList(prev, acc.id),
                            )
                          }
                          className="rounded border-[var(--color-card-border)] accent-[var(--color-primary)]"
                        />
                        <span
                          className="inline-block h-2 w-2 rounded-full"
                          style={{
                            background: resolveAccountSwatchColor(
                              acc.name,
                              index,
                              chartTheme,
                            ),
                          }}
                        />
                        {acc.name}
                        <span className="ml-auto text-[11px] text-[var(--color-muted)]">
                          {acc.currency}
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              {/* 基準 */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-widest text-[var(--color-muted)]/70">
                    基準
                  </span>
                  <div className="h-px flex-1 bg-[var(--color-card-border)]/40" />
                </div>
                <p className="text-[11px] leading-relaxed text-[var(--color-muted)]">
                  勾選後顯示於累積報酬圖
                </p>
                <div className="mt-1">
                  <BenchmarkSelector
                    benchmarks={benchmarkList}
                    selectedSymbols={selectedBenchmarks}
                    onSelectionChange={setSelectedBenchmarks}
                    onBenchmarksChange={setBenchmarkList}
                  />
                </div>
              </div>
            </div>

            {/* ── 執行 ──────────────────────────────────────────────── */}
            <div className="space-y-3 border-t border-[var(--color-card-border)]/50 pt-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs text-[var(--color-muted)]">
                  變更日期、帳戶或基準後，請重新計算以更新圖表與指標
                </p>
                <Button
                  className="w-full shrink-0 sm:w-auto sm:min-w-[9rem]"
                  onClick={() => load({ force: true })}
                  disabled={loading || bgRefreshing}
                >
                  {loading ? "計算中…" : "重新計算"}
                </Button>
              </div>
              {loading && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs text-[var(--color-muted)]">
                    <span>{progressPhase ?? "計算中…"}</span>
                    <span className="tabular-nums">{Math.round(progress)}%</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-[var(--color-card-border)]">
                    <div
                      className="h-full rounded-full bg-[var(--color-primary)] transition-all duration-300"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>
              )}
            </div>

          </div>
        </CollapsibleCard>
      </PageSection>

      {!data && bgRefreshing && (
        <PageSection id="performance-loading" title="績效圖表" className="mt-8" navOrder={20}>
          <Card>
            <CardContent className="py-12 text-center text-sm text-[var(--color-muted)]">
              載入績效資料中…
            </CardContent>
          </Card>
        </PageSection>
      )}

      {data && (
        <>
          <PageSection id="performance-metrics" title="績效指標" className="mt-8" navOrder={30}>
          <PerformanceMetricPanels data={data} />
          </PageSection>

          <PageSection id="performance-chart" title="累積報酬圖" className="mt-8" navOrder={40}>
          <Card>
            <CardHeader>
              <CardTitle>
                {selectedBenchmarks.length > 0
                  ? "績效 Benchmark（累積報酬率 %）"
                  : "累積報酬率 %"}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data.chartData?.length && data.chartLines?.length ? (
                <PerformanceChart
                  data={data.chartData}
                  lines={
                    visibleChartLines.length > 0
                      ? visibleChartLines
                      : data.chartLines
                  }
                />
              ) : (
                <p className="text-sm text-[var(--color-muted)]">
                  圖表資料格式已更新，請按「重新計算」
                </p>
              )}
            </CardContent>
          </Card>
          </PageSection>

          {data.benchmarks.length > 0 && (
          <PageSection id="performance-benchmark-compare" title="基準報酬比較" className="mt-8" navOrder={50}>
          <Card>
            <CardHeader>
              <CardTitle>基準報酬比較</CardTitle>
              <p className="text-xs text-[var(--color-muted)]">
                相對 Entire Portfolio（已扣除入出金）· 下列為組合減基準之差，正號表示組合較佳
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              {data.benchmarks.map((b) => (
                <div
                  key={b.symbol}
                  className="rounded-lg border border-[var(--color-card-border)]/50 p-4"
                >
                  <p className="mb-3 text-sm font-medium text-[var(--color-foreground)]">
                    {b.label}{" "}
                    <span className="text-[var(--color-muted)]">({b.symbol})</span>
                  </p>
                  <div className="grid gap-2 sm:grid-cols-3">
                    <div className="rounded-md bg-[var(--color-card)] border border-[var(--color-card-border)] px-3 py-2">
                      <p className="text-[10px] uppercase tracking-wide text-[var(--color-muted)]">
                        期間報酬差
                      </p>
                      <p
                        className={`mt-1 tabular-nums text-sm font-medium ${
                          beatPositive(b.returnBeat) === true
                            ? "positive"
                            : beatPositive(b.returnBeat) === false
                              ? "negative"
                              : ""
                        }`}
                      >
                        {formatBeat(b.returnBeat, true)}
                      </p>
                      <p className="mt-0.5 text-[10px] text-[var(--color-muted)]">
                        組合 {formatPercent(b.portfolioPeriodReturn ?? 0)} · 基準{" "}
                        {formatPercent(b.periodReturn)}
                      </p>
                    </div>
                    <div className="rounded-md bg-[var(--color-card)] border border-[var(--color-card-border)] px-3 py-2">
                      <p className="text-[10px] uppercase tracking-wide text-[var(--color-muted)]">
                        Sharpe 差
                      </p>
                      <p
                        className={`mt-1 tabular-nums text-sm font-medium ${
                          beatPositive(b.sharpeBeat) === true
                            ? "positive"
                            : beatPositive(b.sharpeBeat) === false
                              ? "negative"
                              : ""
                        }`}
                      >
                        {formatBeat(b.sharpeBeat)}
                      </p>
                      <p className="mt-0.5 text-[10px] text-[var(--color-muted)]">
                        組合 {(b.portfolioSharpeRatio ?? 0).toFixed(2)} · 基準{" "}
                        {(b.sharpeRatio ?? 0).toFixed(2)}
                      </p>
                    </div>
                    <div className="rounded-md bg-[var(--color-card)] border border-[var(--color-card-border)] px-3 py-2">
                      <p className="text-[10px] uppercase tracking-wide text-[var(--color-muted)]">
                        最大回撤差
                      </p>
                      <p
                        className={`mt-1 tabular-nums text-sm font-medium ${
                          beatPositive(b.maxDrawdownBeat) === true
                            ? "positive"
                            : beatPositive(b.maxDrawdownBeat) === false
                              ? "negative"
                              : ""
                        }`}
                      >
                        {formatBeat(b.maxDrawdownBeat, true)}
                      </p>
                      <p className="mt-0.5 text-[10px] text-[var(--color-muted)]">
                        組合 {formatPercent(-(b.portfolioMaxDrawdown ?? 0))} · 基準{" "}
                        {formatPercent(-(b.maxDrawdown ?? 0))}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
          </PageSection>
          )}
        </>
      )}
    </div>
  );
}
