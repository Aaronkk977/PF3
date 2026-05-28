import { PrismaClient } from "@prisma/client";
import { getHoldings, getPortfolioSummary } from "../src/lib/portfolio-engine";
import { getUsdToTwdRate } from "../src/lib/fx";

const prisma = new PrismaClient();

async function main() {
  const summary = await getPortfolioSummary();
  const holdings = await getHoldings();
  const rate = await getUsdToTwdRate();

  console.log("USD/TWD:", rate);
  console.log("Summary TWD market:", summary.totalMarketValue);
  console.log("Summary TWD cash:", summary.cash);
  console.log("Total assets:", summary.totalMarketValue + summary.cash);

  let sumNative = 0;
  let sumTwd = 0;
  let zeroPrice = 0;

  for (const h of holdings.slice(0, 15)) {
    const twd =
      h.currency === "USD" ? h.marketValue * rate : h.marketValue;
    sumNative += h.marketValue;
    sumTwd += twd;
    if (h.marketPrice <= 0) zeroPrice++;
    console.log(
      `${h.symbol} qty=${h.quantity} px=${h.marketPrice} ${h.currency} mv=${h.marketValue.toFixed(0)} twd=${twd.toFixed(0)}`,
    );
  }

  console.log(`\nHoldings count: ${holdings.length}`);
  console.log(`Top 15 native sum (mixed currencies!): ${sumNative}`);
  console.log(`Top 15 TWD sum: ${sumTwd}`);
  console.log(`Zero price count (all): ${holdings.filter((h) => h.marketPrice <= 0).length}`);

  const noCurrency = await prisma.instrument.count({
    where: { OR: [{ currency: null }, { currency: "" }] },
  });
  console.log(`Instruments missing currency: ${noCurrency}`);
}

main().finally(() => prisma.$disconnect());
