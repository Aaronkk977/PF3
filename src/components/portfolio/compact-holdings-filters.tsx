"use client";

import { ENTIRE_PORTFOLIO_FILTER_ID, ENTIRE_PORTFOLIO_LABEL } from "@/lib/chart-constants";
import { withoutDeprecatedTags } from "@/lib/deprecated-tags";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

function toggleInList<T>(list: T[], item: T): T[] {
  return list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
}

function FilterPill({
  active,
  onClick,
  children,
  className,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
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
        className,
      )}
    >
      {children}
    </button>
  );
}

export function CompactHoldingsFilters({
  accounts,
  allTags,
  tagFilters,
  accountFilters,
  onTagFiltersChange,
  onAccountFiltersChange,
  accountsOnly = false,
  summaryLabel = "篩選",
  showEntirePortfolioPill = false,
  startDate,
  onStartDateChange,
  clearLabel = "清除篩選",
  uncategorizedKey = "__untagged__",
  uncategorizedLabel = "未標記",
  showUncategorizedPill = true,
  accountSectionLabel,
  inlineSectionLabel,
  onClear,
  showClear,
  variant = "dropdown",
  className,
}: {
  accounts: { id: string; name: string; currency: string }[];
  allTags: string[];
  tagFilters: string[];
  accountFilters: string[];
  onTagFiltersChange: (next: string[]) => void;
  onAccountFiltersChange: (next: string[]) => void;
  accountsOnly?: boolean;
  summaryLabel?: string;
  showEntirePortfolioPill?: boolean;
  startDate?: string;
  onStartDateChange?: (value: string) => void;
  clearLabel?: string;
  uncategorizedKey?: string;
  uncategorizedLabel?: string;
  showUncategorizedPill?: boolean;
  accountSectionLabel?: string;
  inlineSectionLabel?: string;
  /** 自訂清除（例如一併清除分類彙總） */
  onClear?: () => void;
  /** 覆寫是否顯示清除按鈕 */
  showClear?: boolean;
  variant?: "dropdown" | "inline";
  className?: string;
}) {
  const visibleTags = withoutDeprecatedTags(allTags);

  const accountPillCount = accountFilters.filter(
    (id) => id !== ENTIRE_PORTFOLIO_FILTER_ID,
  ).length;
  const entireSelected = accountFilters.includes(ENTIRE_PORTFOLIO_FILTER_ID);
  const activeCount =
    (accountsOnly ? 0 : tagFilters.length) +
    accountPillCount +
    (entireSelected ? 1 : 0);

  const filterBody = (
    <div className="flex max-w-full flex-col items-end gap-1.5">
      {!accountsOnly && visibleTags.length > 0 && (
        <div className="flex flex-wrap items-center justify-end gap-1">
          {showUncategorizedPill && (
            <FilterPill
              active={tagFilters.includes(uncategorizedKey)}
              onClick={() =>
                onTagFiltersChange(toggleInList(tagFilters, uncategorizedKey))
              }
            >
              {uncategorizedLabel}
            </FilterPill>
          )}
          {visibleTags.map((tag) => (
            <FilterPill
              key={tag}
              active={tagFilters.includes(tag)}
              onClick={() => onTagFiltersChange(toggleInList(tagFilters, tag))}
            >
              {tag}
            </FilterPill>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-end gap-1">
        {accountSectionLabel && (
          <span className="mr-1 shrink-0 text-[10px] text-[var(--color-muted)]">
            {accountSectionLabel}
          </span>
        )}
        {showEntirePortfolioPill && (
          <FilterPill
            active={entireSelected}
            onClick={() =>
              onAccountFiltersChange(
                toggleInList(accountFilters, ENTIRE_PORTFOLIO_FILTER_ID),
              )
            }
          >
            {ENTIRE_PORTFOLIO_LABEL}
          </FilterPill>
        )}
        {accounts.map((a) => (
          <FilterPill
            key={a.id}
            active={accountFilters.includes(a.id)}
            onClick={() =>
              onAccountFiltersChange(toggleInList(accountFilters, a.id))
            }
          >
            {a.name}
          </FilterPill>
        ))}
      </div>
      {startDate != null && onStartDateChange && (
        <div className="flex items-center gap-1.5">
          <label className="form-label shrink-0 text-[10px]">起算日期</label>
          <Input
            type="date"
            value={startDate}
            max={new Date().toISOString().slice(0, 10)}
            onChange={(e) => onStartDateChange(e.target.value)}
            className="h-7 w-[132px] text-xs"
          />
        </div>
      )}
      {(showClear ?? activeCount > 0) && (
        <button
          type="button"
          className="text-[10px] text-[var(--color-primary)] hover:underline"
          onClick={() => {
            if (onClear) {
              onClear();
            } else {
              if (!accountsOnly) onTagFiltersChange([]);
              onAccountFiltersChange([]);
            }
          }}
        >
          {clearLabel}
        </button>
      )}
    </div>
  );

  if (variant === "inline") {
    return (
      <div
        className={cn(
          "flex w-full max-w-full flex-col items-end gap-1 text-xs",
          className,
        )}
      >
        {inlineSectionLabel ? (
          <span className="text-[10px] text-[var(--color-muted)]">
            {inlineSectionLabel}
          </span>
        ) : null}
        {filterBody}
      </div>
    );
  }

  return (
    <details className={cn("group text-xs", className)}>
      <summary className="cursor-pointer list-none text-[var(--color-muted)] marker:content-none [&::-webkit-details-marker]:hidden">
        <span className="inline-flex items-center gap-1">
          {summaryLabel}
          {activeCount > 0 && (
            <span className="rounded-full bg-[var(--color-primary)]/20 px-1.5 text-[10px] text-[var(--color-primary)]">
              {activeCount}
            </span>
          )}
          <span className="text-[10px] opacity-60 group-open:hidden">▼</span>
          <span className="hidden text-[10px] opacity-60 group-open:inline">
            ▲
          </span>
        </span>
      </summary>
      <div className="mt-2 space-y-2">{filterBody}</div>
    </details>
  );
}
