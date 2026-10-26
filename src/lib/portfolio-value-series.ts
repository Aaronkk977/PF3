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
  getTransactionChangesSince,
  getTransactionMeta,
  type TransactionMeta,
} from "@/lib/data-version";
import {
  buildPortfolioValueCacheKey,
  getPortfolioValueCache,
  setPortfolioValueCache,
  type PortfolioValueCachePayload,
} from "@/lib/portfolio-value-cache";
import {
  calendarDateKeys,
  forwardFillPrices,
  mapFromRecord,
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
): Promise<{
  priceBySymbol: Map<string, Map<string, number>>;
  /** 今天有真實 K 線的標的（見 simulateValueDays 的說明） */
  todayBarSymbols: Set<string>;
}> {
  const priceBySymbol = new Map<string, Map<string, number>>();
  const todayBarSymbols = new Set<string>();
  if (symbols.length === 0) return { priceBySymbol, todayBarSymbols };

  const todayKey = toLocalDateKey(new Date());
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
    if (bars.some((b) => b.date === todayKey && b.close > 0)) {
      todayBarSymbols.add(symbol);
    }
  });
  return { priceBySymbol, todayBarSymbols };
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

  const { priceBySymbol, todayBarSymbols } = await loadPriceMaps(
    symbols,
    periodStart,
    periodEnd,
  );
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
    { fetchLiveQuotes: getQuotes, todayBarSymbols },
  );

  const trimmed = trimAnomalousLeadingPoint(points);
  const periodStartStr = toLocalDateKey(periodStart);
  const periodEndStr = toLocalDateKey(periodEnd);
  const meta = await getTransactionMeta();
  const cashFlows = await buildCashFlowSeries(periodStart, periodEnd, options);

  return {
    points: trimmed,
    cashFlows,
    endState,
    periodStart: periodStartStr,
    periodEnd: periodEndStr,
    txCount: meta.txCount,
    maxTxDate: meta.maxTxDate,
    maxUpdatedAt: meta.maxUpdatedAt,
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

  // 一律從快取的最後一天本身（而不是隔天）重跑。每次計算都跑到「今天」，
  // 所以快取最後一天的點很可能是用盤中價算的：若那天還是今天，要讓它跟著
  // 盤中報價更新；若已經過了那天，要讓它換成正式收盤價——否則那個點會永遠
  // 停在上次開 app 當下的盤中價。
  //
  // 重跑這天不會讓交易被重複計入：endState 是這天結束時的狀態，
  // simulateValueDays 消費交易的 while 迴圈從傳入的 txIdx 續跑，這天的交易
  // 早就被消費掉了；持倉也就是這天收盤後的持倉，跟當初算這天時一致。
  const extendFromKey = cached.endState.date;
  const periodEndStr = toLocalDateKey(periodEnd);
  if (extendFromKey > periodEndStr) {
    return cached;
  }

  const extendFrom = new Date(extendFromKey);
  extendFrom.setHours(0, 0, 0, 0);

  const heldSymbols = Object.keys(cached.endState.positions).filter(
    (s) => (cached.endState.positions[s] ?? 0) > 0,
  );

  const { priceBySymbol, todayBarSymbols } = await loadPriceMaps(
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
    { fetchLiveQuotes: getQuotes, todayBarSymbols },
  );

  // 重跑的起點那天快取裡可能已經有點，丟掉舊的換成新算的；新算出來那天若
  // 被跳過（total<=0），就保留原本的點。
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
    maxUpdatedAt: meta.maxUpdatedAt,
  };
}

async function canIncrementalFromCache(
  cached: PortfolioValueCachePayload,
  meta: TransactionMeta,
  periodStartStr: string,
): Promise<boolean> {
  if (cached.periodStart !== periodStartStr) return false;
  // 舊版快取沒記 maxUpdatedAt，無從判斷有沒有交易被原地編輯過，直接重算
  if (cached.maxUpdatedAt === undefined) return false;
  if (isSameTransactionData(cached, meta)) {
    // 用 <= 而非 <：快取尾端等於今天時也要走增量路徑，才能讓
    // extendPortfolioValueSeries 有機會重跑快取最後一天、跟上盤中報價或收盤價
    // （見那邊的說明）。這裡本身不打任何外部 API，實際節流交給
    // getHistoricalPrices 自己的 15 分鐘快取 TTL。
    return cached.periodEnd <= toLocalDateKey(new Date());
  }
  if (meta.txCount <= cached.txCount) return false;
  // 筆數變多不代表只有新增：同時有舊交易被改過的話，已算好的點就錯了。
  // 新增的交易也要每一筆都不早於快取尾端，增量延伸才納入得到。
  const changes = await getTransactionChangesSince(cached.maxUpdatedAt);
  if (changes.editedCount > 0) return false;
  return changes.addedDates.every(
    (d) => toLocalDateKey(d) >= cached.endState.date,
  );
}

function isSameTransactionData(
  cached: PortfolioValueCachePayload,
  meta: TransactionMeta,
): boolean {
  return (
    meta.txCount === cached.txCount &&
    meta.maxTxDate === cached.maxTxDate &&
    meta.maxUpdatedAt === cached.maxUpdatedAt
  );
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
    if (cached && (await canIncrementalFromCache(cached, meta, periodStartStr))) {
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
      isSameTransactionData(cached, meta) &&
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
