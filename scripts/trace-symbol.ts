import { PrismaClient } from "@prisma/client";
import { toLocalDateKey } from "../src/lib/date-keys";
import { toNumber } from "../src/lib/utils";

const prisma = new PrismaClient();
const symbol = process.argv[2] ?? "0050.TW";

async function main() {
  const inst = await prisma.instrument.findUnique({ where: { symbol } });
  if (!inst) return console.log("not found");
  const txs = await prisma.transaction.findMany({
    where: { instrumentId: inst.id },
    include: { account: true },
    orderBy: { date: "asc" },
  });
  console.log(symbol, "txs", txs.length);
  for (const t of txs) {
    console.log(
      toLocalDateKey(t.date),
      t.type,
      toNumber(t.quantity),
      toNumber(t.price),
      "fee",
      toNumber(t.fee),
      "tax",
      toNumber(t.tax),
      t.account.name,
    );
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
