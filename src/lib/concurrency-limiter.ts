/** 限制「同時執行中」的工作數量，且這個上限是全域共用的——同一個 semaphore
 *  實例不管被幾個不相關的呼叫者（不同請求、不同函式）拿去用，加總起來的併發
 *  執行數都不會超過 limit。用來取代各檔案各自土炮的併發批次迴圈：批次內的
 *  上限只在單次呼叫裡有效，兩個批次剛好同時發生時加總還是可能超標；
 *  semaphore 是全域的，才能真的擋住這種跨呼叫疊加的情況。
 *
 *  支援兩層優先權（見 run() 的 priority 選項）：使用者切頁時，我們刻意不去
 *  abort 舊頁面還沒做完的工作（怕留下不上不下的狀態，且切頁很快、犧牲的
 *  運算量通常不大），而是讓新頁面的工作插隊排到還沒開始跑的舊工作前面。
 *  已經真的拿到名額、在執行中的工作不會被插隊打斷——這裡做的是「排隊順序」
 *  的優先權，不是搶佔式排程。 */
export type RunPriority = "high" | "low";

export type Semaphore = {
  run<T>(fn: () => Promise<T>, options?: { priority?: RunPriority }): Promise<T>;
};

export function createSemaphore(limit: number): Semaphore {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error(`semaphore limit 必須是正整數，收到 ${limit}`);
  }

  let active = 0;
  const highQueue: (() => void)[] = [];
  const lowQueue: (() => void)[] = [];

  function acquire(priority: RunPriority): Promise<void> {
    if (active < limit) {
      active++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      const entry = () => {
        active++;
        resolve();
      };
      (priority === "low" ? lowQueue : highQueue).push(entry);
    });
  }

  function release(): void {
    active--;
    const next = highQueue.shift() ?? lowQueue.shift();
    if (next) next();
  }

  return {
    async run<T>(
      fn: () => Promise<T>,
      options?: { priority?: RunPriority },
    ): Promise<T> {
      await acquire(options?.priority ?? "high");
      try {
        return await fn();
      } finally {
        release();
      }
    },
  };
}

/** 全站 SQLite 寫入的共用併發上限——SQLite 同一時間只有一個寫入者，太多併發
 *  寫入會互相卡到逾時（甚至拖累同一次請求裡其他不相干的查詢一起失敗，
 *  股票分割功能併發設 8 時就真的把 dashboard 拖垮過一次）。所有批次寫入都
 *  應該共用同一個 dbWriteLimiter，而不是各自訂一個數字。 */
export const DB_WRITE_CONCURRENCY = 2;
export const dbWriteLimiter = createSemaphore(DB_WRITE_CONCURRENCY);

/** 對外部 API（目前主要是 Yahoo／證交所）的共用併發上限，跟資料庫寫入上限
 *  分開訂——這裡怕的是被對方限流／擋掉，不是 SQLite 鎖死，性質不同。 */
export const EXTERNAL_READ_CONCURRENCY = 4;
export const externalReadLimiter = createSemaphore(EXTERNAL_READ_CONCURRENCY);
