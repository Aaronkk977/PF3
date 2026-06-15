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

export const PAGE_CACHE_KEYS = {
  dashboard: "dashboard",
  holdings: "holdings",
  transactions: "transactions",
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
