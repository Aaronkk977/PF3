import { mapWithConcurrency } from "@/lib/async-pool";
import { prisma } from "@/lib/db";
import {
  periodStartWithPriceLookback,
  toLocalDateKey,
} from "@/lib/date-keys";
import { getUsdToTwdRate, toBaseCurrency } from "@/lib/fx";
import { getHistoricalPrices, getQuotes } from "@/lib/yahoo";
import { toNumber } from "@/lib/utils";

/** 單日入出金（實際交易日） */
export type CashFlowEvent = {
  date: string;
  deposit: number;
  withdrawal: number;
};

/** @deprecated 請改用 CashFlowEvent */
export type CashFlowMonth = CashFlowEvent & { month?: string };

function isCashFlowType(type: string): boolean {
  const t = type.toUpperCase();
  return t === "DEPOSIT" || t === "WITHDRAWAL";
}

/** 依實際交易日彙總入金／出金（換算為 TWD） */
export async function buildCashFlowSeries(
  periodStart: Date,
  periodEnd: Date,
  options?: { accountIds?: string[] },
): Promise<CashFlowEvent[]> {
  const accountFilter = options?.accountIds?.length
    ? { accountId: { in: options.accountIds } }
    : {};

  const txs = await prisma.transaction.findMany({
    where: {
      date: { gte: periodStart, lte: periodEnd },
      ...accountFilter,
    },
    include: { account: true },
    orderBy: { date: "asc" },
  });

  const cashTxs = txs.filter((tx) => isCashFlowType(tx.type));
  const byDate = new Map<string, { deposit: number; withdrawal: number }>();

  for (const tx of cashTxs) {
    const gross = toNumber(tx.quantity) * toNumber(tx.price);
    const amount = await toBaseCurrency(gross, tx.account.currency);
    const date = toLocalDateKey(tx.date);
    const entry = byDate.get(date) ?? { deposit: 0, withdrawal: 0 };
    const kind = tx.type.toUpperCase();
    if (kind === "DEPOSIT") entry.deposit += amount;
    else entry.withdrawal += amount;
    byDate.set(date, entry);
  }

  return [...byDate.entries()]
    .map(([date, { deposit, withdrawal }]) => ({
      date,
      deposit,
      withdrawal,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

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

/** 移除首日異常低點（常因部分標的尚未有報價） */
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

/** 依交易回放每日持倉＋現金，並以 forward-fill 收盤價計算組合總市值 */
export async function buildPortfolioValueSeries(
  periodStart: Date,
  periodEnd: Date,
  options?: { accountIds?: string[] },
): Promise<{ date: string; value: number }[]> {
  if (
    options?.accountIds?.length === 1 &&
    options.accountIds[0] === "__none__"
  ) {
    return [];
  }

  const accountFilter = options?.accountIds?.length
    ? { accountId: { in: options.accountIds } }
    : {};

  const accounts = await prisma.account.findMany({
    where: options?.accountIds?.length
      ? { id: { in: options.accountIds } }
      : undefined,
  });
  const accountCurrencies = new Map(
    accounts.map((a) => [a.id, a.currency]),
  );
  const allowedAccountIds = new Set(accounts.map((a) => a.id));

  const allTxs = await prisma.transaction.findMany({
    include: { instrument: true, account: true },
    where: {
      date: { lte: periodEnd },
      ...accountFilter,
    },
    orderBy: { date: "asc" },
  });

  if (allTxs.length === 0) return [];

  const securityTxs = allTxs.filter((t) => t.instrument);
  const usdRate = await getUsdToTwdRate();
  const currencyBySymbol = new Map<string, string | null>();
  for (const t of securityTxs) {
    if (t.instrument) {
      currencyBySymbol.set(
        t.instrument.symbol,
        t.instrument.currency ?? "TWD",
      );
    }
  }

  const symbols = [...new Set(securityTxs.map((t) => t.instrument!.symbol))];
  const priceBySymbol = new Map<string, Map<string, number>>();

  if (symbols.length > 0) {
    await mapWithConcurrency(symbols, 2, async (symbol) => {
      const bars = await getHistoricalPrices(
        symbol,
        periodStartWithPriceLookback(periodStart),
        periodEnd,
      );
      const filled = buildForwardFilledPriceMap(bars, periodStart, periodEnd);
      priceBySymbol.set(symbol, filled);
    });
  }

  const sortedDates = calendarDateKeys(periodStart, periodEnd);
  const todayKey = toLocalDateKey(new Date());
  const positions = new Map<string, number>();
  const cashByAccount = new Map<string, number>();
  let txIdx = 0;
  const points: { date: string; value: number }[] = [];
  let liveQuotesCache: Awaited<ReturnType<typeof getQuotes>> | null = null;

  for (const dateStr of sortedDates) {
    while (txIdx < allTxs.length) {
      const tx = allTxs[txIdx] as TxRow;
      const txDay = toLocalDateKey(tx.date);
      if (txDay > dateStr) break;
      if (allowedAccountIds.has(tx.accountId)) {
        applyCashToAccount(cashByAccount, tx);
        applySecurityPosition(positions, tx);
      }
      txIdx++;
    }

    const cashTotal = await sumCashInBase(
      cashByAccount,
      accountCurrencies,
      usdRate,
    );

    const held = [...positions.entries()].filter(([, qty]) => qty > 0);
    let securitiesValue = 0;
    let priced = 0;

    for (const [symbol, qty] of held) {
      let price = priceBySymbol.get(symbol)?.get(dateStr);
      if ((price === undefined || price <= 0) && dateStr === todayKey) {
        if (!liveQuotesCache) {
          liveQuotesCache = await getQuotes([...positions.keys()]);
        }
        const live = liveQuotesCache.get(symbol)?.price;
        if (live != null && live > 0) price = live;
      }
      if (price !== undefined && price > 0) {
        const fx = currencyBySymbol.get(symbol) === "USD" ? usdRate : 1;
        securitiesValue += qty * price * fx;
        priced++;
      }
    }

    // 完全無法為任何持股計價時略過（部分缺價仍計入，避免走勢圖中段整段消失）
    if (held.length > 0 && priced === 0) {
      continue;
    }

    const total = securitiesValue + Math.max(0, cashTotal);
    if (total <= 0) continue;

    points.push({ date: dateStr, value: total });
  }

  return trimAnomalousLeadingPoint(points);
}

function netFlowByDate(flows: CashFlowEvent[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const f of flows) {
    map.set(f.date, (map.get(f.date) ?? 0) + f.deposit - f.withdrawal);
  }
  return map;
}

/** 市值序列 → 累積報酬率 %（鏈結日報酬；含入出金造成的市值跳動） */
export function buildCumulativeReturnPctSeries(
  points: { date: string; value: number }[],
): Map<string, number> {
  if (points.length === 0) return new Map();
  const result = new Map<string, number>();
  result.set(points[0]!.date, 0);

  let factor = 1;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]!.value;
    const curr = points[i]!.value;
    if (prev > 0 && curr > 0) {
      factor *= curr / prev;
    }
    result.set(points[i]!.date, (factor - 1) * 100);
  }
  return result;
}

/**
 * 績效用：鏈結日報酬，並自當日市值變動扣除淨入金（入金－出金），
 * 使累積報酬率不受外部資金流入流出影響。
 */
export function buildCumulativeReturnPctNeutralizingFlows(
  points: { date: string; value: number }[],
  flows: CashFlowEvent[],
): Map<string, number> {
  if (points.length === 0) return new Map();
  const flowByDate = netFlowByDate(flows);
  const result = new Map<string, number>();
  result.set(points[0]!.date, 0);

  let factor = 1;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]!.value;
    const curr = points[i]!.value;
    const date = points[i]!.date;
    const netFlow = flowByDate.get(date) ?? 0;

    if (prev > 0 && curr > 0) {
      const dailyReturn = (curr - prev - netFlow) / prev;
      factor *= 1 + dailyReturn;
    }
    result.set(date, (factor - 1) * 100);
  }
  return result;
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

/** 將收盤價 forward-fill 至區間內每個曆日（假日沿用最近交易日收盤價） */
export function buildForwardFilledCloseSeries(
  bars: { date: string; close: number }[],
  periodStart: Date,
  periodEnd: Date,
): { date: string; value: number }[] {
  const filled = buildForwardFilledPriceMap(bars, periodStart, periodEnd);
  return [...filled.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, value]) => ({ date, value }));
}

/** 供績效拆解等模組與組合市值使用相同 forward-fill 報價 */
export function buildForwardFilledPriceMap(
  bars: { date: string; close: number }[],
  periodStart: Date,
  periodEnd: Date,
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
    beforeStart.length > 0
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
