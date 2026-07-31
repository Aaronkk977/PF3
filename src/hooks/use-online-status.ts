"use client";

import { useEffect, useState } from "react";

const PROBE_INTERVAL_MS = 20_000;
const PROBE_TIMEOUT_MS = 5_000;
/**
 * 高可用性的靜態端點，用來做連線探測（Android/Chrome OS 也用同一顆判斷是否
 * 「真的」連上網際網路）。用 no-cors 送出，讀不到回應內容沒關係，重點是
 * fetch 有沒有丟出網路錯誤／逾時。
 */
const PROBE_URL = "https://www.gstatic.com/generate_204";

async function probeConnectivity(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    await fetch(PROBE_URL, {
      mode: "no-cors",
      cache: "no-store",
      signal: controller.signal,
    });
    clearTimeout(timer);
    return true;
  } catch {
    return false;
  }
}

/**
 * 追蹤真實連線狀態。
 *
 * 單純依賴瀏覽器的 online/offline 事件並不可靠：這兩個事件反映的是「網路
 * 介面是否連上路由器」，不是「路由器是否連得到網際網路」——訊號弱、或路由
 * 器本身斷網但 WiFi 仍顯示已連線時，瀏覽器經常完全不會觸發這兩個事件。
 * 因此這裡改為「事件 + 主動探測」雙軌：events 提供即時反應（真的拔線時秒
 * 反應），定時對外送一個輕量請求則負責抓到「介面正常但實際上不通網路」的
 * 情況，兩者任一判定離線就顯示提示。
 *
 * 初始值一律先假設「在線」（SSR 與客戶端首次渲染保證一致，避免 hydration
 * mismatch），真正的偵測改到 useEffect（只在瀏覽器執行）進行。
 */
export function useOnlineStatus(): boolean {
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function check() {
      const reachable = await probeConnectivity();
      if (!cancelled) setIsOnline(reachable);
    }

    void check();
    const interval = setInterval(() => void check(), PROBE_INTERVAL_MS);

    function goOffline() {
      setIsOnline(false);
    }
    function goOnline() {
      // 介面剛恢復不代表真的通網路，重新探測一次才可信。
      void check();
    }
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);

    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  return isOnline;
}
