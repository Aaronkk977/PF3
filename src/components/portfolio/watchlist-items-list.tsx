"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, ChevronRight, Pencil, X } from "lucide-react";
import { useCallback, useState, type DragEvent } from "react";
import { instrumentHref } from "@/lib/instrument-nav";
import { isTaiwanLimitUp } from "@/lib/market-utils";
import type { WatchlistEntry } from "@/lib/watchlist";
import { Input } from "@/components/ui/input";
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
  return target instanceof HTMLElement && !!target.closest("a, button, input");
}

const WATCHLIST_ROW_GRID =
  "grid grid-cols-[minmax(0,1fr)_5.5rem_4.25rem_4.25rem_1.75rem] items-center gap-x-3 sm:gap-x-4";

type SeparatorItem = Extract<WatchlistEntry, { kind: "SEPARATOR" }>;

function SeparatorRow({
  item,
  dragging,
  dragHandleProps,
  collapsed,
  onToggleCollapse,
  onContextMenu,
  onRename,
}: {
  item: SeparatorItem;
  dragging: boolean;
  dragHandleProps: React.HTMLAttributes<HTMLDivElement>;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onRename: (label: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.label);
  const hasLabel = item.label.trim().length > 0;

  function commit() {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed !== item.label) onRename(trimmed);
    else setDraft(item.label);
  }

  return (
    <div
      {...dragHandleProps}
      onContextMenu={onContextMenu}
      title="右鍵可刪除標題"
      className={`group/row flex items-center gap-1.5 rounded-md px-1 py-2 transition-[opacity,box-shadow] cursor-grab active:cursor-grabbing ${
        dragging ? "opacity-50" : ""
      }`}
    >
      <button
        type="button"
        onClick={onToggleCollapse}
        aria-label={collapsed ? "展開" : "收起"}
        className="shrink-0 rounded p-0.5 text-[var(--color-muted)] transition-colors hover:bg-[var(--color-card-border)]/60 hover:text-[var(--color-foreground)]"
      >
        {collapsed ? (
          <ChevronRight className="h-3.5 w-3.5" aria-hidden />
        ) : (
          <ChevronDown className="h-3.5 w-3.5" aria-hidden />
        )}
      </button>
      {editing ? (
        <Input
          autoFocus
          className="h-7 max-w-[60%] shrink-0 text-xs"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            }
            if (e.key === "Escape") {
              setDraft(item.label);
              setEditing(false);
            }
          }}
        />
      ) : hasLabel ? (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="group flex max-w-[60%] shrink-0 items-center gap-1.5 truncate text-left text-[11px] font-semibold uppercase tracking-wider text-[var(--color-muted)] hover:text-[var(--color-foreground)]"
        >
          <span className="truncate">{item.label}</span>
          <Pencil
            className="h-3 w-3 shrink-0 opacity-0 group-hover:opacity-60"
            aria-hidden
          />
        </button>
      ) : null}
      <button
        type="button"
        onClick={() => setEditing(true)}
        aria-label={hasLabel ? undefined : "新增標題文字"}
        tabIndex={hasLabel ? -1 : 0}
        className="h-px flex-1 bg-[var(--color-card-border)]/60 transition-colors hover:bg-[var(--color-primary)]/50"
      />
    </div>
  );
}

/** 一般標的列（可拖曳排序、右鍵新增標題、hover 才顯示刪除鍵） */
function SymbolRow({
  item,
  pathname,
  dragging,
  dragHandleProps,
  onContextMenu,
  onRemove,
}: {
  item: Extract<WatchlistEntry, { kind: "SYMBOL" }>;
  pathname: string;
  dragging: boolean;
  dragHandleProps: React.HTMLAttributes<HTMLDivElement>;
  onContextMenu: (e: React.MouseEvent) => void;
  onRemove: () => void;
}) {
  const limitUp = isTaiwanLimitUp(item.symbol, item.changePercent, {
    price: item.price,
    prevClose:
      item.previousClose ??
      (item.change != null && item.price > 0 ? item.price - item.change : null),
  });

  return (
    <div
      {...dragHandleProps}
      onContextMenu={onContextMenu}
      title="右鍵可在此標的下新增標題"
      className={`group/row ${WATCHLIST_ROW_GRID} rounded-lg border px-3 py-2.5 transition-[opacity,box-shadow,border-color] cursor-grab active:cursor-grabbing ${
        limitUp
          ? "tw-limit-up border-[var(--color-card-border)]/50"
          : "overflow-hidden border-[var(--color-card-border)]/50 bg-[var(--color-card-border)]/10"
      } ${dragging ? "opacity-50" : ""}`}
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
        {item.changePercent !== null ? formatPercent(item.changePercent) : "—"}
      </span>
      <span
        className={`text-right whitespace-nowrap text-sm font-medium tabular-nums ${changeToneClass(item.weekChangePercent ?? 0)}`}
      >
        {item.weekChangePercent !== null
          ? formatPercent(item.weekChangePercent)
          : "—"}
      </span>
      <button
        type="button"
        onClick={onRemove}
        className="justify-self-end rounded p-0.5 text-[var(--color-muted)] opacity-0 transition-[opacity,background-color,color] hover:bg-[var(--color-card-border)]/60 hover:text-[var(--color-negative)] group-hover/row:opacity-100 focus-visible:opacity-100"
        aria-label={`移除 ${item.symbol}`}
      >
        <X className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}

type Block =
  | { kind: "leading"; items: WatchlistEntry[] }
  | { kind: "section"; separator: SeparatorItem; items: WatchlistEntry[] };

function buildBlocks(items: WatchlistEntry[]): Block[] {
  const blocks: Block[] = [];
  let current: WatchlistEntry[] = [];
  let currentSeparator: SeparatorItem | null = null;

  function flush() {
    if (currentSeparator) {
      blocks.push({ kind: "section", separator: currentSeparator, items: current });
    } else if (current.length > 0) {
      blocks.push({ kind: "leading", items: current });
    }
  }

  for (const item of items) {
    if (item.kind === "SEPARATOR") {
      flush();
      current = [];
      currentSeparator = item;
    } else {
      current.push(item);
    }
  }
  flush();
  return blocks;
}

export function WatchlistItemsList({
  listId,
  items,
  onItemsChange,
  onRemove,
  onRenameSeparator,
  onItemContextMenu,
}: {
  listId: string;
  items: WatchlistEntry[];
  onItemsChange: (items: WatchlistEntry[]) => void;
  onRemove: (item: WatchlistEntry) => void;
  onRenameSeparator: (itemId: string, label: string) => void;
  onItemContextMenu?: (item: WatchlistEntry, e: React.MouseEvent) => void;
}) {
  const pathname = usePathname();
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());

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

  function toggleCollapse(id: string) {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (items.length === 0) {
    return (
      <p className="py-4 text-sm text-[var(--color-muted)]">此清單尚無標的</p>
    );
  }

  function dragHandlePropsFor(item: WatchlistEntry): React.HTMLAttributes<HTMLDivElement> {
    return {
      draggable: true,
      onDragStart: (e: DragEvent<HTMLDivElement>) => {
        if (isInteractiveDragTarget(e.target)) {
          e.preventDefault();
          return;
        }
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", item.id);
        setDraggingId(item.id);
      },
      onDragOver: (e: DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (draggingId && draggingId !== item.id) {
          const next = reorderById(items, draggingId, item.id);
          if (next !== items) onItemsChange(next);
        }
      },
      onDrop: (e: DragEvent<HTMLDivElement>) => e.preventDefault(),
      onDragEnd: () => {
        setDraggingId(null);
        void persistOrder(items.map((i) => i.id));
      },
    };
  }

  function renderRow(item: WatchlistEntry) {
    const dragging = draggingId === item.id;
    const dragHandleProps = dragHandlePropsFor(item);

    if (item.kind === "SEPARATOR") {
      return (
        <SeparatorRow
          key={item.id}
          item={item}
          dragging={dragging}
          dragHandleProps={dragHandleProps}
          collapsed={collapsedIds.has(item.id)}
          onToggleCollapse={() => toggleCollapse(item.id)}
          onContextMenu={(e) => {
            e.stopPropagation();
            onItemContextMenu?.(item, e);
          }}
          onRename={(label) => onRenameSeparator(item.id, label)}
        />
      );
    }

    return (
      <SymbolRow
        key={item.id}
        item={item}
        pathname={pathname}
        dragging={dragging}
        dragHandleProps={dragHandleProps}
        onContextMenu={(e) => {
          e.stopPropagation();
          onItemContextMenu?.(item, e);
        }}
        onRemove={() => onRemove(item)}
      />
    );
  }

  const blocks = buildBlocks(items);

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
      {blocks.map((block) => {
        if (block.kind === "leading") {
          return (
            <div key="leading" className="flex flex-col gap-1.5">
              {block.items.map(renderRow)}
            </div>
          );
        }
        const collapsed = collapsedIds.has(block.separator.id);
        return (
          <div key={block.separator.id}>
            {renderRow(block.separator)}
            <div
              className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${
                collapsed ? "grid-rows-[0fr]" : "grid-rows-[1fr]"
              }`}
            >
              <div className="overflow-hidden">
                <div className="flex flex-col gap-1.5 pt-1.5">
                  {block.items.map(renderRow)}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
