import { test } from "node:test";
import assert from "node:assert/strict";
import {
  inferAccountMarkets,
  mergeInstrumentSuggestions,
  suggestionMarketOf,
} from "@/lib/instrument-suggestions";

const CATALOG = [
  { symbol: "2330.TW", name: "台積電" },
  { symbol: "6488.TWO", name: "環球晶" },
  { symbol: "AAPL", name: "Apple" },
  { symbol: "TSM", name: "Taiwan Semiconductor" },
  { symbol: "BTC-USD", name: "Bitcoin" },
];

const symbols = (list: { symbol: string }[]) => list.map((i) => i.symbol);

test("suggestionMarketOf 依代號分出台股／美股／加密", () => {
  assert.equal(suggestionMarketOf("2330.TW"), "tw");
  assert.equal(suggestionMarketOf("6488.TWO"), "tw");
  assert.equal(suggestionMarketOf("2330"), "tw");
  assert.equal(suggestionMarketOf("AAPL"), "us");
  assert.equal(suggestionMarketOf("BTC-USD"), "crypto");
});

test("inferAccountMarkets：有交易紀錄時看實際交易過的市場", () => {
  // 同樣是 USD 帳戶，美股券商跟加密交易所要分得開
  assert.deepEqual(inferAccountMarkets("USD", ["AAPL", "TSM"]), new Set(["us"]));
  assert.deepEqual(inferAccountMarkets("USD", ["BTC-USD"]), new Set(["crypto"]));
});

test("inferAccountMarkets：沒有交易紀錄時退回用幣別猜", () => {
  assert.deepEqual(inferAccountMarkets("TWD", []), new Set(["tw"]));
  assert.deepEqual(inferAccountMarkets("USD", []), new Set(["us", "crypto"]));
  assert.equal(inferAccountMarkets("JPY", []), null);
});

test("初始推薦（空白查詢）只列帳戶市場內的標的", () => {
  const us = mergeInstrumentSuggestions([], CATALOG, [], "", 15, [], new Set(["us"]));
  assert.deepEqual(symbols(us).sort(), ["AAPL", "TSM"]);

  const tw = mergeInstrumentSuggestions([], CATALOG, [], "", 15, [], new Set(["tw"]));
  assert.deepEqual(symbols(tw).sort(), ["2330.TW", "6488.TWO"]);
});

test("最近使用、持倉、遠端搜尋結果也都會被篩選", () => {
  const out = mergeInstrumentSuggestions(
    [{ symbol: "2317.TW", name: "鴻海", priority: 0 }],
    [],
    [{ symbol: "NVDA", name: "NVIDIA" }],
    "",
    15,
    [{ symbol: "2330.TW", name: "台積電", priority: -20 }],
    new Set(["us"]),
  );
  assert.deepEqual(symbols(out), ["NVDA"]);
});

test("關鍵字在帳戶市場內有符合的，就不混入其他市場", () => {
  const out = mergeInstrumentSuggestions([], CATALOG, [], "taiwan", 15, [], new Set(["us"]));
  assert.deepEqual(symbols(out), ["TSM"]);
});

test("關鍵字在帳戶市場內完全沒有符合時，退回不篩選，避免整個選不到", () => {
  const out = mergeInstrumentSuggestions([], CATALOG, [], "AAPL", 15, [], new Set(["tw"]));
  assert.deepEqual(symbols(out), ["AAPL"]);
});

test("markets 為 null 時不篩選（維持舊行為）", () => {
  const out = mergeInstrumentSuggestions([], CATALOG, [], "", 15, [], null);
  assert.equal(out.length, CATALOG.length);
});
