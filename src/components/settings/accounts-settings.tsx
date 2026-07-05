"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CurrencySelect } from "@/components/settings/currency-select";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { SerializedAccount } from "@/lib/accounts";
import { parseResponseJson } from "@/lib/utils";
import {
  displayFeePermille,
  displayTaxPermille,
} from "@/lib/account-fee-rules";

export function AccountsSettings({
  initialAccounts,
}: {
  initialAccounts: SerializedAccount[];
}) {
  const router = useRouter();
  const [accounts, setAccounts] = useState(initialAccounts);
  const [loading, setLoading] = useState(false);
  const [newName, setNewName] = useState("");
  const [newCurrency, setNewCurrency] = useState("TWD");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, SerializedAccount>>({});

  function getDraft(acc: SerializedAccount): SerializedAccount {
    return drafts[acc.id] ?? acc;
  }

  function patchDraft(id: string, patch: Partial<SerializedAccount>) {
    const base = accounts.find((a) => a.id === id);
    if (!base) return;
    setDrafts((d) => ({
      ...d,
      [id]: { ...getDraft(base), ...patch },
    }));
  }

  async function refreshAccounts() {
    const res = await fetch("/api/accounts");
    if (res.ok) {
      const data = await parseResponseJson<SerializedAccount[]>(res);
      if (data) setAccounts(data);
    }
    router.refresh();
  }

  async function handleCreateAccount(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setLoading(true);
    try {
      const res = await fetch("/api/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim(), currency: newCurrency }),
      });
      const data = await parseResponseJson<{ error?: string }>(res);
      if (!res.ok) {
        alert(data?.error ?? "建立帳戶失敗");
        return;
      }
      setNewName("");
      await refreshAccounts();
    } finally {
      setLoading(false);
    }
  }

  async function saveAccount(id: string) {
    const d = drafts[id];
    if (!d) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/accounts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: d.name,
          currency: d.currency,
          feeRateBpsBuy: d.feeRateBpsBuy,
          feeRateBpsSell: d.feeRateBpsSell,
          taxRatePctBuy: d.taxRatePctBuy,
          taxRatePctSell: d.taxRatePctSell,
          feeTaxRoundHalfUp: d.feeTaxRoundHalfUp,
        }),
      });
      const data = await parseResponseJson<{ error?: string }>(res);
      if (!res.ok) {
        alert(data?.error ?? "儲存失敗");
        return;
      }
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setExpandedId(null);
      await refreshAccounts();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>投資帳戶</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <ul className="space-y-2">
            {accounts.map((acc) => {
              const d = getDraft(acc);
              const open = expandedId === acc.id;
              return (
                <li
                  key={acc.id}
                  className="rounded-lg border border-[var(--color-card-border)]"
                >
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-sm"
                    onClick={() =>
                      setExpandedId(open ? null : acc.id)
                    }
                  >
                    <span>
                      <span className="font-medium">{acc.name}</span>
                      <span className="ml-2 text-xs text-[var(--color-muted)]">
                        {acc.currency} · 現金{" "}
                        {acc.cash.toLocaleString("zh-TW")}
                      </span>
                    </span>
                    <span className="text-xs text-[var(--color-muted)]">
                      {open ? "▲" : "▼"} 展開以編輯
                    </span>
                  </button>
                  {open && (
                    <div className="space-y-3 border-t border-[var(--color-card-border)] px-4 py-3">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div>
                          <label className="mb-1 block text-xs text-[var(--color-muted)]">
                            帳戶名稱
                          </label>
                          <Input
                            value={d.name}
                            onChange={(e) =>
                              patchDraft(acc.id, { name: e.target.value })
                            }
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs text-[var(--color-muted)]">
                            幣別
                          </label>
                          <CurrencySelect
                            value={d.currency}
                            onChange={(currency) =>
                              patchDraft(acc.id, { currency })
                            }
                          />
                        </div>
                      </div>
                      <label className="flex cursor-pointer items-start gap-2 rounded-md border border-[var(--color-card-border)]/60 p-3">
                        <input
                          type="checkbox"
                          checked={d.feeTaxRoundHalfUp}
                          onChange={(e) =>
                            patchDraft(acc.id, {
                              feeTaxRoundHalfUp: e.target.checked,
                            })
                          }
                          className="mt-0.5 rounded border-[var(--color-card-border)]"
                        />
                        <span className="text-xs">
                          <span className="font-medium">手續費與稅無條件捨去（低消 1 元）</span>
                          <span className="mt-0.5 block text-[var(--color-muted)]">
                            自動計算時捨去至整數；金額大於 0 時至少 1 元。未勾選則保留小數
                          </span>
                        </span>
                      </label>
                      <p className="text-xs font-medium text-[var(--color-primary)]">
                        買進規則
                      </p>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div>
                          <label className="mb-1 block text-xs text-[var(--color-muted)]">
                            手續費（‰）
                          </label>
                          <Input
                            type="number"
                            step="0.0001"
                            value={displayFeePermille(
                              d.feeRateBpsBuy,
                              d.feeRateBps,
                            )}
                            onChange={(e) =>
                              patchDraft(acc.id, {
                                feeRateBpsBuy: Number(e.target.value),
                              })
                            }
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs text-[var(--color-muted)]">
                            稅率（‰）
                          </label>
                          <Input
                            type="number"
                            step="0.0001"
                            value={displayTaxPermille(d.taxRatePctBuy, 0)}
                            onChange={(e) =>
                              patchDraft(acc.id, {
                                taxRatePctBuy: Number(e.target.value),
                              })
                            }
                          />
                        </div>
                      </div>
                      <p className="text-xs font-medium text-[var(--color-primary)]">
                        賣出規則
                      </p>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div>
                          <label className="mb-1 block text-xs text-[var(--color-muted)]">
                            手續費（‰）
                          </label>
                          <Input
                            type="number"
                            step="0.0001"
                            value={displayFeePermille(
                              d.feeRateBpsSell,
                              d.feeRateBps,
                            )}
                            onChange={(e) =>
                              patchDraft(acc.id, {
                                feeRateBpsSell: Number(e.target.value),
                              })
                            }
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs text-[var(--color-muted)]">
                            稅率（‰）
                          </label>
                          <Input
                            type="number"
                            step="0.0001"
                            value={displayTaxPermille(
                              d.taxRatePctSell,
                              d.taxRatePct,
                            )}
                            onChange={(e) =>
                              patchDraft(acc.id, {
                                taxRatePctSell: Number(e.target.value),
                              })
                            }
                          />
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          className="h-8 text-xs"
                          disabled={loading}
                          onClick={() => saveAccount(acc.id)}
                        >
                          儲存
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          className="h-8 text-xs"
                          onClick={() => {
                            setDrafts((prev) => {
                              const next = { ...prev };
                              delete next[acc.id];
                              return next;
                            });
                            setExpandedId(null);
                          }}
                        >
                          取消
                        </Button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          <form
            onSubmit={handleCreateAccount}
            className="space-y-2 border-t border-[var(--color-card-border)] pt-4"
          >
            <p className="text-xs font-medium text-[var(--color-muted)]">
              新增帳戶
            </p>
            <Input
              placeholder="帳戶名稱"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <CurrencySelect value={newCurrency} onChange={setNewCurrency} />
            <Button type="submit" disabled={loading} className="w-full">
              新增帳戶
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
