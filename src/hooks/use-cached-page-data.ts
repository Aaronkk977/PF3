"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { readClientCache, writeClientCache } from "@/lib/client-data-cache";
import { parseResponseJson } from "@/lib/utils";

export function useCachedPageData<T>(cacheKey: string, fetchUrl: string) {
  const [data, setData] = useState<T | null>(() => readClientCache<T>(cacheKey));
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  const dataRef = useRef<T | null>(data);
  dataRef.current = data;

  const refresh = useCallback(
    async (opts?: { silent?: boolean }) => {
      const silent = opts?.silent ?? dataRef.current != null;
      setRefreshing(true);
      setError(null);
      try {
        const res = await fetch(fetchUrl, { cache: "no-store" });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(
            (body as { error?: string }).error ?? `載入失敗 (${res.status})`,
          );
        }
        const json = await parseResponseJson<T>(res);
        if (!mounted.current) return;
        if (json == null) {
          throw new Error("伺服器回傳空白資料");
        }
        setData(json);
        writeClientCache(cacheKey, json);
      } catch (e) {
        if (!mounted.current) return;
        if (!dataRef.current) {
          setError(e instanceof Error ? e.message : "載入失敗");
        }
      } finally {
        if (mounted.current) setRefreshing(false);
      }
    },
    [cacheKey, fetchUrl],
  );

  useEffect(() => {
    mounted.current = true;
    const cached = readClientCache<T>(cacheKey);
    if (cached) setData(cached);
    void refresh({ silent: cached != null });
    return () => {
      mounted.current = false;
    };
  }, [cacheKey, fetchUrl, refresh]);

  return {
    data,
    refreshing,
    error,
    refresh,
    isPending: data == null && refreshing,
  };
}
