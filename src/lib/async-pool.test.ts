import { test } from "node:test";
import assert from "node:assert/strict";
import { mapWithConcurrency } from "@/lib/async-pool";
import { createSemaphore } from "@/lib/concurrency-limiter";

test("結果陣列順序對應輸入順序，跟完成先後順序無關", async () => {
  const sem = createSemaphore(3);
  const delays = [30, 10, 20];
  const results = await mapWithConcurrency(delays, sem, async (ms, i) => {
    await new Promise((r) => setTimeout(r, ms));
    return i;
  });
  assert.deepEqual(results, [0, 1, 2]);
});

test("受限於傳入的 semaphore，不會超過其 limit", async () => {
  const sem = createSemaphore(2);
  let active = 0;
  let maxActive = 0;
  await mapWithConcurrency([1, 2, 3, 4, 5], sem, async () => {
    active++;
    maxActive = Math.max(maxActive, active);
    await new Promise((r) => setTimeout(r, 10));
    active--;
  });
  assert.equal(maxActive, 2);
});

test("兩次 mapWithConcurrency 呼叫共用同一個 semaphore 時，總併發數仍受限", async () => {
  const sem = createSemaphore(2);
  let active = 0;
  let maxActive = 0;
  async function work() {
    active++;
    maxActive = Math.max(maxActive, active);
    await new Promise((r) => setTimeout(r, 20));
    active--;
  }
  await Promise.all([
    mapWithConcurrency([1, 2, 3], sem, work),
    mapWithConcurrency([1, 2, 3], sem, work),
  ]);
  assert.equal(maxActive, 2);
});

test("空陣列直接回傳空陣列", async () => {
  const sem = createSemaphore(2);
  const results = await mapWithConcurrency([], sem, async () => 1);
  assert.deepEqual(results, []);
});

test("任一項目丟出例外，整體回傳的 promise 會 reject", async () => {
  const sem = createSemaphore(2);
  await assert.rejects(
    mapWithConcurrency([1, 2, 3], sem, async (n) => {
      if (n === 2) throw new Error("bad item");
      return n;
    }),
    /bad item/,
  );
});

test("可以指定 priority，交給共用 semaphore 的排隊順序處理", async () => {
  const sem = createSemaphore(1);
  const order: string[] = [];
  let releaseHolder!: () => void;
  const holderGate = new Promise<void>((r) => (releaseHolder = r));

  const holder = sem.run(async () => {
    await holderGate;
  });
  await new Promise((r) => setTimeout(r, 5));

  const lowRun = mapWithConcurrency(
    ["a", "b"],
    sem,
    async (item) => {
      order.push(`low-${item}`);
    },
    { priority: "low" },
  );
  await new Promise((r) => setTimeout(r, 5));

  const highRun = mapWithConcurrency(
    ["x"],
    sem,
    async (item) => {
      order.push(`high-${item}`);
    },
    { priority: "high" },
  );

  releaseHolder();
  await Promise.all([holder, lowRun, highRun]);

  assert.deepEqual(order, ["high-x", "low-a", "low-b"]);
});
