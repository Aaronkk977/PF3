/**
 * 清除 Firstrade 買賣錯誤自動帶入的手續費（股息稅保留）
 * 執行：npx tsx scripts/fix-firstrade-trade-fees.ts
 */
import { PrismaClient } from "@prisma/client";
import { matchLegacyAccountName, STANDARD_ACCOUNTS } from "../src/lib/standard-accounts";
import { reconcileAccountCash } from "../src/lib/accounts";
import { invalidatePerformanceCache } from "../src/lib/performance-cache";

const prisma = new PrismaClient();

async function main() {
  const firstradeName = STANDARD_ACCOUNTS[1].name;
  const accounts = await prisma.account.findMany();
  const usAccounts = accounts.filter(
    (a) => (matchLegacyAccountName(a.name) ?? a.name) === firstradeName,
  );

  if (usAccounts.length === 0) {
    console.log("找不到美股帳戶");
    return;
  }

  for (const acc of usAccounts) {
    await prisma.account.update({
      where: { id: acc.id },
      data: {
        feeRateBps: 0,
        feeRateBpsBuy: 0,
        feeRateBpsSell: 0,
        taxRatePct: 0,
        taxRatePctBuy: 0,
        taxRatePctSell: 0,
      },
    });

    const result = await prisma.transaction.updateMany({
      where: {
        accountId: acc.id,
        type: { in: ["BUY", "SELL"] },
        fee: { not: 0 },
      },
      data: { fee: 0 },
    });

    await reconcileAccountCash(acc.id);
    console.log(`${acc.name}: 已清除 ${result.count} 筆買賣手續費`);
  }

  await invalidatePerformanceCache();
  console.log("完成");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
