import { prisma } from "@/lib/db";
import { toNumber } from "@/lib/utils";

const QUANTITY_EPSILON = 1e-7;

/** 特定帳戶＋標的目前持有股數（加總所有既有 BUY/SELL 交易，可排除指定交易＝編輯情境） */
export async function getHeldQuantity(
  accountId: string,
  instrumentId: string,
  excludeTransactionId?: string,
): Promise<number> {
  const rows = await prisma.transaction.findMany({
    where: {
      accountId,
      instrumentId,
      type: { in: ["BUY", "SELL"] },
      ...(excludeTransactionId ? { id: { not: excludeTransactionId } } : {}),
    },
    select: { type: true, quantity: true },
  });
  let qty = 0;
  for (const r of rows) {
    const q = toNumber(r.quantity);
    qty += r.type === "BUY" ? q : -q;
  }
  return qty;
}

/** 賣出數量若超過目前持有股數，回傳警告文字（非阻擋，供呼叫端自行決定如何提示）；否則回傳 null */
export function checkSellExceedsHolding(
  type: string,
  sellQuantity: number,
  heldQuantity: number,
): string | null {
  if (type !== "SELL") return null;
  if (sellQuantity <= heldQuantity + QUANTITY_EPSILON) return null;
  const overBy = sellQuantity - heldQuantity;
  return `此帳戶目前持有 ${heldQuantity.toLocaleString("zh-TW")} 股，這筆賣出 ${sellQuantity.toLocaleString("zh-TW")} 股將超賣 ${overBy.toLocaleString("zh-TW")} 股`;
}
