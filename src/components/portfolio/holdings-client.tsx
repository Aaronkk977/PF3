"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AllocationChart } from "@/components/charts/allocation-chart";
import {
  ValueTrendChart,
  type ValueTrendLineConfig,
} from "@/components/charts/value-trend-chart";
import { AllocationSettings } from "@/components/portfolio/allocation-settings";
import { CompactHoldingsFilters } from "@/components/portfolio/compact-holdings-filters";
import { HoldingCategoryCell } from "@/components/portfolio/holding-category-cell";
import {
  HoldingsCategoriesPanel,
  type CategoryRow,
} from "@/components/portfolio/holdings-categories-panel";
import { TrendValueSettings } from "@/components/portfolio/trend-value-settings";
import {
  buildAllocationChartData,
  cashForFilters,
  filterHoldingsForAllocation,
  isUserCategoryKey,
  userCategoryKeys,
} from "@/lib/allocation-chart-data";
import { ENTIRE_PORTFOLIO_FILTER_ID } from "@/lib/chart-constants";
import { PageSection } from "@/components/layout/page-sections";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useSettings } from "@/components/settings/settings-provider";
import type { HoldingPosition } from "@/lib/holding-types";
import { convertFromTwd } from "@/lib/fx-convert";
import {
  buildHoldingsValueCacheKey,
  isHoldingsValueCacheFresh,
  loadHoldingsValueCache,
  saveHoldingsValueCache,
  type ValueTrendLine,
} from "@/lib/holdings-cache-client";
import type { CashFlowEvent } from "@/lib/portfolio-history";
import {
  loadHoldingsPrefs,
  saveHoldingsPrefs,
  type HoldingsPrefs,
} from "@/lib/ui-prefs";
import { withoutDeprecatedTags } from "@/lib/deprecated-tags";
import { instrumentHref } from "@/lib/instrument-nav";
import {
  changeToneClass,
  formatCurrency,
  formatPercent,
  parseResponseJson,
} from "@/lib/utils";

type AccountOption = { id: string; name: string; currency: string };

type SortKey =
  | "symbol"
  | "quantity"
  | "avgCost"
  | "costBasisBase"
  | "marketValue"
  | "marketValueBase"
  | "unrealizedPnl"
  | "unrealizedPnlPct"
  | "dayChangePct"
  | "weight";

type SortDir = "asc" | "desc";

function defaultTrendStartDate(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 1);
  return d.toISOString().slice(0, 10);
}

function SortHeader({
  label,
  sortKey,
  activeKey,
  dir,
  onSort,
  className = "",
}: {
  label: string;
  sortKey: SortKey;
  activeKey: SortKey | null;
  dir: SortDir | null;
  onSort: (key: SortKey) => void;
  className?: string;
}) {
  const active = activeKey === sortKey;
  const arrow = !active || !dir ? "\u2195" : dir === "asc" ? "\u2191" : "\u2193";
  return (
    <th className={`pb-3 pr-4 ${className}`}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-1 text-xs uppercase tracking-wider transition-colors hover:text-[var(--color-primary)] ${
          active ? "text-[var(--color-primary)]" : "text-[var(--color-muted)]"
        }`}
      >
        <span>{label}</span>
        <span
          className={`text-[10px] ${active ? "text-[var(--color-primary)]" : "text-[var(--color-muted)]/50"}`}
          aria-hidden
        >
          {arrow}
        </span>
      </button>
    </th>
  );
}

function scaleHolding(h: HoldingPosition, qty: number): HoldingPosition {
  if (qty >= h.quantity) return h;
  const ratio = h.quantity > 0 ? qty / h.quantity : 0;
  return {
    ...h,
    quantity: qty,
    costBasis: h.costBasis * ratio,
    marketValue: h.marketValue * ratio,
    marketValueBase: h.marketValueBase * ratio,
    unrealizedPnl: h.unrealizedPnl * ratio,
    dayChange: h.dayChange * ratio,
  };
}

function filterHoldings(
  holdings: HoldingPosition[],
  tagFilters: string[],
  accountFilters: string[],
): HoldingPosition[] {
  let list = holdings
    .map((h) => {
      if (accountFilters.length === 0) return h;
      const selected = h.accounts.filter((a) =>
        accountFilters.includes(a.id),
      );
      if (selected.length === 0) return null;
      const qty = selected.reduce((s, a) => s + a.quantity, 0);
      return scaleHolding(h, qty);
    })
    .filter((h): h is HoldingPosition => h !== null);

  if (tagFilters.length > 0) {
    list = list.filter((h) => {
      if (tagFilters.includes("__uncategorized__") && h.tags.length === 0) {
        return true;
      }
      return tagFilters.some(
        (t) => t !== "__uncategorized__" && h.tags.includes(t),
      );
    });
  }

  return list;
}

/** 基準幣總投入（成本），與後端 unrealized = 市值 − 成本 一致 */
function costBasisInBase(h: HoldingPosition): number {
  return h.marketValueBase - h.unrealizedPnl;
}

export function HoldingsClient({
  holdings: holdingsProp,
  accounts,
  allTags,
  totalCashBase,
  cashByAccount,
  onRefresh,
}: {
  holdings: HoldingPosition[];
  accounts: AccountOption[];
  allTags: string[];
  totalCashBase: number;
  cashByAccount: Record<string, number>;
  onRefresh?: () => void;
}) {
  const pathname = usePathname();
  const [holdings, setHoldings] = useState(holdingsProp);
  const [categoryRows, setCategoryRows] = useState<CategoryRow[]>([]);
  const allCategories = useMemo(
    () =>
      categoryRows.length > 0
        ? categoryRows.map((c) => c.name)
        : allTags,
    [categoryRows, allTags],
  );
  const [allocationTagFilters, setAllocationTagFilters] = useState<string[]>(
    [],
  );
  const [allocationAccountFilters, setAllocationAccountFilters] = useState<
    string[]
  >([]);
  const [allocationAggregateBy, setAllocationAggregateBy] = useState<string[]>(
    [],
  );
  const [drillDownCategory, setDrillDownCategory] = useState<string | null>(
    null,
  );
  const [tableTagFilters, setTableTagFilters] = useState<string[]>([]);
  const [tableAccountFilters, setTableAccountFilters] = useState<string[]>(
    [],
  );
  const [trendAccountFilters, setTrendAccountFilters] = useState<string[]>([]);
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir | null>(null);
  const [trendLines, setTrendLines] = useState<ValueTrendLine[]>([]);
  const [trendChartData, setTrendChartData] = useState<
    Record<string, string | number>[]
  >([]);
  const [trendCashFlows, setTrendCashFlows] = useState<CashFlowEvent[]>([]);
  const [valueHistoryLoading, setValueHistoryLoading] = useState(false);
  const [valueCacheHint, setValueCacheHint] = useState<string | null>(null);
  const [trendStartDate, setTrendStartDate] = useState(defaultTrendStartDate);
  const [usdToTwd, setUsdToTwd] = useState(32);
  const [twdToBase, setTwdToBase] = useState<number | null>(1);
  const [prefsReady, setPrefsReady] = useState(false);
  const { settings } = useSettings();
  const baseCurrency = settings.baseCurrency;

  useEffect(() => {
    setHoldings(holdingsProp);
  }, [holdingsProp]);

  useEffect(() => {
    const prefs = loadHoldingsPrefs();
    const mapCatKey = (list: string[]) =>
      list
        .map((x) => (x === "__untagged__" ? "__uncategorized__" : x))
        .filter((x) => x !== "__uncategorized__");
    setAllocationTagFilters(
      withoutDeprecatedTags(mapCatKey(prefs.allocationTagFilters)),
    );
    setAllocationAccountFilters(prefs.allocationAccountFilters);
    setAllocationAggregateBy(
      Array.isArray(prefs.allocationAggregateBy)
        ? prefs.allocationAggregateBy
        : [],
    );
    setTableTagFilters(withoutDeprecatedTags(mapCatKey(prefs.tableTagFilters)));
    setTableAccountFilters(prefs.tableAccountFilters);
    setTrendAccountFilters(prefs.trendAccountFilters);
    setSortKey(prefs.sortKey);
    setSortDir(prefs.sortDir);
    setTrendStartDate(prefs.trendStartDate || defaultTrendStartDate());
    setPrefsReady(true);
  }, []);

  useEffect(() => {
    void fetch(
      `/api/fx/rates?base=${encodeURIComponent(baseCurrency)}&codes=TWD,USD`,
    )
      .then(async (r) =>
        r.ok
          ? parseResponseJson<{
              usdToTwd?: number;
              rates?: { code: string; rateToBase: number }[];
            }>(r)
          : null,
      )
      .then((j: { usdToTwd?: number; rates?: { code: string; rateToBase: number }[] } | null) => {
        if (j?.usdToTwd && j.usdToTwd > 0) setUsdToTwd(j.usdToTwd);
        const twdRow = j?.rates?.find((r) => r.code === "TWD");
        if (baseCurrency === "TWD") {
          setTwdToBase(1);
        } else if (twdRow?.rateToBase && twdRow.rateToBase > 0) {
          setTwdToBase(twdRow.rateToBase);
        } else {
          setTwdToBase(null);
        }
      })
      .catch(() => {});
  }, [baseCurrency]);

  useEffect(() => {
    if (!prefsReady) return;
    const prefs: HoldingsPrefs = {
      allocationTagFilters,
      allocationAccountFilters,
      tableTagFilters,
      tableAccountFilters,
      trendAccountFilters,
      trendStartDate,
      sortKey,
      sortDir,
      allocationAggregateBy,
    };
    saveHoldingsPrefs(prefs);
  }, [
    allocationTagFilters,
    allocationAccountFilters,
    allocationAggregateBy,
    tableTagFilters,
    tableAccountFilters,
    trendAccountFilters,
    trendStartDate,
    sortKey,
    sortDir,
    prefsReady,
  ]);

  const toSettlement = useCallback(
    (amountTwd: number) =>
      convertFromTwd(amountTwd, baseCurrency, twdToBase, usdToTwd),
    [baseCurrency, twdToBase, usdToTwd],
  );

  function cycleSort(key: SortKey) {
    if (sortKey !== key) {
      setSortKey(key);
      setSortDir(key === "symbol" ? "asc" : "desc");
      return;
    }
    if (sortDir === "asc") {
      setSortDir("desc");
      return;
    }
    setSortKey(null);
    setSortDir(null);
  }

  useEffect(() => {
    setDrillDownCategory(null);
  }, [allocationAggregateBy]);

  const tableFiltered = useMemo(
    () => filterHoldings(holdings, tableTagFilters, tableAccountFilters),
    [holdings, tableTagFilters, tableAccountFilters],
  );

  const tableWeightDenominator = useMemo(() => {
    const securities = tableFiltered.reduce((s, h) => s + h.marketValueBase, 0);
    const cash = cashForFilters(
      tableAccountFilters,
      totalCashBase,
      cashByAccount,
    );
    return securities + cash;
  }, [tableFiltered, tableAccountFilters, totalCashBase, cashByAccount]);

  const sorted = useMemo(() => {
    if (!sortKey || !sortDir) return tableFiltered;
    const list = [...tableFiltered];
    const dir = sortDir === "asc" ? 1 : -1;

    list.sort((a, b) => {
      switch (sortKey) {
        case "symbol":
          return a.symbol.localeCompare(b.symbol) * dir;
        case "quantity":
          return (a.quantity - b.quantity) * dir;
        case "avgCost":
          return (a.avgCost - b.avgCost) * dir;
        case "costBasisBase":
          return (costBasisInBase(a) - costBasisInBase(b)) * dir;
        case "marketValue":
          return (a.marketValue - b.marketValue) * dir;
        case "marketValueBase":
          return (a.marketValueBase - b.marketValueBase) * dir;
        case "unrealizedPnl":
          return (a.unrealizedPnl - b.unrealizedPnl) * dir;
        case "unrealizedPnlPct":
          return (a.unrealizedPnlPct - b.unrealizedPnlPct) * dir;
        case "dayChangePct":
          return ((a.dayChangePct ?? 0) - (b.dayChangePct ?? 0)) * dir;
        case "weight": {
          const total = tableWeightDenominator;
          const wa = total > 0 ? a.marketValueBase / total : 0;
          const wb = total > 0 ? b.marketValueBase / total : 0;
          return (wa - wb) * dir;
        }
        default:
          return 0;
      }
    });
    return list;
  }, [tableFiltered, tableWeightDenominator, sortKey, sortDir]);

  const chartData = useMemo(
    () =>
      buildAllocationChartData({
        holdings,
        accounts,
        accountFilters: allocationAccountFilters,
        categoryFilters: allocationTagFilters,
        aggregateBy: allocationAggregateBy,
        cashByAccount,
        totalCashBase,
        drillDownCategory,
      }),
    [
      holdings,
      accounts,
      allocationAccountFilters,
      allocationTagFilters,
      allocationAggregateBy,
      cashByAccount,
      totalCashBase,
      drillDownCategory,
    ],
  );

  const allocationCenterTotal = useMemo(() => {
    const filtered = filterHoldingsForAllocation(
      holdings,
      allocationTagFilters,
      allocationAccountFilters,
    );
    const securities = filtered.reduce((s, h) => s + h.marketValueBase, 0);
    const cash =
      allocationAccountFilters.length === 0
        ? totalCashBase
        : allocationAccountFilters.reduce(
            (s, id) => s + (cashByAccount[id] ?? 0),
            0,
          );
    return convertFromTwd(securities + cash, baseCurrency, twdToBase, usdToTwd);
  }, [
    holdings,
    allocationTagFilters,
    allocationAccountFilters,
    totalCashBase,
    cashByAccount,
    baseCurrency,
    twdToBase,
    usdToTwd,
  ]);

  const allocationDrillHint = useMemo(() => {
    if (
      !drillDownCategory ||
      !isUserCategoryKey(drillDownCategory) ||
      !userCategoryKeys(allocationAggregateBy).includes(drillDownCategory)
    ) {
      return null;
    }
    return `類別「${drillDownCategory}」· 各帳戶佔比`;
  }, [allocationAggregateBy, drillDownCategory]);

  const trendLineConfigs = useMemo<ValueTrendLineConfig[]>(
    () =>
      trendLines.map(({ dataKey, label, color, kind }) => ({
        dataKey,
        label,
        color,
        kind,
      })),
    [trendLines],
  );

  const trendSelection = useMemo(() => {
    const wantsEntire = trendAccountFilters.includes(ENTIRE_PORTFOLIO_FILTER_ID);
    const accountIds = trendAccountFilters.filter(
      (id) => id !== ENTIRE_PORTFOLIO_FILTER_ID,
    );
    return { wantsEntire, accountIds };
  }, [trendAccountFilters]);

  const valueHistoryAccountIds = useMemo(() => {
    if (trendSelection.accountIds.length > 0) {
      return trendSelection.accountIds.join(",");
    }
    return "all";
  }, [trendSelection.accountIds]);

  const loadValueHistory = useCallback(
    async (force = false) => {
      const cacheKey = buildHoldingsValueCacheKey(
        valueHistoryAccountIds,
        trendStartDate,
        trendSelection.wantsEntire,
        true,
      );

      const localCached = loadHoldingsValueCache(cacheKey);
      if (localCached) {
        setTrendLines(localCached.lines);
        setTrendChartData(localCached.chartData);
        setTrendCashFlows(localCached.cashFlows ?? []);
        setValueCacheHint(
          `已載入 ${new Date(localCached.cachedAt).toLocaleString("zh-TW")} 的快取`,
        );
        if (!force && isHoldingsValueCacheFresh(localCached.cachedAt)) {
          return;
        }
      }

      setValueHistoryLoading(true);
      try {
        const forceParam = force ? "&force=1" : "";
        const entireParam = trendSelection.wantsEntire ? "&entire=1" : "";
        const flowsParam = "&includeCashFlows=1";
        const res = await fetch(
          `/api/portfolio/value-history?start=${encodeURIComponent(trendStartDate)}&accountIds=${encodeURIComponent(valueHistoryAccountIds)}${entireParam}${flowsParam}${forceParam}`,
        );
        if (res.ok) {
          const json = await parseResponseJson<{
            lines: ValueTrendLine[];
            cashFlows: CashFlowEvent[];
            chartData: Record<string, string | number>[];
          }>(res);
          if (!json) return;
          const lines = json.lines ?? [];
          const flows = json.cashFlows ?? [];
          const chartData = json.chartData ?? [];
          setTrendLines(lines);
          setTrendChartData(chartData);
          setTrendCashFlows(flows);
          const cachedAt = new Date().toISOString();
          saveHoldingsValueCache({
            cacheKey,
            cachedAt,
            lines,
            cashFlows: flows,
            chartData,
          });
          setValueCacheHint(
            `${force ? "完整重算" : "已更新"} · ${new Date(cachedAt).toLocaleString("zh-TW")}`,
          );
        }
      } finally {
        setValueHistoryLoading(false);
      }
    },
    [valueHistoryAccountIds, trendStartDate, trendSelection.wantsEntire],
  );

  useEffect(() => {
    if (!prefsReady) return;
    void loadValueHistory(false);
  }, [prefsReady, loadValueHistory]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-mono text-2xl font-bold text-[var(--color-primary)] glow-text">
          Holdings
        </h1>
        <p className="mt-1 text-sm text-[var(--color-muted)]">{"\u6301\u5009\u660e\u7d30"}</p>
      </div>

      <PageSection id="holdings-allocation" title="持倉配置" navOrder={10}>
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2 space-y-0">
            <CardTitle>{"\u6301\u5009\u914d\u7f6e"}</CardTitle>
            <AllocationSettings
              accounts={accounts}
              allCategories={allCategories}
              accountFilters={allocationAccountFilters}
              aggregateBy={allocationAggregateBy}
              onAccountFiltersChange={setAllocationAccountFilters}
              onAggregateByChange={setAllocationAggregateBy}
            />
          </CardHeader>
          <CardContent>
            <AllocationChart
              data={chartData}
              centerValue={allocationCenterTotal}
              centerCurrency={baseCurrency}
              drillHint={allocationDrillHint}
              onSliceClick={(slice) => {
                if (drillDownCategory) return;
                if (!slice.key || !isUserCategoryKey(slice.key)) return;
                if (!userCategoryKeys(allocationAggregateBy).includes(slice.key)) {
                  return;
                }
                setDrillDownCategory(slice.key);
              }}
            />
            {allocationDrillHint && (
              <button
                type="button"
                className="mt-2 text-xs text-[var(--color-primary)] hover:underline"
                onClick={() => setDrillDownCategory(null)}
              >
                返回類別總覽
              </button>
            )}
          </CardContent>
        </Card>
      </PageSection>

      <PageSection
        id="holdings-value-trend"
        title="資產市值走勢"
        className="mt-8"
        navOrder={20}
      >
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2 space-y-0">
            <div className="min-w-0 space-y-1">
              <CardTitle>{"\u8cc7\u7522\u5e02\u503c\u8d70\u52e2"}</CardTitle>
              {valueCacheHint && (
                <p className="text-xs text-[var(--color-muted)]">{valueCacheHint}</p>
              )}
            </div>
            <div className="flex flex-col items-end gap-1.5">
              <TrendValueSettings
                accounts={accounts}
                accountFilters={trendAccountFilters}
                onAccountFiltersChange={setTrendAccountFilters}
                startDate={trendStartDate}
                onStartDateChange={setTrendStartDate}
              />
              <button
                type="button"
                onClick={() => void loadValueHistory(true)}
                disabled={valueHistoryLoading}
                className="text-xs text-[var(--color-primary)] hover:underline disabled:opacity-50"
              >
                {valueHistoryLoading ? "更新中…" : "更新"}
              </button>
            </div>
          </CardHeader>
          <CardContent>
            <ValueTrendChart
              lines={trendLineConfigs}
              chartData={trendChartData}
              cashFlows={trendCashFlows}
              loading={valueHistoryLoading}
              currency={baseCurrency}
            />
          </CardContent>
        </Card>
      </PageSection>

      <PageSection
        id="holdings-table"
        title="持倉列表"
        className="mt-8"
        navOrder={30}
      >
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2 space-y-0">
          <CardTitle>{"\u6301\u5009\u5217\u8868"}</CardTitle>
          <CompactHoldingsFilters
            accounts={accounts}
            allTags={allCategories}
            tagFilters={tableTagFilters}
            accountFilters={tableAccountFilters}
            onTagFiltersChange={setTableTagFilters}
            onAccountFiltersChange={setTableAccountFilters}
            showUncategorizedPill={false}
          />
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-card-border)] text-left">
                <SortHeader
                  label={"\u6a19\u7684"}
                  sortKey="symbol"
                  activeKey={sortKey}
                  dir={sortDir}
                  onSort={cycleSort}
                />
                <SortHeader
                  label={"\u6578\u91cf"}
                  sortKey="quantity"
                  activeKey={sortKey}
                  dir={sortDir}
                  onSort={cycleSort}
                />
                <SortHeader
                  label={"\u5747\u50f9"}
                  sortKey="avgCost"
                  activeKey={sortKey}
                  dir={sortDir}
                  onSort={cycleSort}
                />
                <SortHeader
                  label={"\u7e3d\u6295\u5165"}
                  sortKey="costBasisBase"
                  activeKey={sortKey}
                  dir={sortDir}
                  onSort={cycleSort}
                />
                <SortHeader
                  label={"\u5e02\u503c"}
                  sortKey="marketValue"
                  activeKey={sortKey}
                  dir={sortDir}
                  onSort={cycleSort}
                />
                <SortHeader
                  label={"\u672a\u5be6\u73fe\u640d\u76ca"}
                  sortKey="unrealizedPnl"
                  activeKey={sortKey}
                  dir={sortDir}
                  onSort={cycleSort}
                />
                <SortHeader
                  label={"\u4eca\u65e5"}
                  sortKey="dayChangePct"
                  activeKey={sortKey}
                  dir={sortDir}
                  onSort={cycleSort}
                />
                <SortHeader
                  label={"\u5360\u6bd4"}
                  sortKey="weight"
                  activeKey={sortKey}
                  dir={sortDir}
                  onSort={cycleSort}
                />
                <th className="pb-3 text-xs uppercase tracking-wider text-[var(--color-muted)]">
                  類別
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((h) => {
                const total = tableWeightDenominator;
                const weight = total > 0 ? h.marketValueBase / total : 0;
                return (
                  <tr
                    key={h.instrumentId}
                    className="border-b border-[var(--color-card-border)]/40 hover:bg-[color-mix(in_srgb,var(--color-foreground)_4%,transparent)]"
                  >
                    <td className="py-4 pr-4">
                      <Link
                        href={instrumentHref(h.symbol, pathname)}
                        className="font-mono text-[var(--color-primary)] hover:underline"
                      >
                        {h.symbol}
                      </Link>
                      <p className="text-xs text-[var(--color-muted)]">{h.name}</p>
                    </td>
                    <td className="tabular-nums py-4 pr-4">
                      {h.quantity.toLocaleString()}
                    </td>
                    <td className="tabular-nums py-4 pr-4">
                      {formatCurrency(h.avgCost, h.currency ?? "TWD")}
                    </td>
                    <td className="tabular-nums py-4 pr-4">
                      {formatCurrency(
                        toSettlement(costBasisInBase(h)),
                        baseCurrency,
                      )}
                    </td>
                    <td className="tabular-nums py-4 pr-4">
                      {formatCurrency(toSettlement(h.marketValueBase), baseCurrency)}
                    </td>
                    <td
                      className={`tabular-nums py-4 pr-4 ${changeToneClass(h.unrealizedPnl, "money")}`}
                    >
                      <div className="font-medium leading-tight">
                        {formatCurrency(
                          toSettlement(h.unrealizedPnl),
                          baseCurrency,
                        )}
                      </div>
                      <div className="mt-0.5 text-xs opacity-90">
                        {formatPercent(h.unrealizedPnlPct)}
                      </div>
                    </td>
                    <td
                      className={`tabular-nums py-4 pr-4 ${changeToneClass(h.dayChangePct ?? 0)}`}
                    >
                      {h.dayChangePct !== null
                        ? formatPercent(h.dayChangePct)
                        : "\u2014"}
                    </td>
                    <td className="tabular-nums py-4 pr-4">
                      {(weight * 100).toFixed(1)}%
                    </td>
                    <td className="py-4">
                      <HoldingCategoryCell
                        instrumentId={h.instrumentId}
                        categories={h.tags}
                        allCategories={allCategories}
                        onUpdated={(next) => {
                          setHoldings((prev) =>
                            prev.map((row) =>
                              row.instrumentId === h.instrumentId
                                ? { ...row, tags: next }
                                : row,
                            ),
                          );
                        }}
                      />
                    </td>
                  </tr>
                );
              })}
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-[var(--color-muted)]">
                    {"\u5c1a\u7121\u7b26\u5408\u689d\u4ef6\u7684\u6301\u5009"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
      </PageSection>

      <PageSection id="holdings-categories" title="類別" className="mt-8" navOrder={40}>
        <HoldingsCategoriesPanel
          holdings={holdings}
          onCategoriesChange={setCategoryRows}
          onHoldingsRefresh={() => onRefresh?.()}
        />
      </PageSection>
    </div>
  );
}
