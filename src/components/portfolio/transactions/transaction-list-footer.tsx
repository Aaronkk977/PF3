"use client";

import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { PAGE_SIZE_OPTIONS } from "@/components/portfolio/transactions/transaction-utils";
import type { TransactionListPagination } from "@/components/portfolio/transactions/use-transaction-list";
import { cn, formatCurrency } from "@/lib/utils";

/** 篩選後交易的買賣合計（依幣別分開） */
export function TransactionListTotals({
  totals,
}: {
  totals: [string, { buy: number; sell: number }][];
}) {
  return (
    <div className="mt-4 rounded-lg border border-[var(--color-card-border)] bg-[var(--color-background)]/40 px-4 py-3">
      <p className="mb-3 text-xs text-[var(--color-muted)]">
        列表合計（含手續費與稅之淨收付）
      </p>
      {totals.length === 0 ? (
        <div className="flex flex-wrap gap-8">
          <div>
            <p className="text-xs text-[var(--color-muted)]">總買入</p>
            <p className="mt-0.5 font-mono text-sm trade-buy">—</p>
          </div>
          <div>
            <p className="text-xs text-[var(--color-muted)]">總賣出</p>
            <p className="mt-0.5 font-mono text-sm trade-sell">—</p>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {totals.map(([ccy, { buy, sell }]) => (
            <div
              key={ccy}
              className={cn(
                "flex flex-wrap gap-8",
                totals.length > 1 &&
                  "border-t border-[var(--color-card-border)]/50 pt-3 first:border-0 first:pt-0",
              )}
            >
              {totals.length > 1 && (
                <p className="w-full text-[10px] font-medium uppercase tracking-wide text-[var(--color-muted)]">
                  {ccy}
                </p>
              )}
              <div>
                <p className="text-xs text-[var(--color-muted)]">總買入</p>
                <p className="mt-0.5 font-mono text-sm trade-buy">
                  {formatCurrency(buy, ccy)}
                </p>
              </div>
              <div>
                <p className="text-xs text-[var(--color-muted)]">總賣出</p>
                <p className="mt-0.5 font-mono text-sm trade-sell">
                  {formatCurrency(sell, ccy)}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** 分頁列：顯示筆數、每頁筆數、上一頁／下一頁 */
export function TransactionListPager({
  pagination,
  filteredCount,
  totalCount,
}: {
  pagination: TransactionListPagination;
  filteredCount: number;
  totalCount: number;
}) {
  const { page, setPage, pageSize, setPageSize, totalPages, pageStart, pageEnd } =
    pagination;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-card-border)]/60 pt-4">
      <p className="text-xs text-[var(--color-muted)]">
        顯示 {pageStart}–{pageEnd} / 共 {filteredCount} 筆
        {filteredCount !== totalCount && `（全部 ${totalCount} 筆）`}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-xs text-[var(--color-muted)]">
          每頁
          <Select
            value={String(pageSize)}
            className="h-8 w-20"
            onChange={(e) => setPageSize(Number(e.target.value))}
          >
            {PAGE_SIZE_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </Select>
        </label>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            上一頁
          </Button>
          <span className="flex items-center px-2 font-mono text-xs text-[var(--color-muted)]">
            {page} / {totalPages}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            下一頁
          </Button>
        </div>
      </div>
    </div>
  );
}
