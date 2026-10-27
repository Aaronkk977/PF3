import {
  isSyncedSettingKey,
  SYNCED_SETTING_KEYS,
  toStoredSettingValue,
} from "@/lib/setting-keys";

/** 瀏覽器端寫設定：寫進 localStorage（頁面同步讀取用），同時存回資料庫。
 *  連續快速變動（拖曳抽屜寬度、打字篩選）會合併成一次寫入；關閉或切走
 *  頁面時把還沒送出的立刻送出。 */

const DEBOUNCE_MS = 400;
const pending = new Map<string, unknown>();
let timer: ReturnType<typeof setTimeout> | null = null;
let flushHooked = false;

/** 寫入一個設定。value 為原始字串時（例如抽屜寬度）照樣存字串。 */
export function writeSetting(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      key,
      typeof value === "string" ? value : JSON.stringify(value),
    );
  } catch {
    // 本機寫不進去（容量滿）也照樣存回資料庫
  }
  if (!isSyncedSettingKey(key)) return;
  pending.set(key, value);
  hookFlushOnLeave();
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => flush(false), DEBOUNCE_MS);
}

function flush(keepalive: boolean): void {
  if (timer) clearTimeout(timer);
  timer = null;
  for (const [key, value] of pending) {
    if (!isSyncedSettingKey(key)) continue;
    void fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value: toStoredSettingValue(key, value) }),
      keepalive,
    }).catch(() => {
      // 離線或伺服器重啟中：本機已經存了，下次變動時會再送
    });
  }
  pending.clear();
}

function hookFlushOnLeave(): void {
  if (flushHooked) return;
  flushHooked = true;
  window.addEventListener("pagehide", () => flush(true));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush(true);
  });
}

/** 資料庫還沒有、但這個瀏覽器的 localStorage 有的設定，上傳一次。
 *  用於從「只存 localStorage」的舊版升級：第一次開新版時把原本的設定搬進
 *  資料庫，之後就以資料庫為準。 */
export function uploadLocalOnlySettings(serverKeys: readonly string[]): void {
  if (typeof window === "undefined") return;
  const known = new Set(serverKeys);
  for (const key of SYNCED_SETTING_KEYS) {
    if (known.has(key)) continue;
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(key);
    } catch {
      continue;
    }
    if (raw == null) continue;
    let value: unknown = raw;
    try {
      value = JSON.parse(raw);
    } catch {
      // 不是 JSON（例如抽屜寬度、編輯器模式），照原字串存
    }
    pending.set(key, value);
  }
  if (pending.size > 0) flush(false);
}
