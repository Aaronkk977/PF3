import { prisma } from "@/lib/db";
import type { TransactionMeta } from "@/lib/data-version";
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
