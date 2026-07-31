import "server-only";

import { prisma } from "@/lib/db";
import { correctInstrumentCurrencies } from "@/lib/portfolio-engine";
import { syncSplitsForHeldInstruments } from "@/lib/stock-splits";
import { correctWatchlistItemNames } from "@/lib/watchlist";

/** 24 小時冷卻，跟股票分割逐檔標的的冷卻是分開的概念——這裡是「整包開機
 *  維護要不要重跑」的總開關，只有一列（id 固定 1）。 */
const COOLDOWN_MS = 24 * 60 * 60 * 1000;

export type MaintenancePhase =
  | "idle"
  | "checking-splits"
  | "correcting-currencies"
  | "correcting-watchlist-names"
  | "done";

let phase: MaintenancePhase = "idle";
/** 整個 Node 行程只會真的觸發一次（除非冷卻到期），第一個打 /api/startup/status
 *  的請求會建立這個 promise，後續請求（含同一次開機同時打進來的多個請求）
 *  一律等同一個 promise，不會各自重跑一次。 */
let inFlight: Promise<void> | null = null;

export function getMaintenancePhase(): MaintenancePhase {
  return phase;
}

/** 供頁面查詢路徑（getHoldings／getWatchlists）呼叫：確保開機維護「已經
 *  跑過或正在跑」，但不會讓頁面查詢本身等待或重複觸發——維護工作跟頁面
 *  資料查詢是兩條獨立的路，這裡只負責啟動，不 await。 */
export function ensureStartupMaintenanceStarted(): void {
  void ensureStartupMaintenance();
}

/** 供 /api/startup/status 呼叫：真的等維護跑完（或確認冷卻中不用跑）才回傳。 */
export function ensureStartupMaintenance(): Promise<void> {
  if (!inFlight) {
    inFlight = runIfDue().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

async function runIfDue(): Promise<void> {
  const row = await prisma.appMaintenance.findUnique({ where: { id: 1 } });
  if (row?.lastRunAt && Date.now() - row.lastRunAt.getTime() < COOLDOWN_MS) {
    phase = "done";
    return;
  }

  try {
    phase = "checking-splits";
    await syncSplitsForHeldInstruments().catch((e) =>
      console.error("[startup-maintenance] split sync failed", e),
    );

    phase = "correcting-currencies";
    await correctInstrumentCurrencies().catch((e) =>
      console.error("[startup-maintenance] currency correction failed", e),
    );

    phase = "correcting-watchlist-names";
    await correctWatchlistItemNames().catch((e) =>
      console.error("[startup-maintenance] watchlist name correction failed", e),
    );

    await prisma.appMaintenance.upsert({
      where: { id: 1 },
      create: { id: 1, lastRunAt: new Date() },
      update: { lastRunAt: new Date() },
    });
  } finally {
    phase = "done";
  }
}
