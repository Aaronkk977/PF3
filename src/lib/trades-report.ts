import {
  isTransactionInPeriod,
  toLocalDateKey,
  toLocalMonthKey,
  toLocalWeekKey,
} from "@/lib/date-keys";
import { prisma } from "@/lib/db";
import { getExchangeRate } from "@/lib/fx-rates";
import { getUsdToTwdRate, normalizeCurrencyCode } from "@/lib/fx";
import { inferInstrumentCurrency } from "@/lib/instrument-currency";
import { toNumber } from "@/lib/utils";

export type TradesPeriodGranularity =
  | "week"
  | "month"
  | "quarter"
  | "year";

export function tradesGranularityLabel(
  granularity: TradesPeriodGranularity,
): string {
  switch (granularity) {
    case "week":
      return "每週";
    case "month":
      return "每月";
    case "quarter":
      return "每季";
    case "year":
      return "每年";
  }
}

export type TradesPeriodBucket = {
  key: string;
  label: string;
  fees: number;
  taxes: number;
  realizedPnl: number;
  sellCount: number;
};

export type RealizedTradeRow = {
  transactionId: string;
  date: string;
  accountId: string;
  accountName: string;
  symbol: string;
  instrumentName: string | null;
  quantity: number;
  price: number;
  fee: number;
  tax: number;
  proceedsTwd: number;
  costBasisTwd: number;
  realizedPnl: number;
  realizedPnlPct: number;
  holdingDays: number;
  /** 年化 IRR（單筆 round-trip，依持有天數複利年化） */
  irr: number | null;
  accountCurrency: string;
};

export type TradesReport = {
  baseCurrency: "TWD";
  periodStart: string;
  periodEnd: string;
  granularity: TradesPeriodGranularity;
  summary: {
    fees: number;
    taxes: number;
    realizedPnl: number;
    sellCount: number;
    winCount: number;
    lossCount: number;
  };
  buckets: TradesPeriodBucket[];
  realizedTrades: RealizedTradeRow[];
  /** Yahoo 無法連線時提示（仍用快取／預設匯率） */
  fxNote: string | null;
  appliedScope: {
    accountNames: string[];
  };
};

type TxRow = {
  id: string;
  date: Date;
  type: string;
  quantity: number;
  price: number;
  fee: number;
  tax: number;
  instrumentCurrency: string;
  accountCurrency: string;
  accountId: string;
  accountName: string;
  instrumentId: string | null;
  symbol: string;
  instrumentName: string | null;
};

type Lot = {
  qty: number;
  costBase: number;
  buyDate: Date;
};

const MS_PER_DAY = 24 * 3600 * 1000;

function txAccountWhere(accountIds: string[]) {
  return accountIds.length ? { accountId: { in: accountIds } } : {};
}

function lotKey(accountId: string, instrumentId: string) {
  return `${accountId}:${instrumentId}`;
}

function isTwdAccount(currency: string) {
  return normalizeCurrencyCode(currency) === "TWD";
}

function holdingDaysBetween(buyDate: Date, sellDate: Date): number {
  const days = (sellDate.getTime() - buyDate.getTime()) / MS_PER_DAY;
  return Math.max(0, Math.round(days));
}

type TradesFxContext = {
  /** 每 1 USD = ? TWD（檢討頁用單一匯率，避免逐日打 Yahoo） */
  usdTwd: number;
  note: string | null;
};

async function buildTradesFxContext(): Promise<TradesFxContext> {
  const live = await getExchangeRate("USD", "TWD");
  if (live != null && live > 0) {
    return { usdTwd: live, note: null };
  }

  const stale = await prisma.fxRateCache.findUnique({
    where: { pair: "USD_TWD" },
  });
  if (stale?.rate && stale.rate > 0) {
    return {
      usdTwd: stale.rate,
      note: "無法連線 Yahoo，美元已改用資料庫快取匯率換算",
    };
  }

  return {
    usdTwd: await getUsdToTwdRate(),
    note: "無法連線 Yahoo，美元已改用預設匯率換算",
  };
}

function toTwd(amount: number, currency: string, fx: TradesFxContext): number {
  if (!Number.isFinite(amount) || amount === 0) return 0;
  const code = normalizeCurrencyCode(currency);
  if (code === "TWD") return amount;
  return amount * fx.usdTwd;
}

/** 單筆平倉年化 IRR：(1 + 總報酬)^(365/天) - 1 */
export function annualizedTradeIrr(
  realizedPnlPct: number,
  holdingDays: number,
): number | null {
  if (holdingDays < 1 || !Number.isFinite(realizedPnlPct)) return null;
  const growth = 1 + realizedPnlPct;
  if (growth <= 0) return null;
  return Math.pow(growth, 365 / holdingDays) - 1;
}

function periodBucketKey(
  date: Date,
  granularity: TradesPeriodGranularity,
): string {
  if (granularity === "week") return toLocalWeekKey(date);
  if (granularity === "month") return toLocalMonthKey(date);
  if (granularity === "year") return String(date.getFullYear());
  const q = Math.floor(date.getMonth() / 3) + 1;
  return `${date.getFullYear()}-Q${q}`;
}

function periodBucketLabel(
  key: string,
  granularity: TradesPeriodGranularity,
): string {
  if (granularity === "year") return `${key} 年`;
  if (granularity === "month") {
    const [y, m] = key.split("-");
    return `${y} 年 ${Number(m)} 月`;
  }
  const wk = key.match(/^(\d{4})-W(\d{2})$/);
  if (wk) return `${wk[1]} 年第 ${Number(wk[2])} 週`;
  const m = key.match(/^(\d{4})-Q(\d)$/);
  if (m) return `${m[1]} 年第 ${m[2]} 季`;
  return key;
}

function ensureBucket(
  map: Map<string, TradesPeriodBucket>,
  key: string,
  granularity: TradesPeriodGranularity,
): TradesPeriodBucket {
  let bucket = map.get(key);
  if (!bucket) {
    bucket = {
      key,
      label: periodBucketLabel(key, granularity),
      fees: 0,
      taxes: 0,
      realizedPnl: 0,
      sellCount: 0,
    };
    map.set(key, bucket);
  }
  return bucket;
}

/**
 * 交易檢討報表（與績效頁實現損益相同：台股價差 FIFO、手續費稅另列；美股歷史匯率）
 */
export async function buildTradesReport(
  periodStartKey: string,
  periodEndKey: string,
  accountIds: string[],
  granularity: TradesPeriodGranularity,
  accountNames: string[],
): Promise<TradesReport> {
  const periodEnd = new Date(`${periodEndKey}T23:59:59`);

  const txs = await prisma.transaction.findMany({
    where: {
      date: { lte: periodEnd },
      ...txAccountWhere(accountIds),
    },
    include: { account: true, instrument: true },
    orderBy: { date: "asc" },
  });

  const fx = await buildTradesFxContext();
  const lotsByKey = new Map<string, Lot[]>();
  const bucketMap = new Map<string, TradesPeriodBucket>();
  const realizedTrades: RealizedTradeRow[] = [];

  let totalFees = 0;
  let totalTaxes = 0;
  let totalRealized = 0;
  let winCount = 0;
  let lossCount = 0;

  const inPeriod = (d: Date) =>
    isTransactionInPeriod(d, periodStartKey, periodEndKey);

  for (const raw of txs) {
    const instrumentCurrency = raw.instrument
      ? inferInstrumentCurrency(
          raw.instrument.symbol,
          raw.instrument.currency,
        )
      : raw.account.currency;

    const tx: TxRow = {
      id: raw.id,
      date: raw.date,
      type: raw.type,
      quantity: toNumber(raw.quantity),
      price: toNumber(raw.price),
      fee: toNumber(raw.fee),
      tax: toNumber(raw.tax),
      instrumentCurrency,
      accountCurrency: raw.account.currency,
      accountId: raw.accountId,
      accountName: raw.account.name,
      instrumentId: raw.instrumentId,
      symbol: raw.instrument?.symbol ?? "",
      instrumentName: raw.instrument?.name ?? null,
    };

    const tw = isTwdAccount(tx.accountCurrency);
    const dateKey = toLocalDateKey(tx.date);

    if (inPeriod(tx.date) && (tx.type === "BUY" || tx.type === "SELL")) {
      const feeTwd = tw ? tx.fee : toTwd(tx.fee, tx.accountCurrency, fx);
      const taxTwd = tw ? tx.tax : toTwd(tx.tax, tx.accountCurrency, fx);

      totalFees += feeTwd;
      totalTaxes += taxTwd;

      const bKey = periodBucketKey(tx.date, granularity);
      const bucket = ensureBucket(bucketMap, bKey, granularity);
      bucket.fees += feeTwd;
      bucket.taxes += taxTwd;
    }

    if (!tx.instrumentId) continue;

    const key = lotKey(tx.accountId, tx.instrumentId);
    const lots = lotsByKey.get(key) ?? [];

    if (tx.type === "BUY" && tx.quantity > 0) {
      const costNative = tx.quantity * tx.price;
      const costBase = tw ? costNative : toTwd(costNative, tx.instrumentCurrency, fx);
      lots.push({ qty: tx.quantity, costBase, buyDate: tx.date });
    } else if (tx.type === "SELL" && tx.quantity > 0) {
      let remaining = tx.quantity;
      let matchedCostBase = 0;
      let weightedHoldingDays = 0;
      let matchedQty = 0;

      while (remaining > 0 && lots.length > 0) {
        const lot = lots[0]!;
        const used = Math.min(remaining, lot.qty);
        const sliceCost = (lot.costBase / lot.qty) * used;
        matchedCostBase += sliceCost;
        weightedHoldingDays += used * holdingDaysBetween(lot.buyDate, tx.date);
        matchedQty += used;
        lot.costBase -= sliceCost;
        lot.qty -= used;
        remaining -= used;
        if (lot.qty <= 0.0000001) lots.shift();
      }

      if (inPeriod(tx.date) && matchedQty > 0) {
        const proceeds = tw
          ? tx.quantity * tx.price
          : toTwd(tx.quantity * tx.price, tx.instrumentCurrency, fx);
        const realizedPnl = proceeds - matchedCostBase;
        const realizedPnlPct =
          matchedCostBase > 0 ? realizedPnl / matchedCostBase : 0;
        const holdingDays = Math.round(weightedHoldingDays / matchedQty);

        totalRealized += realizedPnl;
        if (realizedPnl > 0) winCount++;
        else if (realizedPnl < 0) lossCount++;

        const bKey = periodBucketKey(tx.date, granularity);
        const bucket = ensureBucket(bucketMap, bKey, granularity);
        bucket.realizedPnl += realizedPnl;
        bucket.sellCount += 1;

        realizedTrades.push({
          transactionId: tx.id,
          date: dateKey,
          accountId: tx.accountId,
          accountName: tx.accountName,
          symbol: tx.symbol,
          instrumentName: tx.instrumentName,
          quantity: tx.quantity,
          price: tx.price,
          fee: tx.fee,
          tax: tx.tax,
          proceedsTwd: proceeds,
          costBasisTwd: matchedCostBase,
          realizedPnl,
          realizedPnlPct,
          holdingDays,
          irr: annualizedTradeIrr(realizedPnlPct, holdingDays),
          accountCurrency: tx.accountCurrency,
        });
      }
    } else if (tx.type === "DIVIDEND" && tx.quantity > 0 && !tw) {
      const divBase = toTwd(tx.quantity * tx.price, tx.instrumentCurrency, fx);
      let remaining = divBase;
      for (const lot of lots) {
        if (remaining <= 0) break;
        const cut = Math.min(lot.costBase, remaining);
        lot.costBase -= cut;
        remaining -= cut;
      }
    }

    lotsByKey.set(key, lots);
  }

  const buckets = [...bucketMap.values()].sort((a, b) =>
    a.key.localeCompare(b.key),
  );

  realizedTrades.sort((a, b) => b.date.localeCompare(a.date));

  return {
    baseCurrency: "TWD",
    periodStart: periodStartKey,
    periodEnd: periodEndKey,
    granularity,
    summary: {
      fees: totalFees,
      taxes: totalTaxes,
      realizedPnl: totalRealized,
      sellCount: realizedTrades.length,
      winCount,
      lossCount,
    },
    buckets,
    realizedTrades,
    fxNote: fx.note,
    appliedScope: {
      accountNames: [...accountNames].sort((a, b) => a.localeCompare(b, "zh-TW")),
    },
  };
}
