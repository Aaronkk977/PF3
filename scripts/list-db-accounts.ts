import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const accounts = await prisma.account.findMany();
  for (const a of accounts) {
    const tx = await prisma.transaction.count({ where: { accountId: a.id } });
    console.log(`${a.name} (${a.id.slice(0, 8)}…) tx=${tx} cash=${a.cash}`);
  }
}

main().finally(() => prisma.$disconnect());
