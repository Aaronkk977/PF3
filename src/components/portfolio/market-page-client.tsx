"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { DisplayedSymbolsProvider } from "@/components/layout/displayed-symbols";
import { MarketClient } from "@/components/portfolio/market-client";
import { PageRefreshBanner } from "@/components/ui/page-refresh-banner";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { useAutoRefresh } from "@/hooks/use-auto-refresh";
import { useCachedPageData } from "@/hooks/use-cached-page-data";
import type { HoldingPosition, PortfolioSummary } from "@/lib/portfolio-engine";
import type { InstrumentSuggestion } from "@/lib/instrument-suggestions";
import { PAGE_CACHE_KEYS } from "@/lib/client-data-cache";
import {
  prefetchPerformanceWarm,
  prefetchSiblingPages,
  prefetchValueHistoryWarm,
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
  const { data, refreshing, error, isPending, refresh, updatedAt } =
    useCachedPageData<DashboardPayload>(
      PAGE_CACHE_KEYS.dashboard,
      "/api/portfolio/dashboard",
    );
  // 只看畫面上正在顯示的標的（目前選中的追蹤清單、本日持倉表現篩選後的持股），
  // 由各元件透過 useDisplayedSymbols 登記
  const [displayedSymbols, setDisplayedSymbols] = useState<string[]>([]);
  useAutoRefresh(() => refresh({ silent: true }), displayedSymbols, updatedAt);
  useEffect(() => {
    if (data) {
      prefetchSiblingPages();
      prefetchPerformanceWarm();
      prefetchValueHistoryWarm();
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
      <PageRefreshBanner refreshing={refreshing} updatedAt={updatedAt} />
      <DisplayedSymbolsProvider onChange={setDisplayedSymbols}>
        <MarketClient
          holdings={data.holdings}
          watchlists={data.watchlists}
          instruments={data.instruments}
          priorityInstruments={data.priorityInstruments}
        />
      </DisplayedSymbolsProvider>
    </>
  );
}
