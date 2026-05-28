import { mapWithConcurrency } from "@/lib/async-pool";
import { periodStartWithPriceLookback, toLocalDateKey } from "@/lib/date-keys";
import { prisma } from "@/lib/db";
import { normalizeCurrencyCode } from "@/lib/fx";
import { inferInstrumentCurrency } from "@/lib/instrument-currency";
import {
  buildForwardFilledPriceMap,
} from "@/lib/portfolio-history";
import { getHistoricalPrices, getQuotes } from "@/lib/yahoo";
import { toNumber } from "@/lib/utils";

export type ExposureSnapshot = {
  /** 美元計價持倉市值＋美元帳戶現金（USD 原幣） */
  usdNative: number;
  /** 台幣計價持倉＋台幣帳戶現金（TWD） */
  twdNative: number;
};

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

function applyCash(cashByAccount: Map<string, number>, tx: TxRow): void {
  const gross = toNumber(tx.quantity) * toNumber(tx.price);
  const fee = toNumber(tx.fee);
  const tax = toNumber(tx.tax);
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

function applyPosition(positions: Map<string, number>, tx: TxRow): void {
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

async function buildPriceMaps(
  symbols: string[],
  periodStart: Date,
  periodEnd: Date,
): Promise<Map<string, Map<string, number>>> {
  const maps = new Map<string, Map<string, number>>();
  if (symbols.length === 0) return maps;
  await mapWithConcurrency(symbols, 2, async (symbol) => {
    const bars = await getHistoricalPrices(
      symbol,
      periodStartWithPriceLookback(periodStart),
      periodEnd,
    );
    maps.set(symbol, buildForwardFilledPriceMap(bars, periodStart, periodEnd));
  });
  return maps;
}

/**
 * 回放至 asOfDate，計算美元／台幣原幣曝險（不含匯率換算）
 */
export async function computeExposureSnapshot(
  asOfDateKey: string,
  periodStart: Date,
  periodEnd: Date,
  accountIds: string[],
): Promise<ExposureSnapshot> {
  const accountFilter = accountIds.length
    ? { accountId: { in: accountIds } }
    : {};

  const accounts = await prisma.account.findMany({
    where: accountIds.length ? { id: { in: accountIds } } : undefined,
  });
  const accountCurrencies = new Map(
    accounts.map((a) => [a.id, normalizeCurrencyCode(a.currency)]),
  );
  const allowedIds = new Set(accounts.map((a) => a.id));

  const allTxs = await prisma.transaction.findMany({
    where: { date: { lte: new Date(`${asOfDateKey}T23:59:59`) }, ...accountFilter },
    include: { instrument: true, account: true },
    orderBy: { date: "asc" },
  });

  const positions = new Map<string, number>();
  const cashByAccount = new Map<string, number>();
  const currencyBySymbol = new Map<string, string>();

  for (const tx of allTxs) {
    if (!allowedIds.has(tx.accountId)) continue;
    applyCash(cashByAccount, tx as TxRow);
    applyPosition(positions, tx as TxRow);
    if (tx.instrument) {
      currencyBySymbol.set(
        tx.instrument.symbol,
        inferInstrumentCurrency(
          tx.instrument.symbol,
          tx.instrument.currency,
        ),
      );
    }
  }

  const symbols = [...positions.keys()];
  const priceMaps = await buildPriceMaps(symbols, periodStart, periodEnd);
  const todayKey = toLocalDateKey(new Date());
  let liveQuotes: Awaited<ReturnType<typeof getQuotes>> | null = null;

  let usdSecurities = 0;
  let twdSecurities = 0;

  for (const [symbol, qty] of positions) {
    if (qty <= 0.0000001) continue;
    let price = priceMaps.get(symbol)?.get(asOfDateKey);
    if ((price === undefined || price <= 0) && asOfDateKey === todayKey) {
      if (!liveQuotes) liveQuotes = await getQuotes(symbols);
      const live = liveQuotes.get(symbol)?.price;
      if (live != null && live > 0) price = live;
    }
    if (price === undefined || price <= 0) continue;

    const ccy = currencyBySymbol.get(symbol) ?? "TWD";
    const mv = qty * price;
    if (normalizeCurrencyCode(ccy) === "USD") usdSecurities += mv;
    else twdSecurities += mv;
  }

  let usdCash = 0;
  let twdCash = 0;
  for (const [accountId, balance] of cashByAccount) {
    const ccy = accountCurrencies.get(accountId) ?? "TWD";
    if (normalizeCurrencyCode(ccy) === "USD") usdCash += balance;
    else twdCash += balance;
  }

  return {
    usdNative: usdSecurities + usdCash,
    twdNative: twdSecurities + twdCash,
  };
}

/**
 * 期間匯差：美元曝險因 USD/TWD 匯率變動產生的 TWD 損益
 * = 期初曝險×(期末匯率−期初匯率) + 期間曝險變動×(期末匯率−期初匯率)
 */
export function computeFxDifferenceTwd(
  usdStart: number,
  usdEnd: number,
  rateStart: number,
  rateEnd: number,
): number {
  const rateDelta = rateEnd - rateStart;
  return usdStart * rateDelta + (usdEnd - usdStart) * rateDelta;
}
