"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { DashboardClient } from "@/components/portfolio/dashboard-client";
import { PageRefreshBanner } from "@/components/ui/page-refresh-banner";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { useCachedPageData } from "@/hooks/use-cached-page-data";
import type { HoldingPosition, PortfolioSummary } from "@/lib/portfolio-engine";
import type { InstrumentSuggestion } from "@/lib/instrument-suggestions";
import { PAGE_CACHE_KEYS } from "@/lib/client-data-cache";
import { prefetchSiblingPages } from "@/lib/prefetch-page-data";
import type { WatchlistWithEntries } from "@/lib/watchlist";

type DashboardPayload = {
  summary: PortfolioSummary;
  holdings: HoldingPosition[];
  watchlists: WatchlistWithEntries[];
  instruments: { id: string; symbol: string; name: string | null }[];
  priorityInstruments: InstrumentSuggestion[];
};

export function DashboardPageClient() {
  const pathname = usePathname();
  const { data, refreshing, error, isPending, refresh } =
    useCachedPageData<DashboardPayload>(
      PAGE_CACHE_KEYS.dashboard,
      "/api/portfolio/dashboard",
    );

  useEffect(() => {
    if (data) prefetchSiblingPages();
  }, [data]);

  useEffect(() => {
    if (pathname === "/") void refresh({ silent: true });
  }, [pathname, refresh]);

  if (isPending) return <PageSkeleton title="Dashboard" />;
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
  if (!data) return <PageSkeleton title="Dashboard" />;

  return (
    <>
      <PageRefreshBanner refreshing={refreshing} />
      <DashboardClient
        summary={data.summary}
        holdings={data.holdings}
        watchlists={data.watchlists}
        instruments={data.instruments}
        priorityInstruments={data.priorityInstruments}
      />
    </>
  );
}
