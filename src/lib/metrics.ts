import { prisma } from "@/lib/db";
import { toBaseCurrency } from "@/lib/fx";
import { toNumber } from "@/lib/utils";

export type CashFlow = { date: Date; amount: number };

export function computeXirr(cashFlows: CashFlow[], guess = 0.1): number | null {
  if (cashFlows.length < 2) return null;

  const sorted = [...cashFlows].sort((a, b) => a.date.getTime() - b.date.getTime());
  const t0 = sorted[0].date.getTime();

  const npv = (rate: number) =>
    sorted.reduce((sum, cf) => {
      const years = (cf.date.getTime() - t0) / (365.25 * 24 * 3600 * 1000);
      return sum + cf.amount / Math.pow(1 + rate, years);
    }, 0);

  const dNpv = (rate: number) =>
    sorted.reduce((sum, cf) => {
      const years = (cf.date.getTime() - t0) / (365.25 * 24 * 3600 * 1000);
      return sum - (years * cf.amount) / Math.pow(1 + rate, years + 1);
    }, 0);

  let rate = guess;
  for (let i = 0; i < 100; i++) {
    const f = npv(rate);
    const df = dNpv(rate);
    if (Math.abs(df) < 1e-12) break;
    const next = rate - f / df;
    if (Math.abs(next - rate) < 1e-7) return next;
    rate = next;
  }
  return null;
}

export function computeVolatility(dailyReturns: number[]): number {
  if (dailyReturns.length < 2) return 0;
  const mean = dailyReturns.reduce((s, r) => s + r, 0) / dailyReturns.length;
  const variance =
    dailyReturns.reduce((s, r) => s + (r - mean) ** 2, 0) /
    (dailyReturns.length - 1);
  return Math.sqrt(variance) * Math.sqrt(252);
}

/** 年化半變異數（目標報酬 0，僅計入負報酬之平方） */
export function computeSemiVariance(
  dailyReturns: number[],
  target = 0,
): number {
  if (dailyReturns.length < 2) return 0;
  let sumSq = 0;
  for (const r of dailyReturns) {
    if (r < target) {
      const d = r - target;
      sumSq += d * d;
    }
  }
  return (sumSq / dailyReturns.length) * 252;
}

/** 年化半標準差（與波動率同量級，便於比較） */
export function computeSemiDeviation(
  dailyReturns: number[],
  target = 0,
): number {
  const semiVar = computeSemiVariance(dailyReturns, target);
  return semiVar > 0 ? Math.sqrt(semiVar) : 0;
}

export function dailyReturnsFromValues(values: number[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < values.length; i++) {
    const prev = values[i - 1];
    if (prev > 0) returns.push((values[i] - prev) / prev);
  }
  return returns;
}

export type WealthPoint = { date: string; wealth: number };

export type DrawdownPoint = { date: string; drawdownPct: number };

/** 日報酬（扣除當日淨入金） */
export function dailyReturnsNeutralizingFlows(
  points: { date: string; value: number }[],
  flows: { date: string; deposit: number; withdrawal: number }[],
): { returnDates: string[]; returns: number[] } {
  const flowByDate = new Map<string, number>();
  for (const f of flows) {
    flowByDate.set(
      f.date,
      (flowByDate.get(f.date) ?? 0) + f.deposit - f.withdrawal,
    );
  }
  const returnDates: string[] = [];
  const returns: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]!.value;
    const curr = points[i]!.value;
    const date = points[i]!.date;
    if (prev > 0 && curr > 0) {
      const netFlow = flowByDate.get(date) ?? 0;
      returnDates.push(date);
      returns.push((curr - prev - netFlow) / prev);
    }
  }
  return { returnDates, returns };
}

export function buildWealthIndexFromDailyReturns(
  startDate: string,
  returnDates: string[],
  dailyReturns: number[],
): WealthPoint[] {
  const series: WealthPoint[] = [{ date: startDate, wealth: 1 }];
  let w = 1;
  for (let i = 0; i < dailyReturns.length; i++) {
    w *= 1 + dailyReturns[i]!;
    series.push({ date: returnDates[i]!, wealth: w });
  }
  return series;
}

export function buildDrawdownSeries(wealthSeries: WealthPoint[]): DrawdownPoint[] {
  let peak = wealthSeries[0]?.wealth ?? 1;
  return wealthSeries.map(({ date, wealth }) => {
    if (wealth > peak) peak = wealth;
    const ddPct = peak > 0 ? ((wealth - peak) / peak) * 100 : 0;
    return { date, drawdownPct: ddPct };
  });
}

export function computeSharpeRatio(
  dailyReturns: number[],
  riskFreeAnnual = 0,
): number {
  if (dailyReturns.length < 2) return 0;
  const rfDaily = riskFreeAnnual / 252;
  const mean =
    dailyReturns.reduce((s, r) => s + r, 0) / dailyReturns.length;
  const variance =
    dailyReturns.reduce((s, r) => s + (r - mean) ** 2, 0) /
    (dailyReturns.length - 1);
  const std = Math.sqrt(variance);
  if (std === 0) return 0;
  return ((mean - rfDaily) / std) * Math.sqrt(252);
}

export function computeMaxDrawdownEpisode(wealthSeries: WealthPoint[]): {
  maxDrawdown: number;
  peakDate: string | null;
  troughDate: string | null;
  recoveryDate: string | null;
  durationDays: number;
} {
  if (wealthSeries.length === 0) {
    return {
      maxDrawdown: 0,
      peakDate: null,
      troughDate: null,
      recoveryDate: null,
      durationDays: 0,
    };
  }

  let runningPeakWealth = wealthSeries[0]!.wealth;
  let runningPeakDate = wealthSeries[0]!.date;
  let maxDd = 0;
  let episodePeakDate = runningPeakDate;
  let episodeTroughDate = runningPeakDate;
  let episodePeakWealth = runningPeakWealth;

  for (const { date, wealth } of wealthSeries) {
    const dd =
      runningPeakWealth > 0
        ? (runningPeakWealth - wealth) / runningPeakWealth
        : 0;
    if (dd > maxDd) {
      maxDd = dd;
      episodePeakDate = runningPeakDate;
      episodeTroughDate = date;
      episodePeakWealth = runningPeakWealth;
    }
    if (wealth > runningPeakWealth) {
      runningPeakWealth = wealth;
      runningPeakDate = date;
    }
  }

  const peakIdx = wealthSeries.findIndex((p) => p.date === episodePeakDate);
  const troughIdx = wealthSeries.findIndex((p) => p.date === episodeTroughDate);

  let recoveryDate: string | null = null;
  if (maxDd > 0 && troughIdx >= 0) {
    for (let i = troughIdx + 1; i < wealthSeries.length; i++) {
      if (wealthSeries[i]!.wealth >= episodePeakWealth) {
        recoveryDate = wealthSeries[i]!.date;
        break;
      }
    }
  }

  const endIdx = recoveryDate
    ? wealthSeries.findIndex((p) => p.date === recoveryDate)
    : wealthSeries.length - 1;
  const durationDays =
    maxDd > 0 && peakIdx >= 0 && endIdx >= peakIdx ? endIdx - peakIdx : 0;

  return {
    maxDrawdown: maxDd,
    peakDate: episodePeakDate,
    troughDate: episodeTroughDate,
    recoveryDate,
    durationDays,
  };
}

export function analyzeReturnSeries(
  startDate: string,
  returnDates: string[],
  dailyReturns: number[],
) {
  const wealth = buildWealthIndexFromDailyReturns(
    startDate,
    returnDates,
    dailyReturns,
  );
  const episode = computeMaxDrawdownEpisode(wealth);
  return {
    wealth,
    drawdownSeries: buildDrawdownSeries(wealth),
    sharpeRatio: computeSharpeRatio(dailyReturns),
    maxDrawdown: episode.maxDrawdown,
    maxDrawdownPeakDate: episode.peakDate,
    maxDrawdownTroughDate: episode.troughDate,
    maxDrawdownRecoveryDate: episode.recoveryDate,
    maxDrawdownDurationDays: episode.durationDays,
    periodReturn:
      wealth.length > 0 ? (wealth[wealth.length - 1]!.wealth - 1) : 0,
  };
}

export function analyzeValueSeries(
  points: { date: string; value: number }[],
  flows?: { date: string; deposit: number; withdrawal: number }[],
) {
  if (points.length === 0) {
    return {
      wealth: [] as WealthPoint[],
      drawdownSeries: [] as DrawdownPoint[],
      sharpeRatio: 0,
      maxDrawdown: 0,
      maxDrawdownPeakDate: null as string | null,
      maxDrawdownTroughDate: null as string | null,
      maxDrawdownRecoveryDate: null as string | null,
      maxDrawdownDurationDays: 0,
      periodReturn: 0,
      dailyReturns: [] as number[],
    };
  }

  const { returnDates, returns } = flows?.length
    ? dailyReturnsNeutralizingFlows(points, flows)
    : {
        returnDates: points.slice(1).map((p) => p.date),
        returns: dailyReturnsFromValues(points.map((p) => p.value)),
      };

  const analyzed = analyzeReturnSeries(points[0]!.date, returnDates, returns);
  return { ...analyzed, dailyReturns: returns };
}

export type TradingMetrics = {
  winRate: number;
  /** 平均獲利 / 平均虧損（已平倉） */
  profitLossRatio: number;
  feeRate: number;
  taxRate: number;
  avgHoldingDays: number;
  closedTrades: number;
  totalTradeVolume: number;
};

/** 組合週轉率（期間）：單邊成交額 ÷ 期初期末平均市值 */
export function computePortfolioTurnover(
  tradeVolume: number,
  startValue: number,
  endValue: number,
): number {
  const avgValue = (startValue + endValue) / 2;
  if (avgValue <= 0 || tradeVolume <= 0) return 0;
  return tradeVolume / 2 / avgValue;
}

export function annualizeTurnover(
  periodTurnover: number,
  periodStart: Date,
  periodEnd: Date,
): number {
  if (periodTurnover <= 0) return 0;
  const days = Math.max(
    1,
    (periodEnd.getTime() - periodStart.getTime()) / MS_PER_DAY,
  );
  return periodTurnover * (365 / days);
}

const MS_PER_DAY = 24 * 3600 * 1000;

function holdingDaysBetween(buyDate: Date, sellDate: Date): number {
  const days = (sellDate.getTime() - buyDate.getTime()) / MS_PER_DAY;
  return Math.max(0, days);
}

function isInPeriod(
  date: Date,
  periodStart?: Date,
  periodEnd?: Date,
): boolean {
  if (periodStart && date < periodStart) return false;
  if (periodEnd && date > periodEnd) return false;
  return true;
}

export async function computeTradingMetrics(
  periodStart?: Date,
  periodEnd?: Date,
  accountIds?: string[],
): Promise<TradingMetrics> {
  const transactions = await prisma.transaction.findMany({
    where: accountIds?.length
      ? { accountId: { in: accountIds } }
      : undefined,
    include: { instrument: true },
    orderBy: { date: "asc" },
  });

  /** 回放至 periodEnd，保留期初前買入的 FIFO 成本，否則期內賣出會算成 0 天 */
  const replayTxs = transactions.filter(
    (t) => !periodEnd || t.date <= periodEnd,
  );

  let tradeVolume = 0;
  let feeTaxableVolume = 0;
  let taxTaxableVolume = 0;
  let totalFees = 0;
  let totalTax = 0;
  let wins = 0;
  let losses = 0;
  let totalWinPnl = 0;
  let totalLossPnl = 0;
  let closed = 0;
  const holdingPeriods: number[] = [];

  const lotsByInstrument = new Map<
    string,
    { qty: number; cost: number; date: Date }[]
  >();

  for (const tx of replayTxs) {
    if (!tx.instrumentId) continue;

    const qty = toNumber(tx.quantity);
    const price = toNumber(tx.price);
    const fee = toNumber(tx.fee);
    const tax = toNumber(tx.tax);
    const amount = qty * price;
    const inPeriod = isInPeriod(tx.date, periodStart, periodEnd);

    if (inPeriod && (tx.type === "BUY" || tx.type === "SELL")) {
      tradeVolume += amount;
      totalFees += fee;
      totalTax += tax;
      if (fee > 0) feeTaxableVolume += amount;
      if (tax > 0) taxTaxableVolume += amount;
    } else if (inPeriod && tx.type === "DIVIDEND") {
      const divAmount = amount > 0 ? amount : price;
      totalTax += tax;
      if (tax > 0 && divAmount > 0) taxTaxableVolume += divAmount;
    }

    const lots = lotsByInstrument.get(tx.instrumentId) ?? [];

    if (tx.type === "BUY") {
      lots.push({
        qty,
        cost: amount + fee + tax,
        date: tx.date,
      });
    } else if (tx.type === "SELL" && qty > 0) {
      let remaining = qty;
      let sellCost = 0;
      let weightedHoldingDays = 0;
      let matchedQty = 0;

      while (remaining > 0 && lots.length > 0) {
        const lot = lots[0]!;
        const used = Math.min(remaining, lot.qty);
        const sliceCost = (lot.cost / lot.qty) * used;
        sellCost += sliceCost;
        lot.cost -= sliceCost;
        weightedHoldingDays += used * holdingDaysBetween(lot.date, tx.date);
        matchedQty += used;
        lot.qty -= used;
        remaining -= used;
        if (lot.qty <= 0.0000001) lots.shift();
      }

      if (inPeriod && matchedQty > 0) {
        const proceeds = amount - fee - tax;
        const pnl = proceeds - sellCost;
        closed++;
        if (pnl > 0) {
          wins++;
          totalWinPnl += pnl;
        } else if (pnl < 0) {
          losses++;
          totalLossPnl += -pnl;
        }
        holdingPeriods.push(weightedHoldingDays / matchedQty);
      }
    }

    lotsByInstrument.set(tx.instrumentId, lots);
  }

  const avgWin = wins > 0 ? totalWinPnl / wins : 0;
  const avgLoss = losses > 0 ? totalLossPnl / losses : 0;

  return {
    winRate: closed > 0 ? wins / closed : 0,
    profitLossRatio: avgLoss > 0 ? avgWin / avgLoss : 0,
    feeRate:
      feeTaxableVolume > 0
        ? totalFees / feeTaxableVolume
        : tradeVolume > 0
          ? totalFees / tradeVolume
          : 0,
    taxRate:
      taxTaxableVolume > 0
        ? totalTax / taxTaxableVolume
        : tradeVolume > 0
          ? totalTax / tradeVolume
          : 0,
    avgHoldingDays:
      holdingPeriods.length > 0
        ? holdingPeriods.reduce((s, d) => s + d, 0) / holdingPeriods.length
        : 0,
    closedTrades: closed,
    totalTradeVolume: tradeVolume,
  };
}

export async function buildCashFlowsForXirr(
  accountIds?: string[],
): Promise<CashFlow[]> {
  const transactions = await prisma.transaction.findMany({
    where: accountIds?.length
      ? { accountId: { in: accountIds } }
      : undefined,
    include: { account: true },
    orderBy: { date: "asc" },
  });

  const flows: CashFlow[] = [];
  const summary = await import("@/lib/portfolio-engine").then((m) =>
    m.getPortfolioSummary(),
  );

  let terminalValue = 0;
  for (const acc of summary.accountSummaries) {
    if (accountIds?.length && !accountIds.includes(acc.accountId)) continue;
    terminalValue += acc.totalAssets;
  }
  flows.push({
    date: new Date(),
    amount: terminalValue,
  });

  for (const tx of transactions) {
    const qty = toNumber(tx.quantity);
    const price = toNumber(tx.price);
    const fee = toNumber(tx.fee);
    const tax = toNumber(tx.tax);
    const amount = qty * price;

    if (tx.type === "BUY") {
      flows.push({ date: tx.date, amount: -(amount + fee + tax) });
    } else if (tx.type === "SELL") {
      flows.push({ date: tx.date, amount: amount - fee - tax });
    } else if (tx.type === "DIVIDEND") {
      flows.push({ date: tx.date, amount: amount });
    } else if (tx.type === "DEPOSIT") {
      const base = await toBaseCurrency(amount, tx.account.currency);
      flows.push({ date: tx.date, amount: -base });
    } else if (tx.type === "WITHDRAWAL") {
      const base = await toBaseCurrency(amount, tx.account.currency);
      flows.push({ date: tx.date, amount: base });
    }
  }

  return flows;
}
