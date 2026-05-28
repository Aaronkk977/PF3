import { PrismaClient } from "@prisma/client";
import { toLocalDateKey } from "../src/lib/date-keys";
import { toNumber } from "../src/lib/utils";

const prisma = new PrismaClient();

async function main() {
  const tw = await prisma.account.findFirst({ where: { currency: "TWD" } });
  const txs = await prisma.transaction.findMany({
    where: { accountId: tw!.id },
    include: { instrument: true },
    orderBy: { date: "asc" },
  });

  const seen = new Map<string, number>();
  for (const t of txs) {
    const key = `${toLocalDateKey(t.date)}|${t.instrument?.symbol}|${t.type}|${toNumber(t.quantity)}|${toNumber(t.price)}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  const dups = [...seen.entries()].filter(([, n]) => n > 1);
  console.log("duplicate keys", dups.length);
  for (const [k, n] of dups.slice(0, 20)) {
    console.log(n, k);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
