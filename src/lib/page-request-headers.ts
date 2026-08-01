/** 前端頁面資料請求帶的識別 header。
 *
 *  這支刻意不含任何 server-only 的東西（request-priority.ts 用了
 *  node:async_hooks，client 匯不進去），讓前後端共用同一組字串常數。 */

/** 值是 PAGE_CACHE_KEYS 的那組字串，標示這個請求是為了哪一頁 */
export const PAGE_HEADER = "x-pp-page";
/** 帶 "background" 表示這是預熱請求，使用者並沒有在看這一頁 */
export const SCOPE_HEADER = "x-pp-scope";
export const BACKGROUND_SCOPE = "background";

export function pageRequestHeaders(
  page: string,
  options?: { background?: boolean },
): Record<string, string> {
  const headers: Record<string, string> = { [PAGE_HEADER]: page };
  if (options?.background) headers[SCOPE_HEADER] = BACKGROUND_SCOPE;
  return headers;
}
