import { createHash } from "crypto";
import { prisma } from "@/lib/db";
import type { CachedPerformanceResult } from "@/lib/performance-cache-client";

export type { CachedPerformanceResult, PerformancePrefs } from "@/lib/performance-cache-client";
export {
  buildPerformanceCacheKey,
  loadPerformancePrefs,
  savePerformancePrefs,
  PERFORMANCE_PREFS_KEY,
} from "@/lib/performance-cache-client";

export async function getDataFingerprint(): Promise<string> {
  const [txCount, txMaxDate, accountAgg] = await Promise.all([
    prisma.transaction.count(),
    prisma.transaction.aggregate({ _max: { date: true } }),
    prisma.account.aggregate({ _count: true, _sum: { cash: true } }),
  ]);
  const raw = [
    txCount,
    txMaxDate._max.date?.toISOString() ?? "",
    accountAgg._count,
    accountAgg._sum.cash?.toString() ?? "0",
  ].join(":");
  return createHash("sha256").update(raw).digest("hex").slice(0, 16);
}

export async function getCachedPerformance(
  cacheKey: string,
): Promise<CachedPerformanceResult | null> {
  const fingerprint = await getDataFingerprint();
  const row = await prisma.performanceSnapshot.findUnique({
    where: { cacheKey },
  });
  if (!row || row.dataFingerprint !== fingerprint) return null;
  try {
    return JSON.parse(row.payload) as CachedPerformanceResult;
  } catch {
    return null;
  }
}

export async function setCachedPerformance(
  cacheKey: string,
  periodStart: string,
  periodEnd: string,
  benchmarkSymbol: string,
  result: CachedPerformanceResult,
): Promise<void> {
  const fingerprint = await getDataFingerprint();
  await prisma.performanceSnapshot.upsert({
    where: { cacheKey },
    create: {
      cacheKey,
      periodStart,
      periodEnd,
      benchmarkSymbol,
      dataFingerprint: fingerprint,
      payload: JSON.stringify(result),
    },
    update: {
      periodStart,
      periodEnd,
      benchmarkSymbol,
      dataFingerprint: fingerprint,
      payload: JSON.stringify(result),
      computedAt: new Date(),
    },
  });
}

export async function invalidatePerformanceCache(): Promise<void> {
  await prisma.performanceSnapshot.deleteMany();
}
