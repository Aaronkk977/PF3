import { normalizePeriodDates, toLocalDateKey } from "@/lib/date-keys";
import { getExchangeRateOnDate } from "@/lib/fx-rates";
import { BASE_CURRENCY } from "@/lib/fx";
import {
  computeExposureSnapshot,
  computeFxDifferenceTwd,
} from "@/lib/performance-fx-exposure";
import { aggregatePeriodRealizedPnl } from "@/lib/performance-realized-pnl";
import { buildCashFlowSeries } from "@/lib/portfolio-history";

export type PerformanceCalculation = {
  baseCurrency: string;
  startValue: number;
  netDeposits: number;
  realizedPnl: number;
  fees: number;
  taxes: number;
  dividends: number;
  /** 股價／持倉變動（TWD），已扣除匯差 */
  capitalGains: number;
  fxDifference: number;
  endValue: number;
};

async function sumNetDeposits(
  periodStart: Date,
  periodEnd: Date,
  accountIds: string[],
): Promise<number> {
  const flows = await buildCashFlowSeries(periodStart, periodEnd, {
    accountIds: accountIds.length ? accountIds : undefined,
  });
  return flows.reduce((s, f) => s + f.deposit - f.withdrawal, 0);
}

export async function computePerformanceCalculation(
  periodStartIn: Date,
  periodEndIn: Date,
  accountIds: string[],
  startValue: number,
  endValue: number,
  options?: {
    startDateKey?: string;
    endDateKey?: string;
  },
): Promise<PerformanceCalculation> {
  const { periodStart, periodEnd } = normalizePeriodDates(
    periodStartIn,
    periodEndIn,
  );

  const startDateKey =
    options?.startDateKey ?? toLocalDateKey(periodStart);
  const endDateKey = options?.endDateKey ?? toLocalDateKey(periodEnd);

  const [netDeposits, periodAgg] = await Promise.all([
    sumNetDeposits(periodStart, periodEnd, accountIds),
    aggregatePeriodRealizedPnl(periodStart, periodEnd, accountIds, {
      periodStartKey: startDateKey,
      periodEndKey: endDateKey,
    }),
  ]);

  const { realizedPnl, fees, taxes, dividends } = periodAgg;

  const totalChange =
    endValue -
    startValue -
    netDeposits -
    realizedPnl +
    fees +
    taxes -
    dividends;

  let fxDifference = 0;

  const [exposureStart, exposureEnd, rateStart, rateEnd] = await Promise.all([
    computeExposureSnapshot(
      startDateKey,
      periodStart,
      periodEnd,
      accountIds,
    ),
    computeExposureSnapshot(
      endDateKey,
      periodStart,
      periodEnd,
      accountIds,
    ),
    getExchangeRateOnDate("USD", "TWD", new Date(`${startDateKey}T12:00:00`)),
    getExchangeRateOnDate("USD", "TWD", new Date(`${endDateKey}T12:00:00`)),
  ]);

  const usdStart = exposureStart.usdNative;
  const usdEnd = exposureEnd.usdNative;
  const hasFxExposure =
    Math.abs(usdStart) >= 1 || Math.abs(usdEnd) >= 1;

  if (
    hasFxExposure &&
    rateStart != null &&
    rateEnd != null &&
    rateStart > 0 &&
    rateEnd > 0
  ) {
    fxDifference = computeFxDifferenceTwd(
      usdStart,
      usdEnd,
      rateStart,
      rateEnd,
    );
    if (!Number.isFinite(fxDifference)) fxDifference = 0;
  }

  const capitalGains = totalChange - fxDifference;

  return {
    baseCurrency: BASE_CURRENCY,
    startValue,
    netDeposits,
    realizedPnl,
    fees,
    taxes,
    dividends,
    capitalGains,
    fxDifference,
    endValue,
  };
}
