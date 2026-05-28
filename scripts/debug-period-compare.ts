import { PrismaClient } from "@prisma/client";
import { aggregatePeriodRealizedPnl } from "../src/lib/performance-realized-pnl";

const prisma = new PrismaClient();

async function main() {
  const accounts = await prisma.account.findMany();
  const tw = accounts.find((a) => a.currency === "TWD")!;
  const end = new Date("2026-05-18T23:59:59");

  const r = await aggregatePeriodRealizedPnl(
    new Date("2026-04-27T12:00:00"),
    end,
    [tw.id],
    { periodStartKey: "2026-04-27", periodEndKey: "2026-05-18" },
  );
  console.log("TW 4/27-5/18 (date keys):", Math.round(r.realizedPnl));
  console.log("fees", Math.round(r.fees), "taxes", Math.round(r.taxes));
  console.log("broker", 49192, "gap", 49192 - Math.round(r.realizedPnl));

  const max = await prisma.transaction.aggregate({
    _max: { date: true },
    where: { accountId: tw.id },
  });
  console.log("latest TW tx in DB:", max._max.date);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
