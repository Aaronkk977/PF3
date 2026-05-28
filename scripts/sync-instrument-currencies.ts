import { PrismaClient } from "@prisma/client";
import { inferInstrumentCurrency } from "../src/lib/instrument-currency";

const prisma = new PrismaClient();

async function main() {
  const instruments = await prisma.instrument.findMany();
  let updated = 0;
  for (const inst of instruments) {
    const currency = inferInstrumentCurrency(inst.symbol, inst.currency);
    if (currency !== inst.currency) {
      await prisma.instrument.update({
        where: { id: inst.id },
        data: { currency },
      });
      console.log(`${inst.symbol}: ${inst.currency ?? "null"} → ${currency}`);
      updated++;
    }
  }
  console.log(`Updated ${updated} / ${instruments.length} instruments`);
}

main().finally(() => prisma.$disconnect());
