import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isComputedAtFresh,
  isQuoteFresh,
  QUOTE_HOLIDAY_REFRESH_MS,
  QUOTE_REFRESH_MS,
  quoteMarketOf,
} from "@/lib/quote-freshness";

/** 台北時間（UTC+8，無夏令時間） */
const tw = (iso: string) => new Date(`${iso}+08:00`);
/** 紐約時間；2026-11-02 起是 EST（UTC-5） */
const ny = (iso: string) => new Date(`${iso}-05:00`);
const ago = (now: Date, ms: number) => now.getTime() - ms;

test("依代碼判斷市場", () => {
  assert.equal(quoteMarketOf("2330.TW"), "tw");
  assert.equal(quoteMarketOf("6488.TWO"), "tw");
  assert.equal(quoteMarketOf("2330"), "tw");
  assert.equal(quoteMarketOf("^TWII"), "tw");
  assert.equal(quoteMarketOf("VIXTWN"), "tw");
  assert.equal(quoteMarketOf("AAPL"), "us");
  assert.equal(quoteMarketOf("^GSPC"), "us");
  assert.equal(quoteMarketOf("BRK-B"), "us");
  assert.equal(quoteMarketOf("2802.T"), "jp");
  assert.equal(quoteMarketOf("^N225"), "jp");
  assert.equal(quoteMarketOf("009150.KS"), "kr");
  assert.equal(quoteMarketOf("^KS11"), "kr");
  assert.equal(quoteMarketOf("BTC-USD"), "always");
  assert.equal(quoteMarketOf("BTC"), "always");
  assert.equal(quoteMarketOf("USDTWD=X"), "always");
  assert.equal(quoteMarketOf("CL=F"), "always");
  assert.equal(quoteMarketOf("DX-Y.NYB"), "always");
  assert.equal(quoteMarketOf("TWMARGINRATIO"), "always");
});

test("日股依東京時間：台北 14:00 = 東京 15:00 仍在盤中", () => {
  const now = tw("2026-11-03T14:00:00");
  assert.equal(isQuoteFresh("2802.T", { fetchedAt: ago(now, 4 * 60_000) }, now), false);
});

test("台股盤中：3 分鐘內沿用，超過就重抓", () => {
  const now = tw("2026-11-03T10:00:00"); // 週二
  assert.equal(isQuoteFresh("2330.TW", { fetchedAt: ago(now, 2 * 60_000) }, now), true);
  assert.equal(isQuoteFresh("2330.TW", { fetchedAt: ago(now, QUOTE_REFRESH_MS) }, now), false);
});

test("台股收盤後 15 分鐘內仍照間隔重抓，等收盤價定案", () => {
  const now = tw("2026-11-03T13:40:00");
  assert.equal(isQuoteFresh("2330.TW", { fetchedAt: ago(now, 4 * 60_000) }, now), false);
});

test("台股收盤後：收盤後抓過就不再抓，收盤前抓的要再抓一次", () => {
  const now = tw("2026-11-03T20:00:00");
  const afterClose = tw("2026-11-03T13:50:00").getTime();
  const beforeClose = tw("2026-11-03T13:20:00").getTime();
  assert.equal(isQuoteFresh("2330.TW", { fetchedAt: afterClose }, now), true);
  assert.equal(isQuoteFresh("2330.TW", { fetchedAt: beforeClose }, now), false);
});

test("台股隔天開盤前：前一天收盤後抓的仍可用", () => {
  const now = tw("2026-11-04T08:30:00");
  assert.equal(
    isQuoteFresh("2330.TW", { fetchedAt: tw("2026-11-03T18:00:00").getTime() }, now),
    true,
  );
});

test("週末：週五收盤後抓過就整個週末不抓，週五盤中抓的要補一次", () => {
  const now = tw("2026-11-08T12:00:00"); // 週日
  assert.equal(
    isQuoteFresh("2330.TW", { fetchedAt: tw("2026-11-06T14:00:00").getTime() }, now),
    true,
  );
  assert.equal(
    isQuoteFresh("2330.TW", { fetchedAt: tw("2026-11-06T11:00:00").getTime() }, now),
    false,
  );
});

test("週一開盤後，週末抓的就過期了", () => {
  const now = tw("2026-11-09T09:05:00");
  assert.equal(
    isQuoteFresh("2330.TW", { fetchedAt: tw("2026-11-08T12:00:00").getTime() }, now),
    false,
  );
});

test("美股依紐約時間：台灣早上是美股收盤後", () => {
  // 台北 11/4 08:00 = 紐約 11/3 19:00，已收盤
  const now = tw("2026-11-04T08:00:00");
  assert.equal(
    isQuoteFresh("AAPL", { fetchedAt: ny("2026-11-03T16:30:00").getTime() }, now),
    true,
  );
  assert.equal(
    isQuoteFresh("AAPL", { fetchedAt: ny("2026-11-03T15:00:00").getTime() }, now),
    false,
  );
});

test("美股盤中照 3 分鐘間隔", () => {
  const now = ny("2026-11-03T11:00:00");
  assert.equal(isQuoteFresh("AAPL", { fetchedAt: ago(now, 10_000) }, now), true);
  assert.equal(isQuoteFresh("AAPL", { fetchedAt: ago(now, 4 * 60_000) }, now), false);
});

test("加密貨幣不看開收盤，一律 3 分鐘", () => {
  const now = tw("2026-11-08T03:00:00"); // 週日半夜
  assert.equal(isQuoteFresh("BTC-USD", { fetchedAt: ago(now, 2 * 60_000) }, now), true);
  assert.equal(isQuoteFresh("BTC-USD", { fetchedAt: ago(now, 4 * 60_000) }, now), false);
});

test("上次失敗（舊快取）收盤後也照 3 分鐘重試", () => {
  const now = tw("2026-11-03T20:00:00");
  const fetchedAt = tw("2026-11-03T19:56:00").getTime();
  assert.equal(isQuoteFresh("2330.TW", { fetchedAt, stale: true }, now), false);
  assert.equal(isQuoteFresh("2330.TW", { fetchedAt }, now), true);
});

test("國定假日：最後成交停在前一天，盤中拉長成 30 分鐘才重抓", () => {
  const now = tw("2026-11-03T10:30:00");
  const marketTime = tw("2026-11-02T13:30:00").getTime();
  const fetchedAt = ago(now, 5 * 60_000);
  assert.equal(isQuoteFresh("2330.TW", { fetchedAt, marketTime }, now), true);
  assert.equal(
    isQuoteFresh("2330.TW", { fetchedAt: ago(now, QUOTE_HOLIDAY_REFRESH_MS), marketTime }, now),
    false,
  );
});

test("開盤頭 15 分鐘還沒成交不算休市", () => {
  const now = tw("2026-11-03T09:10:00");
  const marketTime = tw("2026-11-02T13:30:00").getTime();
  assert.equal(
    isQuoteFresh("2330.TW", { fetchedAt: ago(now, 4 * 60_000), marketTime }, now),
    false,
  );
});

test("有今天的成交就是正常盤中", () => {
  const now = tw("2026-11-03T10:30:00");
  const marketTime = tw("2026-11-03T10:29:00").getTime();
  assert.equal(
    isQuoteFresh("2330.TW", { fetchedAt: ago(now, 4 * 60_000), marketTime }, now),
    false,
  );
});

test("算出來的結果用較長間隔：盤中 5 分鐘內沿用", () => {
  const now = tw("2026-11-03T10:00:00");
  const fiveMin = 5 * 60_000;
  assert.equal(
    isComputedAtFresh(["2330.TW", "AAPL"], ago(now, 4 * 60_000), now, fiveMin),
    true,
  );
  assert.equal(
    isComputedAtFresh(["2330.TW", "AAPL"], ago(now, fiveMin), now, fiveMin),
    false,
  );
});

test("算出來的結果：收盤後用收盤價算過就一直沿用，有一檔還沒就重算", () => {
  const now = tw("2026-11-03T20:00:00");
  const fiveMin = 5 * 60_000;
  const computedAt = tw("2026-11-03T14:00:00").getTime();
  assert.equal(isComputedAtFresh(["2330.TW"], computedAt, now, fiveMin), true);
  // 加密貨幣 24 小時交易，滿 5 分鐘就要重算
  assert.equal(isComputedAtFresh(["2330.TW", "BTC-USD"], computedAt, now, fiveMin), false);
});
