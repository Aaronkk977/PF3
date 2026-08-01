import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";
import type { RunPriority } from "@/lib/concurrency-limiter";
import {
  BACKGROUND_SCOPE,
  PAGE_HEADER,
  SCOPE_HEADER,
} from "@/lib/page-request-headers";

type RequestScope = {
  page: string;
  background: boolean;
};

const scopeStorage = new AsyncLocalStorage<RequestScope>();

/**
 * 使用者目前真的在看的那一頁。
 *
 * 這是行程層級的單一變數，成立的前提是這個 app 是單人單視窗的桌面應用——
 * 同一時間只有一個「當前頁」。如果哪天變成多人共用同一個 server，這裡就必須
 * 改成每個 session 各自一份，否則 A 的切頁會把 B 的請求降級。
 *
 * 只有前景請求會更新它：背景預熱（nav hover、idle 預載）不算「使用者切過去
 * 了」，否則預載 holdings 反而會把使用者正在看的總覽降級。
 */
let activePage: string | null = null;

/** 給 API route 包住 handler 用，把這次請求的來源頁記進 AsyncLocalStorage。 */
export function withRequestScope<T>(request: Request, run: () => T): T {
  const page = request.headers.get(PAGE_HEADER)?.trim() ?? "";
  const background = request.headers.get(SCOPE_HEADER) === BACKGROUND_SCOPE;
  if (page && !background) activePage = page;
  return scopeStorage.run({ page, background }, run);
}

/**
 * semaphore 沒有明確指定 priority 時的預設值。三種情況：
 *
 * 1. 不在任何請求範圍內（開機維護自己排的工作）→ high，但那條路徑本來就都
 *    明確傳 "low"，不會走到這裡。
 * 2. 背景預熱請求 → low。使用者沒在等它。
 * 3. 來源頁已經不是當前頁（使用者切走了）→ low。舊頁面的工作不會被 abort，
 *    但排隊時要讓位給新頁面——這正是原本註解宣稱、卻一直沒有實作的行為。
 *
 * 已經拿到名額、正在執行的工作不受影響：這裡調整的是排隊順序，不是搶佔。
 */
export function inferRequestPriority(): RunPriority {
  const scope = scopeStorage.getStore();
  if (!scope) return "high";
  if (scope.background) return "low";
  if (scope.page && activePage && scope.page !== activePage) return "low";
  return "high";
}

/** 測試用：把「當前頁」狀態歸零 */
export function resetActivePageForTests(): void {
  activePage = null;
}
