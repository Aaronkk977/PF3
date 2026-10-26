import { test } from "node:test";
import assert from "node:assert/strict";
import { toLocalDateKey } from "@/lib/date-keys";
import {
  forwardFillPrices,
  simulateValueDays,
  type SeriesContext,
  type TxRow,
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

test("forwardFillPrices：起點前有真實 K 線時優先於 seed（seed 可能是上次的盤中價）", () => {
  const filled = forwardFillPrices(
    [{ date: "2026-01-02", close: 100 }],
    new Date(2026, 0, 3),
    new Date(2026, 0, 3),
    95, // 上次盤中記下的價格
  );
  assert.equal(filled.get("2026-01-03"), 100);
});

test("forwardFillPrices：回溯區間抓不到任何 K 線時才用 seed", () => {
  const filled = forwardFillPrices(
    [],
    new Date(2026, 0, 3),
    new Date(2026, 0, 3),
    95,
  );
  assert.equal(filled.get("2026-01-03"), 95);
});

test("今天只有前向填充的價格（沒有今天的 K 線）時改用即時報價", async () => {
  const today = toLocalDateKey(new Date());
  const ctx = makeCtx();
  const priceBySymbol = new Map([["AAA", new Map([[today, 100]])]]); // 前一天 close 填過來的
  const positions = new Map([["AAA", 10]]);
  let liveCallCount = 0;
  const { points } = await simulateValueDays(
    ctx,
    [today],
    emptyInitial(new Map([[ACCOUNT_ID, 0]]), positions),
    priceBySymbol,
    {
      todayBarSymbols: new Set(),
      fetchLiveQuotes: async (symbols) => {
        liveCallCount++;
        const map = new Map();
        for (const s of symbols) map.set(s, { price: 120 });
        return map;
      },
    },
  );
  assert.equal(liveCallCount, 1);
  assert.equal(points[0]!.value, 1200);
});

test("今天有真實 K 線時直接用 K 線，不打即時報價", async () => {
  const today = toLocalDateKey(new Date());
  const ctx = makeCtx();
  const priceBySymbol = new Map([["AAA", new Map([[today, 110]])]]);
  const positions = new Map([["AAA", 10]]);
  let liveCallCount = 0;
  const { points } = await simulateValueDays(
    ctx,
    [today],
    emptyInitial(new Map([[ACCOUNT_ID, 0]]), positions),
    priceBySymbol,
    {
      todayBarSymbols: new Set(["AAA"]),
      fetchLiveQuotes: async () => {
        liveCallCount++;
        return new Map();
      },
    },
  );
  assert.equal(liveCallCount, 0);
  assert.equal(points[0]!.value, 1100);
});

test("今天沒 K 線、即時報價也失敗時，退回前向填充的價格而不是算成 0", async () => {
  const today = toLocalDateKey(new Date());
  const ctx = makeCtx();
  const priceBySymbol = new Map([["AAA", new Map([[today, 100]])]]);
  const positions = new Map([["AAA", 10]]);
  const { points } = await simulateValueDays(
    ctx,
    [today],
    emptyInitial(new Map([[ACCOUNT_ID, 0]]), positions),
    priceBySymbol,
    {
      todayBarSymbols: new Set(),
      fetchLiveQuotes: async (symbols) => {
        const map = new Map();
        for (const s of symbols) map.set(s, { price: 0 });
        return map;
      },
    },
  );
  assert.equal(points[0]!.value, 1000);
});

test("endState.date 是最後一個模擬日，即使尾端那幾天被跳過", async () => {
  const ctx = makeCtx();
  const priceBySymbol = new Map([["AAA", new Map([["2026-01-01", 100]])]]);
  const positions = new Map([["AAA", 10]]);
  const { points, endState } = await simulateValueDays(
    ctx,
    ["2026-01-01", "2026-01-02"],
    emptyInitial(new Map([[ACCOUNT_ID, 0]]), positions),
    priceBySymbol,
  );
  assert.equal(points.length, 1);
  assert.equal(endState.date, "2026-01-02");
});

function makeTx(date: string, type: string, qty: number, price: number): TxRow {
  const [y, m, d] = date.split("-").map(Number);
  return {
    date: new Date(y!, m! - 1, d!, 12),
    type,
    quantity: qty,
    price,
    fee: 0,
    tax: 0,
    accountId: ACCOUNT_ID,
    account: { currency: "TWD" },
    instrument: type === "DEPOSIT" ? null : { symbol: "AAA", currency: "TWD" },
  };
}

test("從 endState 重跑最後一天：當天交易不會重複計入，價格換成新的收盤價", async () => {
  const ctx = makeCtx({
    allTxs: [
      makeTx("2026-01-01", "DEPOSIT", 1, 10_000),
      makeTx("2026-01-02", "BUY", 10, 100),
    ],
  });
  const first = await simulateValueDays(
    ctx,
    ["2026-01-01", "2026-01-02"],
    emptyInitial(new Map(), new Map()),
    new Map([["AAA", new Map([["2026-01-02", 100]])]]), // 盤中價
  );
  assert.equal(first.endState.date, "2026-01-02");
  assert.equal(first.points.at(-1)!.value, 10_000);

  const { endState } = first;
  const rerun = await simulateValueDays(
    ctx,
    [endState.date],
    {
      txIdx: endState.txIdx,
      positions: new Map(Object.entries(endState.positions)),
      cashByAccount: new Map(Object.entries(endState.cashByAccount)),
    },
    new Map([["AAA", new Map([["2026-01-02", 110]])]]), // 正式收盤價
  );
  assert.equal(rerun.endState.positions.AAA, 10, "BUY 不應該被再套用一次");
  assert.equal(rerun.points[0]!.value, 9_000 + 10 * 110);
});
