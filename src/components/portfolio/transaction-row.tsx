"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Save, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { instrumentHref } from "@/lib/instrument-nav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { TxColumnId } from "@/lib/transaction-table-columns";
import { computeTransactionSettlement } from "@/lib/transaction-settlement";
import {
  formatTransactionType,
  transactionTypeClass,
} from "@/lib/transaction-type-display";
import {
  cn,
  formatCurrency,
  formatDate,
  formatFeeTaxAmount,
  formatTransactionAmount,
} from "@/lib/utils";

const CASH_TYPES = new Set(["DEPOSIT", "WITHDRAWAL"]);

export type EditableTransaction = {
  id: string;
  date: string;
  type: string;
  accountId: string;
  accountName: string;
  symbol: string | null;
  instrumentName?: string | null;
  quantity: number;
  price: number;
  fee: number;
  tax: number;
  note: string | null;
};

type AccountOption = {
  id: string;
  name: string;
  currency: string;
  feeTaxRoundHalfUp?: boolean;
};

export function TransactionRow({
  tx,
  accounts,
  columnOrder,
  isEditing,
  onStartEdit,
  onCancelEdit,
  onSaved,
  onDeleted,
}: {
  tx: EditableTransaction;
  accounts: AccountOption[];
  columnOrder: TxColumnId[];
  isEditing: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaved: () => void;
  onDeleted: () => void;
}) {
  const pathname = usePathname();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    accountId: tx.accountId,
    type: tx.type,
    date: tx.date.slice(0, 10),
    symbol: tx.symbol ?? "",
    quantity: String(tx.quantity),
    price: String(tx.price),
    fee: String(tx.fee),
    tax: String(tx.tax),
    note: tx.note ?? "",
  });
  useEffect(() => {
    if (!isEditing) return;
    setForm({
      accountId: tx.accountId,
      type: tx.type,
      date: tx.date.slice(0, 10),
      symbol: tx.symbol ?? "",
      quantity: String(tx.quantity),
      price: String(tx.price),
      fee: String(tx.fee),
      tax: String(tx.tax),
      note: tx.note ?? "",
    });
  }, [isEditing, tx]);

  const account = accounts.find((a) => a.id === tx.accountId);
  const currency = account?.currency ?? "TWD";
  const isCash = CASH_TYPES.has(form.type);
  const isCashTx = CASH_TYPES.has(tx.type);
  const hasSymbol = !isCashTx && !!tx.symbol;

  const settlement = useMemo(
    () =>
      computeTransactionSettlement(
        tx.type,
        tx.quantity,
        tx.price,
        tx.fee,
        tx.tax,
      ),
    [tx.type, tx.quantity, tx.price, tx.fee, tx.tax],
  );

  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        accountId: form.accountId,
        type: form.type,
        date: form.date,
        note: form.note || null,
      };
      if (isCash) {
        payload.price = parseFloat(form.price);
      } else {
        payload.symbol = form.symbol.toUpperCase();
        payload.quantity = parseFloat(form.quantity);
        payload.price = parseFloat(form.price);
        payload.fee = parseFloat(form.fee) || 0;
        payload.tax = parseFloat(form.tax) || 0;
        payload.autoFeeTax = false;
      }

      const res = await fetch(`/api/transactions/${tx.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json();
        alert(err.error ?? "儲存失敗");
        return;
      }
      const updated = (await res.json()) as { warning?: string | null };
      if (updated.warning) alert(updated.warning);
      onCancelEdit();
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  /** 買／賣的手續費、稅率通常不一樣（帳戶設定裡有分開的買進/賣出費率），改交易
   *  類型後舊的手續費／稅金額不會自動跟著變，容易漏改造成金額錯誤——這裡改
   *  類型時直接照目前的標的／數量／單價／日期重新查一次費率並覆蓋掉。 */
  async function handleTypeChange(nextType: string) {
    setForm((f) => ({ ...f, type: nextType }));
    if (CASH_TYPES.has(nextType)) return;
    if (!form.symbol || !form.quantity || !form.price || !form.accountId) return;
    const nextAccount = accounts.find((a) => a.id === form.accountId);
    try {
      const params = new URLSearchParams({
        symbol: form.symbol,
        date: form.date,
        type: nextType,
        accountId: form.accountId,
        quantity: form.quantity,
        price: form.price,
        roundHalfUp: nextAccount?.feeTaxRoundHalfUp ? "1" : "0",
      });
      const res = await fetch(`/api/transactions/preview?${params}`);
      if (!res.ok) return;
      const data = (await res.json()) as { fee: number; tax: number };
      setForm((f) =>
        f.type === nextType
          ? { ...f, fee: formatFeeTaxAmount(data.fee), tax: formatFeeTaxAmount(data.tax) }
          : f,
      );
    } catch {
      // 查詢失敗就保留原本的手續費／稅，使用者仍可手動調整
    }
  }

  async function remove() {
    if (!confirm("確定刪除此交易？")) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/transactions/${tx.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const err = await res.json();
        alert(err.error ?? "刪除失敗");
        return;
      }
      onDeleted();
    } finally {
      setSaving(false);
    }
  }

  const isTaiwanStockTx =
    !isCashTx && !!tx.symbol && /\.(TW|TWO)$/i.test(tx.symbol.trim());

  if (isEditing) {
    return (
      <tr className="border-b border-[var(--color-card-border)]/60 bg-[var(--color-primary)]/5">
        <td colSpan={columnOrder.length} className="py-4">
          <div className="grid gap-3 md:grid-cols-4">
            <div>
              <label className="mb-1 block text-xs text-[var(--color-muted)]">
                日期
              </label>
              <Input
                type="date"
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-[var(--color-muted)]">
                帳戶
              </label>
              <Select
                value={form.accountId}
                onChange={(e) =>
                  setForm({ ...form, accountId: e.target.value })
                }
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-[var(--color-muted)]">
                類型
              </label>
              <Select
                value={form.type}
                onChange={(e) => void handleTypeChange(e.target.value)}
              >
                <option value="BUY">BUY</option>
                <option value="SELL">SELL</option>
                <option value="DIVIDEND">DIVIDEND</option>
                <option value="DEPOSIT">DEPOSIT</option>
                <option value="WITHDRAWAL">WITHDRAWAL</option>
              </Select>
            </div>
            {!isCash && (
              <div>
                <label className="mb-1 block text-xs text-[var(--color-muted)]">
                  代碼
                </label>
                <Input
                  value={form.symbol}
                  onChange={(e) => setForm({ ...form, symbol: e.target.value })}
                />
              </div>
            )}
            {!isCash && (
              <div>
                <label className="mb-1 block text-xs text-[var(--color-muted)]">
                  數量
                </label>
                <Input
                  type="number"
                  step="any"
                  value={form.quantity}
                  onChange={(e) =>
                    setForm({ ...form, quantity: e.target.value })
                  }
                />
              </div>
            )}
            <div>
              <label className="mb-1 block text-xs text-[var(--color-muted)]">
                {isCash ? "金額" : "單價"}
              </label>
              <Input
                type="number"
                step="any"
                value={form.price}
                onChange={(e) => setForm({ ...form, price: e.target.value })}
              />
            </div>
            {!isCash && (
              <>
                <div>
                  <label className="mb-1 block text-xs text-[var(--color-muted)]">
                    手續費
                  </label>
                  <Input
                    type="number"
                    step="any"
                    value={form.fee}
                    onChange={(e) => setForm({ ...form, fee: e.target.value })}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-[var(--color-muted)]">
                    稅
                  </label>
                  <Input
                    type="number"
                    step="any"
                    value={form.tax}
                    onChange={(e) => setForm({ ...form, tax: e.target.value })}
                  />
                </div>
              </>
            )}
            <div className="md:col-span-2">
              <label className="mb-1 block text-xs text-[var(--color-muted)]">
                備註
              </label>
              <Input
                value={form.note}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
              />
            </div>
          </div>
          <div className="mt-3 flex items-center gap-1">
            <button
              type="button"
              onClick={save}
              disabled={saving}
              aria-label="儲存"
              title="儲存"
              className="rounded-md p-1.5 text-[var(--color-muted)] transition-colors hover:bg-[color-mix(in_srgb,var(--color-primary)_12%,transparent)] hover:text-[var(--color-primary)] disabled:opacity-50"
            >
              <Save className="h-4 w-4" aria-hidden />
            </button>
            <button
              type="button"
              onClick={onCancelEdit}
              disabled={saving}
              aria-label="取消"
              title="取消"
              className="rounded-md p-1.5 text-[var(--color-muted)] transition-colors hover:bg-[color-mix(in_srgb,var(--color-foreground)_6%,transparent)] hover:text-[var(--color-primary)] disabled:opacity-50"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
            <button
              type="button"
              onClick={remove}
              disabled={saving}
              aria-label="刪除"
              title="刪除"
              className="rounded-md p-1.5 text-[var(--color-muted)] transition-colors hover:bg-[color-mix(in_srgb,var(--color-negative)_12%,transparent)] hover:text-[var(--color-negative)] disabled:opacity-50"
            >
              <Trash2 className="h-4 w-4" aria-hidden />
            </button>
          </div>
        </td>
      </tr>
    );
  }

  const numericClass = "py-3 pr-4 text-right tabular-nums";

  function renderCell(col: TxColumnId) {
    switch (col) {
      case "date":
        return (
          <td
            key={col}
            className="py-3 pr-4 whitespace-nowrap tabular-nums text-[var(--color-foreground)]"
          >
            {formatDate(tx.date)}
          </td>
        );
      case "symbol":
        return (
          <td key={col} className="max-w-[14rem] py-3 pr-4">
            {hasSymbol ? (
              <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
                <Link
                  href={instrumentHref(tx.symbol!, pathname)}
                  className="shrink-0 font-mono text-[var(--color-primary)] hover:underline"
                >
                  {tx.symbol}
                </Link>
                {tx.instrumentName ? (
                  <Link
                    href={instrumentHref(tx.symbol!, pathname)}
                    className="min-w-0 truncate text-xs text-[var(--color-muted)] hover:text-[var(--color-primary)] hover:underline"
                  >
                    {tx.instrumentName}
                  </Link>
                ) : null}
              </div>
            ) : (
              <span className="text-[var(--color-muted)]">—</span>
            )}
          </td>
        );
      case "account":
        return (
          <td key={col} className="py-3 pr-4">
            {tx.accountName}
          </td>
        );
      case "type":
        return (
          <td
            key={col}
            className={cn(
              "py-3 pr-4 font-medium",
              transactionTypeClass(tx.type),
            )}
          >
            {formatTransactionType(tx.type)}
          </td>
        );
      case "quantity":
        return (
          <td key={col} className={numericClass}>
            {isCashTx ? "—" : tx.quantity.toLocaleString("zh-TW")}
          </td>
        );
      case "price":
        return (
          <td key={col} className={numericClass}>
            {isTaiwanStockTx
              ? formatTransactionAmount(tx.price)
              : formatCurrency(tx.price, currency)}
          </td>
        );
      case "fee":
        return (
          <td
            key={col}
            className={cn(numericClass, "text-[var(--color-muted)]")}
          >
            {isCashTx ? "—" : formatFeeTaxAmount(tx.fee)}
          </td>
        );
      case "tax":
        return (
          <td
            key={col}
            className={cn(numericClass, "text-[var(--color-muted)]")}
          >
            {isCashTx ? "—" : formatFeeTaxAmount(tx.tax)}
          </td>
        );
      case "total":
        return (
          <td
            key={col}
            className={cn(
              numericClass,
              "font-medium",
              settlement?.isOutflow ? "negative" : settlement ? "positive" : "",
            )}
          >
            {settlement
              ? `${settlement.isOutflow ? "−" : "+"}${
                  isTaiwanStockTx
                    ? formatTransactionAmount(Math.abs(settlement.net))
                    : formatCurrency(Math.abs(settlement.net), currency)
                }`
              : "—"}
          </td>
        );
      case "note":
        return (
          <td key={col} className="max-w-[14rem] py-3 pr-4 align-middle">
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-[var(--color-muted)]" title={tx.note ?? undefined}>
                {tx.note?.trim() ? tx.note : "—"}
              </span>
              <Button
                type="button"
                variant="ghost"
                className="h-8 shrink-0 px-2 text-xs"
                onClick={onStartEdit}
              >
                編輯
              </Button>
            </div>
          </td>
        );
      default:
        return null;
    }
  }

  return (
    <tr className="border-b border-[var(--color-card-border)]/40 hover:bg-[color-mix(in_srgb,var(--color-foreground)_4%,transparent)]">
      {columnOrder.map((col) => renderCell(col))}
    </tr>
  );
}
