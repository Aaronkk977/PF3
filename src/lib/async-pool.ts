import type { RunPriority, Semaphore } from "@/lib/concurrency-limiter";

/** 限制並發數執行 async 工作，避免 SQLite 等資源被大量並行寫入打滿。
 *  併發上限由呼叫端傳入的共用 semaphore 決定（見 concurrency-limiter.ts 的
 *  dbWriteLimiter／externalReadLimiter）——同一個 semaphore 可以被多個不
 *  相關的呼叫共用，才能真正擋住「兩個批次剛好同時發生，各自都在上限內、
 *  加總卻超標」的情況。`priority` 直接轉給 semaphore：背景性質的批次工作
 *  （例如開機維護）可以傳 "low"，讓真正在等資料的頁面請求插隊先跑。 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limiter: Semaphore,
  fn: (item: T, index: number) => Promise<R>,
  options?: { priority?: RunPriority },
): Promise<R[]> {
  return Promise.all(
    items.map((item, index) => limiter.run(() => fn(item, index), options)),
  );
}
