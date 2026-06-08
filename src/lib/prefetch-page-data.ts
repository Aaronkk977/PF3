import {
  PAGE_CACHE_KEYS,
  readClientCache,
  writeClientCache,
} from "@/lib/client-data-cache";
import { parseResponseJson } from "@/lib/utils";

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

  const res = await fetch(url, { cache: "no-store" });
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
    const end = new Date();
    const start = new Date(
      end.getFullYear() - 1,
      end.getMonth(),
      end.getDate(),
    );
    const startStr = start.toISOString().slice(0, 10);
    const endStr = end.toISOString().slice(0, 10);
    void fetch(
      `/api/performance?start=${startStr}&end=${endStr}`,
      { cache: "no-store" },
    ).catch(() => {});
  });
}

/** Warm a single tab cache (e.g. nav hover). */
export function prefetchPage(cacheKey: string, url: string): void {
  if (typeof window === "undefined") return;
  if (readClientCache(cacheKey)) return;
  void fetchIntoCache(cacheKey, url);
}

export const NAV_PREFETCH: Record<string, { cacheKey: string; url: string }> = {
  "/holdings": {
    cacheKey: PAGE_CACHE_KEYS.holdings,
    url: "/api/portfolio/holdings-page",
  },
  "/transactions": {
    cacheKey: PAGE_CACHE_KEYS.transactions,
    url: "/api/portfolio/transactions-page",
  },
};
