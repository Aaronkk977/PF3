"use client";

import { HoldingsClient } from "@/components/portfolio/holdings-client";
import { PageRefreshBanner } from "@/components/ui/page-refresh-banner";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { useCachedPageData } from "@/hooks/use-cached-page-data";
import type { HoldingPosition } from "@/lib/portfolio-engine";
import { PAGE_CACHE_KEYS } from "@/lib/client-data-cache";

type HoldingsPayload = {
  holdings: HoldingPosition[];
  accounts: { id: string; name: string; currency: string }[];
  allTags: string[];
  totalCashBase: number;
  cashByAccount: Record<string, number>;
};

export function HoldingsPageClient() {
  const { data, refreshing, error, isPending, refresh } = useCachedPageData<HoldingsPayload>(
    PAGE_CACHE_KEYS.holdings,
    "/api/portfolio/holdings-page",
  );

  if (isPending) return <PageSkeleton title="持倉" />;
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
  if (!data) return <PageSkeleton title="持倉" />;

  return (
    <>
      <PageRefreshBanner refreshing={refreshing} />
      <HoldingsClient
        holdings={data.holdings}
        accounts={data.accounts}
        allTags={data.allTags}
        totalCashBase={data.totalCashBase}
        cashByAccount={data.cashByAccount}
        onRefresh={() => void refresh({ silent: false })}
      />
    </>
  );
}
