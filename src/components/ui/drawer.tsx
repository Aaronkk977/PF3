"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { writeSetting } from "@/lib/persisted-settings";
import { cn } from "@/lib/utils";

const WIDTH_STORAGE_KEY = "notes-drawer-width";
const DEFAULT_WIDTH = 820;
const MIN_WIDTH = 480;

function clampWidth(width: number): number {
  const max = typeof window !== "undefined" ? window.innerWidth - 120 : width;
  return Math.min(Math.max(width, MIN_WIDTH), Math.max(max, MIN_WIDTH));
}

const EXIT_DURATION_MS = 300;

/** 從右側滑入的側邊抽屜：右緣貼齊視窗邊緣，上／下／左留一點邊界（圓角在左上角），
 *  左側邊框可拖曳調整寬度 */
export function Drawer({
  left,
  right,
  onClose,
  children,
}: {
  left: ReactNode;
  right?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  const [entered, setEntered] = useState(false);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const resizing = useRef(false);
  const startRef = useRef({ x: 0, width: DEFAULT_WIDTH });
  const closingRef = useRef(false);

  function requestClose() {
    if (closingRef.current) return;
    closingRef.current = true;
    setEntered(false);
    window.setTimeout(onClose, EXIT_DURATION_MS);
  }

  useEffect(() => {
    const id = window.setTimeout(() => setEntered(true), 10);
    const stored = Number(window.localStorage.getItem(WIDTH_STORAGE_KEY));
    if (stored) setWidth(clampWidth(stored));
    return () => window.clearTimeout(id);
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") requestClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  });

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (!resizing.current) return;
      const delta = startRef.current.x - e.clientX;
      setWidth(clampWidth(startRef.current.width + delta));
    }
    function onMouseUp() {
      if (!resizing.current) return;
      resizing.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setWidth((w) => {
        writeSetting(WIDTH_STORAGE_KEY, String(w));
        return w;
      });
    }
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  function startResize(e: React.MouseEvent) {
    resizing.current = true;
    startRef.current = { x: e.clientX, width };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex justify-end bg-black/60 pt-[7vh] pb-4 pl-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) requestClose();
      }}
    >
      <div
        style={{ width }}
        className={cn(
          "relative flex h-full max-w-[92vw] flex-col rounded-tl-2xl border-t border-l border-[var(--color-card-border)] bg-[var(--color-background)] shadow-xl transition-transform duration-300 ease-out",
          entered ? "translate-x-0" : "translate-x-full",
        )}
      >
        <div
          onMouseDown={startResize}
          role="separator"
          aria-orientation="vertical"
          aria-label="調整寬度"
          className="group absolute -left-1.5 top-0 z-10 h-full w-3 cursor-col-resize"
        >
          <div className="mx-auto h-full w-px bg-transparent transition-colors group-hover:bg-[var(--color-primary)]/40" />
        </div>
        <div className="flex items-center justify-between border-b border-[var(--color-card-border)] px-5 py-4">
          <div className="flex min-w-0 items-center gap-2">{left}</div>
          <div className="flex items-center gap-1">
            {right}
            <button
              type="button"
              onClick={requestClose}
              aria-label="關閉"
              className="rounded-md p-1.5 text-[var(--color-muted)] transition-colors hover:bg-[color-mix(in_srgb,var(--color-foreground)_6%,transparent)] hover:text-[var(--color-primary)]"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}
