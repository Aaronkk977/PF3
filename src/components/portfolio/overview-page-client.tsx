"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { PageSection } from "@/components/layout/page-sections";
import { DashboardClock } from "@/components/portfolio/dashboard-clock";
import { StatCard } from "@/components/portfolio/stat-card";
import { PageRefreshBanner } from "@/components/ui/page-refresh-banner";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { useCachedPageData } from "@/hooks/use-cached-page-data";
import type { PortfolioSummary } from "@/lib/portfolio-engine";
import { PAGE_CACHE_KEYS } from "@/lib/client-data-cache";
import {
  prefetchPerformanceWarm,
  prefetchSiblingPages,
} from "@/lib/prefetch-page-data";
import {
  changePositive,
  changePositiveMoney,
  formatCurrency,
  formatPercent,
} from "@/lib/utils";

/** 與 /api/portfolio/dashboard 回傳一致；本頁只用 summary，
 * 但沿用同一 cache key，讓 Overview/Market 兩頁共用一份快取與報價成本。 */
type DashboardPayload = {
  summary: PortfolioSummary;
};

export function OverviewPageClient() {
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
    if (pathname === "/") void refresh();
  }, [pathname, refresh]);

  if (isPending) return <PageSkeleton title="Overview" />;
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
  if (!data) return <PageSkeleton title="Overview" />;

  const { summary } = data;

  return (
    <div className="space-y-8">
      <PageRefreshBanner refreshing={refreshing} />
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-mono text-2xl font-bold text-[var(--color-primary)] glow-text">
            Overview
          </h1>
          <p className="mt-1 text-sm text-[var(--color-muted)]">投資組合總覽</p>
        </div>
        <DashboardClock />
      </div>

      <PageSection id="overview-summary" title="總覽" navOrder={10}>
        <div className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(min(100%,10.5rem),1fr))]">
          <StatCard
            title="總資產"
            value={summary.totalMarketValue + summary.cash}
            isCurrency
            currency={summary.baseCurrency}
          />
          <StatCard
            title="證券市值"
            value={summary.totalMarketValue}
            isCurrency
            currency={summary.baseCurrency}
          />
          <StatCard
            title="現金"
            value={summary.cash}
            isCurrency
            currency={summary.baseCurrency}
          />
          <StatCard
            title="今日漲跌"
            value={summary.todayChange}
            isCurrency
            currency={summary.baseCurrency}
            positive={changePositiveMoney(summary.todayChange)}
            subtitle={formatPercent(summary.todayChangePct)}
            animated
            stale={summary.quotesStale}
          />
          <StatCard
            title="未實現損益"
            value={summary.totalUnrealizedPnl}
            isCurrency
            currency={summary.baseCurrency}
            positive={changePositiveMoney(summary.totalUnrealizedPnl)}
            subtitle={formatPercent(summary.totalUnrealizedPnlPct)}
          />
        </div>
      </PageSection>

      {(summary.accountSummaries ?? []).length > 0 && (
        <PageSection
          id="overview-accounts"
          title="各帳戶表現"
          className="mt-8"
          navOrder={20}
        >
          <div className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(min(100%,10.5rem),1fr))]">
            {(summary.accountSummaries ?? []).map((acc) => (
              <StatCard
                key={acc.accountId}
                title={acc.name}
                value={acc.totalAssets}
                isCurrency
                currency={summary.baseCurrency}
                subtitle={`今日 ${formatCurrency(acc.todayChange, summary.baseCurrency)} (${formatPercent(acc.todayChangePct)})`}
                positive={changePositive(acc.todayChangePct)}
              />
            ))}
          </div>
        </PageSection>
      )}
    </div>
  );
}
