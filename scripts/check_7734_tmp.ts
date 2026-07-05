import { config } from "dotenv"; import path from "path";
config({ path: path.resolve(process.cwd(), ".env") });
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

function toNum(v: any): number {
  if (v == null) return 0;
  return typeof v === "object" && "toNumber" in v ? v.toNumber() : Number(v);
}

async function main() {
  const txs = await prisma.transaction.findMany({
    where: {
      instrument: { symbol: { contains: "7734" } },
      type: { in: ["BUY", "SELL"] },
    },
    include: { instrument: true, account: { select: { name: true } } },
    orderBy: { date: "asc" },
  });

  console.log(`=== 7734 交易記錄 (共 ${txs.length} 筆) ===`);
  let totalBuyQty = 0, totalBuyAmt = 0;
  let totalSellQty = 0, totalSellAmt = 0;
  let costBasis = 0, heldQty = 0;

  for (const t of txs) {
    const qty = toNum(t.quantity);
    const px = toNum(t.price);
    const fee = toNum(t.fee);
    const tax = toNum(t.tax);
    const sign = t.type === "BUY" ? "買進" : "賣出";
    const amt = qty * px;
    console.log(`${t.date.toISOString().slice(0,10)}  ${sign}  ${qty}股  @${px}  金額:${Math.round(amt)}  手續費:${fee}  交易稅:${tax}${t.note ? "  備註:"+t.note : ""}`);

    if (t.type === "BUY") {
      totalBuyQty += qty; totalBuyAmt += amt + fee + tax;
      costBasis += amt + fee + tax; heldQty += qty;
    } else {
      totalSellQty += qty; totalSellAmt += amt - fee - tax;
      if (heldQty > 0) {
        const avgCost = costBasis / heldQty;
        costBasis -= avgCost * qty; heldQty -= qty;
      }
    }
  }

  console.log(`\n─── 統計 ───`);
  console.log(`買進：${txs.filter(t=>t.type==="BUY").length} 筆，${totalBuyQty} 股，合計 ${Math.round(totalBuyAmt)} 元`);
  console.log(`賣出：${txs.filter(t=>t.type==="SELL").length} 筆，${totalSellQty} 股，合計 ${Math.round(totalSellAmt)} 元`);
  console.log(`現持有（推算）：${Math.round(heldQty * 1000)/1000} 股`);
  if (heldQty > 0.001) {
    const avgCost = costBasis / heldQty;
    console.log(`持倉均成本：${Math.round(avgCost * 100)/100}`);
    console.log(`持倉成本總額：${Math.round(costBasis)} 元`);
  }
  const realizedPnl = totalSellAmt - (totalBuyAmt - costBasis);
  console.log(`已實現損益（估算）：${Math.round(realizedPnl)} 元`);

  await prisma.$disconnect();
}
main();
