"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Pencil, Save, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
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
import { pageRequestHeaders } from "@/lib/page-request-headers";
import { PAGE_CACHE_KEYS } from "@/lib/client-data-cache";

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
  const [entered, setEntered] = useState(false);
  /** 使用者手動改過手續費／稅之後，就不要再被下面的自動重算蓋掉——跟新增交易
   *  表單（transactions-client.tsx）同一套保護邏輯。 */
  const feeTaxTouched = useRef(false);
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
  const account = accounts.find((a) => a.id === tx.accountId);
  const currency = account?.currency ?? "TWD";
  const isCash = CASH_TYPES.has(form.type);
  const isCashTx = CASH_TYPES.has(tx.type);
  const hasSymbol = !isCashTx && !!tx.symbol;

  useEffect(() => {
    if (!isEditing) {
      setEntered(false);
      return;
    }
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
    feeTaxTouched.current = false;
    // 進場動畫：先讓「未進場」的樣式（透明、微微上移）在 DOM 上落地一個 frame，
    // 下一輪才切成「已進場」觸發 CSS transition，不然一開始就套用最終樣式會
    // 直接跳出來，沒有動畫效果（跟 drawer.tsx 的做法一致）。
    const id = window.setTimeout(() => setEntered(true), 10);
    return () => window.clearTimeout(id);
  }, [isEditing, tx]);

  /** 改數量／單價／類型／日期／帳戶任一項，debounce 350ms 後重新查一次手續費／
   *  稅並帶入表單——跟新增交易表單同一套機制。以前這裡只有「類型」下拉選單的
   *  onChange 會觸發重算（見已移除的 handleTypeChange），改數量或單價完全不會
   *  更新手續費／稅，容易留著跟新金額對不上的舊值。 */
  useEffect(() => {
    if (!isEditing || isCash) return;
    if (!form.symbol || !form.date || !form.accountId) return;
    if (!form.quantity || !form.price) return;

    const controller = new AbortController();
    const nextAccount = accounts.find((a) => a.id === form.accountId);
    const timer = window.setTimeout(async () => {
      try {
        const params = new URLSearchParams({
          symbol: form.symbol,
          date: form.date,
          type: form.type,
          accountId: form.accountId,
          quantity: form.quantity,
          price: form.price,
          roundHalfUp: nextAccount?.feeTaxRoundHalfUp ? "1" : "0",
        });
        const res = await fetch(`/api/transactions/preview?${params}`, {
          signal: controller.signal,
          headers: pageRequestHeaders(PAGE_CACHE_KEYS.transactions),
        });
        if (!res.ok) return;
        const data = (await res.json()) as { fee: number; tax: number };
        if (!feeTaxTouched.current) {
          setForm((f) => ({
            ...f,
            fee: formatFeeTaxAmount(data.fee),
            tax: formatFeeTaxAmount(data.tax),
          }));
        }
      } catch {
        // 查詢失敗就保留原本的手續費／稅，使用者仍可手動調整
      }
    }, 350);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [
    isEditing,
    isCash,
    form.symbol,
    form.date,
    form.type,
    form.accountId,
    form.quantity,
    form.price,
    accounts,
  ]);

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
      <tr className="border-b border-[var(--color-card-border)]/60">
        <td colSpan={columnOrder.length} className="py-3">
          <div
            className={cn(
              "rounded-lg border border-[var(--color-primary)]/30 bg-[var(--color-card)]/80 p-4 glow-border backdrop-blur-sm transition-all duration-200 ease-out",
              entered ? "translate-y-0 opacity-100" : "-translate-y-1 opacity-0",
            )}
          >
            <div className="mb-4 flex items-center gap-1.5 text-xs font-semibold tracking-widest text-[var(--color-primary)] uppercase">
              <Pencil className="h-3.5 w-3.5" aria-hidden />
              編輯交易
            </div>

            {/* 交易資訊：何時、何處、何種類型、標的 */}
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
                  onChange={(e) => setForm({ ...form, type: e.target.value })}
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
                    onChange={(e) =>
                      setForm({ ...form, symbol: e.target.value })
                    }
                  />
                </div>
              )}
            </div>

            {/* 數量與成本：quantity/price/fee/tax 是同一組會互相影響的數字
             *（見 computeTransactionSettlement），放在一起才看得出彼此關聯，
             *  改其中任一項也是下面那支 useEffect 會重新試算手續費／稅的觸發點。 */}
            <div className="mt-4 grid gap-3 md:grid-cols-4">
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
                      onChange={(e) => {
                        feeTaxTouched.current = true;
                        setForm({ ...form, fee: e.target.value });
                      }}
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
                      onChange={(e) => {
                        feeTaxTouched.current = true;
                        setForm({ ...form, tax: e.target.value });
                      }}
                    />
                  </div>
                </>
              )}
            </div>

            <div className="mt-4">
              <label className="mb-1 block text-xs text-[var(--color-muted)]">
                備註
              </label>
              <Input
                value={form.note}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
              />
            </div>

            <div className="mt-4 flex items-center gap-2 border-t border-[var(--color-card-border)]/50 pt-3">
              <button
                type="button"
                onClick={remove}
                disabled={saving}
                aria-label="刪除"
                title="刪除"
                className="mr-auto rounded-md p-1.5 text-[var(--color-muted)] transition-colors hover:bg-[color-mix(in_srgb,var(--color-negative)_12%,transparent)] hover:text-[var(--color-negative)] disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4" aria-hidden />
              </button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onCancelEdit}
                disabled={saving}
              >
                <X className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                取消
              </Button>
              <Button
                type="button"
                variant="default"
                size="sm"
                onClick={save}
                disabled={saving}
              >
                <Save className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                {saving ? "儲存中…" : "儲存"}
              </Button>
            </div>
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
