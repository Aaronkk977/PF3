/** 頁面資料的 client 端快取。
 *  - readClientCache／writeClientCache：記憶體 + sessionStorage，存各頁 API 的
 *    整包回應（切頁時先顯示上次的資料，再背景更新）
 *  - readStoredEntry／writeStoredEntry：localStorage，跨重開保存、以 cacheKey
 *    區分的多筆快取（例如持股頁市值走勢），超過上限時丟掉最舊的
 *  使用者偏好（篩選、排序、期間…）不是快取，放在 ui-prefs.ts。 */

const MEMORY = new Map<string, { data: unknown; at: number }>();

function storageKey(key: string): string {
  return `pp-cache:${key}`;
}

export function readClientCache<T>(key: string, maxAgeMs?: number): T | null {
  const mem = MEMORY.get(key);
  if (mem) {
    if (maxAgeMs == null || Date.now() - mem.at <= maxAgeMs) {
      return mem.data as T;
    }
  }
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(storageKey(key));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { data: T; at: number };
    if (maxAgeMs != null && Date.now() - parsed.at > maxAgeMs) return null;
    MEMORY.set(key, { data: parsed.data, at: parsed.at });
    return parsed.data;
  } catch {
    return null;
  }
}

export function writeClientCache<T>(key: string, data: T): void {
  const at = Date.now();
  MEMORY.set(key, { data, at });
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(storageKey(key), JSON.stringify({ data, at }));
  } catch {
    // quota — memory cache still works for session
  }
}

export function patchClientCache<T extends object>(
  key: string,
  patch: Partial<T> | ((prev: T) => T),
): void {
  const prev = readClientCache<T>(key);
  if (!prev) return;
  const next =
    typeof patch === "function"
      ? patch(prev)
      : ({ ...prev, ...patch } as T);
  writeClientCache(key, next);
}

/** 前四個同時是 sessionStorage 的快取鍵；`performance` 與 `instrument` 沒有
 *  client 端快取，只當作「這個請求屬於哪一頁」的識別用（見
 *  page-request-headers.ts）——頁面識別集中在這裡一份，避免各處散落字串。 */
export const PAGE_CACHE_KEYS = {
  dashboard: "dashboard",
  holdings: "holdings",
  transactions: "transactions",
  trades: "trades",
  notes: "notes",
  performance: "performance",
  instrument: "instrument",
} as const;

/** Remove a single cache entry from both in-memory map and sessionStorage. */
export function clearClientCache(key: string): void {
  MEMORY.delete(key);
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(storageKey(key));
  } catch {
    // ignore
  }
}

/** 從 localStorage 的多筆快取（陣列）裡找 cacheKey 相同的那一筆 */
export function readStoredEntry<T extends { cacheKey: string }>(
  storageKey: string,
  cacheKey: string,
): T | null {
  return readStoredEntries<T>(storageKey).find((e) => e.cacheKey === cacheKey) ?? null;
}

/** 寫入（或取代同 cacheKey 的）一筆，最新的放最前面，只保留 maxEntries 筆 */
export function writeStoredEntry<T extends { cacheKey: string }>(
  storageKey: string,
  entry: T,
  maxEntries: number,
): void {
  if (typeof window === "undefined") return;
  const entries = readStoredEntries<T>(storageKey);
  const next = [entry, ...entries.filter((e) => e.cacheKey !== entry.cacheKey)];
  try {
    localStorage.setItem(storageKey, JSON.stringify(next.slice(0, maxEntries)));
  } catch {
    // quota — 下次進頁重新計算即可
  }
}

function readStoredEntries<T>(storageKey: string): T[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}
