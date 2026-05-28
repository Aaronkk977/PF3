"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export function HoldingCategoryCell({
  instrumentId,
  categories,
  allCategories,
  onUpdated,
}: {
  instrumentId: string;
  categories: string[];
  allCategories: string[];
  onUpdated: (categories: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  async function toggleCategory(name: string) {
    const next = categories.includes(name)
      ? categories.filter((c) => c !== name)
      : [...categories, name];
    setSaving(true);
    try {
      const res = await fetch(`/api/instruments/${instrumentId}/tags`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tags: next }),
      });
      if (res.ok) {
        const json = (await res.json()) as { tags: string[] };
        onUpdated(json.tags);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "max-w-[12rem] rounded border border-[var(--color-card-border)]/80 px-2 py-1 text-left text-xs transition-colors hover:border-[var(--color-primary)]/40",
          saving && "opacity-50",
        )}
      >
        {categories.length > 0 ? categories.join(", ") : "—"}
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 min-w-[10rem] rounded-md border border-[var(--color-card-border)] bg-[var(--color-card)] p-2 shadow-lg">
          {allCategories.length === 0 ? (
            <p className="text-xs text-[var(--color-muted)]">尚無類別</p>
          ) : (
            <ul className="max-h-48 space-y-0.5 overflow-y-auto">
              {allCategories.map((name) => (
                <li key={name}>
                  <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-xs hover:bg-[color-mix(in_srgb,var(--color-foreground)_6%,transparent)]">
                    <input
                      type="checkbox"
                      checked={categories.includes(name)}
                      disabled={saving}
                      onChange={() => void toggleCategory(name)}
                      className="accent-[var(--color-primary)]"
                    />
                    {name}
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
