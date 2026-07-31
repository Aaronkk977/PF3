import { test } from "node:test";
import assert from "node:assert/strict";
import { toLocalDateKey } from "@/lib/date-keys";
import {
  simulateValueDays,
  type SeriesContext,
} from "@/lib/portfolio-value-simulation";

const ACCOUNT_ID = "acct-1";

function makeCtx(overrides?: Partial<SeriesContext>): SeriesContext {
  return {
    allTxs: [],
    allowedAccountIds: new Set([ACCOUNT_ID]),
    accountCurrencies: new Map([[ACCOUNT_ID, "TWD"]]),
    currencyBySymbol: new Map([
      ["AAA", "TWD"],
      ["BBB", "TWD"],
    ]),
    usdRate: 30,
    ...overrides,
  };
}

function emptyInitial(cashByAccount: Map<string, number>, positions: Map<string, number>) {
  return { txIdx: 0, positions, cashByAccount };
}

test("部分持股缺價時不整天跳過，仍照有價格的部分計算（避免走勢圖中段消失）", async () => {
  const ctx = makeCtx();
  const priceBySymbol = new Map([
    ["AAA", new Map([["2026-01-01", 100]])],
    // BBB 這天沒有價格
  ]);
  const positions = new Map([
    ["AAA", 10],
    ["BBB", 5],
  ]);
  const { points } = await simulateValueDays(
    ctx,
    ["2026-01-01"],
    emptyInitial(new Map([[ACCOUNT_ID, 0]]), positions),
    priceBySymbol,
  );
  assert.equal(points.length, 1, "缺價不應該讓這天整個消失");
  assert.equal(points[0]!.value, 1000); // 10 * 100，BBB 缺價部分不計入
});

test("全部持股都缺價、現金也是 0，這天要跳過", async () => {
  const ctx = makeCtx();
  const priceBySymbol = new Map<string, Map<string, number>>();
  const positions = new Map([["AAA", 10]]);
  const { points } = await simulateValueDays(
    ctx,
    ["2026-01-01"],
    emptyInitial(new Map([[ACCOUNT_ID, 0]]), positions),
    priceBySymbol,
  );
  assert.equal(points.length, 0);
});

test("全部持股都缺價，但現金 > 0，這天仍要記錄（只算現金）", async () => {
  const ctx = makeCtx();
  const priceBySymbol = new Map<string, Map<string, number>>();
  const positions = new Map([["AAA", 10]]);
  const { points } = await simulateValueDays(
    ctx,
    ["2026-01-01"],
    emptyInitial(new Map([[ACCOUNT_ID, 5000]]), positions),
    priceBySymbol,
  );
  assert.equal(points.length, 1);
  assert.equal(points[0]!.value, 5000);
});

test("今天缺價時會用即時報價補洞", async () => {
  const today = toLocalDateKey(new Date());
  const ctx = makeCtx();
  const priceBySymbol = new Map<string, Map<string, number>>(); // 完全沒有快取價格
  const positions = new Map([["AAA", 10]]);
  let liveCallCount = 0;
  const { points } = await simulateValueDays(
    ctx,
    [today],
    emptyInitial(new Map([[ACCOUNT_ID, 0]]), positions),
    priceBySymbol,
    {
      fetchLiveQuotes: async (symbols) => {
        liveCallCount++;
        const map = new Map();
        for (const s of symbols) map.set(s, { symbol: s, price: 200 });
        return map;
      },
    },
  );
  assert.equal(liveCallCount, 1);
  assert.equal(points.length, 1);
  assert.equal(points[0]!.value, 2000); // 10 * 200
});

test("非今天的日期缺價不會去打即時報價（避免對歷史日期狂打 API）", async () => {
  const ctx = makeCtx();
  const priceBySymbol = new Map<string, Map<string, number>>();
  const positions = new Map([["AAA", 10]]);
  let liveCallCount = 0;
  await simulateValueDays(
    ctx,
    ["2020-01-01"],
    emptyInitial(new Map([[ACCOUNT_ID, 0]]), positions),
    priceBySymbol,
    {
      fetchLiveQuotes: async () => {
        liveCallCount++;
        return new Map();
      },
    },
  );
  assert.equal(liveCallCount, 0);
});

test("即時報價同一批次裡多個標的缺價，只打一次批次查詢（不是每個標的各打一次）", async () => {
  const today = toLocalDateKey(new Date());
  const ctx = makeCtx();
  const priceBySymbol = new Map<string, Map<string, number>>();
  const positions = new Map([
    ["AAA", 10],
    ["BBB", 5],
  ]);
  let liveCallCount = 0;
  await simulateValueDays(
    ctx,
    [today],
    emptyInitial(new Map([[ACCOUNT_ID, 0]]), positions),
    priceBySymbol,
    {
      fetchLiveQuotes: async (symbols) => {
        liveCallCount++;
        const map = new Map();
        for (const s of symbols) map.set(s, { symbol: s, price: 50 });
        return map;
      },
    },
  );
  assert.equal(liveCallCount, 1);
});

test("USD 計價標的會換算成台幣", async () => {
  const ctx = makeCtx({
    currencyBySymbol: new Map([["USD_STOCK", "USD"]]),
  });
  const priceBySymbol = new Map([
    ["USD_STOCK", new Map([["2026-01-01", 10]])],
  ]);
  const positions = new Map([["USD_STOCK", 2]]);
  const { points } = await simulateValueDays(
    ctx,
    ["2026-01-01"],
    emptyInitial(new Map([[ACCOUNT_ID, 0]]), positions),
    priceBySymbol,
  );
  assert.equal(points[0]!.value, 2 * 10 * 30); // qty * price * usdRate
});
