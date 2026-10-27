"use client";

import { useEffect } from "react";
import { uploadLocalOnlySettings } from "@/lib/persisted-settings";

/** 從舊版（設定只存在 localStorage）升級時，把這個瀏覽器裡資料庫還沒有的
 *  設定上傳一次。serverKeys 是這次頁面載入時資料庫已有的設定。 */
export function SettingsMigration({ serverKeys }: { serverKeys: string[] }) {
  useEffect(() => {
    uploadLocalOnlySettings(serverKeys);
    // 只在第一次載入時跑；之後的變動都由 writeSetting 直接存回資料庫
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}
