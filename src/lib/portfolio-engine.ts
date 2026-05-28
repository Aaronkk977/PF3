import { computeAllAccountsCash } from "@/lib/accounts";
import { prisma } from "@/lib/db";
import {
  BASE_CURRENCY,
  fromBaseCurrency,
  getUsdToTwdRate,
  toBaseCurrency,
} from "@/lib/fx";
import { inferInstrumentCurrency } from "@/lib/instrument-currency";
import {
  computeInstrumentPnl,
  mapSecurityTransactionsToPnlInput,
} from "@/lib/instrument-pnl";
import { getQuotes, type QuoteResult } from "@/lib/yahoo";
import type { HoldingPosition } from "@/lib/holding-types";
import { toNumber } from "@/lib/utils";

export type { HoldingPosition } from "@/lib/holding-types";
export { isTaiwanMarket, isUsMarket } from "@/lib/market-utils";

export type AccountPerformance = {
  accountId: string;
  name: string;
  marketValue: number;
  cash: number;
  totalAssets: number;
  todayChange: number;
  todayChangePct: number;
  unrealizedPnl: number;
  unrealizedPnlPct: number;
};

export type PortfolioSummary = {
  baseCurrency: string;
  usdToTwdRate: number;
  totalMarketValue: number;
  totalCostBasis: number;
  totalUnrealizedPnl: number;
  totalUnrealizedPnlPct: number;
  todayChange: number;
  todayChangePct: number;
  cash: number;
  holdingsCount: number;
  accountSummaries: AccountPerformance[];
  allocationByAssetClass: { name: string; value: number; pct: number }[];
  allocationByTag: { name: string; value: number; pct: number }[];
  allocationByHolding: { name: string; value: number; pct: number }[];
};

type TxRow = {
  type: string;
  quantity: number;
  price: number;
  fee: number;
  tax: number;
};

function computePositionFromTransactions(transactions: TxRow[]) {
  let quantity = 0;
  let costBasis = 0;

  for (const tx of transactions) {
    const qty = tx.quantity;
    const price = tx.price;
    const fees = tx.fee + tx.tax;

    if (tx.type === "BUY") {
      costBasis += qty * price + fees;
      quantity += qty;
    } else if (tx.type === "SELL") {
      if (quantity > 0) {
        const avgCost = costBasis / quantity;
        costBasis -= avgCost * qty;
        quantity -= qty;
      }
    } else if (tx.type === "DIVIDEND") {
      costBasis -= qty * price;
    }
  }

  const avgCost = quantity > 0 ? costBasis / quantity : 0;
  return { quantity, costBasis, avgCost };
}

export async function getHoldings(): Promise<HoldingPosition[]> {
  const instruments = await prisma.instrument.findMany({
    include: {
      transactions: {
        orderBy: { date: "asc" },
        include: { account: true },
      },
      tags: { include: { tag: true } },
    },
  });

  const symbols = instruments.map((i) => i.symbol);
  const quotes = await getQuotes(symbols);

  const positions: HoldingPosition[] = [];
  const currencyUpdates: { id: string; currency: string }[] = [];

  for (const inst of instruments) {
    const securityTxs = inst.transactions.filter(
      (t) => t.type === "BUY" || t.type === "SELL" || t.type === "DIVIDEND",
    );

    const txs = securityTxs.map((t) => ({
      type: t.type,
      quantity: toNumber(t.quantity),
      price: toNumber(t.price),
      fee: toNumber(t.fee),
      tax: toNumber(t.tax),
    }));

    const quote = quotes.get(inst.symbol);
    const currency = inferInstrumentCurrency(
      inst.symbol,
      inst.currency,
      quote?.currency,
    );
    if (currency !== inst.currency) {
      currencyUpdates.push({ id: inst.id, currency });
    }

    const marketFromQuote =
      quote?.price && quote.price > 0 ? quote.price : 0;
    const firstBuy = securityTxs.find((t) => t.type === "BUY");
    const fallbackPrice = firstBuy
      ? toNumber(firstBuy.price)
      : computePositionFromTransactions(txs).avgCost;
    const marketPriceResolved =
      marketFromQuote > 0
        ? marketFromQuote
        : fallbackPrice > 0
          ? fallbackPrice
          : 0;

    const pnl = await computeInstrumentPnl(
      mapSecurityTransactionsToPnlInput(
        securityTxs.map((t) => ({
          date: t.date,
          type: t.type,
          quantity: toNumber(t.quantity),
          price: toNumber(t.price),
          fee: toNumber(t.fee),
          tax: toNumber(t.tax),
          currency: t.account.currency,
        })),
      ),
      marketPriceResolved,
      currency,
    );

    const quantity = pnl.quantity;
    if (quantity <= 0.0000001) continue;

    const costBasis = await fromBaseCurrency(pnl.openCostBasis, currency);
    const avgCost = quantity > 0 ? costBasis / quantity : 0;

    const byAccount = new Map<string, { id: string; name: string; txs: TxRow[] }>();
    for (const t of securityTxs) {
      const entry = byAccount.get(t.accountId) ?? {
        id: t.accountId,
        name: t.account.name,
        txs: [],
      };
      entry.txs.push({
        type: t.type,
        quantity: toNumber(t.quantity),
        price: toNumber(t.price),
        fee: toNumber(t.fee),
        tax: toNumber(t.tax),
      });
      byAccount.set(t.accountId, entry);
    }

    const accounts: HoldingPosition["accounts"] = [];
    const accountIds: string[] = [];
    for (const [, acc] of byAccount) {
      const pos = computePositionFromTransactions(acc.txs);
      if (pos.quantity > 0.0000001) {
        accounts.push({
          id: acc.id,
          name: acc.name,
          quantity: pos.quantity,
        });
        accountIds.push(acc.id);
      }
    }

    const marketValue = quantity * marketPriceResolved;
    const marketValueBase = pnl.marketValue;
    const unrealizedPnl = pnl.unrealizedPnl;
    const unrealizedPnlPct = pnl.unrealizedPnlPct;
    const dayChange = (quote?.change ?? 0) * quantity;

    positions.push({
      instrumentId: inst.id,
      symbol: inst.symbol,
      name: inst.name,
      assetClass: inst.assetClass,
      currency,
      quantity,
      avgCost,
      costBasis,
      marketPrice: marketPriceResolved,
      marketValue,
      marketValueBase,
      unrealizedPnl,
      unrealizedPnlPct,
      dayChangePct: quote?.changePercent ?? null,
      dayChange,
      previousClose: quote?.previousClose ?? null,
      tags: inst.tags.map((t) => t.tag.name),
      weight: 0,
      accountIds,
      accounts,
    });
  }

  const securitiesTotal = positions.reduce((s, p) => s + p.marketValueBase, 0);
  const [cashMap, dbAccounts] = await Promise.all([
    computeAllAccountsCash(),
    prisma.account.findMany(),
  ]);
  let portfolioCashBase = 0;
  for (const acc of dbAccounts) {
    const cashBalance = cashMap.get(acc.id) ?? 0;
    portfolioCashBase += await toBaseCurrency(cashBalance, acc.currency);
  }
  const totalValue = securitiesTotal + portfolioCashBase;
  for (const p of positions) {
    p.weight = totalValue > 0 ? p.marketValueBase / totalValue : 0;
  }

  await Promise.all(
    currencyUpdates.map(({ id, currency }) =>
      prisma.instrument.update({ where: { id }, data: { currency } }),
    ),
  );

  return positions.sort((a, b) => b.marketValueBase - a.marketValueBase);
}

export async function getPortfolioSummary(
  existingHoldings?: HoldingPosition[],
): Promise<PortfolioSummary> {
  const accounts = await prisma.account.findMany();
  const holdings = existingHoldings ?? (await getHoldings());
  const usdRate = await getUsdToTwdRate();

  const toBase = async (value: number, currency: string | null) =>
    toBaseCurrency(value, currency);

  let totalMarketValue = 0;
  let totalCostBasis = 0;
  let todayChange = 0;

  for (const h of holdings) {
    totalMarketValue += h.marketValueBase;
    totalCostBasis += await toBase(h.costBasis, h.currency);
    todayChange += await toBase(h.dayChange, h.currency);
  }

  const totalUnrealizedPnl = totalMarketValue - totalCostBasis;
  const totalUnrealizedPnlPct =
    totalCostBasis > 0 ? totalUnrealizedPnl / totalCostBasis : 0;

  const cashByAccount = await import("@/lib/accounts").then((m) =>
    m.computeAllAccountsCash(),
  );
  let cash = 0;

  const byAccount = new Map<
    string,
    { name: string; marketValue: number; costBasis: number; todayChange: number }
  >();
  for (const acc of accounts) {
    byAccount.set(acc.id, {
      name: acc.name,
      marketValue: 0,
      costBasis: 0,
      todayChange: 0,
    });
  }

  for (const h of holdings) {
    const costBasisBase = await toBase(h.costBasis, h.currency);
    const dayChangeBase = await toBase(h.dayChange, h.currency);
    for (const acc of h.accounts) {
      const ratio = h.quantity > 0 ? acc.quantity / h.quantity : 0;
      const row = byAccount.get(acc.id);
      if (!row) continue;
      row.marketValue += h.marketValueBase * ratio;
      row.costBasis += costBasisBase * ratio;
      row.todayChange += dayChangeBase * ratio;
    }
  }

  const accountSummaries: AccountPerformance[] = [];
  for (const acc of accounts) {
    const row = byAccount.get(acc.id)!;
    const cashBalance = cashByAccount.get(acc.id) ?? 0;
    const cashBase = await toBase(cashBalance, acc.currency);
    cash += cashBase;
    const unrealizedPnl = row.marketValue - row.costBasis;
    const unrealizedPnlPct =
      row.costBasis > 0 ? unrealizedPnl / row.costBasis : 0;
    const prevValue = row.marketValue - row.todayChange;
    const todayChangePct = prevValue > 0 ? row.todayChange / prevValue : 0;
    accountSummaries.push({
      accountId: acc.id,
      name: row.name,
      marketValue: row.marketValue,
      cash: cashBase,
      totalAssets: row.marketValue + cashBase,
      todayChange: row.todayChange,
      todayChangePct,
      unrealizedPnl,
      unrealizedPnlPct,
    });
  }

  const todayChangePct = totalMarketValue - todayChange > 0
    ? todayChange / (totalMarketValue - todayChange)
    : 0;
  const byClass = new Map<string, number>();
  for (const h of holdings) {
    byClass.set(h.assetClass, (byClass.get(h.assetClass) ?? 0) + h.marketValueBase);
  }

  const byTag = new Map<string, number>();
  for (const h of holdings) {
    const baseValue = h.marketValueBase;
    const tagList = h.tags.length > 0 ? h.tags : ["untagged"];
    const share = baseValue / tagList.length;
    for (const tag of tagList) {
      byTag.set(tag, (byTag.get(tag) ?? 0) + share);
    }
  }

  const totalAssetsForPct = totalMarketValue + cash;
  if (cash > 0) {
    byClass.set("現金", (byClass.get("現金") ?? 0) + cash);
  }
  const toAllocation = (map: Map<string, number>) =>
    [...map.entries()]
      .map(([name, value]) => ({
        name,
        value,
        pct: totalAssetsForPct > 0 ? value / totalAssetsForPct : 0,
      }))
      .sort((a, b) => b.value - a.value);

  const allocationByHolding = holdings.map((h) => ({
    name: h.symbol,
    value: h.marketValueBase,
    pct: totalAssetsForPct > 0 ? h.marketValueBase / totalAssetsForPct : 0,
  }));

  return {
    baseCurrency: BASE_CURRENCY,
    usdToTwdRate: usdRate,
    totalMarketValue,
    totalCostBasis,
    totalUnrealizedPnl,
    totalUnrealizedPnlPct,
    todayChange,
    todayChangePct,
    cash,
    holdingsCount: holdings.length,
    accountSummaries,
    allocationByAssetClass: toAllocation(byClass),
    allocationByTag: toAllocation(byTag),
    allocationByHolding,
  };
}

export async function getQuotesForHoldings(): Promise<Map<string, QuoteResult>> {
  const holdings = await getHoldings();
  return getQuotes(holdings.map((h) => h.symbol));
}

export type TodayChangeRow = {
  accountId: string;
  name: string;
  change: number;
  changePct: number;
  marketValue: number;
};

export async function getTodayChangeBreakdown(): Promise<{
  overall: { change: number; changePct: number; marketValue: number };
  accounts: TodayChangeRow[];
}> {
  const [holdings, dbAccounts] = await Promise.all([
    getHoldings(),
    prisma.account.findMany({ orderBy: { name: "asc" } }),
  ]);
  const usdRate = await getUsdToTwdRate();

  const byAccount = new Map<
    string,
    { name: string; change: number; marketValue: number }
  >();
  for (const acc of dbAccounts) {
    byAccount.set(acc.id, { name: acc.name, change: 0, marketValue: 0 });
  }

  for (const h of holdings) {
    const fx = h.currency === "USD" ? usdRate : 1;
    const changeBase = h.dayChange * fx;
    for (const acc of h.accounts) {
      const ratio = h.quantity > 0 ? acc.quantity / h.quantity : 0;
      const row = byAccount.get(acc.id);
      if (!row) continue;
      row.change += changeBase * ratio;
      row.marketValue += h.marketValueBase * ratio;
    }
  }

  const accounts: TodayChangeRow[] = [];
  let totalChange = 0;
  let totalMarket = 0;

  for (const acc of dbAccounts) {
    const row = byAccount.get(acc.id)!;
    const prevValue = row.marketValue - row.change;
    const changePct = prevValue > 0 ? row.change / prevValue : 0;
    accounts.push({
      accountId: acc.id,
      name: row.name,
      change: row.change,
      changePct,
      marketValue: row.marketValue,
    });
    totalChange += row.change;
    totalMarket += row.marketValue;
  }

  const overallPrev = totalMarket - totalChange;
  return {
    overall: {
      change: totalChange,
      changePct: overallPrev > 0 ? totalChange / overallPrev : 0,
      marketValue: totalMarket,
    },
    accounts,
  };
}
