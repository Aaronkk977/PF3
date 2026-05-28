import { BASE_CURRENCY, toBaseCurrency } from "@/lib/fx";

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

export async function computeInstrumentPnl(
  transactions: InstrumentTxInput[],
  marketPrice: number,
  instrumentCurrency: string,
): Promise<InstrumentPnlSummary> {
  const sorted = [...transactions].sort(
    (a, b) => a.date.getTime() - b.date.getTime(),
  );

  const lots: { qty: number; costBase: number }[] = [];
  let realizedPnl = 0;
  let realizedCostBasis = 0;

  for (const tx of sorted) {
    const qty = tx.quantity;
    const price = tx.price;
    const fee = tx.fee;
    const tax = tx.tax;

    if (tx.type === "BUY" && qty > 0) {
      const costBase = await toBaseCurrency(
        qty * price + fee + tax,
        tx.currency,
      );
      lots.push({ qty, costBase });
      continue;
    }

    if (tx.type === "SELL" && qty > 0) {
      let remaining = qty;
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

      const proceedsBase = await toBaseCurrency(
        qty * price - fee - tax,
        tx.currency,
      );
      realizedCostBasis += matchedCostBase;
      realizedPnl += proceedsBase - matchedCostBase;
      continue;
    }

    if (tx.type === "DIVIDEND" && qty > 0) {
      const divBase = await toBaseCurrency(qty * price, tx.currency);
      let remaining = divBase;
      for (const lot of lots) {
        if (remaining <= 0) break;
        const cut = Math.min(lot.costBase, remaining);
        lot.costBase -= cut;
        remaining -= cut;
      }
    }
  }

  const quantity = lots.reduce((s, l) => s + l.qty, 0);
  const openCostBasis = lots.reduce((s, l) => s + l.costBase, 0);
  const marketValue =
    quantity > 0 && marketPrice > 0
      ? await toBaseCurrency(quantity * marketPrice, instrumentCurrency)
      : 0;
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
