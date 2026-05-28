import { PrismaClient } from "@prisma/client";
import { toLocalDateKey } from "../src/lib/date-keys";
import { toNumber } from "../src/lib/utils";

const prisma = new PrismaClient();
const START = "2026-04-27";
const END = "2026-05-18";

async function main() {
  const tw = await prisma.account.findFirst({ where: { currency: "TWD" } });
  const txs = await prisma.transaction.findMany({
    where: { accountId: tw!.id, date: { lte: new Date(`${END}T23:59:59`) } },
    orderBy: { date: "asc" },
  });
  const inP = (d: Date) => {
    const k = toLocalDateKey(d);
    return k >= START && k <= END;
  };

  type Lot = { qty: number; cost: number };
  const lots = new Map<string, Lot[]>();
  let r = 0;

  for (const raw of txs) {
    if (!raw.instrumentId) continue;
    const qty = toNumber(raw.quantity);
    const price = toNumber(raw.price);
    const fee = toNumber(raw.fee);
    const tax = toNumber(raw.tax);
    const arr = lots.get(raw.instrumentId) ?? [];

    if (raw.type === "BUY" && qty > 0) {
      arr.push({ qty, cost: qty * price + fee + tax });
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
      if (inP(raw.date)) {
        // broker proceeds = sell gross + sell fee + sell tax (all positive to investor?)
        r += qty * price + fee + tax - matched;
      }
    }
    // NO dividend cut
    lots.set(raw.instrumentId, arr);
  }
  console.log("gross cost, sell gross+fee+tax:", Math.round(r));
  console.log("broker", 49192, "delta", 49192 - Math.round(r));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
