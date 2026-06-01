import { TradesClient } from "@/components/portfolio/trades-client";
import { computeAllAccountsCash } from "@/lib/accounts";
import { prisma } from "@/lib/db";
import { STANDARD_ACCOUNTS } from "@/lib/standard-accounts";

export const dynamic = "force-dynamic";

export default async function TradesPage() {
  const accounts = await prisma.account.findMany({
    orderBy: { name: "asc" },
  });

  const end = new Date();
  const start = new Date(end.getFullYear() - 1, end.getMonth(), end.getDate());

  const earliestTx = await prisma.transaction.findFirst({
    orderBy: { date: "asc" },
    select: { date: true },
  });
  const portfolioEarliest = earliestTx
    ? earliestTx.date.toISOString().slice(0, 10)
    : start.toISOString().slice(0, 10);

  const cashMap = await computeAllAccountsCash();
  const accountOptions = accounts.map((a) => {
    const std = STANDARD_ACCOUNTS.find((s) => s.name === a.name);
    return {
      id: a.id,
      name: a.name,
      currency: a.currency,
      color: std?.color ?? "#00f0ff",
      cash: cashMap.get(a.id) ?? 0,
    };
  });

  return (
    <TradesClient
      accounts={accountOptions}
      defaultStart={start.toISOString().slice(0, 10)}
      defaultEnd={end.toISOString().slice(0, 10)}
      portfolioEarliest={portfolioEarliest}
    />
  );
}
