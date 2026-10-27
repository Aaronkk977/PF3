/** 存進資料庫（AppSetting）的使用者設定。這些原本只存在瀏覽器的
 *  localStorage，而 localStorage 是依網址（含埠號）分開存的——換了埠號、從
 *  launcher 換到桌面版，設定就讀不到。現在以資料庫為準，localStorage 只是
 *  頁面同步讀取用的副本（見 app/layout.tsx 的開頁灌值與 persisted-settings.ts）。
 *
 *  快取類的資料（各頁 API 回應、持股市值走勢、分析頁計算結果）不在這裡，
 *  它們本來就只該留在本機。client／server 共用，不能 import 任何 server 模組。 */
export const SYNCED_SETTING_KEYS = [
  "portfolio-app-settings",
  "portfolio-custom-currencies",
  "portfolio-holdings-prefs",
  "portfolio-dashboard-prefs",
  "portfolio-transactions-prefs",
  "portfolio-recent-instruments",
  "portfolio-performance-prefs",
  "notes-drawer-width",
  "notes-editor-mode",
] as const;

export type SyncedSettingKey = (typeof SYNCED_SETTING_KEYS)[number];

export function isSyncedSettingKey(key: string): key is SyncedSettingKey {
  return (SYNCED_SETTING_KEYS as readonly string[]).includes(key);
}

/** 分析頁偏好裡夾帶的計算結果快取，不送進資料庫 */
const LOCAL_ONLY_FIELDS: Partial<Record<SyncedSettingKey, string[]>> = {
  "portfolio-performance-prefs": ["cachedResult", "cachedAt", "cacheKey"],
};

/** 要寫進資料庫前，拿掉只該留在本機的欄位 */
export function toStoredSettingValue(key: SyncedSettingKey, value: unknown): unknown {
  const omit = LOCAL_ONLY_FIELDS[key];
  if (!omit || !value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value).filter(([field]) => !omit.includes(field)),
  );
}
