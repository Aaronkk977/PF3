"use client";

import { useEffect, useRef, useState } from "react";
import { Wifi, WifiOff, X } from "lucide-react";
import { useOnlineStatus } from "@/hooks/use-online-status";

const RECONNECTED_DISPLAY_MS = 3000;

function CloseButton({ onClick, tone }: { onClick: () => void; tone: "amber" | "positive" }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="關閉"
      className={
        tone === "amber"
          ? "ml-1 shrink-0 rounded p-0.5 text-amber-200/70 transition-colors hover:text-amber-200"
          : "ml-1 shrink-0 rounded p-0.5 text-[var(--color-positive)]/70 transition-colors hover:text-[var(--color-positive)]"
      }
    >
      <X className="h-3 w-3" />
    </button>
  );
}

/** 全站連線狀態提示：離線時常駐（可關閉，斷線再發生會重新顯示）；恢復連線時短暫提示。 */
export function ConnectivityBanner() {
  const isOnline = useOnlineStatus();
  const [dismissed, setDismissed] = useState(false);
  const [showReconnected, setShowReconnected] = useState(false);
  const wasOffline = useRef(false);

  useEffect(() => {
    if (!isOnline) {
      wasOffline.current = true;
      setDismissed(false);
      setShowReconnected(false);
      return;
    }
    if (wasOffline.current) {
      wasOffline.current = false;
      setShowReconnected(true);
      const timer = setTimeout(() => setShowReconnected(false), RECONNECTED_DISPLAY_MS);
      return () => clearTimeout(timer);
    }
  }, [isOnline]);

  if (!isOnline) {
    if (dismissed) return null;
    return (
      <div
        className="fixed top-20 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-md border border-amber-500/30 bg-[var(--color-card)]/95 px-3 py-2 text-xs text-amber-200/90 shadow-md backdrop-blur-sm"
        role="status"
      >
        <WifiOff className="h-3.5 w-3.5 shrink-0" aria-hidden />
        目前離線，資料可能無法更新
        <CloseButton tone="amber" onClick={() => setDismissed(true)} />
      </div>
    );
  }

  if (showReconnected) {
    return (
      <div
        className="fixed top-20 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-md border border-[var(--color-positive)]/30 bg-[var(--color-card)]/95 px-3 py-2 text-xs text-[var(--color-positive)] shadow-md backdrop-blur-sm"
        role="status"
      >
        <Wifi className="h-3.5 w-3.5 shrink-0" aria-hidden />
        已恢復連線
        <CloseButton tone="positive" onClick={() => setShowReconnected(false)} />
      </div>
    );
  }

  return null;
}
