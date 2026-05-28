import { PrismaClient } from "@prisma/client";
import { toLocalDateKey } from "../src/lib/date-keys";
import { aggregatePeriodRealizedPnl } from "../src/lib/performance-realized-pnl";
import { toNumber } from "../src/lib/utils";

const prisma = new PrismaClient();

const PERIOD_START = new Date("2026-04-27T00:00:00");
const PERIOD_END = new Date("2026-05-18T23:59:59");
const BROKER = 49192;

type Lot = { qty: number; cost: number };

async function avgCostRealized(accountId: string, includeDivCut: boolean) {
  const txs = await prisma.transaction.findMany({
    where: { accountId, date: { lte: PERIOD_END } },
    include: { instrument: true },
    orderBy: { date: "asc" },
  });

  const state = new Map<string, { qty: number; totalCost: number }>();
  let realized = 0;
  const inPeriod = (d: Date) => d >= PERIOD_START && d <= PERIOD_END;

  for (const raw of txs) {
    if (!raw.instrumentId) continue;
    const id = raw.instrumentId;
    const qty = toNumber(raw.quantity);
    const price = toNumber(raw.price);
    const fee = toNumber(raw.fee);
    const tax = toNumber(raw.tax);
    const s = state.get(id) ?? { qty: 0, totalCost: 0 };

    if (raw.type === "BUY" && qty > 0) {
      s.totalCost += qty * price + fee + tax;
      s.qty += qty;
    } else if (raw.type === "SELL" && qty > 0) {
      const avg = s.qty > 0 ? s.totalCost / s.qty : 0;
      const matched = avg * qty;
      if (inPeriod(raw.date)) {
        realized += qty * price - fee - tax - matched;
      }
      s.totalCost -= matched;
      s.qty -= qty;
      if (s.qty <= 0.0000001) {
        s.qty = 0;
        s.totalCost = 0;
      }
    } else if (raw.type === "DIVIDEND" && qty > 0 && includeDivCut) {
      s.totalCost = Math.max(0, s.totalCost - qty * price);
    }
    state.set(id, s);
  }
  return realized;
}

async function fifoVariants(accountId: string) {
  const variants: Record<string, number> = {};

  for (const [label, opts] of [
    ["gross_no_div", { mode: "gross" as const, div: false, netSell: false, netBuy: false }],
    ["gross_div", { mode: "gross" as const, div: true, netSell: false, netBuy: false }],
    ["net_sell", { mode: "gross" as const, div: false, netSell: true, netBuy: false }],
    ["net_full", { mode: "gross" as const, div: false, netSell: true, netBuy: true }],
    ["gross_plus_sell_fee_tax", { mode: "gross" as const, div: false, netSell: false, netBuy: false, addSellCharges: true }],
  ] as const) {
    const txs = await prisma.transaction.findMany({
      where: { accountId, date: { lte: PERIOD_END } },
      include: { instrument: true },
      orderBy: { date: "asc" },
    });
    const lots = new Map<string, Lot[]>();
    let realized = 0;
    const inPeriod = (d: Date) => d >= PERIOD_START && d <= PERIOD_END;

    for (const raw of txs) {
      if (!raw.instrumentId) continue;
      const qty = toNumber(raw.quantity);
      const price = toNumber(raw.price);
      const fee = toNumber(raw.fee);
      const tax = toNumber(raw.tax);
      const lotsArr = lots.get(raw.instrumentId) ?? [];

      if (raw.type === "BUY" && qty > 0) {
        const cost = opts.netBuy ? qty * price + fee + tax : qty * price;
        lotsArr.push({ qty, cost });
      } else if (raw.type === "SELL" && qty > 0) {
        let remaining = qty;
        let matched = 0;
        while (remaining > 0 && lotsArr.length > 0) {
          const lot = lotsArr[0]!;
          const used = Math.min(remaining, lot.qty);
          const slice = (lot.cost / lot.qty) * used;
          matched += slice;
          lot.cost -= slice;
          lot.qty -= used;
          remaining -= used;
          if (lot.qty <= 0.0000001) lotsArr.shift();
        }
        if (inPeriod(raw.date)) {
          let proceeds = qty * price;
          if (opts.netSell) proceeds -= fee + tax;
          realized += proceeds - matched;
          if ("addSellCharges" in opts && opts.addSellCharges) {
            realized += fee + tax;
          }
        }
      } else if (raw.type === "DIVIDEND" && qty > 0 && opts.div) {
        let rem = qty * price;
        for (const lot of lotsArr) {
          if (rem <= 0) break;
          const cut = Math.min(lot.cost, rem);
          lot.cost -= cut;
          rem -= cut;
        }
      }
      lots.set(raw.instrumentId, lotsArr);
    }
    variants[label] = Math.round(realized);
  }
  return variants;
}

async function main() {
  const tw = await prisma.account.findFirst({
    where: { OR: [{ currency: "TWD" }, { name: { contains: "台" } }] },
  });
  if (!tw) throw new Error("no TW account");

  const agg = await aggregatePeriodRealizedPnl(PERIOD_START, PERIOD_END, [tw.id]);
  const excl427Start = new Date("2026-04-28T00:00:00");
  const agg428 = await aggregatePeriodRealizedPnl(excl427Start, PERIOD_END, [tw.id]);

  console.log("TW:", tw.name);
  console.log("Broker target:", BROKER);
  console.log("\nFIFO from module 4/27+:", Math.round(agg.realizedPnl));
  console.log("FIFO from module 4/28+:", Math.round(agg428.realizedPnl), "(user ~42642?)");

  const variants = await fifoVariants(tw.id);
  console.log("\nFIFO variants:");
  for (const [k, v] of Object.entries(variants)) {
    console.log(`  ${k}: ${v} (delta broker: ${BROKER - v})`);
  }

  const avgNet = await avgCostRealized(tw.id, false);
  const avgDiv = await avgCostRealized(tw.id, true);
  console.log("\nAverage cost net sell:", Math.round(avgNet));
  console.log("\nAverage cost + div cut:", Math.round(avgDiv));

  // Sum broker-style per sell: (sell price - avg cost at sell) * qty, net of fees on sell only
  const txs = await prisma.transaction.findMany({
    where: { accountId: tw.id, date: { lte: PERIOD_END } },
    include: { instrument: true },
    orderBy: { date: "asc" },
  });
  const state = new Map<string, { qty: number; totalCost: number }>();
  let brokerStyle = 0;
  const inPeriod = (d: Date) => d >= PERIOD_START && d <= PERIOD_END;

  for (const raw of txs) {
    if (!raw.instrumentId || !raw.instrument) continue;
    const id = raw.instrumentId;
    const qty = toNumber(raw.quantity);
    const price = toNumber(raw.price);
    const s = state.get(id) ?? { qty: 0, totalCost: 0 };

    if (raw.type === "BUY" && qty > 0) {
      s.totalCost += qty * price;
      s.qty += qty;
    } else if (raw.type === "SELL" && qty > 0) {
      const avg = s.qty > 0 ? s.totalCost / s.qty : price;
      if (inPeriod(raw.date)) {
        brokerStyle += (price - avg) * qty;
      }
      const matched = avg * qty;
      s.totalCost -= matched;
      s.qty -= qty;
    }
    state.set(id, s);
  }
  console.log("\nAvg cost gross (price-avg)*qty:", Math.round(brokerStyle));

  // Check sells before period that consume lots affecting... no that's for period sells only

  // List unmatched sells (no lots)
  const lots2 = new Map<string, Lot[]>();
  let unmatchedPnl = 0;
  for (const raw of txs) {
    if (!raw.instrumentId) continue;
    const qty = toNumber(raw.quantity);
    const price = toNumber(raw.price);
    const lotsArr = lots2.get(raw.instrumentId) ?? [];
    if (raw.type === "BUY" && qty > 0) {
      lotsArr.push({ qty, cost: qty * price });
    } else if (raw.type === "SELL" && qty > 0) {
      let remaining = qty;
      let matched = 0;
      while (remaining > 0 && lotsArr.length > 0) {
        const lot = lotsArr[0]!;
        const used = Math.min(remaining, lot.qty);
        const slice = (lot.cost / lot.qty) * used;
        matched += slice;
        lot.cost -= slice;
        lot.qty -= used;
        remaining -= used;
        if (lot.qty <= 0.0000001) lotsArr.shift();
      }
      if (inPeriod(raw.date) && remaining > 0.0001) {
        const extra = remaining * price;
        unmatchedPnl += extra;
        console.log("UNMATCHED", toLocalDateKey(raw.date), raw.instrument?.symbol, "qty", remaining, "extra proceeds", extra);
      }
    }
    lots2.set(raw.instrumentId, lotsArr);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
