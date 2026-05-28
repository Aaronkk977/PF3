import { mapWithConcurrency } from "@/lib/async-pool";
import { prisma } from "@/lib/db";
import {
  periodStartWithPriceLookback,
  toLocalDateKey,
} from "@/lib/date-keys";
import { getUsdToTwdRate, toBaseCurrency } from "@/lib/fx";
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
  type PortfolioValueEndState,
} from "@/lib/portfolio-value-cache";
import { getHistoricalPrices } from "@/lib/yahoo";
import { toNumber } from "@/lib/utils";

export type { CashFlowEvent } from "@/lib/portfolio-history";
export { buildPortfolioValueCacheKey } from "@/lib/portfolio-value-cache";

type TxRow = {
  date: Date;
  type: string;
  quantity: unknown;
  price: unknown;
  fee: unknown;
  tax: unknown;
  accountId: string;
  account: { currency: string };
  instrument: { symbol: string; currency: string | null } | null;
};

type SeriesContext = {
  allTxs: TxRow[];
  allowedAccountIds: Set<string>;
  accountCurrencies: Map<string, string>;
  currencyBySymbol: Map<string, string | null>;
  usdRate: number;
};

function applyCashToAccount(
  cashByAccount: Map<string, number>,
  tx: TxRow,
): void {
  const qty = toNumber(tx.quantity);
  const price = toNumber(tx.price);
  const fee = toNumber(tx.fee);
  const tax = toNumber(tx.tax);
  const gross = qty * price;
  const cur = cashByAccount.get(tx.accountId) ?? 0;

  switch (tx.type) {
    case "DEPOSIT":
      cashByAccount.set(tx.accountId, cur + gross);
      break;
    case "WITHDRAWAL":
      cashByAccount.set(tx.accountId, cur - gross);
      break;
    case "BUY":
      cashByAccount.set(tx.accountId, cur - gross - fee - tax);
      break;
    case "SELL":
      cashByAccount.set(tx.accountId, cur + gross - fee - tax);
      break;
    case "DIVIDEND":
      cashByAccount.set(tx.accountId, cur + gross);
      break;
  }
}

function applySecurityPosition(
  positions: Map<string, number>,
  tx: TxRow,
): void {
  if (!tx.instrument) return;
  const symbol = tx.instrument.symbol;
  const qty = toNumber(tx.quantity);

  if (tx.type === "BUY") {
    positions.set(symbol, (positions.get(symbol) ?? 0) + qty);
  } else if (tx.type === "SELL") {
    const next = (positions.get(symbol) ?? 0) - qty;
    if (next <= 0.0000001) positions.delete(symbol);
    else positions.set(symbol, next);
  }
}

async function sumCashInBase(
  cashByAccount: Map<string, number>,
  currencies: Map<string, string>,
  usdRate: number,
): Promise<number> {
  let total = 0;
  for (const [accountId, balance] of cashByAccount) {
    const currency = currencies.get(accountId) ?? "TWD";
    if (currency === "TWD" || !currency) {
      total += balance;
    } else if (currency === "USD") {
      total += balance * usdRate;
    } else {
      total += await toBaseCurrency(balance, currency);
    }
  }
  return total;
}

function calendarDateKeys(periodStart: Date, periodEnd: Date): string[] {
  const keys: string[] = [];
  const cursor = new Date(periodStart);
  cursor.setHours(0, 0, 0, 0);
  const end = new Date(periodEnd);
  end.setHours(23, 59, 59, 999);

  while (cursor <= end) {
    keys.push(toLocalDateKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return keys;
}

function forwardFillPrices(
  bars: { date: string; close: number }[],
  periodStart: Date,
  periodEnd: Date,
  seedPrice?: number,
): Map<string, number> {
  const byDate = new Map(bars.map((b) => [b.date, b.close]));
  const result = new Map<string, number>();

  const cursor = new Date(periodStart);
  cursor.setHours(0, 0, 0, 0);
  const end = new Date(periodEnd);
  end.setHours(23, 59, 59, 999);
  const periodStartKey = toLocalDateKey(cursor);

  const beforeStart = bars
    .filter((b) => b.date < periodStartKey && b.close > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  let lastPrice: number | null =
    seedPrice !== undefined && seedPrice > 0
      ? seedPrice
      : beforeStart.length > 0
        ? beforeStart[beforeStart.length - 1]!.close
        : null;

  while (cursor <= end) {
    const key = toLocalDateKey(cursor);
    if (byDate.has(key)) {
      lastPrice = byDate.get(key)!;
    }
    if (lastPrice !== null && lastPrice > 0) {
      result.set(key, lastPrice);
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  return result;
}

function trimAnomalousLeadingPoint(
  points: { date: string; value: number }[],
): { date: string; value: number }[] {
  if (points.length < 2) return points;
  const first = points[0]!.value;
  const second = points[1]!.value;
  if (second > 0 && first < second * 0.5) {
    return points.slice(1);
  }
  return points;
}

function mapFromRecord(rec: Record<string, number>): Map<string, number> {
  return new Map(Object.entries(rec));
}

function recordFromMap(map: Map<string, number>): Record<string, number> {
  return Object.fromEntries(map);
}

function nextDateKey(dateStr: string): string {
  const d = new Date(dateStr);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 1);
  return toLocalDateKey(d);
}

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

  await mapWithConcurrency(symbols, 2, async (symbol) => {
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

async function simulateValueDays(
  ctx: SeriesContext,
  dateKeys: string[],
  initial: {
    txIdx: number;
    positions: Map<string, number>;
    cashByAccount: Map<string, number>;
  },
  priceBySymbol: Map<string, Map<string, number>>,
): Promise<{
  points: { date: string; value: number }[];
  endState: PortfolioValueEndState;
}> {
  const positions = new Map(initial.positions);
  const cashByAccount = new Map(initial.cashByAccount);
  let txIdx = initial.txIdx;
  const points: { date: string; value: number }[] = [];
  const lastPriceBySymbol: Record<string, number> = {};

  for (const dateStr of dateKeys) {
    while (txIdx < ctx.allTxs.length) {
      const tx = ctx.allTxs[txIdx]!;
      const txDay = toLocalDateKey(tx.date);
      if (txDay > dateStr) break;
      if (ctx.allowedAccountIds.has(tx.accountId)) {
        applyCashToAccount(cashByAccount, tx);
        applySecurityPosition(positions, tx);
      }
      txIdx++;
    }

    const cashTotal = await sumCashInBase(
      cashByAccount,
      ctx.accountCurrencies,
      ctx.usdRate,
    );

    const held = [...positions.entries()].filter(([, qty]) => qty > 0);
    let securitiesValue = 0;
    let priced = 0;

    for (const [symbol, qty] of held) {
      const price = priceBySymbol.get(symbol)?.get(dateStr);
      if (price !== undefined && price > 0) {
        const fx = ctx.currencyBySymbol.get(symbol) === "USD" ? ctx.usdRate : 1;
        securitiesValue += qty * price * fx;
        priced++;
        lastPriceBySymbol[symbol] = price;
      }
    }

    if (held.length > 0 && priced < held.length) {
      continue;
    }

    const total = securitiesValue + Math.max(0, cashTotal);
    if (total <= 0) continue;
    if (held.length > 0 && priced === 0 && cashTotal <= 0) continue;

    points.push({ date: dateStr, value: total });
  }

  const lastDate =
    dateKeys.length > 0 ? dateKeys[dateKeys.length - 1]! : initial.txIdx.toString();

  return {
    points,
    endState: {
      date: points.length > 0 ? points[points.length - 1]!.date : lastDate,
      txIdx,
      positions: recordFromMap(positions),
      cashByAccount: recordFromMap(cashByAccount),
      lastPriceBySymbol,
    },
  };
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
