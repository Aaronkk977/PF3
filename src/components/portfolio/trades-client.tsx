"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { TradesPeriodChart } from "@/components/charts/trades-period-chart";
import { PageSection } from "@/components/layout/page-sections";
import { PerformancePeriodPresets } from "@/components/portfolio/performance-period-presets";
import { StatCard } from "@/components/portfolio/stat-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CollapsibleCard } from "@/components/ui/collapsible-card";
import { Input } from "@/components/ui/input";
import { useChartTheme } from "@/hooks/use-chart-theme";
import { resolveAccountSwatchColor } from "@/lib/chart-palette";
import { normalizePeriodRange } from "@/lib/date-keys";
import type { PerformancePeriodPreset } from "@/lib/performance-period-presets";
import {
  loadCustomPeriodPresets,
  loadPerformancePrefs,
} from "@/lib/performance-cache-client";
import {
  tradesGranularityLabel,
  type RealizedTradeRow,
  type TradesPeriodGranularity,
  type TradesReport,
} from "@/lib/trades-report";
import { encodeSymbol } from "@/lib/utils";
import {
  PAGE_CACHE_KEYS,
  patchClientCache,
  readClientCache,
  writeClientCache,
} from "@/lib/client-data-cache";
import {
  changePositiveMoney,
  changeToneClass,
  cn,
  formatCurrency,
  formatDate,
  formatPercent,
  parseResponseJson,
} from "@/lib/utils";

type AccountOption = {
  id: string;
  name: string;
  currency: string;
  color: string;
};

type PnlFilter = "all" | "win" | "loss";

type TradeSortKey =
  | "date"
  | "symbol"
  | "accountName"
  | "holdingDays"
  | "costBasisTwd"
  | "proceedsTwd"
  | "realizedPnl"
  | "realizedPnlPct"
  | "irr";

type SortDir = "asc" | "desc";

/** 上次成功查詢的完整畫面快照，讓返回此頁時能立即還原內容（避免因非同步重新
 * 抓取資料導致頁面短暫變矮，讓全域捲動位置還原機制抓不到正確高度）。 */
type TradesCacheSnapshot = {
  start: string;
  end: string;
  accountIds: string[];
  granularity: TradesPeriodGranularity;
  report: TradesReport;
  settingsExpanded: boolean;
  sortKey: TradeSortKey | null;
  sortDir: SortDir | null;
  pnlFilter: PnlFilter;
};

const GRANULARITY_OPTIONS: {
  value: TradesPeriodGranularity;
  label: string;
}[] = [
  { value: "week", label: "每週" },
  { value: "month", label: "每月" },
  { value: "quarter", label: "每季" },
  { value: "year", label: "每年" },
];

function toggleInList<T>(list: T[], item: T): T[] {
  return list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
}

function AppliedScopeBanner({ report }: { report: TradesReport }) {
  const accounts =
    report.appliedScope.accountNames.length > 0
      ? report.appliedScope.accountNames.join("、")
      : "（無帳戶）";

  return (
    <p className="mt-2 text-xs leading-relaxed text-[var(--color-foreground)]">
      <span className="text-[var(--color-muted)]">目前顯示：</span>
      {report.periodStart} ～ {report.periodEnd}
      <span className="mx-1 text-[var(--color-muted)]">·</span>
      {tradesGranularityLabel(report.granularity)}彙總
      <span className="mx-1 text-[var(--color-muted)]">·</span>
      {accounts}
    </p>
  );
}

export function TradesClient({
  accounts,
  defaultStart,
  defaultEnd,
  portfolioEarliest,
}: {
  accounts: AccountOption[];
  defaultStart: string;
  defaultEnd: string;
  portfolioEarliest: string;
}) {
  const chartTheme = useChartTheme();
  const [cached] = useState<TradesCacheSnapshot | null>(() =>
    readClientCache<TradesCacheSnapshot>(PAGE_CACHE_KEYS.trades),
  );
  const [start, setStart] = useState(cached?.start ?? defaultStart);
  const [end, setEnd] = useState(cached?.end ?? defaultEnd);
  const [granularity, setGranularity] = useState<TradesPeriodGranularity>(
    cached?.granularity ?? "month",
  );
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>(() => {
    const cachedIds = cached?.accountIds?.filter((id) =>
      accounts.some((a) => a.id === id),
    );
    if (cachedIds?.length) return cachedIds;
    return accounts.map((a) => a.id);
  });
  const [report, setReport] = useState<TradesReport | null>(
    cached?.report ?? null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pnlFilter, setPnlFilter] = useState<PnlFilter>(
    cached?.pnlFilter ?? "all",
  );
  const [settingsExpanded, setSettingsExpanded] = useState(
    cached?.settingsExpanded ?? true,
  );
  const [customPeriodPresets, setCustomPeriodPresets] = useState<
    PerformancePeriodPreset[]
  >([]);
  const [activePeriodPresetId, setActivePeriodPresetId] = useState<
    string | null
  >(null);
  const [sortKey, setSortKey] = useState<TradeSortKey | null>(
    cached?.sortKey ?? "date",
  );
  const [sortDir, setSortDir] = useState<SortDir | null>(
    cached?.sortDir ?? "desc",
  );

  useEffect(() => {
    const prefs = loadPerformancePrefs();
    setCustomPeriodPresets(loadCustomPeriodPresets(prefs));
    // 若已經有本頁的快照，代表 start/end/accountIds 已經是使用者上次實際查詢
    // 的精確狀態，比泛用的 performance 頁偏好設定更準確，不要覆蓋掉。
    if (cached) return;
    if (prefs?.start) setStart(prefs.start);
    if (prefs?.end) setEnd(prefs.end);
    if (prefs?.accountIds?.length) {
      const valid = prefs.accountIds.filter((id) =>
        accounts.some((a) => a.id === id),
      );
      if (valid.length > 0) setSelectedAccountIds(valid);
    }
  }, [accounts, cached]);

  const load = useCallback(async () => {
    if (selectedAccountIds.length === 0) {
      setError("請至少選擇一個帳戶");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const normalized = normalizePeriodRange(start, end);
      if (normalized.swapped) {
        setStart(normalized.start);
        setEnd(normalized.end);
      }
      const params = new URLSearchParams({
        start: normalized.start,
        end: normalized.end,
        accounts: selectedAccountIds.join(","),
        granularity,
      });
      const res = await fetch(`/api/trades?${params}`);
      const json = await parseResponseJson<TradesReport & { error?: string }>(
        res,
      );
      if (!res.ok || !json) {
        throw new Error(json?.error ?? "載入失敗");
      }
      setReport(json);
      setSettingsExpanded(false);
      writeClientCache<TradesCacheSnapshot>(PAGE_CACHE_KEYS.trades, {
        start: normalized.start,
        end: normalized.end,
        accountIds: selectedAccountIds,
        granularity,
        report: json,
        settingsExpanded: false,
        sortKey,
        sortDir,
        pnlFilter,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "載入失敗");
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, [start, end, selectedAccountIds, granularity, sortKey, sortDir, pnlFilter]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initial load only
  }, []);

  // 排序／篩選／設定面板展開狀態不會觸發重新查詢，但離開頁面前也一併存進
  // 快照，讓返回時完全還原上次畫面（僅在已有查詢結果的快照時才更新）。
  useEffect(() => {
    patchClientCache<TradesCacheSnapshot>(PAGE_CACHE_KEYS.trades, {
      sortKey,
      sortDir,
      pnlFilter,
      settingsExpanded,
    });
  }, [sortKey, sortDir, pnlFilter, settingsExpanded]);

  const applyPeriodRange = useCallback(
    (range: { start: string; end: string }, presetId: string | null) => {
      const normalized = normalizePeriodRange(range.start, range.end);
      setStart(normalized.start);
      setEnd(normalized.end);
      setActivePeriodPresetId(presetId);
    },
    [],
  );

  const draftAccountNames = useMemo(
    () =>
      accounts
        .filter((a) => selectedAccountIds.includes(a.id))
        .map((a) => a.name),
    [accounts, selectedAccountIds],
  );

  const sortedTrades = useMemo(() => {
    if (!report) return [];
    const filtered = report.realizedTrades.filter((row) => {
      if (pnlFilter === "win") return row.realizedPnl > 0;
      if (pnlFilter === "loss") return row.realizedPnl < 0;
      return true;
    });
    if (!sortKey || !sortDir) return filtered;

    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "date":
          cmp = a.date.localeCompare(b.date);
          break;
        case "symbol":
          cmp = a.symbol.localeCompare(b.symbol);
          break;
        case "accountName":
          cmp = a.accountName.localeCompare(b.accountName, "zh-TW");
          break;
        case "holdingDays":
          cmp = a.holdingDays - b.holdingDays;
          break;
        case "costBasisTwd":
          cmp = a.costBasisTwd - b.costBasisTwd;
          break;
        case "proceedsTwd":
          cmp = a.proceedsTwd - b.proceedsTwd;
          break;
        case "realizedPnl":
          cmp = a.realizedPnl - b.realizedPnl;
          break;
        case "realizedPnlPct":
          cmp = a.realizedPnlPct - b.realizedPnlPct;
          break;
        case "irr": {
          const av = a.irr ?? -Infinity;
          const bv = b.irr ?? -Infinity;
          cmp = av - bv;
          break;
        }
      }
      return cmp * dir;
    });
  }, [report, pnlFilter, sortKey, sortDir]);

  const handleSort = (key: TradeSortKey) => {
    if (sortKey !== key) {
      setSortKey(key);
      setSortDir(key === "date" ? "desc" : "desc");
      return;
    }
    if (sortDir === "desc") {
      setSortDir("asc");
      return;
    }
    setSortKey(null);
    setSortDir(null);
  };

  return (
    <div className="space-y-8">
      <PageSection id="trades-settings" title="設定" navOrder={10}>
        <CollapsibleCard
          title="查詢設定"
          expanded={settingsExpanded}
          onToggle={() => setSettingsExpanded((v) => !v)}
        >
          <div className="space-y-6">
            <div className="rounded-lg border border-[var(--color-primary)]/25 bg-[var(--color-primary)]/8 px-4 py-3">
              <p className="text-sm font-medium text-[var(--color-primary)]">
                套用範圍
              </p>
              {report && <AppliedScopeBanner report={report} />}
              {!report && (
                <p className="mt-2 text-xs text-[var(--color-muted)]">
                  草稿：{start} ～ {end} · {tradesGranularityLabel(granularity)} ·{" "}
                  {draftAccountNames.join("、") || "（請選帳戶）"}
                </p>
              )}
            </div>

            <fieldset className="space-y-3 border-0 p-0">
              <legend className="text-xs font-medium uppercase tracking-wide text-[var(--color-primary)]">
                查詢期間
              </legend>
              <div className="flex flex-wrap items-end gap-4">
                <div>
                  <label className="mb-1 block text-xs text-[var(--color-muted)]">
                    起始
                  </label>
                  <Input
                    type="date"
                    value={start}
                    onChange={(e) => {
                      setStart(e.target.value);
                      setActivePeriodPresetId(null);
                    }}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-[var(--color-muted)]">
                    結束
                  </label>
                  <Input
                    type="date"
                    value={end}
                    onChange={(e) => {
                      setEnd(e.target.value);
                      setActivePeriodPresetId(null);
                    }}
                  />
                </div>
              </div>
              <PerformancePeriodPresets
                start={start}
                end={end}
                activePresetId={activePeriodPresetId}
                customPresets={customPeriodPresets}
                portfolioEarliest={portfolioEarliest}
                onApply={applyPeriodRange}
                onCustomPresetsChange={setCustomPeriodPresets}
              />
            </fieldset>

            <fieldset className="space-y-3 border-0 p-0">
              <legend className="text-xs font-medium uppercase tracking-wide text-[var(--color-primary)]">
                彙總粒度
              </legend>
              <p className="text-[11px] text-[var(--color-muted)]">
                影響上方折線圖與下方彙總表的分組方式
              </p>
              <div className="flex flex-wrap gap-2">
                {GRANULARITY_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setGranularity(opt.value)}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-sm transition-colors",
                      granularity === opt.value
                        ? "border-[var(--color-primary)] bg-[var(--color-primary)]/15 text-[var(--color-primary)]"
                        : "border-[var(--color-card-border)] text-[var(--color-muted)] hover:border-[var(--color-primary)]/40",
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </fieldset>

            <fieldset className="space-y-3 border-0 p-0">
              <legend className="text-xs font-medium uppercase tracking-wide text-[var(--color-primary)]">
                帳戶範圍
              </legend>
              <p className="text-[11px] text-[var(--color-muted)]">
                勾選的帳戶交易將合併計算（可多選或單選）
              </p>
              <div className="flex flex-wrap gap-3">
                {accounts.length === 0 ? (
                  <p className="text-xs text-[var(--color-muted)]">尚無帳戶</p>
                ) : (
                  accounts.map((acc, index) => (
                    <label
                      key={acc.id}
                      className="flex cursor-pointer items-center gap-2 text-sm"
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
                      <span className="text-xs text-[var(--color-muted)]">
                        ({acc.currency})
                      </span>
                    </label>
                  ))
                )}
              </div>
            </fieldset>

            <div className="flex flex-wrap items-center gap-3 border-t border-[var(--color-card-border)]/50 pt-4">
              <Button onClick={() => void load()} disabled={loading}>
                {loading ? "查詢中…" : "套用並查詢"}
              </Button>
              {error && (
                <p className="text-sm text-[var(--color-negative)]">{error}</p>
              )}
            </div>
          </div>
        </CollapsibleCard>
      </PageSection>

      {report && (
        <>
          {report.fxNote && (
            <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200/90">
              {report.fxNote}
            </p>
          )}

          <PageSection id="trades-summary" title="期間合計" navOrder={20}>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard
                title="手續費"
                value={report.summary.fees}
                isCurrency
                currency={report.baseCurrency}
                neutral
              />
              <StatCard
                title="稅"
                value={report.summary.taxes}
                isCurrency
                currency={report.baseCurrency}
                neutral
              />
              <StatCard
                title="實現損益"
                value={report.summary.realizedPnl}
                isCurrency
                currency={report.baseCurrency}
                positive={changePositiveMoney(report.summary.realizedPnl)}
              />
              <StatCard
                title="已平倉"
                value={report.summary.sellCount}
                subtitle={`獲利 ${report.summary.winCount} · 虧損 ${report.summary.lossCount}`}
                neutral
              />
            </div>
          </PageSection>

          <PageSection
            id="trades-buckets"
            title={`${tradesGranularityLabel(report.granularity)}彙總`}
            navOrder={30}
          >
            <Card>
              <CardContent className="space-y-6 pt-6">
                <TradesPeriodChart
                  buckets={report.buckets}
                  baseCurrency={report.baseCurrency}
                />
                {report.buckets.length === 0 ? (
                  <p className="py-6 text-center text-sm text-[var(--color-muted)]">
                    此期間無交易費用或平倉紀錄
                  </p>
                ) : (
                  <div className="overflow-x-auto border-t border-[var(--color-card-border)]/50 pt-6">
                    <table className="w-full min-w-[640px] text-left text-sm">
                      <thead>
                        <tr className="border-b border-[var(--color-card-border)] text-xs text-[var(--color-muted)]">
                          <th className="py-2 pr-4 font-medium">期間</th>
                          <th className="py-2 pr-4 font-medium text-right">
                            手續費
                          </th>
                          <th className="py-2 pr-4 font-medium text-right">
                            稅
                          </th>
                          <th className="py-2 pr-4 font-medium text-right">
                            實現損益
                          </th>
                          <th className="py-2 font-medium text-right">
                            賣出筆數
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.buckets.map((bucket) => (
                          <tr
                            key={bucket.key}
                            className="border-b border-[var(--color-card-border)]/40"
                          >
                            <td className="py-3 pr-4 font-medium text-[var(--color-foreground)]">
                              {bucket.label}
                            </td>
                            <td className="py-3 pr-4 text-right tabular-nums text-[var(--color-muted)]">
                              {formatCurrency(
                                bucket.fees,
                                report.baseCurrency,
                              )}
                            </td>
                            <td className="py-3 pr-4 text-right tabular-nums text-[var(--color-muted)]">
                              {formatCurrency(
                                bucket.taxes,
                                report.baseCurrency,
                              )}
                            </td>
                            <td
                              className={cn(
                                "py-3 pr-4 text-right tabular-nums",
                                changeToneClass(
                                  bucket.realizedPnl,
                                  "money",
                                ),
                              )}
                            >
                              {formatCurrency(
                                bucket.realizedPnl,
                                report.baseCurrency,
                              )}
                            </td>
                            <td className="py-3 text-right tabular-nums text-[var(--color-foreground)]">
                              {bucket.sellCount}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t border-[var(--color-card-border)] font-medium">
                          <td className="py-3 pr-4">合計</td>
                          <td className="py-3 pr-4 text-right tabular-nums">
                            {formatCurrency(
                              report.summary.fees,
                              report.baseCurrency,
                            )}
                          </td>
                          <td className="py-3 pr-4 text-right tabular-nums">
                            {formatCurrency(
                              report.summary.taxes,
                              report.baseCurrency,
                            )}
                          </td>
                          <td
                            className={cn(
                              "py-3 pr-4 text-right tabular-nums",
                              changeToneClass(
                                report.summary.realizedPnl,
                                "money",
                              ),
                            )}
                          >
                            {formatCurrency(
                              report.summary.realizedPnl,
                              report.baseCurrency,
                            )}
                          </td>
                          <td className="py-3 text-right tabular-nums">
                            {report.summary.sellCount}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </PageSection>

          <PageSection id="trades-realized" title="逐筆實現損益" navOrder={40}>
            <Card>
              <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <CardTitle className="text-base">逐筆實現損益</CardTitle>
                  <p className="mt-1 text-xs text-[var(--color-muted)]">
                    點欄位標題排序 · IRR 為依持有天數之年化報酬
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {(
                    [
                      { id: "all", label: "全部" },
                      { id: "win", label: "獲利" },
                      { id: "loss", label: "虧損" },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setPnlFilter(opt.id)}
                      className={cn(
                        "rounded-full border px-3 py-1 text-xs transition-colors",
                        pnlFilter === opt.id
                          ? "border-[var(--color-primary)] bg-[var(--color-primary)]/15 text-[var(--color-primary)]"
                          : "border-[var(--color-card-border)] text-[var(--color-muted)] hover:border-[var(--color-primary)]/40",
                      )}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </CardHeader>
              <CardContent>
                {sortedTrades.length === 0 ? (
                  <p className="py-6 text-center text-sm text-[var(--color-muted)]">
                    無符合條件的平倉紀錄
                  </p>
                ) : (
                  <RealizedTradesTable
                    rows={sortedTrades}
                    baseCurrency={report.baseCurrency}
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onSort={handleSort}
                  />
                )}
              </CardContent>
            </Card>
          </PageSection>
        </>
      )}
    </div>
  );
}

function TradeSortHeader({
  label,
  sortKey: key,
  activeKey,
  dir,
  onSort,
  className = "",
}: {
  label: string;
  sortKey: TradeSortKey;
  activeKey: TradeSortKey | null;
  dir: SortDir | null;
  onSort: (key: TradeSortKey) => void;
  className?: string;
}) {
  const active = activeKey === key;
  const arrow =
    !active || !dir ? "↕" : dir === "asc" ? "↑" : "↓";
  return (
    <th className={cn("py-2 pr-1", className)}>
      <button
        type="button"
        onClick={() => onSort(key)}
        className={cn(
          "inline-flex items-center gap-1 text-xs font-medium transition-colors hover:text-[var(--color-primary)]",
          active ? "text-[var(--color-primary)]" : "text-[var(--color-muted)]",
          className?.includes("text-right") && "ml-auto",
        )}
      >
        <span>{label}</span>
        <span
          className={cn(
            "text-[10px]",
            active
              ? "text-[var(--color-primary)]"
              : "text-[var(--color-muted)]/50",
          )}
          aria-hidden
        >
          {arrow}
        </span>
      </button>
    </th>
  );
}

function RealizedTradesTable({
  rows,
  baseCurrency,
  sortKey,
  sortDir,
  onSort,
}: {
  rows: RealizedTradeRow[];
  baseCurrency: string;
  sortKey: TradeSortKey | null;
  sortDir: SortDir | null;
  onSort: (key: TradeSortKey) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full table-fixed text-left text-xs sm:text-sm">
        <colgroup>
          <col className="w-[4.25rem]" />
          <col className="w-[20%]" />
          <col className="w-[4rem]" />
          <col className="w-[2.5rem]" />
          <col className="w-[3.25rem]" />
          <col className="w-[3.25rem]" />
          <col className="w-[3.25rem]" />
          <col className="w-[3rem]" />
          <col className="w-[4rem]" />
        </colgroup>
        <thead>
          <tr className="border-b border-[var(--color-card-border)]">
            <TradeSortHeader
              label="日期"
              sortKey="date"
              activeKey={sortKey}
              dir={sortDir}
              onSort={onSort}
            />
            <TradeSortHeader
              label="標的"
              sortKey="symbol"
              activeKey={sortKey}
              dir={sortDir}
              onSort={onSort}
            />
            <TradeSortHeader
              label="帳戶"
              sortKey="accountName"
              activeKey={sortKey}
              dir={sortDir}
              onSort={onSort}
            />
            <TradeSortHeader
              label="天數"
              sortKey="holdingDays"
              activeKey={sortKey}
              dir={sortDir}
              onSort={onSort}
              className="text-right"
            />
            <TradeSortHeader
              label="成本"
              sortKey="costBasisTwd"
              activeKey={sortKey}
              dir={sortDir}
              onSort={onSort}
              className="text-right"
            />
            <TradeSortHeader
              label="收入"
              sortKey="proceedsTwd"
              activeKey={sortKey}
              dir={sortDir}
              onSort={onSort}
              className="text-right"
            />
            <TradeSortHeader
              label="損益"
              sortKey="realizedPnl"
              activeKey={sortKey}
              dir={sortDir}
              onSort={onSort}
              className="text-right"
            />
            <TradeSortHeader
              label="報酬"
              sortKey="realizedPnlPct"
              activeKey={sortKey}
              dir={sortDir}
              onSort={onSort}
              className="text-right"
            />
            <TradeSortHeader
              label="IRR"
              sortKey="irr"
              activeKey={sortKey}
              dir={sortDir}
              onSort={onSort}
              className="text-right"
            />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.transactionId}
              className="border-b border-[var(--color-card-border)]/40"
            >
              <td className="whitespace-nowrap py-2 pr-1 text-[var(--color-foreground)]">
                {formatDate(row.date)}
              </td>
              <td
                className="max-w-0 py-2 pr-2"
                title={
                  row.instrumentName
                    ? `${row.symbol} ${row.instrumentName}`
                    : row.symbol
                }
              >
                <div className="flex min-w-0 items-baseline gap-1.5 overflow-hidden whitespace-nowrap">
                  <Link
                    href={`/instruments/${encodeSymbol(row.symbol)}`}
                    className="shrink-0 font-medium text-[var(--color-primary)] hover:underline"
                  >
                    {row.symbol}
                  </Link>
                  {row.instrumentName ? (
                    <span className="min-w-0 truncate text-[11px] text-[var(--color-muted)]">
                      {row.instrumentName}
                    </span>
                  ) : null}
                </div>
              </td>
              <td
                className="truncate py-2 pr-1 text-[var(--color-foreground)]"
                title={row.accountName}
              >
                {row.accountName}
              </td>
              <td className="whitespace-nowrap py-2 pr-1 text-right tabular-nums text-[var(--color-muted)]">
                {row.holdingDays}
              </td>
              <td className="whitespace-nowrap py-2 pr-1 text-right tabular-nums text-[var(--color-muted)]">
                {formatCurrency(row.costBasisTwd, baseCurrency)}
              </td>
              <td className="whitespace-nowrap py-2 pr-1 text-right tabular-nums text-[var(--color-muted)]">
                {formatCurrency(row.proceedsTwd, baseCurrency)}
              </td>
              <td
                className={cn(
                  "whitespace-nowrap py-2 pr-1 text-right tabular-nums font-medium",
                  changeToneClass(row.realizedPnl, "money"),
                )}
              >
                {formatCurrency(row.realizedPnl, baseCurrency)}
              </td>
              <td
                className={cn(
                  "whitespace-nowrap py-2 pr-1 text-right tabular-nums",
                  changeToneClass(row.realizedPnlPct),
                )}
              >
                {formatPercent(row.realizedPnlPct)}
              </td>
              <td
                className={cn(
                  "whitespace-nowrap py-2 pl-1 pr-0.5 text-right tabular-nums",
                  row.irr != null ? changeToneClass(row.irr) : "",
                )}
              >
                {row.irr != null ? formatPercent(row.irr) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 text-xs text-[var(--color-muted)]">
        手續費與稅已自實現損益分離。IRR = (1 + 總報酬率)
        <sup>365/持有天數</sup> − 1。單筆費用請至{" "}
        <Link
          href="/transactions"
          className="text-[var(--color-primary)] hover:underline"
        >
          Transactions
        </Link>{" "}
        查閱。
      </p>
    </div>
  );
}
