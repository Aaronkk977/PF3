import { PrismaClient } from "@prisma/client";
import { toLocalDateKey } from "../src/lib/date-keys";
import { toNumber } from "../src/lib/utils";

const prisma = new PrismaClient();
const START = "2026-04-27";
const END = "2026-05-18";

async function main() {
  const tw = await prisma.account.findFirst({ where: { currency: "TWD" } });
  const txs = await prisma.transaction.findMany({
    where: { accountId: tw!.id },
    orderBy: { date: "asc" },
  });
  const inP = (d: Date) => {
    const k = toLocalDateKey(d);
    return k >= START && k <= END;
  };

  let sellGross = 0;
  let buyGross = 0;
  let sellNet = 0;
  let buyNet = 0;
  for (const t of txs) {
    if (!inP(t.date)) continue;
    const q = toNumber(t.quantity);
    const p = toNumber(t.price);
    const f = toNumber(t.fee);
    const tax = toNumber(t.tax);
    if (t.type === "SELL") {
      sellGross += q * p;
      sellNet += q * p - f - tax;
    }
    if (t.type === "BUY") {
      buyGross += q * p;
      buyNet += q * p + f + tax;
    }
  }
  console.log("period sell gross", Math.round(sellGross));
  console.log("period buy gross", Math.round(buyGross));
  console.log("sell - buy gross", Math.round(sellGross - buyGross));
  console.log("sell net - buy net", Math.round(sellNet - buyNet));
  console.log("broker", 49192);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
