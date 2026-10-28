"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { readClientCache, writeClientCache } from "@/lib/client-data-cache";
import { pageRequestHeaders } from "@/lib/page-request-headers";
import { parseResponseJson } from "@/lib/utils";

const noopSubscribe = () => () => {};

export function useCachedPageData<T>(cacheKey: string, fetchUrl: string) {
  // 快取在 sessionStorage，伺服器讀不到：hydration 那次一律先用 null（與 SSR
  // 的骨架一致，避免 hydration mismatch），由下面的 effect 掛載後還原快取。
  // hydration 之後的 client 端切頁不經 SSR，就直接同步讀快取，切頁不閃骨架。
  const hydrated = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
  const [data, setData] = useState<T | null>(() =>
    hydrated ? readClientCache<T>(cacheKey) : null,
  );
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  const dataRef = useRef<T | null>(data);
  dataRef.current = data;

  const refresh = useCallback(
    async () => {
      setRefreshing(true);
      setError(null);
      try {
        // 帶上來源頁：這是使用者正在看的頁，後端據此把「已經被切走的舊頁面」
        // 的排隊工作降級，讓這一頁先拿到名額（見 lib/request-priority.ts）。
        const res = await fetch(fetchUrl, {
          cache: "no-store",
          headers: pageRequestHeaders(cacheKey),
        });
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
    void refresh();
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
