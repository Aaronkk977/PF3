"use client";

import { useEffect, useState } from "react";

/**
 * 追蹤瀏覽器連線狀態（navigator.onLine + online/offline 事件）。
 *
 * 初始值一律先假設「在線」（SSR 與客戶端首次渲染保證一致，避免 hydration
 * mismatch）：新版 Node.js 內建一個不完整的全域 navigator（只有部分欄位、
 * 沒有 onLine），若在 SSR 階段就嘗試讀 navigator.onLine 會讀到 undefined，
 * 讓伺服器端誤判為離線，和瀏覽器端的真實值對不上，造成這個節點 hydrate
 * 失敗後卡住不再更新。真正的偵測改到 useEffect（只在瀏覽器執行）進行。
 */
export function useOnlineStatus(): boolean {
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    setIsOnline(navigator.onLine);

    function goOnline() {
      setIsOnline(true);
    }
    function goOffline() {
      setIsOnline(false);
    }
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  return isOnline;
}
