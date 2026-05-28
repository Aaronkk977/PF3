/**
 * 修正舊匯入把「日曆 0 點」存成 UTC 前一日 16:00 的問題。
 * 執行：npx tsx scripts/repair-transaction-dates.ts
 */
import { PrismaClient } from "@prisma/client";
import {
  isLegacyLocalMidnightUtc,
  normalizeStoredTransactionDate,
  toCalendarDateKey,
} from "../src/lib/date-keys";

const prisma = new PrismaClient();

async function main() {
  const txs = await prisma.transaction.findMany({ select: { id: true, date: true } });
  let fixed = 0;

  for (const tx of txs) {
    const before = toCalendarDateKey(tx.date);
    const next = normalizeStoredTransactionDate(tx.date);
    const after = toCalendarDateKey(next);

    if (before !== after || isLegacyLocalMidnightUtc(tx.date)) {
      await prisma.transaction.update({
        where: { id: tx.id },
        data: { date: next },
      });
      fixed++;
    }
  }

  console.log(`Checked ${txs.length} transaction(s), updated ${fixed}.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
