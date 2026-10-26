"use client";

import { Button } from "@/components/ui/button";
import {
  FilterCheckbox,
  FilterCheckboxGroup,
} from "@/components/ui/filter-checkbox";
import { Input } from "@/components/ui/input";
import {
  toggleInList,
  TX_FILTER_TYPES,
  type Account,
} from "@/components/portfolio/transactions/transaction-utils";
import type { TransactionListFilters } from "@/components/portfolio/transactions/use-transaction-list";
import {
  formatTransactionType,
  transactionTypeClass,
} from "@/lib/transaction-type-display";

/** 交易列表上方可收合的篩選面板 */
export function TransactionListFilterPanel({
  filters,
  accounts,
}: {
  filters: TransactionListFilters;
  accounts: Account[];
}) {
  const {
    filterTypes,
    setFilterTypes,
    filterAccountIds,
    setFilterAccountIds,
    filterDateFrom,
    setFilterDateFrom,
    filterDateTo,
    setFilterDateTo,
    setTodayMode,
    filterSymbol,
    setFilterSymbol,
    filtersExpanded,
    setFiltersExpanded,
    todayKey,
    isTodayFilter,
    hasDateFilter,
    activeFilterCount,
  } = filters;

  return (
    <div className="rounded-md border border-[var(--color-card-border)]/60 bg-[var(--color-card)]">
      <button
        type="button"
        onClick={() => setFiltersExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
      >
        <span className="text-sm font-medium">篩選</span>
        <span className="flex items-center gap-2 text-xs text-[var(--color-muted)]">
          {!filtersExpanded && activeFilterCount > 0 && (
            <span>已選 {activeFilterCount} 項</span>
          )}
          <svg
            aria-hidden
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`h-3.5 w-3.5 shrink-0 transition-transform duration-300 ease-in-out ${filtersExpanded ? "rotate-180" : "rotate-0"}`}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </span>
      </button>
      <div
        className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${filtersExpanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
      >
        <div className="overflow-hidden">
          <div className="space-y-4 border-t border-[var(--color-card-border)]/60 px-4 pb-4 pt-3">
            <div>
              <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-[var(--color-muted)]">
                標的／名稱
              </p>
              <Input
                type="search"
                placeholder="代號或名稱關鍵字…"
                value={filterSymbol}
                onChange={(e) => setFilterSymbol(e.target.value)}
                className="h-8 max-w-xs text-xs"
              />
            </div>
            <div>
              <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-[var(--color-muted)]">
                時間（未選表示全部）
              </p>
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label className="mb-1 block text-[10px] text-[var(--color-muted)]">
                    起
                  </label>
                  <Input
                    type="date"
                    value={filterDateFrom}
                    onChange={(e) => { setTodayMode(false); setFilterDateFrom(e.target.value); }}
                    className="h-8 text-xs"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] text-[var(--color-muted)]">
                    迄
                  </label>
                  <Input
                    type="date"
                    value={filterDateTo}
                    onChange={(e) => { setTodayMode(false); setFilterDateTo(e.target.value); }}
                    className="h-8 text-xs"
                  />
                </div>
                <div className="flex flex-wrap gap-1 pb-0.5">
                  <Button
                    type="button"
                    variant={isTodayFilter ? "default" : "outline"}
                    size="sm"
                    className="h-8 px-2.5 text-xs"
                    onClick={() => {
                      if (isTodayFilter) {
                        // Toggle off — clear the date filter
                        setTodayMode(false);
                        setFilterDateFrom("");
                        setFilterDateTo("");
                      } else {
                        // Toggle on — set to today and remember the mode
                        setTodayMode(true);
                        setFilterDateFrom(todayKey);
                        setFilterDateTo(todayKey);
                      }
                    }}
                  >
                    今日交易
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 px-2.5 text-xs"
                    onClick={() => {
                      setTodayMode(false);
                      setFilterDateFrom("");
                      setFilterDateTo("");
                    }}
                    disabled={!hasDateFilter}
                  >
                    全部日期
                  </Button>
                </div>
              </div>
            </div>
            <FilterCheckboxGroup label="交易類型（未選表示全部）" compact>
              {TX_FILTER_TYPES.map((type) => (
                <FilterCheckbox
                  key={type}
                  compact
                  checked={filterTypes.includes(type)}
                  onChange={() =>
                    setFilterTypes((prev) => toggleInList(prev, type))
                  }
                  label={formatTransactionType(type)}
                  className={transactionTypeClass(type)}
                />
              ))}
            </FilterCheckboxGroup>
            <FilterCheckboxGroup label="帳戶（未選表示全部）" compact>
              {accounts.map((a) => (
                <FilterCheckbox
                  key={a.id}
                  compact
                  checked={filterAccountIds.includes(a.id)}
                  onChange={() =>
                    setFilterAccountIds((prev) => toggleInList(prev, a.id))
                  }
                  label={`${a.name} (${a.currency})`}
                />
              ))}
            </FilterCheckboxGroup>
            {activeFilterCount > 0 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-xs"
                onClick={() => {
                  setFilterTypes([]);
                  setFilterAccountIds([]);
                  setFilterDateFrom("");
                  setFilterDateTo("");
                  setFilterSymbol("");
                }}
              >
                清除篩選
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
