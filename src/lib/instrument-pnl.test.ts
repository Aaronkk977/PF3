import assert from "node:assert/strict";
import { test } from "node:test";
import { computeInstrumentPnlFromRates, type InstrumentTxInput } from "@/lib/instrument-pnl";

function tx(overrides: Partial<InstrumentTxInput>): InstrumentTxInput {
  return {
    date: new Date("2024-01-01"),
    type: "BUY",
    quantity: 0,
    price: 0,
    fee: 0,
    tax: 0,
    currency: "USD",
    ...overrides,
  };
}

test("BUY 用交易當天的匯率換算成本，不是傳入 rateMap 裡的其他日期", () => {
  const rateMap = new Map([
    ["USD_2024-01-01", 30],
    ["USD_2024-06-01", 33],
  ]);
  const transactions = [
    tx({ date: new Date("2024-01-01"), type: "BUY", quantity: 10, price: 100 }),
  ];
  const result = computeInstrumentPnlFromRates(transactions, 0, rateMap);
  // 成本基礎 = 10*100 = 1000 USD，用 2024-01-01 當天匯率 30 換算 = 30000 TWD
  assert.equal(result.openCostBasis, 30000);
});

test("同一檔股票分兩天買，各自用買進當天的匯率，不會被今天的匯率污染", () => {
  const rateMap = new Map([
    ["USD_2024-01-01", 30],
    ["USD_2024-06-01", 33],
  ]);
  const transactions = [
    tx({ date: new Date("2024-01-01"), type: "BUY", quantity: 10, price: 100 }),
    tx({ date: new Date("2024-06-01"), type: "BUY", quantity: 10, price: 100 }),
  ];
  const result = computeInstrumentPnlFromRates(transactions, 0, rateMap);
  // 第一筆 1000usd*30=30000，第二筆 1000usd*33=33000，加總 63000
  assert.equal(result.openCostBasis, 63000);
});

test("SELL 的已實現損益用賣出當天的匯率換算價款，成本用 FIFO 配對", () => {
  const rateMap = new Map([
    ["USD_2024-01-01", 30],
    ["USD_2024-06-01", 33],
  ]);
  const transactions = [
    tx({ date: new Date("2024-01-01"), type: "BUY", quantity: 10, price: 100 }),
    tx({ date: new Date("2024-06-01"), type: "SELL", quantity: 10, price: 100 }),
  ];
  const result = computeInstrumentPnlFromRates(transactions, 0, rateMap);
  // 賣出價款 1000usd 用賣出當天匯率 33 換算 = 33000；配對成本用買進當天匯率 30 = 30000
  assert.equal(result.realizedCostBasis, 30000);
  assert.equal(result.realizedPnl, 3000);
  assert.equal(result.quantity, 0);
  assert.equal(result.openCostBasis, 0);
});

test("DIVIDEND 用配息當天的匯率換算，並依比例扣減既有持倉的成本基礎", () => {
  const rateMap = new Map([
    ["USD_2024-01-01", 30],
    ["USD_2024-06-01", 33],
  ]);
  const transactions = [
    tx({ date: new Date("2024-01-01"), type: "BUY", quantity: 10, price: 100 }),
    tx({ date: new Date("2024-06-01"), type: "DIVIDEND", quantity: 1, price: 50 }),
  ];
  const result = computeInstrumentPnlFromRates(transactions, 0, rateMap);
  // 股息 50usd 用配息當天匯率 33 換算 = 1650，成本基礎 30000-1650=28350
  assert.equal(result.openCostBasis, 28350);
});

test("台幣計價交易完全不查匯率表，rateMap 空的也不影響結果", () => {
  const rateMap = new Map<string, number>();
  const transactions = [
    tx({ date: new Date("2024-01-01"), type: "BUY", quantity: 1000, price: 500, currency: "TWD" }),
  ];
  const result = computeInstrumentPnlFromRates(transactions, 0, rateMap);
  assert.equal(result.openCostBasis, 500000);
});

test("市值用現在的每股台幣價格（marketPriceInBase）乘上 FIFO 算出的實際持有股數", () => {
  const rateMap = new Map([["USD_2024-01-01", 30]]);
  const transactions = [
    tx({ date: new Date("2024-01-01"), type: "BUY", quantity: 10, price: 100 }),
  ];
  // 現在市價 120usd 換算成台幣後是 3960（今天匯率 33，跟成本用的買進日匯率 30 不同）
  const result = computeInstrumentPnlFromRates(transactions, 3960, rateMap);
  assert.equal(result.marketValue, 39600);
  assert.equal(result.openCostBasis, 30000);
  assert.equal(result.unrealizedPnl, 9600);
});

test("rateMap 缺某個日期的匯率時，退回 1:1（不崩潰、不佔用其他日期的值）", () => {
  const rateMap = new Map<string, number>();
  const transactions = [
    tx({ date: new Date("2024-01-01"), type: "BUY", quantity: 10, price: 100 }),
  ];
  const result = computeInstrumentPnlFromRates(transactions, 0, rateMap);
  assert.equal(result.openCostBasis, 1000);
});
