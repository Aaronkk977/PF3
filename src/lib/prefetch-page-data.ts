import {
  PAGE_CACHE_KEYS,
  readClientCache,
  writeClientCache,
} from "@/lib/client-data-cache";
import { parseResponseJson } from "@/lib/utils";
import { PERFORMANCE_PREFS_KEY } from "@/lib/performance-cache-client";

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
    try {
      const raw = localStorage.getItem(PERFORMANCE_PREFS_KEY);
      const prefs = raw
        ? (JSON.parse(raw) as {
            start?: string;
            end?: string;
            accountIds?: string[];
            benchmarks?: string[];
          })
        : null;

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
      }).catch(() => {});
    } catch {
      // ignore
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
  "/holdings": {
    cacheKey: PAGE_CACHE_KEYS.holdings,
    url: "/api/portfolio/holdings-page",
  },
  "/transactions": {
    cacheKey: PAGE_CACHE_KEYS.transactions,
    url: "/api/portfolio/transactions-page",
  },
};
