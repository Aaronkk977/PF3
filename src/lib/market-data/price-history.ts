import "server-only";

import {
  enqueuePriceCacheWrite,
  getCachedHistory,
  persistPriceHistory,
  startOfDay,
  startOfLocalDay,
  toOhlcBars,
} from "@/lib/market-data/price-cache";
import { isTaiwanMarginSymbol } from "@/lib/custom-series-symbols";
import { syncMarginHistory } from "@/lib/market-data/taiwan-margin";
import { isTaiwanVixSymbol, syncVixHistory } from "@/lib/market-data/taiwan-vix";
import { fetchChart, type OhlcBar } from "@/lib/market-data/yahoo-chart";

/** 歷史日線：先讀 PriceCache，過期或不夠長才向 Yahoo 補抓並寫回。 */

const CACHE_TTL_MS = 15 * 60 * 1000;
/** 尾端過期時只重抓最近這幾天（涵蓋週末與遲報的收盤價），其餘信任快取 */
const RECENT_REFRESH_DAYS = 7;
/** 每天至少做一次全區間重抓，接住分割／減資造成的歷史回溯調整 */
const FULL_REFRESH_MS = 24 * 60 * 60 * 1000;

export async function getHistoricalPrices(
  symbol: string,
  periodStart: Date,
  periodEnd: Date,
): Promise<OhlcBar[]> {
  if (isTaiwanVixSymbol(symbol)) {
    return syncVixHistory(periodStart, periodEnd);
  }
  if (isTaiwanMarginSymbol(symbol)) {
    return syncMarginHistory(symbol.trim().toUpperCase(), periodStart, periodEnd);
  }

  const cached = await getCachedHistory(symbol, periodStart, periodEnd);
  const cachedBars = toOhlcBars(cached);

  const covers = cacheCoversRange(cached, periodStart, periodEnd);
  // cachedAt 讀「日期最新那一列」，剛好就是下面只重抓的那段尾巴，兩者一致。
  const cacheAgeMs =
    Date.now() - (cached[cached.length - 1]?.cachedAt?.getTime() ?? 0);

  if (cached.length > 0 && covers && cacheAgeMs <= CACHE_TTL_MS) {
    return cachedBars;
  }

  // 已收盤日的日線是不可變的，沒必要為了「最新那根過了 15 分鐘」就把整段歷史
  // 重抓一次——那正是市值走勢冷啟動要 47～92 秒的原因（126 檔 × 完整歷史）。
  // 快取已經涵蓋整個區間、只是尾端過期時，只補最近幾天就好。
  //
  // 但分割／減資會讓 Yahoo 回溯調整**整段**歷史價，只補尾端會讓舊數字永遠停在
  // 調整前，所以保留每日一次的全區間重抓當逃生口。
  const fullRefresh =
    cached.length === 0 || !covers || cacheAgeMs > FULL_REFRESH_MS;
  const fetchStart = fullRefresh
    ? periodStart
    : new Date(
        Math.max(
          periodStart.getTime(),
          periodEnd.getTime() - RECENT_REFRESH_DAYS * 24 * 60 * 60 * 1000,
        ),
      );

  try {
    const history = await fetchChart(symbol, fetchStart, periodEnd);

    // fetchChart swallows errors and returns [] on timeout / network failure.
    // If we got nothing back but have stale cached rows, serve the cache rather
    // than returning an empty chart.
    if (history.length === 0) {
      return cachedBars;
    }

    const sorted = history.sort((a, b) => a.date.localeCompare(b.date));
    enqueuePriceCacheWrite(() => persistPriceHistory(symbol, sorted));

    // 以日期取聯集：這次抓到的優先，抓不到的沿用快取。
    //
    // 千萬不能寫成「快取前半 + 這次抓到的尾端」——Yahoo 對最新一個交易日很常
    // 先回 close=null（實測 0050.TW 在 2026-07-31 就是這樣，而快取裡早就存了
    // 當天的 101.25），而 fetchChart 會跳過 null。若用切割式合併，那根已經在
    // 資料庫裡的最新報價會整根消失，走勢圖與分析頁的基準線就會停在前一天，
    // 看起來像「大漲那天完全沒反應」。
    const merged = new Map<string, OhlcBar>(
      cachedBars.map((b) => [b.date, b] as const),
    );
    for (const bar of sorted) merged.set(bar.date, bar);
    return [...merged.values()].sort((a, b) => a.date.localeCompare(b.date));
  } catch {
    return cachedBars;
  }
}

function cacheCoversRange(
  cached: { date: Date }[],
  periodStart: Date,
  periodEnd: Date,
): boolean {
  if (cached.length === 0) return false;
  const startMs = startOfLocalDay(periodStart).getTime();
  const endMs = startOfLocalDay(periodEnd).getTime();
  const firstMs = startOfDay(cached[0].date).getTime();
  const lastMs = startOfDay(cached[cached.length - 1].date).getTime();
  const startSlack = 7 * 24 * 60 * 60 * 1000;
  const endSlack = 3 * 24 * 60 * 60 * 1000;
  return firstMs <= startMs + startSlack && lastMs >= endMs - endSlack;
}
