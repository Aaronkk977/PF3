import {
  isTransactionInPeriod,
  toLocalDateKey,
} from "@/lib/date-keys";
import { prisma } from "@/lib/db";
import { getExchangeRateOnDate } from "@/lib/fx-rates";
import { getUsdToTwdRate, normalizeCurrencyCode } from "@/lib/fx";
import { inferInstrumentCurrency } from "@/lib/instrument-currency";
import { toNumber } from "@/lib/utils";

type TxRow = {
  date: Date;
  type: string;
  quantity: number;
  price: number;
  fee: number;
  tax: number;
  instrumentCurrency: string;
  accountCurrency: string;
  accountId: string;
  instrumentId: string | null;
};

type Lot = {
  qty: number;
  /** 台股：買進交割成本（含手續費）；美股等：成交價金 */
  costBase: number;
};

function txAccountWhere(accountIds: string[]) {
  return accountIds.length ? { accountId: { in: accountIds } } : {};
}

function lotKey(accountId: string, instrumentId: string) {
  return `${accountId}:${instrumentId}`;
}

function isTwdAccount(currency: string) {
  return normalizeCurrencyCode(currency) === "TWD";
}

async function toTwdOnDate(
  amount: number,
  currency: string,
  date: Date,
  rateCache: Map<string, number>,
): Promise<number> {
  if (!Number.isFinite(amount) || amount === 0) return 0;
  const code = normalizeCurrencyCode(currency);
  if (code === "TWD") return amount;

  const dateKey = toLocalDateKey(date);
  let rate = rateCache.get(dateKey);
  if (rate === undefined) {
    rate =
      (await getExchangeRateOnDate("USD", "TWD", date)) ??
      (await getUsdToTwdRate());
    rateCache.set(dateKey, rate);
  }

  return amount * rate;
}

function buyLotCost(tx: TxRow): number {
  return tx.quantity * tx.price;
}

async function sellRealizedAmount(
  tx: TxRow,
  matchedCost: number,
  rateCache: Map<string, number>,
): Promise<number> {
  const tw = isTwdAccount(tx.accountCurrency);
  const proceeds = tw
    ? tx.quantity * tx.price
    : await toTwdOnDate(
        tx.quantity * tx.price,
        tx.instrumentCurrency,
        tx.date,
        rateCache,
      );
  return proceeds - matchedCost;
}

/**
 * 期間內 FIFO 實現損益
 * - 台股：成交價 FIFO（價差毛額，手續費／稅另列），以本地日曆判斷期間
 * - 美股：歷史匯率換算之成交價 FIFO
 */
export async function aggregatePeriodRealizedPnl(
  periodStart: Date,
  periodEnd: Date,
  accountIds: string[],
  options?: {
    periodStartKey?: string;
    periodEndKey?: string;
  },
): Promise<{
  realizedPnl: number;
  fees: number;
  taxes: number;
  dividends: number;
}> {
  const periodStartKey =
    options?.periodStartKey ?? toLocalDateKey(periodStart);
  const periodEndKey = options?.periodEndKey ?? toLocalDateKey(periodEnd);

  const txs = await prisma.transaction.findMany({
    where: {
      date: { lte: periodEnd },
      ...txAccountWhere(accountIds),
    },
    include: { account: true, instrument: true },
    orderBy: { date: "asc" },
  });

  const lotsByKey = new Map<string, Lot[]>();
  const rateCache = new Map<string, number>();

  let realizedPnl = 0;
  let fees = 0;
  let taxes = 0;
  let dividends = 0;

  const inPeriod = (d: Date) =>
    isTransactionInPeriod(d, periodStartKey, periodEndKey);

  for (const raw of txs) {
    const instrumentCurrency = raw.instrument
      ? inferInstrumentCurrency(
          raw.instrument.symbol,
          raw.instrument.currency,
        )
      : raw.account.currency;
    const accountCurrency = raw.account.currency;

    const tx: TxRow = {
      date: raw.date,
      type: raw.type,
      quantity: toNumber(raw.quantity),
      price: toNumber(raw.price),
      fee: toNumber(raw.fee),
      tax: toNumber(raw.tax),
      instrumentCurrency,
      accountCurrency,
      accountId: raw.accountId,
      instrumentId: raw.instrumentId,
    };

    const tw = isTwdAccount(accountCurrency);

    if (inPeriod(tx.date) && (tx.type === "BUY" || tx.type === "SELL")) {
      if (tw) {
        if (tx.type === "BUY") {
          fees += tx.fee;
          taxes += tx.tax;
        } else {
          fees += tx.fee;
          taxes += tx.tax;
        }
      } else {
        fees += await toTwdOnDate(
          tx.fee,
          accountCurrency,
          tx.date,
          rateCache,
        );
        taxes += await toTwdOnDate(
          tx.tax,
          accountCurrency,
          tx.date,
          rateCache,
        );
      }
    }

    if (!tx.instrumentId) continue;

    const key = lotKey(tx.accountId, tx.instrumentId);
    const lots = lotsByKey.get(key) ?? [];

    if (tx.type === "BUY" && tx.quantity > 0) {
      const costNative = buyLotCost(tx);
      const costBase = tw
        ? costNative
        : await toTwdOnDate(
            costNative,
            tx.instrumentCurrency,
            tx.date,
            rateCache,
          );
      lots.push({ qty: tx.quantity, costBase });
    } else if (tx.type === "SELL" && tx.quantity > 0) {
      let remaining = tx.quantity;
      let matchedCostBase = 0;

      while (remaining > 0 && lots.length > 0) {
        const lot = lots[0]!;
        const used = Math.min(remaining, lot.qty);
        const sliceCost = (lot.costBase / lot.qty) * used;
        matchedCostBase += sliceCost;
        lot.costBase -= sliceCost;
        lot.qty -= used;
        remaining -= used;
        if (lot.qty <= 0.0000001) lots.shift();
      }

      if (inPeriod(tx.date)) {
        realizedPnl += await sellRealizedAmount(
          tx,
          matchedCostBase,
          rateCache,
        );
      }
    } else if (tx.type === "DIVIDEND" && tx.quantity > 0) {
      const divBase = tw
        ? tx.quantity * tx.price
        : await toTwdOnDate(
            tx.quantity * tx.price,
            tx.instrumentCurrency,
            tx.date,
            rateCache,
          );
      if (inPeriod(tx.date)) dividends += divBase;

      if (!tw) {
        let remaining = divBase;
        for (const lot of lots) {
          if (remaining <= 0) break;
          const cut = Math.min(lot.costBase, remaining);
          lot.costBase -= cut;
          remaining -= cut;
        }
      }
    }

    lotsByKey.set(key, lots);
  }

  return { realizedPnl, fees, taxes, dividends };
}
