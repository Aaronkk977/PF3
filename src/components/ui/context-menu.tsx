"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export type ContextMenuItem = {
  key: string;
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  danger?: boolean;
};

export type ContextMenuPosition = { x: number; y: number };

/** 右鍵選單的開關狀態；open 直接餵滑鼠事件即可，會自動 preventDefault */
export function useContextMenu() {
  const [position, setPosition] = useState<ContextMenuPosition | null>(null);

  const open = useCallback((e: { preventDefault: () => void; clientX: number; clientY: number }) => {
    e.preventDefault();
    setPosition({ x: e.clientX, y: e.clientY });
  }, []);

  const close = useCallback(() => setPosition(null), []);

  return { position, open, close };
}

const MENU_WIDTH_ESTIMATE = 160;
const ITEM_HEIGHT_ESTIMATE = 36;

/** 游標位置彈出的右鍵選單，取代常駐按鈕，用於低頻／管理性操作 */
export function ContextMenu({
  position,
  items,
  onClose,
}: {
  position: ContextMenuPosition | null;
  items: ContextMenuItem[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!position) return;
    function onDocMouseDown(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) onClose();
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [position, onClose]);

  if (!position || items.length === 0) return null;

  const menuHeight = items.length * ITEM_HEIGHT_ESTIMATE + 8;
  const left = Math.min(position.x, window.innerWidth - MENU_WIDTH_ESTIMATE - 8);
  const top = Math.min(position.y, window.innerHeight - menuHeight - 8);

  return (
    <div
      ref={ref}
      role="menu"
      style={{ position: "fixed", left: Math.max(8, left), top: Math.max(8, top) }}
      className="z-50 min-w-[8.5rem] overflow-hidden rounded-md border border-[var(--color-card-border)] bg-[var(--color-background)] py-1 shadow-lg"
    >
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          role="menuitem"
          disabled={item.disabled}
          onClick={() => {
            onClose();
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
  );
}
