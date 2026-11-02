"use client";

import { useEffect, useRef } from "react";
import { AUTO_REFRESH_MS, shouldAutoRefresh } from "@/lib/auto-refresh";

/** 多久檢查一次條件；實際更新間隔由 AUTO_REFRESH_MS 決定 */
const CHECK_EVERY_MS = 30_000;

/**
 * 頁面放著不動時，盤中每 3 分鐘自動重新載入（條件見 shouldAutoRefresh）。
 * 視窗縮小時停；切回前景時若已滿間隔就馬上補一次。
 * 報價實際要不要打 Yahoo 仍由伺服器的報價快取決定（lib/quote-freshness.ts）。
 */
export function useAutoRefresh(
  refresh: () => Promise<void>,
  symbols: readonly string[],
  lastUpdatedAt: number | null,
): void {
  const refreshRef = useRef(refresh);
  const symbolsRef = useRef(symbols);
  const lastUpdatedRef = useRef(lastUpdatedAt);
  refreshRef.current = refresh;
  symbolsRef.current = symbols;
  lastUpdatedRef.current = lastUpdatedAt;

  useEffect(() => {
    let inFlight = false;
    const tick = () => {
      if (
        !shouldAutoRefresh({
          now: new Date(),
          visible: document.visibilityState === "visible",
          inFlight,
          lastUpdatedAt: lastUpdatedRef.current,
          symbols: symbolsRef.current,
          intervalMs: AUTO_REFRESH_MS,
        })
      ) {
        return;
      }
      inFlight = true;
      void refreshRef.current().finally(() => {
        inFlight = false;
      });
    };

    const id = setInterval(tick, CHECK_EVERY_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, []);
}
