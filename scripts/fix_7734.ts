import { config } from "dotenv"; import path from "path";
config({ path: path.resolve(process.cwd(), ".env") });
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

function toNum(v: any): number {
  if (v == null) return 0;
  return typeof v === "object" && "toNumber" in v ? v.toNumber() : Number(v);
}

async function main() {
  // Find instrument and account
  const instrument = await prisma.instrument.findFirst({
    where: { symbol: { contains: "7734" } },
  });
  if (!instrument) { console.error("找不到 7734 instrument"); return; }
  console.log(`Instrument: ${instrument.id} ${instrument.symbol} ${instrument.name}`);

  const account = await prisma.account.findFirst({
    where: { name: { contains: "永豐" } },
  });
  if (!account) { console.error("找不到證券帳戶"); return; }
  console.log(`Account: ${account.id} ${account.name}`);

  // ── 1. 新增漏記的買進 ──
  const toAdd = [
    { date: new Date("2026-01-29"), qty: 1, price: 1245, fee: 1, tax: 0 },
    { date: new Date("2026-01-29"), qty: 1, price: 1210, fee: 1, tax: 0 },
    { date: new Date("2026-05-15"), qty: 1, price: 3900, fee: 5, tax: 0 },
  ];

  for (const t of toAdd) {
    const created = await prisma.transaction.create({
      data: {
        date: t.date,
        type: "BUY",
        quantity: t.qty,
        price: t.price,
        fee: t.fee,
        tax: t.tax,
        instrumentId: instrument.id,
        accountId: account.id,
      },
    });
    console.log(`✅ 新增: ${t.date.toISOString().slice(0,10)} 買進 ${t.qty}股 @${t.price}  id=${created.id}`);
  }

  // ── 2. 修正 03/03 價格 1745→1700 ──
  const tx0303 = await prisma.transaction.findFirst({
    where: {
      instrumentId: instrument.id,
      type: "BUY",
      date: new Date("2026-03-03"),
      quantity: 2,
    },
  });
  if (tx0303) {
    const oldPx = toNum(tx0303.price);
    await prisma.transaction.update({
      where: { id: tx0303.id },
      data: { price: 1700, fee: 4 },
    });
    console.log(`✅ 修正 03/03 價格: ${oldPx} → 1700  id=${tx0303.id}`);
  } else {
    console.warn("⚠️  找不到 03/03 2股買進記錄");
  }

  // ── 3. 修正 05/20 賣出 1股 價格 3165→3185 ──
  const tx0520sells = await prisma.transaction.findMany({
    where: {
      instrumentId: instrument.id,
      type: "SELL",
      date: new Date("2026-05-20"),
    },
  });
  // Find the 1-share sell (the wrong one)
  const tx0520_1 = tx0520sells.find(t => toNum(t.quantity) === 1);
  if (tx0520_1) {
    const oldPx = toNum(tx0520_1.price);
    await prisma.transaction.update({
      where: { id: tx0520_1.id },
      data: { price: 3185 },
    });
    console.log(`✅ 修正 05/20 賣出1股 價格: ${oldPx} → 3185  id=${tx0520_1.id}`);
  } else {
    console.warn("⚠️  找不到 05/20 1股賣出記錄");
  }

  await prisma.$disconnect();
  console.log("\n完成。請重新執行 check_7734_tmp.ts 確認結果。");
}
main();
