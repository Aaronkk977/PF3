"use client";

import { useEffect, type ReactNode } from "react";

/** 置中彈出視窗：點背景或 Esc 關閉 */
export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-lg border border-[var(--color-card-border)] bg-[var(--color-background)] p-5 shadow-xl">
        <h2 className="mb-4 text-base font-semibold text-[var(--color-foreground)]">
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}
