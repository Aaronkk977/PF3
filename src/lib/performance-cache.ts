import { getDataFingerprint } from "@/lib/data-version";
import { prisma } from "@/lib/db";
import { deletePortfolioValueCache } from "@/lib/portfolio-value-cache";
import type { CachedPerformanceResult } from "@/lib/performance-cache-client";

/** 分析頁整份績效結果的 server 端快取（PerformanceSnapshot），以
 *  getDataFingerprint() 判斷是否過期。 */

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
