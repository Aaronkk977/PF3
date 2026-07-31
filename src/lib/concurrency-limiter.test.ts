import { test } from "node:test";
import assert from "node:assert/strict";
import { createSemaphore } from "@/lib/concurrency-limiter";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

test("最多同時只讓 limit 個工作進入執行中", async () => {
  const sem = createSemaphore(2);
  let active = 0;
  let maxActive = 0;
  const gates = Array.from({ length: 5 }, () => deferred<void>());

  const runs = gates.map((gate, i) =>
    sem.run(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await gate.promise;
      active--;
      return i;
    }),
  );

  // 讓事件迴圈跑一輪，確認一開始只有 2 個真的進去跑
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(active, 2);

  gates[0]!.resolve();
  gates[1]!.resolve();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(active, 2); // 空出的名額被排隊中的兩個補上

  gates[2]!.resolve();
  gates[3]!.resolve();
  gates[4]!.resolve();
  const results = await Promise.all(runs);

  assert.equal(maxActive, 2);
  assert.deepEqual(results, [0, 1, 2, 3, 4]);
});

test("超過 limit 的工作會排隊，名額釋出後才執行", async () => {
  const sem = createSemaphore(1);
  const order: number[] = [];
  const gate = deferred<void>();

  const first = sem.run(async () => {
    order.push(1);
    await gate.promise;
    order.push(2);
  });
  const second = sem.run(async () => {
    order.push(3);
  });

  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(order, [1]); // second 還沒開始，因為名額被 first 佔住

  gate.resolve();
  await Promise.all([first, second]);
  assert.deepEqual(order, [1, 2, 3]);
});

test("工作丟出例外時，名額要正確釋放，不能卡住後面排隊的工作", async () => {
  const sem = createSemaphore(1);

  await assert.rejects(
    sem.run(async () => {
      throw new Error("boom");
    }),
    /boom/,
  );

  // 如果名額沒釋放，這個 run 會永遠卡住（測試逾時）
  const result = await sem.run(async () => "still works");
  assert.equal(result, "still works");
});

test("run() 會回傳並傳遞工作函式的結果", async () => {
  const sem = createSemaphore(3);
  const result = await sem.run(async () => 42);
  assert.equal(result, 42);
});

test("同一個 semaphore 實例可以被兩個「不同批次」共用，總併發數仍然受限", async () => {
  const sem = createSemaphore(2);
  let active = 0;
  let maxActive = 0;

  async function work() {
    active++;
    maxActive = Math.max(maxActive, active);
    await new Promise((r) => setTimeout(r, 20));
    active--;
  }

  // 模擬兩個不相關的呼叫者（例如兩個不同 API 請求）幾乎同時各自送出一批工作
  const batchA = Promise.all([1, 2, 3].map(() => sem.run(work)));
  const batchB = Promise.all([1, 2, 3].map(() => sem.run(work)));

  await Promise.all([batchA, batchB]);
  assert.equal(maxActive, 2, "兩個批次加起來的同時執行數不該超過 limit");
});

test("limit 必須是正整數", () => {
  assert.throws(() => createSemaphore(0));
  assert.throws(() => createSemaphore(-1));
});

test("高優先權的工作即使比較晚排隊，也會插到低優先權前面先拿到名額", async () => {
  const sem = createSemaphore(1);
  const order: string[] = [];
  const gate = deferred<void>();

  // 先佔住唯一的名額，讓後面的工作都得排隊
  const holder = sem.run(async () => {
    order.push("holder");
    await gate.promise;
  });
  await new Promise((r) => setTimeout(r, 5));

  // 兩個低優先權先排隊
  const low1 = sem.run(async () => order.push("low1"), { priority: "low" });
  const low2 = sem.run(async () => order.push("low2"), { priority: "low" });
  await new Promise((r) => setTimeout(r, 5));

  // 高優先權晚排隊，但名額釋出後應該先跑
  const high = sem.run(async () => order.push("high"), { priority: "high" });

  gate.resolve();
  await Promise.all([holder, low1, low2, high]);

  assert.deepEqual(order, ["holder", "high", "low1", "low2"]);
});

test("同一個優先權層級內，先排隊的先跑（保持 FIFO）", async () => {
  const sem = createSemaphore(1);
  const order: string[] = [];
  const gate = deferred<void>();

  const holder = sem.run(async () => {
    await gate.promise;
  });
  await new Promise((r) => setTimeout(r, 5));

  const a = sem.run(async () => order.push("a"), { priority: "low" });
  const b = sem.run(async () => order.push("b"), { priority: "low" });
  const c = sem.run(async () => order.push("c"), { priority: "low" });

  gate.resolve();
  await Promise.all([holder, a, b, c]);

  assert.deepEqual(order, ["a", "b", "c"]);
});

test("已經在執行中的工作不會被之後才排隊的高優先權工作打斷（不做搶佔）", async () => {
  const sem = createSemaphore(1);
  const order: string[] = [];
  const gate = deferred<void>();

  const holder = sem.run(async () => {
    order.push("holder-start");
    await gate.promise;
    order.push("holder-end");
  });
  await new Promise((r) => setTimeout(r, 5));

  const high = sem.run(async () => order.push("high"), { priority: "high" });
  await new Promise((r) => setTimeout(r, 5));
  // 這時候 holder 應該還在跑（沒被高優先權打斷），high 還在排隊
  assert.deepEqual(order, ["holder-start"]);

  gate.resolve();
  await Promise.all([holder, high]);
  assert.deepEqual(order, ["holder-start", "holder-end", "high"]);
});

test("沒指定 priority 時預設視為高優先權", async () => {
  const sem = createSemaphore(1);
  const order: string[] = [];
  const gate = deferred<void>();

  const holder = sem.run(async () => {
    await gate.promise;
  });
  await new Promise((r) => setTimeout(r, 5));

  const low = sem.run(async () => order.push("low"), { priority: "low" });
  await new Promise((r) => setTimeout(r, 5));
  const defaultPriority = sem.run(async () => order.push("default"));

  gate.resolve();
  await Promise.all([holder, low, defaultPriority]);

  assert.deepEqual(order, ["default", "low"]);
});
