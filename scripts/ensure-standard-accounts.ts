/**
 * 建立三個標準帳戶，並將既有交易／現金合併到對應帳戶。
 * 執行：npm run accounts:ensure
 */
import { PrismaClient } from "@prisma/client";
import {
  matchLegacyAccountName,
  STANDARD_ACCOUNTS,
} from "../src/lib/standard-accounts";

const prisma = new PrismaClient();

async function main() {
  const idByStandardName = new Map<string, string>();

  for (const std of STANDARD_ACCOUNTS) {
    let account = await prisma.account.findFirst({ where: { name: std.name } });
    const feeDefaults =
      std.name === "美股（Firstrade）"
        ? {
            feeRateBps: 0,
            feeRateBpsBuy: 0,
            feeRateBpsSell: 0,
            taxRatePct: 0,
            taxRatePctBuy: 0,
            taxRatePctSell: 0,
          }
        : {};

    if (!account) {
      account = await prisma.account.create({
        data: { name: std.name, currency: std.currency, cash: 0, ...feeDefaults },
      });
      console.log(`建立帳戶：${std.name}`);
    } else {
      await prisma.account.update({
        where: { id: account.id },
        data: { currency: std.currency, ...feeDefaults },
      });
      console.log(`已有帳戶：${std.name}`);
    }
    idByStandardName.set(std.name, account.id);
  }

  const allAccounts = await prisma.account.findMany();
  let movedTx = 0;

  for (const acc of allAccounts) {
    const targetName = matchLegacyAccountName(acc.name);
    if (!targetName || acc.name === targetName) continue;

    const targetId = idByStandardName.get(targetName)!;
    const result = await prisma.transaction.updateMany({
      where: { accountId: acc.id },
      data: { accountId: targetId },
    });
    movedTx += result.count;

    const sourceCash = Number(acc.cash);
    if (sourceCash !== 0) {
      const target = await prisma.account.findUniqueOrThrow({
        where: { id: targetId },
      });
      await prisma.account.update({
        where: { id: targetId },
        data: { cash: Number(target.cash) + sourceCash },
      });
    }

    const remaining = await prisma.transaction.count({
      where: { accountId: acc.id },
    });
    if (remaining === 0 && acc.name !== targetName) {
      await prisma.account.delete({ where: { id: acc.id } });
      console.log(`刪除舊帳戶：${acc.name} → 併入 ${targetName}`);
    } else if (result.count > 0) {
      console.log(`搬移 ${result.count} 筆交易：${acc.name} → ${targetName}`);
    }
  }

  console.log(`共搬移 ${movedTx} 筆交易`);

  const orphans = await prisma.account.findMany({
    where: { name: { in: ["匯入帳戶", "預設帳戶"] } },
  });
  for (const o of orphans) {
    const tx = await prisma.transaction.count({ where: { accountId: o.id } });
    if (tx === 0) {
      await prisma.account.delete({ where: { id: o.id } });
      console.log(`刪除空帳戶：${o.name}`);
    }
  }

  const final = await prisma.account.findMany({ orderBy: { name: "asc" } });
  for (const a of final) {
    console.log(`  ${a.name} (${a.currency}) 現金 ${a.cash}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
