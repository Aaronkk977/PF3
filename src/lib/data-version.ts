import { createHash } from "crypto";
import { prisma } from "@/lib/db";

/** 「交易／帳戶資料有沒有變過」的判斷，server 端兩層快取共用：
 *  - PerformanceSnapshot（performance-cache.ts）：整份比對 getDataFingerprint()
 *  - PortfolioValueSnapshot（portfolio-value-cache.ts）：用 getTransactionMeta()
 *    與 getTransactionChangesSince() 判斷能不能沿用並往後增量延伸 */

export type TransactionMeta = {
  txCount: number;
  maxTxDate: string;
  maxUpdatedAt: string;
};

export async function getTransactionMeta(): Promise<TransactionMeta> {
  const agg = await prisma.transaction.aggregate({
    _count: true,
    _max: { date: true, updatedAt: true },
  });
  const maxTxDate = agg._max.date
    ? agg._max.date.toISOString().slice(0, 10)
    : "";
  return {
    txCount: agg._count,
    maxTxDate,
    maxUpdatedAt: agg._max.updatedAt?.toISOString() ?? "",
  };
}

/** 從 since 之後有變動的交易：拆成「既有交易被原地編輯」跟「新增的交易」。
 *  前者不管日期都會讓已算好的市值序列失準；後者只要日期不早於快取尾端，
 *  增量延伸就能正確納入。 */
export async function getTransactionChangesSince(since: string): Promise<{
  editedCount: number;
  addedDates: Date[];
}> {
  const sinceDate = new Date(since);
  const rows = await prisma.transaction.findMany({
    where: { updatedAt: { gt: sinceDate } },
    select: { date: true, createdAt: true },
  });
  let editedCount = 0;
  const addedDates: Date[] = [];
  for (const r of rows) {
    if (r.createdAt > sinceDate) addedDates.push(r.date);
    else editedCount++;
  }
  return { editedCount, addedDates };
}

/** 交易／帳戶任何一筆被新增、刪除或原地編輯，指紋都會變。筆數抓新增刪除，
 *  max(updatedAt) 抓原地編輯（改舊交易的數量／單價時筆數跟最大日期都不變，
 *  只靠前兩者會繼續回傳過期快取）。股票分割是直接改寫交易，同樣會反映在
 *  updatedAt 上。MCP server 的 get_performance 也用這支判斷新鮮度。 */
export async function getDataFingerprint(): Promise<string> {
  const [txMeta, accountAgg] = await Promise.all([
    getTransactionMeta(),
    prisma.account.aggregate({
      _count: true,
      _sum: { cash: true },
      _max: { updatedAt: true },
    }),
  ]);
  const raw = [
    txMeta.txCount,
    txMeta.maxTxDate,
    txMeta.maxUpdatedAt,
    accountAgg._count,
    accountAgg._sum.cash?.toString() ?? "0",
    accountAgg._max.updatedAt?.toISOString() ?? "",
  ].join(":");
  return createHash("sha256").update(raw).digest("hex").slice(0, 16);
}
