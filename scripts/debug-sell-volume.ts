import { PrismaClient } from "@prisma/client";
import { toLocalDateKey } from "../src/lib/date-keys";
import { toNumber } from "../src/lib/utils";

const prisma = new PrismaClient();

async function main() {
  const tw = await prisma.account.findFirst({ where: { currency: "TWD" } });
  const sells = await prisma.transaction.findMany({
    where: {
      accountId: tw!.id,
      type: "SELL",
      date: { gte: new Date("2026-04-27"), lte: new Date("2026-05-18T23:59:59") },
    },
  });
  let gross = 0;
  let fee = 0;
  let tax = 0;
  for (const s of sells) {
    gross += toNumber(s.quantity) * toNumber(s.price);
    fee += toNumber(s.fee);
    tax += toNumber(s.tax);
  }
  console.log("sell count", sells.length);
  console.log("gross volume", Math.round(gross));
  console.log("fees", fee, "tax", tax);
  console.log("tax/gross", (tax / gross * 100).toFixed(3), "%");
  console.log("net proceeds", Math.round(gross - fee - tax));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
