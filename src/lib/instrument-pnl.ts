import { mapWithConcurrency } from "@/lib/async-pool";
import { externalReadLimiter } from "@/lib/concurrency-limiter";
import { toLocalDateKey } from "@/lib/date-keys";
import {
  consumeFifoLots,
  reduceFifoLotsCost,
  sumFifoLots,
  type FifoLot,
} from "@/lib/fifo-lots";
import { BASE_CURRENCY, getUsdToTwdRate, toBaseCurrency } from "@/lib/fx";
import { getExchangeRateOnDate, normalizeCurrencyCode } from "@/lib/fx-rates";

export type InstrumentTxInput = {
  date: Date;
  type: string;
  quantity: number;
  price: number;
  fee: number;
  tax: number;
  currency: string;
};

/** 將資料庫交易列轉為 FIFO 損益輸入（與標的詳情頁一致） */
export function mapSecurityTransactionsToPnlInput(
  txs: {
    date: Date;
    type: string;
    quantity: number;
    price: number;
    fee: number;
    tax: number;
    currency: string;
  }[],
): InstrumentTxInput[] {
  return txs.map((t) => ({
    date: t.date,
    type: t.type,
    quantity: t.quantity,
    price: t.price,
    fee: t.fee,
    tax: t.tax,
    currency: t.currency,
  }));
}

export type InstrumentPnlSummary = {
  baseCurrency: string;
  quantity: number;
  realizedPnl: number;
  /** 已平倉部位成本（FIFO 賣出配對成本），作為實現損益率分母 */
  realizedCostBasis: number;
  realizedPnlPct: number;
  unrealizedPnl: number;
  unrealizedPnlPct: number;
  openCostBasis: number;
  marketValue: number;
};

function rateMapKey(currency: string, date: Date): string {
  return `${normalizeCurrencyCode(currency)}_${toLocalDateKey(date)}`;
}

function toBaseAtDate(
  amount: number,
  currency: string,
  date: Date,
  rateMap: ReadonlyMap<string, number>,
): number {
  const norm = normalizeCurrencyCode(currency);
  if (norm === BASE_CURRENCY) return amount;
  const rate = rateMap.get(rateMapKey(currency, date));
  return amount * (rate ?? 1);
}

/**
 * 純計算核心：FIFO 配對成本 + 損益率，不含任何 I/O。外幣交易一律用呼叫端
 * 先解析好的「交易當天」匯率（rateMap）換算，不是現在的即期匯率——不然
 * 成本基礎會隨今天的匯率波動而改變，把匯率漲跌跟選股績效混在一起。
 * marketValueBase 則是「現在」市值，維持即期匯率，跟成本基礎的歷史匯率
 * 是兩回事：一個問「現在值多少」，一個問「當初花多少」。
 */
export function computeInstrumentPnlFromRates(
  transactions: InstrumentTxInput[],
  marketPriceInBase: number,
  rateMap: ReadonlyMap<string, number>,
): InstrumentPnlSummary {
  const sorted = [...transactions].sort(
    (a, b) => a.date.getTime() - b.date.getTime(),
  );

  const lots: FifoLot[] = [];
  let realizedPnl = 0;
  let realizedCostBasis = 0;

  for (const tx of sorted) {
    const qty = tx.quantity;
    const price = tx.price;
    const fee = tx.fee;
    const tax = tx.tax;

    if (tx.type === "BUY" && qty > 0) {
      const costBase = toBaseAtDate(
        qty * price + fee + tax,
        tx.currency,
        tx.date,
        rateMap,
      );
      lots.push({ qty, costBase });
      continue;
    }

    if (tx.type === "SELL" && qty > 0) {
      const { matchedCostBase } = consumeFifoLots(lots, qty);

      const proceedsBase = toBaseAtDate(
        qty * price - fee - tax,
        tx.currency,
        tx.date,
        rateMap,
      );
      realizedCostBasis += matchedCostBase;
      realizedPnl += proceedsBase - matchedCostBase;
      continue;
    }

    if (tx.type === "DIVIDEND" && qty > 0) {
      const divBase = toBaseAtDate(qty * price, tx.currency, tx.date, rateMap);
      reduceFifoLotsCost(lots, divBase);
    }
  }

  const { quantity, costBase: openCostBasis } = sumFifoLots(lots);
  const marketValue =
    quantity > 0 && marketPriceInBase > 0 ? quantity * marketPriceInBase : 0;
  const unrealizedPnl = marketValue - openCostBasis;
  const unrealizedPnlPct =
    openCostBasis > 0 ? unrealizedPnl / openCostBasis : 0;
  const realizedPnlPct =
    realizedCostBasis > 0 ? realizedPnl / realizedCostBasis : 0;

  return {
    baseCurrency: BASE_CURRENCY,
    quantity,
    realizedPnl,
    realizedCostBasis,
    realizedPnlPct,
    unrealizedPnl,
    unrealizedPnlPct,
    openCostBasis,
    marketValue,
  };
}

async function resolveRateForEntry(currency: string, date: Date): Promise<number> {
  const rate = await getExchangeRateOnDate(currency, BASE_CURRENCY, date);
  if (rate != null && rate > 0) return rate;
  if (currency === "USD") return getUsdToTwdRate();
  return 1;
}

/**
 * 併發解析這個 instrument 所有交易日各自需要的歷史匯率，建成 lookup map，
 * 讓 computeInstrumentPnlFromRates 全程同步跑，不用每筆交易各等一次網路。
 * 過去的收盤匯率永久快取在 FxRateHistory，之後同一天不會再重打 Yahoo。
 */
async function resolveHistoricalRateMap(
  transactions: InstrumentTxInput[],
): Promise<Map<string, number>> {
  const distinct = new Map<string, { currency: string; date: Date }>();
  for (const tx of transactions) {
    const currency = normalizeCurrencyCode(tx.currency);
    if (currency === BASE_CURRENCY) continue;
    const key = rateMapKey(tx.currency, tx.date);
    if (!distinct.has(key)) distinct.set(key, { currency, date: tx.date });
  }

  const entries = [...distinct.entries()];
  const rates = await mapWithConcurrency(entries, externalReadLimiter, ([, v]) =>
    resolveRateForEntry(v.currency, v.date),
  );

  const map = new Map<string, number>();
  entries.forEach(([key], i) => map.set(key, rates[i]!));
  return map;
}

export async function computeInstrumentPnl(
  transactions: InstrumentTxInput[],
  marketPrice: number,
  instrumentCurrency: string,
): Promise<InstrumentPnlSummary> {
  const [rateMap, marketPriceInBase] = await Promise.all([
    resolveHistoricalRateMap(transactions),
    marketPrice > 0 ? toBaseCurrency(marketPrice, instrumentCurrency) : Promise.resolve(0),
  ]);

  return computeInstrumentPnlFromRates(transactions, marketPriceInBase, rateMap);
}
