/** 限制並發數執行 async 工作，避免 SQLite 等資源被大量並行寫入打滿 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const limit = Math.max(1, Math.min(concurrency, items.length));
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const i = nextIndex++;
      if (i >= items.length) break;
      results[i] = await fn(items[i]!, i);
    }
  }

  await Promise.all(Array.from({ length: limit }, () => worker()));
  return results;
}
