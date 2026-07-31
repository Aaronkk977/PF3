import { NextResponse } from "next/server";
import {
  ensureStartupMaintenance,
  getMaintenancePhase,
} from "@/lib/startup-maintenance";

/** 啟動畫面等維護的上限。冷卻期內（絕大多數的啟動）這支是毫秒等級就回來，
 *  只有 24 小時冷卻到期那一次會真的重跑整包維護——而那一次實測要 20 分鐘
 *  （分割偵測每檔要抓 Yahoo 的完整日線，幣別校正還要查 188 檔報價），遠超過
 *  launcher 的 120 秒健康檢查預算。以前這裡是無限等，於是每 24 小時就會有
 *  一次開不起來、啟動畫面報「伺服器啟動失敗」。 */
const MAX_WAIT_MS = 20_000;

/** 開機時給啟動畫面（launcher/splash.hta、Electron 視窗）輪詢用：等「股票分割
 *  偵測 + 幣別／追蹤清單名稱校正」這一整包開機維護跑完（或確認在 24 小時冷卻
 *  內不用重跑）才回傳，讓啟動畫面關閉的當下，後續頁面查詢都不用再等這些維護
 *  工作。等超過 MAX_WAIT_MS 就先放行——維護會在背景繼續跑完，頂多是這一次開機
 *  後前幾次頁面查詢慢一點，總比整個 app 打不開好。 */
export async function GET() {
  try {
    const maintenance = ensureStartupMaintenance();
    // 逾時放行後這個 promise 還會繼續跑，補一個 catch 免得它之後才失敗時
    // 變成沒人接的 unhandled rejection（同一個 promise 接兩次 catch 無妨）。
    maintenance.catch(() => {});

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), MAX_WAIT_MS);
    });
    try {
      await Promise.race([maintenance, timedOut]);
    } finally {
      if (timer) clearTimeout(timer);
    }

    return NextResponse.json({ ready: true, phase: getMaintenancePhase() });
  } catch (e) {
    console.error(e);
    // 維護失敗也不該卡死啟動畫面——回 ready:true，讓 app 照樣打得開，
    // 錯誤已經在 startup-maintenance.ts 內部各自 catch 並記錄。
    return NextResponse.json({ ready: true, phase: "done", error: true });
  }
}
