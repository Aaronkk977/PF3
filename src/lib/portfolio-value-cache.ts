import { prisma } from "@/lib/db";
import type { CashFlowEvent } from "@/lib/portfolio-history";

export type PortfolioValueEndState = {
  date: string;
  txIdx: number;
  positions: Record<string, number>;
  cashByAccount: Record<string, number>;
  lastPriceBySymbol: Record<string, number>;
};

export type PortfolioValueCachePayload = {
  points: { date: string; value: number }[];
  cashFlows: CashFlowEvent[];
  endState: PortfolioValueEndState;
  periodStart: string;
  periodEnd: string;
  txCount: number;
  maxTxDate: string;
  /** 算這份快取當下所有交易的 max(updatedAt)（ISO）。舊版快取沒有這欄，
   *  一律視為過期重算一次。 */
  maxUpdatedAt?: string;
};

export type TransactionMeta = {
  txCount: number;
  maxTxDate: string;
  maxUpdatedAt: string;
};

export function buildPortfolioValueCacheKey(
  accountIds: string[] | string | undefined,
  periodStart: string,
): string {
  const ids = Array.isArray(accountIds)
    ? [...accountIds].sort()
    : accountIds
      ? accountIds.split(",").map((s) => s.trim()).filter(Boolean).sort()
      : [];
  const acc = ids.length ? ids.join(",") : "all";
  return `value|start:${periodStart}|acc:${acc}`;
}

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

export async function getPortfolioValueCache(
  cacheKey: string,
): Promise<PortfolioValueCachePayload | null> {
  const row = await prisma.portfolioValueSnapshot.findUnique({
    where: { cacheKey },
  });
  if (!row) return null;
  try {
    const payload = JSON.parse(row.payload) as PortfolioValueCachePayload;
    if (!payload.points?.length || !payload.endState) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function setPortfolioValueCache(
  cacheKey: string,
  periodStart: string,
  periodEnd: string,
  meta: TransactionMeta,
  payload: PortfolioValueCachePayload,
): Promise<void> {
  const body = JSON.stringify(payload);
  await prisma.portfolioValueSnapshot.upsert({
    where: { cacheKey },
    create: {
      cacheKey,
      periodStart,
      periodEnd,
      txCount: meta.txCount,
      maxTxDate: meta.maxTxDate,
      payload: body,
    },
    update: {
      periodStart,
      periodEnd,
      txCount: meta.txCount,
      maxTxDate: meta.maxTxDate,
      payload: body,
      computedAt: new Date(),
    },
  });
}

export async function deletePortfolioValueCache(
  cacheKey?: string,
): Promise<void> {
  if (cacheKey) {
    await prisma.portfolioValueSnapshot.deleteMany({ where: { cacheKey } });
    return;
  }
  await prisma.portfolioValueSnapshot.deleteMany();
}
