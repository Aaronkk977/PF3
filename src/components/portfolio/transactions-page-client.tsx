"use client";

import { TransactionsClient } from "@/components/portfolio/transactions-client";
import { PageRefreshBanner } from "@/components/ui/page-refresh-banner";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { useCachedPageData } from "@/hooks/use-cached-page-data";
import type { InstrumentSuggestion } from "@/lib/instrument-suggestions";
import { PAGE_CACHE_KEYS } from "@/lib/client-data-cache";

type TransactionsPayload = {
  initialTransactions: Parameters<typeof TransactionsClient>[0]["initialTransactions"];
  initialAccounts: Parameters<typeof TransactionsClient>[0]["initialAccounts"];
  instruments: Parameters<typeof TransactionsClient>[0]["instruments"];
  priorityInstruments: InstrumentSuggestion[];
};

export function TransactionsPageClient() {
  const { data, refreshing, error, isPending } =
    useCachedPageData<TransactionsPayload>(
      PAGE_CACHE_KEYS.transactions,
      "/api/portfolio/transactions-page",
    );

  if (isPending) return <PageSkeleton title="交易" />;
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
  if (!data) return <PageSkeleton title="交易" />;

  return (
    <>
      <PageRefreshBanner refreshing={refreshing} />
      <TransactionsClient
        initialTransactions={data.initialTransactions}
        initialAccounts={data.initialAccounts}
        instruments={data.instruments}
        priorityInstruments={data.priorityInstruments}
      />
    </>
  );
}
