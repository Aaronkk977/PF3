import { PrismaClient } from "@prisma/client";
import { toNumber } from "../src/lib/utils";

const prisma = new PrismaClient();

async function main() {
  const us = await prisma.account.findFirst({
    where: { name: { contains: "Firstrade" } },
  });
  if (!us) return console.log("no us account");
  console.log("Account:", us.name, {
    feeRateBps: us.feeRateBps,
    feeRateBpsBuy: us.feeRateBpsBuy,
    feeRateBpsSell: us.feeRateBpsSell,
    taxRatePct: us.taxRatePct,
  });

  const txs = await prisma.transaction.findMany({
    where: { accountId: us.id, type: { in: ["BUY", "SELL", "DIVIDEND"] } },
    include: { instrument: true },
    orderBy: { date: "desc" },
    take: 30,
  });

  let buySellWithFee = 0;
  let buySellFeeSum = 0;
  let divWithTax = 0;
  for (const t of txs) {
    const fee = toNumber(t.fee);
    const tax = toNumber(t.tax);
    if (t.type === "BUY" || t.type === "SELL") {
      if (fee > 0) {
        buySellWithFee++;
        buySellFeeSum += fee;
        console.log("FEE>0", t.type, t.instrument?.symbol, fee, tax);
      }
    }
    if (t.type === "DIVIDEND" && (fee > 0 || tax > 0)) {
      divWithTax++;
    }
  }
  console.log("\nRecent sample: buy/sell with fee>0:", buySellWithFee, "sum", buySellFeeSum);
  console.log("dividends with fee/tax:", divWithTax);

  const all = await prisma.transaction.findMany({
    where: { accountId: us.id, type: { in: ["BUY", "SELL"] } },
  });
  const withFee = all.filter((t) => toNumber(t.fee) > 0);
  console.log("Total BUY/SELL:", all.length, "with fee>0:", withFee.length);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
