"use client";

import { CompactHoldingsFilters } from "@/components/portfolio/compact-holdings-filters";
export function TrendValueSettings({
  accounts,
  accountFilters,
  onAccountFiltersChange,
  startDate,
  onStartDateChange,
  variant = "dropdown",
  className,
}: {
  accounts: { id: string; name: string; currency: string }[];
  accountFilters: string[];
  onAccountFiltersChange: (next: string[]) => void;
  startDate: string;
  onStartDateChange: (value: string) => void;
  variant?: "dropdown" | "inline";
  className?: string;
}) {
  return (
    <CompactHoldingsFilters
      variant={variant}
      className={className}
      accounts={accounts}
      allTags={[]}
      tagFilters={[]}
      accountFilters={accountFilters}
      onTagFiltersChange={() => {}}
      onAccountFiltersChange={onAccountFiltersChange}
      accountsOnly
      summaryLabel="設定"
      showEntirePortfolioPill
      startDate={startDate}
      onStartDateChange={onStartDateChange}
      clearLabel="清除設定"
    />
  );
}
