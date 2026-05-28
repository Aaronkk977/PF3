import { PrismaClient } from "@prisma/client";
import { toLocalDateKey } from "../src/lib/date-keys";
import { toNumber } from "../src/lib/utils";

const prisma = new PrismaClient();
const START = "2026-04-27";
const END = "2026-05-18";
const BROKER = 49192;

function inP(d: Date) {
  const k = toLocalDateKey(d);
  return k >= START && k <= END;
}

type Lot = { qty: number; cost: number };

async function fifo(
  accountId: string,
  opts: {
    buyCost: (g: number, fee: number, tax: number) => number;
    sellProceeds: (g: number, fee: number, tax: number) => number;
    divCut: boolean;
  },
) {
  const txs = await prisma.transaction.findMany({
    where: { accountId, date: { lte: new Date(`${END}T23:59:59`) } },
    include: { instrument: true },
    orderBy: { date: "asc" },
  });
  const lots = new Map<string, Lot[]>();
  let r = 0;
  for (const raw of txs) {
    if (!raw.instrumentId) continue;
    const qty = toNumber(raw.quantity);
    const price = toNumber(raw.price);
    const fee = toNumber(raw.fee);
    const tax = toNumber(raw.tax);
    const g = qty * price;
    const arr = lots.get(raw.instrumentId) ?? [];
    if (raw.type === "BUY" && qty > 0) {
      arr.push({ qty, cost: opts.buyCost(g, fee, tax) });
    } else if (raw.type === "SELL" && qty > 0) {
      let rem = qty;
      let matched = 0;
      while (rem > 0 && arr.length) {
        const lot = arr[0]!;
        const used = Math.min(rem, lot.qty);
        const slice = (lot.cost / lot.qty) * used;
        matched += slice;
        lot.cost -= slice;
        lot.qty -= used;
        rem -= used;
        if (lot.qty <= 0.0000001) arr.shift();
      }
      if (inP(raw.date)) r += opts.sellProceeds(g, fee, tax) - matched;
    } else if (raw.type === "DIVIDEND" && qty > 0 && opts.divCut) {
      let rem = g;
      for (const lot of arr) {
        if (rem <= 0) break;
        const cut = Math.min(lot.cost, rem);
        lot.cost -= cut;
        rem -= cut;
      }
    }
    lots.set(raw.instrumentId, arr);
  }
  return Math.round(r);
}

async function main() {
  const tw = await prisma.account.findFirst({ where: { currency: "TWD" } });
  if (!tw) return;

  const formulas: [string, Parameters<typeof fifo>[1]][] = [
    ["gross/gross+div", { buyCost: (g) => g, sellProceeds: (g) => g, divCut: true }],
    ["gross/gross no div", { buyCost: (g) => g, sellProceeds: (g) => g, divCut: false }],
    ["net buy/gross sell", { buyCost: (g, f, t) => g + f + t, sellProceeds: (g) => g, divCut: false }],
    ["net buy/net sell", { buyCost: (g, f, t) => g + f + t, sellProceeds: (g, f, t) => g - f - t, divCut: false }],
    ["gross buy/gross sell", { buyCost: (g) => g, sellProceeds: (g) => g, divCut: false }],
    ["gross buy/gross+fee sell", { buyCost: (g) => g, sellProceeds: (g, f) => g + f, divCut: false }],
    ["gross buy/gross+fee+tax sell", { buyCost: (g) => g, sellProceeds: (g, f, t) => g + f + t, divCut: false }],
    ["net buy/gross+tax sell", { buyCost: (g, f, t) => g + f + t, sellProceeds: (g, f, t) => g + t, divCut: false }],
    ["net buy/gross+fee+tax sell", { buyCost: (g, f, t) => g + f + t, sellProceeds: (g, f, t) => g + f + t, divCut: false }],
  ];

  console.log("Broker:", BROKER);
  for (const [name, opts] of formulas) {
    const v = await fifo(tw.id, opts);
    const delta = BROKER - v;
    const mark = Math.abs(delta) < 100 ? " <--" : "";
    console.log(`${name}: ${v} (delta ${delta})${mark}`);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
