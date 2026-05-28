import { PrismaClient } from "@prisma/client";
import { importLegacyCsvFile } from "../src/lib/legacy-csv-import";
import { resolve } from "path";

const prisma = new PrismaClient();

async function main() {
  const filePath = resolve(process.cwd(), "All_transactions.csv");

  console.log("清除既有交易與標的（保留標籤、基準、追蹤清單）...");
  await prisma.priceCache.deleteMany();
  await prisma.transaction.deleteMany();
  await prisma.tagOnInstrument.deleteMany();
  await prisma.instrument.deleteMany();

  console.log("匯入 All_transactions.csv ...");
  const result = await importLegacyCsvFile(filePath);

  console.log(`成功匯入 ${result.imported} 筆交易`);
  console.log(`入金 ${result.deposits} 筆、出金 ${result.withdrawals} 筆`);
  console.log(`略過 ${result.skipped} 筆`);
  if (result.errors.length > 0) {
    console.log(`錯誤 ${result.errors.length} 筆（前 10 筆）：`);
    result.errors.slice(0, 10).forEach((e) => {
      console.log(`  列 ${e.row}: ${e.message}`);
    });
  }

  const counts = await Promise.all([
    prisma.transaction.count(),
    prisma.instrument.count(),
    prisma.account.findFirst(),
  ]);
  console.log(`資料庫現有：${counts[1]} 檔標的、${counts[0]} 筆交易`);
  console.log(`帳戶現金：${counts[2]?.cash ?? 0}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
