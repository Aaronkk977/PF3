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
    include: { instrument: true },
    orderBy: { date: "asc" },
  });
  const lots = new Map<string, { qty: number; cost: number }[]>();
  const pnls: number[] = [];
  const inP = (d: Date) => {
    const k = toLocalDateKey(d);
    return k >= START && k <= END;
  };

  for (const raw of txs) {
    if (!raw.instrumentId) continue;
    const qty = toNumber(raw.quantity);
    const price = toNumber(raw.price);
    const arr = lots.get(raw.instrumentId) ?? [];
    if (raw.type === "BUY" && qty > 0) {
      arr.push({ qty, cost: qty * price });
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
        const pnl = qty * price - matched;
        pnls.push(pnl);
      }
    } else if (raw.type === "DIVIDEND" && qty > 0) {
      let rem = qty * price;
      for (const lot of arr) {
        if (rem <= 0) break;
        const cut = Math.min(lot.cost, rem);
        lot.cost -= cut;
        rem -= cut;
      }
    }
    lots.set(raw.instrumentId, arr);
  }

  const wins = pnls.filter((p) => p > 0);
  const losses = pnls.filter((p) => p < 0);
  console.log("total", Math.round(pnls.reduce((a, b) => a + b, 0)));
  console.log("wins only", Math.round(wins.reduce((a, b) => a + b, 0)));
  console.log("losses only", Math.round(losses.reduce((a, b) => a + b, 0)));
  console.log("wins count", wins.length, "loss count", losses.length);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
