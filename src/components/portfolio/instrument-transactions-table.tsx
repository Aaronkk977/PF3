"use client";

import {
  formatTransactionType,
  transactionTypeClass,
} from "@/lib/transaction-type-display";
import { cn, formatCurrency, formatDate } from "@/lib/utils";

export type InstrumentTransactionRow = {
  id: string;
  date: string;
  type: string;
  accountName: string;
  quantity: number;
  price: number;
  fee: number;
  tax: number;
  note: string | null;
  currency?: string | null;
};

const CASH_TYPES = new Set(["DEPOSIT", "WITHDRAWAL"]);

export function InstrumentTransactionsTable({
  transactions,
  currency = "TWD",
}: {
  transactions: InstrumentTransactionRow[];
  currency?: string;
}) {
  if (transactions.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-[var(--color-muted)]">
        此標的尚無交易記錄
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead>
          <tr className="border-b border-[var(--color-card-border)] text-xs text-[var(--color-muted)]">
            <th className="py-2 pr-4 font-medium">日期</th>
            <th className="py-2 pr-4 font-medium">帳戶</th>
            <th className="py-2 pr-4 font-medium">類型</th>
            <th className="py-2 pr-4 font-medium text-right">數量</th>
            <th className="py-2 pr-4 font-medium text-right">單價</th>
            <th className="py-2 pr-4 font-medium text-right">手續費</th>
            <th className="py-2 pr-4 font-medium text-right">稅</th>
            <th className="py-2 font-medium">備註</th>
          </tr>
        </thead>
        <tbody>
          {transactions.map((tx) => {
            const isCash = CASH_TYPES.has(tx.type);
            const ccy = tx.currency ?? currency;
            return (
              <tr
                key={tx.id}
                className="border-b border-[var(--color-card-border)]/40"
              >
                <td className="py-3 pr-4 text-[var(--color-foreground)]">
                  {formatDate(tx.date)}
                </td>
                <td className="py-3 pr-4 text-[var(--color-foreground)]">
                  {tx.accountName}
                </td>
                <td
                  className={cn(
                    "py-3 pr-4 font-medium",
                    transactionTypeClass(tx.type),
                  )}
                >
                  {formatTransactionType(tx.type)}
                </td>
                <td className="py-3 pr-4 text-right tabular-nums text-[var(--color-foreground)]">
                  {isCash ? "—" : tx.quantity.toLocaleString("zh-TW")}
                </td>
                <td className="py-3 pr-4 text-right tabular-nums text-[var(--color-foreground)]">
                  {formatCurrency(tx.price, ccy)}
                </td>
                <td className="py-3 pr-4 text-right tabular-nums text-[var(--color-muted)]">
                  {isCash ? "—" : formatCurrency(tx.fee, ccy)}
                </td>
                <td className="py-3 pr-4 text-right tabular-nums text-[var(--color-muted)]">
                  {isCash ? "—" : formatCurrency(tx.tax, ccy)}
                </td>
                <td className="py-3 text-[var(--color-muted)]">
                  {tx.note ?? "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
