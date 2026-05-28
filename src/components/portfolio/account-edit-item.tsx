"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

export function AccountEditItem({
  account,
  onUpdated,
}: {
  account: { id: string; name: string; currency: string; cash: number };
  onUpdated: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(account.name);
  const [currency, setCurrency] = useState(account.currency);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/accounts/${account.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, currency }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error ?? "更新失敗");
        return;
      }
      setEditing(false);
      onUpdated();
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <li className="space-y-2 border-b border-[var(--color-card-border)]/40 py-3">
        <Input value={name} onChange={(e) => setName(e.target.value)} />
        <Select value={currency} onChange={(e) => setCurrency(e.target.value)}>
          <option value="TWD">TWD</option>
          <option value="USD">USD</option>
        </Select>
        <div className="flex gap-2">
          <Button type="button" className="h-8 flex-1 text-xs" onClick={save} disabled={saving}>
            儲存
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="h-8 flex-1 text-xs"
            onClick={() => {
              setName(account.name);
              setCurrency(account.currency);
              setEditing(false);
            }}
          >
            取消
          </Button>
        </div>
      </li>
    );
  }

  return (
    <li className="flex items-center justify-between gap-2 border-b border-[var(--color-card-border)]/40 py-2">
      <span className="min-w-0 flex-1">
        {account.name}{" "}
        <span className="text-xs text-[var(--color-muted)]">({account.currency})</span>
        <span className="mt-0.5 block tabular-nums text-xs text-[var(--color-primary)]">
          現金 {account.cash.toLocaleString("zh-TW")}
        </span>
      </span>
      <Button
        type="button"
        variant="ghost"
        className="h-8 shrink-0 px-2 text-xs"
        onClick={() => setEditing(true)}
      >
        編輯
      </Button>
    </li>
  );
}
