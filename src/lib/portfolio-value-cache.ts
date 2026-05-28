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

export async function getTransactionMeta(): Promise<{
  txCount: number;
  maxTxDate: string;
}> {
  const [txCount, agg] = await Promise.all([
    prisma.transaction.count(),
    prisma.transaction.aggregate({ _max: { date: true } }),
  ]);
  const maxTxDate = agg._max.date
    ? agg._max.date.toISOString().slice(0, 10)
    : "";
  return { txCount, maxTxDate };
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
  meta: { txCount: number; maxTxDate: string },
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
