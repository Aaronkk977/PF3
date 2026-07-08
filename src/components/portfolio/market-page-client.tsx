"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { MarketClient } from "@/components/portfolio/market-client";
import { PageRefreshBanner } from "@/components/ui/page-refresh-banner";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { useCachedPageData } from "@/hooks/use-cached-page-data";
import type { HoldingPosition, PortfolioSummary } from "@/lib/portfolio-engine";
import type { InstrumentSuggestion } from "@/lib/instrument-suggestions";
import { PAGE_CACHE_KEYS } from "@/lib/client-data-cache";
import {
  prefetchPerformanceWarm,
  prefetchSiblingPages,
} from "@/lib/prefetch-page-data";
import type { WatchlistWithEntries } from "@/lib/watchlist";

/** 與 Overview 頁共用 /api/portfolio/dashboard 的快取（同一 cache key）。 */
type DashboardPayload = {
  summary: PortfolioSummary;
  holdings: HoldingPosition[];
  watchlists: WatchlistWithEntries[];
  instruments: { id: string; symbol: string; name: string | null }[];
  priorityInstruments: InstrumentSuggestion[];
};

export function MarketPageClient() {
  const pathname = usePathname();
  const { data, refreshing, error, isPending, refresh } =
    useCachedPageData<DashboardPayload>(
      PAGE_CACHE_KEYS.dashboard,
      "/api/portfolio/dashboard",
    );

  useEffect(() => {
    if (data) {
      prefetchSiblingPages();
      prefetchPerformanceWarm();
    }
  }, [data]);

  useEffect(() => {
    if (pathname === "/market") void refresh();
  }, [pathname, refresh]);

  if (isPending) return <PageSkeleton title="Market" />;
  if (error && !data) {
    return (
      <p className="text-sm text-[var(--color-negative)]">
        {error}
        <button
          type="button"
          className="ml-2 text-[var(--color-primary)] underline"
          onClick={() => window.location.reload()}
        >
          重試
        </button>
      </p>
    );
  }
  if (!data) return <PageSkeleton title="Market" />;

  return (
    <>
      <PageRefreshBanner refreshing={refreshing} />
      <MarketClient
        holdings={data.holdings}
        watchlists={data.watchlists}
        instruments={data.instruments}
        priorityInstruments={data.priorityInstruments}
      />
    </>
  );
}
