"use client";

import { useCallback, useState } from "react";
import {
  DEFAULT_TX_COLUMN_ORDER,
  reorderTxColumns,
  TX_COLUMN_LABELS,
  type TxColumnId,
} from "@/lib/transaction-table-columns";
import { cn } from "@/lib/utils";
import {
  TransactionRow,
  type EditableTransaction,
} from "@/components/portfolio/transaction-row";

type AccountOption = { id: string; name: string; currency: string };

export function TransactionsTable({
  columnOrder,
  onColumnOrderChange,
  transactions,
  accounts,
  onSaved,
  onDeleted,
}: {
  columnOrder: TxColumnId[];
  onColumnOrderChange: (order: TxColumnId[]) => void;
  transactions: EditableTransaction[];
  accounts: AccountOption[];
  onSaved: () => void;
  onDeleted: () => void;
}) {
  const [dragCol, setDragCol] = useState<TxColumnId | null>(null);
  const [dropTarget, setDropTarget] = useState<TxColumnId | null>(null);

  const handleDrop = useCallback(
    (target: TxColumnId) => {
      if (!dragCol || dragCol === target) return;
      onColumnOrderChange(reorderTxColumns(columnOrder, dragCol, target));
      setDragCol(null);
      setDropTarget(null);
    },
    [columnOrder, dragCol, onColumnOrderChange],
  );

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--color-card-border)] text-left text-xs uppercase text-[var(--color-muted)]">
            {columnOrder.map((col) => (
              <th
                key={col}
                draggable
                onDragStart={() => setDragCol(col)}
                onDragEnd={() => {
                  setDragCol(null);
                  setDropTarget(null);
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDropTarget(col);
                }}
                onDragLeave={() => {
                  setDropTarget((cur) => (cur === col ? null : cur));
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  handleDrop(col);
                }}
                className={cn(
                  "cursor-grab select-none pb-3 pr-4 active:cursor-grabbing",
                  col === "quantity" ||
                    col === "price" ||
                    col === "fee" ||
                    col === "tax" ||
                    col === "total"
                    ? "text-right"
                    : "",
                  dropTarget === col &&
                    dragCol &&
                    dragCol !== col &&
                    "bg-[var(--color-primary)]/10 ring-1 ring-inset ring-[var(--color-primary)]/40",
                  dragCol === col && "opacity-50",
                )}
                title="拖曳以調整欄位順序"
              >
                {col === "note" ? (
                  <div className="flex items-center gap-2 normal-case">
                    <span className="flex-1">{TX_COLUMN_LABELS[col]}</span>
                    <span className="h-8 w-[3.25rem] shrink-0" aria-hidden />
                  </div>
                ) : (
                  TX_COLUMN_LABELS[col]
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {transactions.length === 0 ? (
            <tr>
              <td
                colSpan={columnOrder.length}
                className="py-8 text-center text-sm text-[var(--color-muted)]"
              >
                沒有符合條件的交易
              </td>
            </tr>
          ) : (
            transactions.map((t) => (
              <TransactionRow
                key={t.id}
                tx={t}
                accounts={accounts}
                columnOrder={columnOrder}
                onSaved={onSaved}
                onDeleted={onDeleted}
              />
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

export { DEFAULT_TX_COLUMN_ORDER };
