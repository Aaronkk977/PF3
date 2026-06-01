const DEFAULT_TIMEOUT_MS = 5_000;

type FetchInit = RequestInit & { next?: { revalidate?: number } };

/**
 * 對外網 API 的快速 fetch：總計逾時後放棄，失敗回傳 null（不拋錯）
 */
export async function fetchWithShortTimeout(
  url: string,
  init?: FetchInit,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Response | null> {
  try {
    const signal =
      typeof AbortSignal.timeout === "function"
        ? AbortSignal.timeout(timeoutMs)
        : (() => {
            const c = new AbortController();
            setTimeout(() => c.abort(), timeoutMs);
            return c.signal;
          })();

    return await fetch(url, {
      ...init,
      signal,
      headers: { "User-Agent": "Mozilla/5.0", ...init?.headers },
    });
  } catch {
    return null;
  }
}
