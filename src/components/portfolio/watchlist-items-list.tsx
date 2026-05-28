"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { X } from "lucide-react";
import { useCallback, useState, type DragEvent } from "react";
import { instrumentHref } from "@/lib/instrument-nav";
import { isTaiwanLimitUp } from "@/lib/market-utils";
import type { WatchlistEntry } from "@/lib/watchlist";
import {
  changeToneClass,
  formatCurrency,
  formatPercent,
} from "@/lib/utils";

function reorderById<T extends { id: string }>(
  items: T[],
  sourceId: string,
  targetId: string,
): T[] {
  if (sourceId === targetId) return items;
  const from = items.findIndex((i) => i.id === sourceId);
  const to = items.findIndex((i) => i.id === targetId);
  if (from < 0 || to < 0) return items;
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  return next;
}

function isInteractiveDragTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && !!target.closest("a, button");
}

const WATCHLIST_ROW_GRID =
  "grid grid-cols-[minmax(0,1fr)_5.5rem_4.25rem_4.25rem_1.75rem] items-center gap-x-3 sm:gap-x-4";

export function WatchlistItemsList({
  listId,
  items,
  onItemsChange,
  onRemove,
}: {
  listId: string;
  items: WatchlistEntry[];
  onItemsChange: (items: WatchlistEntry[]) => void;
  onRemove: (symbol: string) => void;
}) {
  const pathname = usePathname();
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);

  const persistOrder = useCallback(
    async (itemIds: string[]) => {
      const res = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "reorderItems",
          listId,
          itemIds,
        }),
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        alert(err.error ?? "排序儲存失敗");
      }
    },
    [listId],
  );

  const handleDrop = useCallback(
    (targetId: string) => {
      if (!draggingId || draggingId === targetId) {
        setDraggingId(null);
        setDropTargetId(null);
        return;
      }
      const next = reorderById(items, draggingId, targetId);
      onItemsChange(next);
      setDraggingId(null);
      setDropTargetId(null);
      void persistOrder(next.map((i) => i.id));
    },
    [draggingId, items, onItemsChange, persistOrder],
  );

  if (items.length === 0) {
    return (
      <p className="py-4 text-sm text-[var(--color-muted)]">此清單尚無標的</p>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div
        className={`${WATCHLIST_ROW_GRID} border border-transparent px-3 pb-0.5 text-[10px] uppercase tracking-wider text-[var(--color-muted)]`}
        aria-hidden
      >
        <div />
        <p className="text-right">現價</p>
        <p className="text-right">今日</p>
        <p className="text-right">一週</p>
        <div />
      </div>
      {items.map((item) => {
        const limitUp = isTaiwanLimitUp(item.symbol, item.changePercent, {
          price: item.price,
          prevClose:
            item.previousClose ??
            (item.change != null && item.price > 0
              ? item.price - item.change
              : null),
        });
        const dragging = draggingId === item.id;
        const dropTarget = dropTargetId === item.id && draggingId !== item.id;

        return (
          <div
            key={item.id}
            draggable
            onDragStart={(e: DragEvent<HTMLDivElement>) => {
              if (isInteractiveDragTarget(e.target)) {
                e.preventDefault();
                return;
              }
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", item.id);
              setDraggingId(item.id);
            }}
            onDragOver={(e: DragEvent<HTMLDivElement>) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              if (draggingId && draggingId !== item.id) {
                setDropTargetId(item.id);
              }
            }}
            onDragLeave={() => {
              setDropTargetId((id) => (id === item.id ? null : id));
            }}
            onDrop={(e: DragEvent<HTMLDivElement>) => {
              e.preventDefault();
              handleDrop(item.id);
            }}
            onDragEnd={() => {
              setDraggingId(null);
              setDropTargetId(null);
            }}
            className={`${WATCHLIST_ROW_GRID} rounded-lg border px-3 py-2.5 transition-[opacity,box-shadow,border-color] cursor-grab active:cursor-grabbing ${
              limitUp
                ? "tw-limit-up border-[var(--color-card-border)]/50"
                : "overflow-hidden border-[var(--color-card-border)]/50 bg-[var(--color-card-border)]/10"
            } ${dragging ? "opacity-50" : ""} ${
              dropTarget
                ? "ring-1 ring-[var(--color-primary)]/50 border-[var(--color-primary)]/40"
                : ""
            }`}
          >
            <div className="min-w-0">
              <Link
                href={instrumentHref(item.symbol, pathname)}
                draggable={false}
                className="font-mono text-sm text-[var(--color-primary)] hover:underline"
              >
                {item.symbol}
              </Link>
              {item.name && (
                <p className="truncate text-xs text-[var(--color-muted)]">
                  {item.name}
                </p>
              )}
            </div>
            <span className="text-right whitespace-nowrap tabular-nums text-sm font-medium">
              {formatCurrency(item.price, "TWD")}
            </span>
            <span
              className={`text-right whitespace-nowrap text-sm font-medium tabular-nums ${changeToneClass(item.changePercent ?? 0)}`}
            >
              {item.changePercent !== null
                ? formatPercent(item.changePercent)
                : "—"}
            </span>
            <span
              className={`text-right whitespace-nowrap text-sm font-medium tabular-nums ${
                changeToneClass(item.weekChangePercent ?? 0)
              }`}
            >
              {item.weekChangePercent !== null
                ? formatPercent(item.weekChangePercent)
                : "—"}
            </span>
            <button
              type="button"
              onClick={() => onRemove(item.symbol)}
              className="justify-self-end rounded p-0.5 text-[var(--color-muted)] transition-colors hover:bg-[var(--color-card-border)]/60 hover:text-[var(--color-negative)]"
              aria-label={`移除 ${item.symbol}`}
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
        );
      })}
    </div>
  );
}
