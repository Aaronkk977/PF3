"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { MoreVertical } from "lucide-react";
import { cn } from "@/lib/utils";

export type DropdownMenuItem = {
  key: string;
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  danger?: boolean;
};

/** 精簡的 icon 觸發下拉選單，收納次要／低頻操作，避免按鈕列過度擁擠 */
export function DropdownMenu({
  items,
  icon,
  ariaLabel = "更多操作",
}: {
  items: DropdownMenuItem[];
  icon?: ReactNode;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  if (items.length === 0) return null;

  return (
    <div ref={rootRef} className="relative inline-block">
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--color-card-border)] text-[var(--color-muted)] transition-colors hover:border-[color-mix(in_srgb,var(--color-primary)_50%,transparent)] hover:text-[var(--color-primary)]",
          open && "border-[var(--color-primary)]/50 text-[var(--color-primary)]",
        )}
      >
        {icon ?? <MoreVertical className="h-4 w-4" aria-hidden />}
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-1 min-w-[8.5rem] overflow-hidden rounded-md border border-[var(--color-card-border)] bg-[var(--color-background)] py-1 shadow-lg"
        >
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
              className={cn(
                "block w-full px-3 py-2 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                item.danger
                  ? "text-[var(--color-negative)] hover:bg-[color-mix(in_srgb,var(--color-negative)_12%,transparent)]"
                  : "text-[var(--color-foreground)] hover:bg-[var(--color-card-border)]/40",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
