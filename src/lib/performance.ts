import {
  normalizePeriodDates,
  periodStartWithPriceLookback,
} from "@/lib/date-keys";
import { prisma } from "@/lib/db";
import {
  buildCashFlowSeries,
  buildCumulativeReturnPctNeutralizingFlows,
  buildCumulativeReturnPctSeries,
  buildForwardFilledCloseSeries,
  buildPortfolioValueSeries,
} from "@/lib/portfolio-history";
import {
  analyzeValueSeries,
  computeSemiDeviation,
  computeSemiVariance,
  annualizeTurnover,
  computePortfolioTurnover,
  computeTradingMetrics,
  computeVolatility,
  computeXirr,
  buildCashFlowsForXirr,
  type DrawdownPoint,
} from "@/lib/metrics";
import {
  BENCHMARK_COLORS,
  ENTIRE_PORTFOLIO_COLOR,
  ENTIRE_PORTFOLIO_DATA_KEY,
  ENTIRE_PORTFOLIO_LABEL,
  benchmarkDataKey,
} from "@/lib/chart-constants";
import { accountDataKey, STANDARD_ACCOUNTS } from "@/lib/standard-accounts";
import { computePerformanceCalculation } from "@/lib/performance-calculation";
import type { PerformanceCalculation } from "@/lib/performance-calculation";
import { getHistoricalPrices } from "@/lib/yahoo";

function colorForAccountName(name: string): string {
  const std = STANDARD_ACCOUNTS.find((s) => s.name === name);
  return std?.color ?? "#00f0ff";
}

export type ChartSeriesLine = {
  dataKey: string;
  label: string;
  color: string;
  kind: "portfolio" | "benchmark";
};

export type PerformanceSeriesPoint = {
  date: string;
  portfolio: number;
  benchmark?: number;
};

export type PerformanceProgressUpdate = {
  phase: string;
  percent: number;
};

export type BenchmarkComparison = {
  symbol: string;
  label: string;
  periodReturn: number;
  sharpeRatio: number;
  maxDrawdown: number;
  maxDrawdownDurationDays: number;
  portfolioPeriodReturn: number;
  portfolioSharpeRatio: number;
  portfolioMaxDrawdown: number;
  /** 組合報酬 − 基準報酬（正數＝贏） */
  returnBeat: number;
  /** 組合 Sharpe − 基準 Sharpe */
  sharpeBeat: number;
  /** 基準最大回撤 − 組合最大回撤（正數＝組合回撤較小、較佳） */
  maxDrawdownBeat: number;
};

export type PerformanceMetrics = {
  periodStart: string;
  periodEnd: string;
  chartData: Record<string, string | number>[];
  chartLines: ChartSeriesLine[];
  portfolioSeries: PerformanceSeriesPoint[];
  benchmarkSeries: PerformanceSeriesPoint[];
  drawdownSeries: DrawdownPoint[];
  benchmarks: BenchmarkComparison[];

  todayChange: number;
  todayChangePct: number;

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

  calculation: PerformanceCalculation;
};

/** 基準／行情：鏈結日報酬（無外部入出金） */
function normalizeMarketReturnPct(
  points: { date: string; value: number }[],
): Map<string, number> {
  return buildCumulativeReturnPctSeries(points);
}

function mergeChartData(
  seriesMaps: { dataKey: string; values: Map<string, number> }[],
): Record<string, string | number>[] {
  const dates = new Set<string>();
  for (const s of seriesMaps) {
    for (const d of s.values.keys()) dates.add(d);
  }
  const sorted = [...dates].sort();
  return sorted.map((date) => {
    const row: Record<string, string | number> = { date };
    for (const s of seriesMaps) {
      const v = s.values.get(date);
      if (v !== undefined) row[s.dataKey] = v;
    }
    return row;
  });
}

export function computeMaxDrawdown(values: number[]): number {
  if (values.length === 0) return 0;
  let peak = values[0];
  let maxDd = 0;
  for (const v of values) {
    if (v > peak) peak = v;
    const dd = peak > 0 ? (peak - v) / peak : 0;
    if (dd > maxDd) maxDd = dd;
  }
  return maxDd;
}

export async function getTodayPortfolioChange(): Promise<{
  todayChange: number;
  todayChangePct: number;
}> {
  const summary = await import("@/lib/portfolio-engine").then((m) =>
    m.getPortfolioSummary(),
  );
  return {
    todayChange: summary.todayChange,
    todayChangePct: summary.todayChangePct,
  };
}

export async function getPerformance(
  periodStartIn: Date,
  periodEndIn: Date,
  options?: {
    accountIds?: string[];
    benchmarkSymbols?: string[];
  },
  onProgress?: (update: PerformanceProgressUpdate) => void,
): Promise<PerformanceMetrics> {
  const { periodStart, periodEnd } = normalizePeriodDates(
    periodStartIn,
    periodEndIn,
  );

  let lastPercent = 0;
  const report = (phase: string, percent: number) => {
    const next = Math.min(100, Math.max(lastPercent, Math.max(0, percent)));
    lastPercent = next;
    onProgress?.({ phase, percent: next });
  };
  const allAccounts = await prisma.account.findMany({ orderBy: { name: "asc" } });
  const selectedIds =
    options?.accountIds?.length && options.accountIds.length > 0
      ? options.accountIds
      : allAccounts.map((a) => a.id);

  const selectedAccounts = allAccounts.filter((a) =>
    selectedIds.includes(a.id),
  );

  const allAccountIds = allAccounts.map((a) => a.id);

  report("回放整體組合持倉…", 5);
  const portfolioPoints = await buildPortfolioValueSeries(
    periodStart,
    periodEnd,
    { accountIds: selectedIds },
  );
  const entirePortfolioPoints = await buildPortfolioValueSeries(
    periodStart,
    periodEnd,
    { accountIds: allAccountIds },
  );
  const entirePortfolioCashFlows = await buildCashFlowSeries(
    periodStart,
    periodEnd,
    { accountIds: allAccountIds },
  );
  const portfolioCashFlows = await buildCashFlowSeries(
    periodStart,
    periodEnd,
    { accountIds: selectedIds },
  );
  const rawValues = portfolioPoints.map((p) => p.value);
  const startValue = rawValues[0] ?? 0;
  const endValue = rawValues[rawValues.length - 1] ?? 0;
  const summary = await import("@/lib/portfolio-engine").then((m) =>
    m.getPortfolioSummary(),
  );

  let totalCostBasis = 0;
  let totalUnrealizedPnl = 0;
  for (const acc of summary.accountSummaries) {
    if (!selectedIds.includes(acc.accountId)) continue;
    totalUnrealizedPnl += acc.unrealizedPnl;
    totalCostBasis += acc.marketValue - acc.unrealizedPnl;
  }
  const absoluteReturn =
    totalCostBasis > 0 ? totalUnrealizedPnl / totalCostBasis : 0;
  const portfolioRisk = analyzeValueSeries(
    portfolioPoints,
    portfolioCashFlows,
  );
  const dailyReturns = portfolioRisk.dailyReturns;
  const volatility = computeVolatility(dailyReturns);
  const semiVariance = computeSemiVariance(dailyReturns);
  const semiDeviation = computeSemiDeviation(dailyReturns);

  const dbBenchmarks = await prisma.benchmark.findMany();
  const benchmarkSymbols = options?.benchmarkSymbols ?? [];

  const chartLines: ChartSeriesLine[] = [];
  const seriesMaps: { dataKey: string; values: Map<string, number> }[] = [];

  chartLines.push({
    dataKey: ENTIRE_PORTFOLIO_DATA_KEY,
    label: ENTIRE_PORTFOLIO_LABEL,
    color: ENTIRE_PORTFOLIO_COLOR,
    kind: "portfolio",
  });
  seriesMaps.push({
    dataKey: ENTIRE_PORTFOLIO_DATA_KEY,
    values: buildCumulativeReturnPctNeutralizingFlows(
      entirePortfolioPoints,
      entirePortfolioCashFlows,
    ),
  });

  const accountCount = selectedAccounts.length;
  for (let i = 0; i < selectedAccounts.length; i++) {
    const acc = selectedAccounts[i];
    report(
      `帳戶曲線：${acc.name}…`,
      10 + Math.round(((i + 1) / Math.max(accountCount, 1)) * 35),
    );
    const points = await buildPortfolioValueSeries(periodStart, periodEnd, {
      accountIds: [acc.id],
    });
    const accFlows = await buildCashFlowSeries(periodStart, periodEnd, {
      accountIds: [acc.id],
    });
    const dataKey = accountDataKey(acc.id);
    chartLines.push({
      dataKey,
      label: acc.name,
      color: colorForAccountName(acc.name),
      kind: "portfolio",
    });
    seriesMaps.push({
      dataKey,
      values: buildCumulativeReturnPctNeutralizingFlows(points, accFlows),
    });
  }

  report("計算報酬與風險指標…", 50);
  const cashFlows = await buildCashFlowsForXirr(selectedIds);
  const xirr = computeXirr(cashFlows);
  report("計算市值拆解…", 48);
  const calculation = await computePerformanceCalculation(
    periodStart,
    periodEnd,
    selectedIds,
    startValue,
    endValue,
    {
      startDateKey: portfolioPoints[0]?.date,
      endDateKey: portfolioPoints[portfolioPoints.length - 1]?.date,
    },
  );
  const trading = await computeTradingMetrics(
    periodStart,
    periodEnd,
    selectedIds,
  );
  const periodTurnover = computePortfolioTurnover(
    trading.totalTradeVolume,
    startValue,
    endValue,
  );
  const annualizedTurnover = annualizeTurnover(
    periodTurnover,
    periodStart,
    periodEnd,
  );
  const { todayChange, todayChangePct } = await getTodayPortfolioChange();

  const benchmarkResults: BenchmarkComparison[] = [];

  for (let i = 0; i < benchmarkSymbols.length; i++) {
    const symbol = benchmarkSymbols[i];
    report(
      `基準行情：${symbol}…`,
      55 + Math.round(((i + 1) / Math.max(benchmarkSymbols.length, 1)) * 25),
    );
    const bars = await getHistoricalPrices(
      symbol,
      periodStartWithPriceLookback(periodStart),
      periodEnd,
    );
    const benchPoints = buildForwardFilledCloseSeries(
      bars,
      periodStart,
      periodEnd,
    );
    const dataKey = benchmarkDataKey(symbol);
    const color = BENCHMARK_COLORS[i % BENCHMARK_COLORS.length];
    const bench = dbBenchmarks.find((b) => b.symbol === symbol);

    chartLines.push({
      dataKey,
      label: bench?.label ?? symbol,
      color,
      kind: "benchmark",
    });
    seriesMaps.push({
      dataKey,
      values: normalizeMarketReturnPct(benchPoints),
    });

    if (benchPoints.length >= 2) {
      const benchRisk = analyzeValueSeries(benchPoints);
      benchmarkResults.push({
        symbol,
        label: bench?.label ?? symbol,
        periodReturn: benchRisk.periodReturn,
        sharpeRatio: benchRisk.sharpeRatio,
        maxDrawdown: benchRisk.maxDrawdown,
        maxDrawdownDurationDays: benchRisk.maxDrawdownDurationDays,
        portfolioPeriodReturn: portfolioRisk.periodReturn,
        portfolioSharpeRatio: portfolioRisk.sharpeRatio,
        portfolioMaxDrawdown: portfolioRisk.maxDrawdown,
        returnBeat: portfolioRisk.periodReturn - benchRisk.periodReturn,
        sharpeBeat: portfolioRisk.sharpeRatio - benchRisk.sharpeRatio,
        maxDrawdownBeat: benchRisk.maxDrawdown - portfolioRisk.maxDrawdown,
      });
    }
  }

  report("合併圖表資料…", 85);
  const chartData = mergeChartData(seriesMaps);

  const allNorm = buildCumulativeReturnPctNeutralizingFlows(
    portfolioPoints,
    portfolioCashFlows,
  );

  let portfolioSeries: PerformanceSeriesPoint[] = [...allNorm.entries()].map(
    ([date, portfolio]) => ({ date, portfolio }),
  );
  let benchmarkSeries: PerformanceSeriesPoint[] = [];

  if (benchmarkSymbols.length > 0) {
    const primaryBench = benchmarkSymbols[0]!;
    const benchBars = await getHistoricalPrices(
      primaryBench,
      periodStartWithPriceLookback(periodStart),
      periodEnd,
    );
    const benchFilled = buildForwardFilledCloseSeries(
      benchBars,
      periodStart,
      periodEnd,
    );
    const benchNorm = normalizeMarketReturnPct(benchFilled);
    portfolioSeries = [...allNorm.entries()].map(([date, portfolio]) => ({
      date,
      portfolio,
      benchmark: benchNorm.get(date),
    }));
    const benchBase = benchFilled[0]?.value ?? 0;
    benchmarkSeries = benchFilled.map((p) => {
      const v = benchBase > 0 ? (p.value / benchBase - 1) * 100 : 0;
      return { date: p.date, portfolio: v, benchmark: v };
    });
  }

  report("完成", 100);
  return {
    periodStart: periodStart.toISOString().slice(0, 10),
    periodEnd: periodEnd.toISOString().slice(0, 10),
    chartData,
    chartLines,
    portfolioSeries,
    benchmarkSeries,
    drawdownSeries: portfolioRisk.drawdownSeries,
    benchmarks: benchmarkResults,
    todayChange,
    todayChangePct,
    keyIndicators: {
      periodReturn: portfolioRisk.periodReturn,
      absoluteReturn,
      xirr,
      startValue,
      endValue,
    },
    riskIndicators: {
      maxDrawdown: portfolioRisk.maxDrawdown,
      maxDrawdownPeakDate: portfolioRisk.maxDrawdownPeakDate,
      maxDrawdownTroughDate: portfolioRisk.maxDrawdownTroughDate,
      maxDrawdownRecoveryDate: portfolioRisk.maxDrawdownRecoveryDate,
      maxDrawdownDurationDays: portfolioRisk.maxDrawdownDurationDays,
      sharpeRatio: portfolioRisk.sharpeRatio,
      volatility,
      semiVariance,
      semiDeviation,
    },
    tradingIndicators: {
      winRate: trading.winRate,
      profitLossRatio: trading.profitLossRatio,
      feeRate: trading.feeRate,
      taxRate: trading.taxRate,
      turnover: periodTurnover,
      annualizedTurnover,
      avgHoldingDays: trading.avgHoldingDays,
      closedTrades: trading.closedTrades,
    },
    calculation,
  };
}
