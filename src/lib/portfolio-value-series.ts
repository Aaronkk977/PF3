import { mapWithConcurrency } from "@/lib/async-pool";
import { externalReadLimiter } from "@/lib/concurrency-limiter";
import { prisma } from "@/lib/db";
import {
  periodStartWithPriceLookback,
  toLocalDateKey,
} from "@/lib/date-keys";
import { getUsdToTwdRate } from "@/lib/fx";
import {
  buildCashFlowSeries,
  type CashFlowEvent,
} from "@/lib/portfolio-history";
import {
  buildPortfolioValueCacheKey,
  getPortfolioValueCache,
  getTransactionMeta,
  setPortfolioValueCache,
  type PortfolioValueCachePayload,
} from "@/lib/portfolio-value-cache";
import {
  calendarDateKeys,
  forwardFillPrices,
  mapFromRecord,
  nextDateKey,
  simulateValueDays,
  trimAnomalousLeadingPoint,
  type SeriesContext,
  type TxRow,
} from "@/lib/portfolio-value-simulation";
import { getHistoricalPrices, getQuotes } from "@/lib/yahoo";

export type { CashFlowEvent } from "@/lib/portfolio-history";
export { buildPortfolioValueCacheKey } from "@/lib/portfolio-value-cache";

async function loadSeriesContext(
  periodEnd: Date,
  accountIds?: string[],
): Promise<SeriesContext | null> {
  if (accountIds?.length === 1 && accountIds[0] === "__none__") {
    return null;
  }

  const accountFilter = accountIds?.length
    ? { accountId: { in: accountIds } }
    : {};

  const accounts = await prisma.account.findMany({
    where: accountIds?.length ? { id: { in: accountIds } } : undefined,
  });
  const accountCurrencies = new Map(
    accounts.map((a) => [a.id, a.currency]),
  );
  const allowedAccountIds = new Set(accounts.map((a) => a.id));

  const allTxs = (await prisma.transaction.findMany({
    include: { instrument: true, account: true },
    where: {
      date: { lte: periodEnd },
      ...accountFilter,
    },
    orderBy: { date: "asc" },
  })) as TxRow[];

  if (allTxs.length === 0) return null;

  const currencyBySymbol = new Map<string, string | null>();
  for (const t of allTxs) {
    if (t.instrument) {
      currencyBySymbol.set(
        t.instrument.symbol,
        t.instrument.currency ?? "TWD",
      );
    }
  }

  const usdRate = await getUsdToTwdRate();

  return {
    allTxs,
    allowedAccountIds,
    accountCurrencies,
    currencyBySymbol,
    usdRate,
  };
}

async function loadPriceMaps(
  symbols: string[],
  periodStart: Date,
  periodEnd: Date,
  seeds?: Record<string, number>,
): Promise<Map<string, Map<string, number>>> {
  const priceBySymbol = new Map<string, Map<string, number>>();
  if (symbols.length === 0) return priceBySymbol;

  await mapWithConcurrency(symbols, externalReadLimiter, async (symbol) => {
    const bars = await getHistoricalPrices(
      symbol,
      periodStartWithPriceLookback(periodStart),
      periodEnd,
    );
    const filled = forwardFillPrices(
      bars,
      periodStart,
      periodEnd,
      seeds?.[symbol],
    );
    priceBySymbol.set(symbol, filled);
  });
  return priceBySymbol;
}

async function buildFullPortfolioValueSeries(
  periodStart: Date,
  periodEnd: Date,
  options?: { accountIds?: string[] },
): Promise<PortfolioValueCachePayload | null> {
  const ctx = await loadSeriesContext(periodEnd, options?.accountIds);
  if (!ctx) return null;

  const symbols = [
    ...new Set(
      ctx.allTxs
        .filter((t) => t.instrument)
        .map((t) => t.instrument!.symbol),
    ),
  ];

  const priceBySymbol = await loadPriceMaps(symbols, periodStart, periodEnd);
  const dateKeys = calendarDateKeys(periodStart, periodEnd);
  const { points, endState } = await simulateValueDays(
    ctx,
    dateKeys,
    {
      txIdx: 0,
      positions: new Map(),
      cashByAccount: new Map(),
    },
    priceBySymbol,
    { fetchLiveQuotes: getQuotes },
  );

  const trimmed = trimAnomalousLeadingPoint(points);
  const periodStartStr = toLocalDateKey(periodStart);
  const periodEndStr = toLocalDateKey(periodEnd);
  const meta = await getTransactionMeta();
  const cashFlows = await buildCashFlowSeries(periodStart, periodEnd, options);

  return {
    points: trimmed,
    cashFlows,
    endState: {
      ...endState,
      date: trimmed.length > 0 ? trimmed[trimmed.length - 1]!.date : endState.date,
    },
    periodStart: periodStartStr,
    periodEnd: periodEndStr,
    txCount: meta.txCount,
    maxTxDate: meta.maxTxDate,
  };
}

async function extendPortfolioValueSeries(
  cached: PortfolioValueCachePayload,
  periodStart: Date,
  periodEnd: Date,
  options?: { accountIds?: string[] },
): Promise<PortfolioValueCachePayload | null> {
  const ctx = await loadSeriesContext(periodEnd, options?.accountIds);
  if (!ctx) return null;

  const extendFromKey = nextDateKey(cached.endState.date);
  const periodEndStr = toLocalDateKey(periodEnd);
  if (extendFromKey > periodEndStr) {
    return cached;
  }

  const extendFrom = new Date(extendFromKey);
  extendFrom.setHours(0, 0, 0, 0);

  const heldSymbols = Object.keys(cached.endState.positions).filter(
    (s) => (cached.endState.positions[s] ?? 0) > 0,
  );

  const priceBySymbol = await loadPriceMaps(
    heldSymbols,
    extendFrom,
    periodEnd,
    cached.endState.lastPriceBySymbol,
  );

  const dateKeys = calendarDateKeys(extendFrom, periodEnd);
  const { points: newPoints, endState } = await simulateValueDays(
    ctx,
    dateKeys,
    {
      txIdx: cached.endState.txIdx,
      positions: mapFromRecord(cached.endState.positions),
      cashByAccount: mapFromRecord(cached.endState.cashByAccount),
    },
    priceBySymbol,
    { fetchLiveQuotes: getQuotes },
  );

  const mergedPoints = [...cached.points];
  for (const p of newPoints) {
    const last = mergedPoints[mergedPoints.length - 1];
    if (last?.date === p.date) {
      mergedPoints[mergedPoints.length - 1] = p;
    } else {
      mergedPoints.push(p);
    }
  }

  const meta = await getTransactionMeta();
  const cashFlows = await buildCashFlowSeries(periodStart, periodEnd, options);

  return {
    points: mergedPoints,
    cashFlows,
    endState: {
      ...endState,
      lastPriceBySymbol: {
        ...cached.endState.lastPriceBySymbol,
        ...endState.lastPriceBySymbol,
      },
    },
    periodStart: cached.periodStart,
    periodEnd: periodEndStr,
    txCount: meta.txCount,
    maxTxDate: meta.maxTxDate,
  };
}

function canIncrementalFromCache(
  cached: PortfolioValueCachePayload,
  meta: { txCount: number; maxTxDate: string },
  periodStartStr: string,
): boolean {
  if (cached.periodStart !== periodStartStr) return false;
  if (meta.txCount === cached.txCount && meta.maxTxDate === cached.maxTxDate) {
    return cached.periodEnd < toLocalDateKey(new Date());
  }
  if (meta.txCount > cached.txCount) {
    return meta.maxTxDate >= cached.endState.date;
  }
  return false;
}

export async function resolvePortfolioValueSeries(
  periodStart: Date,
  periodEnd: Date,
  options?: { accountIds?: string[]; force?: boolean },
): Promise<{
  points: { date: string; value: number }[];
  cashFlows: CashFlowEvent[];
  fromCache: boolean;
  incremental: boolean;
}> {
  const periodStartStr = toLocalDateKey(periodStart);
  const cacheKey = buildPortfolioValueCacheKey(
    options?.accountIds,
    periodStartStr,
  );
  const meta = await getTransactionMeta();

  if (!options?.force) {
    const cached = await getPortfolioValueCache(cacheKey);
    if (cached && canIncrementalFromCache(cached, meta, periodStartStr)) {
      const extended = await extendPortfolioValueSeries(
        cached,
        periodStart,
        periodEnd,
        options,
      );
      if (extended) {
        await setPortfolioValueCache(
          cacheKey,
          periodStartStr,
          extended.periodEnd,
          meta,
          extended,
        );
        return {
          points: extended.points,
          cashFlows: extended.cashFlows,
          fromCache: true,
          incremental: true,
        };
      }
    }
    if (
      cached &&
      cached.periodStart === periodStartStr &&
      meta.txCount === cached.txCount &&
      meta.maxTxDate === cached.maxTxDate &&
      cached.periodEnd >= toLocalDateKey(periodEnd)
    ) {
      return {
        points: cached.points,
        cashFlows: cached.cashFlows,
        fromCache: true,
        incremental: false,
      };
    }
  }

  const built = await buildFullPortfolioValueSeries(
    periodStart,
    periodEnd,
    options,
  );
  if (!built) {
    return { points: [], cashFlows: [], fromCache: false, incremental: false };
  }

  await setPortfolioValueCache(
    cacheKey,
    periodStartStr,
    built.periodEnd,
    meta,
    built,
  );

  return {
    points: built.points,
    cashFlows: built.cashFlows,
    fromCache: false,
    incremental: false,
  };
}
