import {
  PAGE_CACHE_KEYS,
  readClientCache,
  writeClientCache,
} from "@/lib/client-data-cache";
import {
  buildValueHistoryUrl,
  resolveValueHistoryQuery,
} from "@/lib/holdings-cache-client";
import { pageRequestHeaders } from "@/lib/page-request-headers";
import { parseResponseJson } from "@/lib/utils";
import { loadHoldingsPrefs, loadPerformancePrefs } from "@/lib/ui-prefs";

/** Holdings only on idle prefetch — transactions is heavy and can race Next dev compile. */
const PREFETCH_TARGETS = [
  {
    cacheKey: PAGE_CACHE_KEYS.holdings,
    url: "/api/portfolio/holdings-page",
  },
] as const;

let prefetchScheduled = false;
let prefetchInFlight: Promise<void> | null = null;

function scheduleIdle(cb: () => void): void {
  if (typeof window === "undefined") return;
  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(() => cb(), { timeout: 4000 });
  } else {
    globalThis.setTimeout(cb, 1500);
  }
}

async function fetchIntoCache(cacheKey: string, url: string): Promise<void> {
  if (readClientCache(cacheKey)) return;

  // 預熱一律標成 background：使用者沒在等這一頁，不該跟當前頁搶名額。
  const res = await fetch(url, {
    cache: "no-store",
    headers: pageRequestHeaders(cacheKey, { background: true }),
  });
  if (!res.ok) return;

  const json = await parseResponseJson<unknown>(res);
  if (json != null) {
    writeClientCache(cacheKey, json);
  }
}

/** Background-load sibling tab APIs after dashboard is ready. */
export function prefetchSiblingPages(): void {
  if (typeof window === "undefined") return;
  if (prefetchScheduled) return;
  prefetchScheduled = true;

  scheduleIdle(() => {
    if (prefetchInFlight) return;
    prefetchInFlight = (async () => {
      await Promise.all(
        PREFETCH_TARGETS.map(({ cacheKey, url }) =>
          fetchIntoCache(cacheKey, url),
        ),
      );
    })().finally(() => {
      prefetchInFlight = null;
    });
  });
}

let performanceWarmScheduled = false;

/**
 * Warm the server-side PerformanceSnapshot cache in the background.
 * Does NOT store result in client cache — just ensures the server has computed
 * and cached the result so navigating to /performance is instant.
 */
export function prefetchPerformanceWarm(): void {
  if (typeof window === "undefined") return;
  if (performanceWarmScheduled) return;
  performanceWarmScheduled = true;

  scheduleIdle(() => {
    try {
      const prefs = loadPerformancePrefs();

      const now = new Date();
      const defaultStart = new Date(
        now.getFullYear() - 1,
        now.getMonth(),
        now.getDate(),
      );
      const startStr = prefs?.start ?? defaultStart.toISOString().slice(0, 10);
      const endStr = prefs?.end ?? now.toISOString().slice(0, 10);
      const accounts = (prefs?.accountIds ?? []).join(",");
      const benchmarks = (prefs?.benchmarks ?? []).join(",");

      const params = new URLSearchParams({ start: startStr, end: endStr });
      if (accounts) params.set("accounts", accounts);
      if (benchmarks) params.set("benchmarks", benchmarks);

      void fetch(`/api/performance?${params.toString()}`, {
        cache: "no-store",
        headers: pageRequestHeaders("performance", { background: true }),
      }).catch(() => {});
    } catch {
      // ignore
    }
  });
}

let valueHistoryWarmScheduled = false;

/**
 * 預熱持股頁「資產市值走勢」的 server 端快取（PortfolioValueSnapshot）。
 *
 * 這是全 app 最慢的一支：實測快取未命中要 47～92 秒，命中只要 0.06 秒。而它的
 * 快取鍵含交易筆數，所以**每新增一筆交易就整批失效**，加上持股頁的 client 端
 * 快取只在同一天內有效，等於每天第一次進持股頁、以及每次記完帳之後，都會撞上
 * 這段等待。
 *
 * 跟 prefetchPerformanceWarm 一樣只打 API、不存 client 快取——目的是讓 server
 * 把結果算好放進 DB 快取，使用者真的切過去時才是 0.06 秒那條路。
 *
 * 起算日與帳戶選擇一定要跟持股頁組出來的完全一致，否則預熱的是一把頁面永遠
 * 不會查的鍵，所以兩邊共用 resolveValueHistoryQuery()。
 */
export function prefetchValueHistoryWarm(): void {
  if (typeof window === "undefined") return;
  if (valueHistoryWarmScheduled) return;
  valueHistoryWarmScheduled = true;

  scheduleIdle(() => {
    try {
      const prefs = loadHoldingsPrefs();
      const query = resolveValueHistoryQuery(
        prefs.trendAccountFilters,
        prefs.trendStartDate,
      );
      void fetch(buildValueHistoryUrl(query), {
        cache: "no-store",
        headers: pageRequestHeaders(PAGE_CACHE_KEYS.holdings, {
          background: true,
        }),
      }).catch(() => {});
    } catch {
      // 預熱失敗不影響任何畫面，使用者切過去時照樣會自己載
    }
  });
}

/** Warm a single tab cache (e.g. nav hover). */
export function prefetchPage(cacheKey: string, url: string): void {
  if (typeof window === "undefined") return;
  if (readClientCache(cacheKey)) return;
  void fetchIntoCache(cacheKey, url);
}

export const NAV_PREFETCH: Record<string, { cacheKey: string; url: string }> = {
  "/market": {
    cacheKey: PAGE_CACHE_KEYS.dashboard,
    url: "/api/portfolio/dashboard",
  },
  "/holdings": {
    cacheKey: PAGE_CACHE_KEYS.holdings,
    url: "/api/portfolio/holdings-page",
  },
  "/transactions": {
    cacheKey: PAGE_CACHE_KEYS.transactions,
    url: "/api/portfolio/transactions-page",
  },
};
