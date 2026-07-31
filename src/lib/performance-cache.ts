import { createHash } from "crypto";
import { prisma } from "@/lib/db";
import { deletePortfolioValueCache } from "@/lib/portfolio-value-cache";
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

/** 清掉分析頁用到的兩層快取：外層 PerformanceSnapshot（整份績效計算結果），
 *  跟內層 PortfolioValueSnapshot（resolvePortfolioValueSeries 的市值序列
 *  快取，getPerformance() 內部會用到）。
 *
 *  兩層一定要一起清，不能只清外層——內層自己的過期判斷只看「交易筆數」跟
 *  「最新交易日期」有沒有變，這兩個值在「原地編輯一筆既有交易的數量/單價/
 *  手續費/稅/日期」時通常都不會變，導致內層誤判成「沒變化」而繼續回傳
 *  編輯前的舊市值序列——這是實測過、會讓分析頁悄悄顯示錯誤數字的真實 bug，
 *  修法就是每次呼叫這裡都把兩層一起清掉，不要只靠內層自己那組脆弱的判斷。 */
export async function invalidatePerformanceCache(): Promise<void> {
  await Promise.all([
    prisma.performanceSnapshot.deleteMany(),
    deletePortfolioValueCache(),
  ]);
}
