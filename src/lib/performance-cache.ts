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

/** 交易／帳戶任何一筆被新增、刪除或原地編輯，指紋都會變。筆數抓新增刪除，
 *  max(updatedAt) 抓原地編輯（改舊交易的數量／單價時筆數跟最大日期都不變，
 *  只靠前兩者會繼續回傳過期快取）。股票分割是直接改寫交易，同樣會反映在
 *  updatedAt 上。scripts/mcp-server.ts 的 get_performance 也用這支判斷新鮮度。 */
export async function getDataFingerprint(): Promise<string> {
  const [txAgg, accountAgg] = await Promise.all([
    prisma.transaction.aggregate({
      _count: true,
      _max: { date: true, updatedAt: true },
    }),
    prisma.account.aggregate({
      _count: true,
      _sum: { cash: true },
      _max: { updatedAt: true },
    }),
  ]);
  const raw = [
    txAgg._count,
    txAgg._max.date?.toISOString() ?? "",
    txAgg._max.updatedAt?.toISOString() ?? "",
    accountAgg._count,
    accountAgg._sum.cash?.toString() ?? "0",
    accountAgg._max.updatedAt?.toISOString() ?? "",
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
 *  兩層一定要一起清，不能只清外層。兩層現在都會用交易的 max(updatedAt)
 *  自己偵測原地編輯，這裡是寫入當下立即失效的第一道保險：早期內層只看
 *  「交易筆數」跟「最新交易日期」，編輯舊交易時會繼續回傳編輯前的舊市值
 *  序列，是實測過、會讓分析頁悄悄顯示錯誤數字的真實 bug。 */
export async function invalidatePerformanceCache(): Promise<void> {
  await Promise.all([
    prisma.performanceSnapshot.deleteMany(),
    deletePortfolioValueCache(),
  ]);
}
