"use client";

import { ACCOUNT_GROUPING_KEY } from "@/lib/allocation-chart-data";
import { cn } from "@/lib/utils";
import { CompactHoldingsFilters } from "@/components/portfolio/compact-holdings-filters";

function toggleInList(list: string[], item: string): string[] {
  return list.includes(item)
    ? list.filter((x) => x !== item)
    : [...list, item];
}

function AggregatePill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-2 py-0.5 font-sans text-[11px] transition-colors",
        active
          ? "border-[var(--color-primary)] bg-[var(--color-primary)]/15 text-[var(--color-primary)]"
          : "border-[var(--color-card-border)]/80 text-[var(--color-muted)] hover:border-[var(--color-primary)]/40",
      )}
    >
      {children}
    </button>
  );
}

export function AllocationSettings({
  accounts,
  allCategories,
  accountFilters,
  aggregateBy,
  onAccountFiltersChange,
  onAggregateByChange,
  className,
}: {
  accounts: { id: string; name: string; currency: string }[];
  allCategories: string[];
  accountFilters: string[];
  aggregateBy: string[];
  onAccountFiltersChange: (next: string[]) => void;
  onAggregateByChange: (next: string[]) => void;
  className?: string;
}) {
  return (
    <details className={cn("group text-xs", className)}>
      <summary className="cursor-pointer list-none text-[var(--color-muted)] marker:content-none [&::-webkit-details-marker]:hidden">
        <span className="inline-flex items-center gap-1">
          設定
          <span className="text-[10px] opacity-60 group-open:hidden">▼</span>
          <span className="hidden text-[10px] opacity-60 group-open:inline">
            ▲
          </span>
        </span>
      </summary>
      <div className="mt-2 flex max-w-full flex-col items-end gap-2">
        <div className="flex w-full max-w-full flex-col items-end gap-1">
          <span className="text-[10px] text-[var(--color-muted)]">分類</span>
          <div className="flex flex-wrap items-center justify-end gap-1">
            {allCategories.map((name) => (
              <AggregatePill
                key={name}
                active={aggregateBy.includes(name)}
                onClick={() =>
                  onAggregateByChange(toggleInList(aggregateBy, name))
                }
              >
                {name}
              </AggregatePill>
            ))}
            <AggregatePill
              active={aggregateBy.includes(ACCOUNT_GROUPING_KEY)}
              onClick={() =>
                onAggregateByChange(
                  toggleInList(aggregateBy, ACCOUNT_GROUPING_KEY),
                )
              }
            >
              帳戶
            </AggregatePill>
          </div>
        </div>
        <CompactHoldingsFilters
          accounts={accounts}
          allTags={[]}
          tagFilters={[]}
          accountFilters={accountFilters}
          onTagFiltersChange={() => {}}
          onAccountFiltersChange={onAccountFiltersChange}
          accountsOnly
          showUncategorizedPill={false}
          variant="inline"
          inlineSectionLabel="篩選"
          clearLabel="清除篩選與分類"
          showClear={
            accountFilters.length > 0 || aggregateBy.length > 0
          }
          onClear={() => {
            onAccountFiltersChange([]);
            onAggregateByChange([]);
          }}
        />
      </div>
    </details>
  );
}
