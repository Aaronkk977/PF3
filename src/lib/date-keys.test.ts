import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isTransactionInPeriod,
  normalizePeriodRange,
  normalizeStoredTransactionDate,
  parseCalendarDate,
  toCalendarDateKey,
  toLocalWeekKey,
  toTransactionDateKey,
} from "@/lib/date-keys";

test("日曆日期存成 UTC 正午，轉回來是同一天", () => {
  const d = parseCalendarDate("2026-05-04");
  assert.equal(d.toISOString(), "2026-05-04T12:00:00.000Z");
  assert.equal(toCalendarDateKey(d), "2026-05-04");
});

test("parseCalendarDate 接受帶時間的字串，只取日期", () => {
  assert.equal(
    parseCalendarDate("2026-05-04 00:00:00").toISOString(),
    "2026-05-04T12:00:00.000Z",
  );
});

test("parseCalendarDate 遇到無效日期丟錯", () => {
  assert.throws(() => parseCalendarDate("not a date"));
});

test("舊匯入的台灣午夜（前一日 16:00 UTC）修正成正確的日曆日", () => {
  const legacy = new Date("2026-05-03T16:00:00.000Z");
  assert.equal(
    normalizeStoredTransactionDate(legacy).toISOString(),
    "2026-05-04T12:00:00.000Z",
  );
  assert.equal(toTransactionDateKey(legacy), "2026-05-04");
});

test("toTransactionDateKey 對字串直接取前 10 碼", () => {
  assert.equal(toTransactionDateKey("2026-05-04T23:59:59Z"), "2026-05-04");
});

test("期間起訖顛倒時自動對調", () => {
  assert.deepEqual(normalizePeriodRange("2026-02-01", "2026-01-01"), {
    start: "2026-01-01",
    end: "2026-02-01",
    swapped: true,
  });
});

test("期初當天的交易算在期間內（含頭含尾）", () => {
  const d = new Date(2026, 0, 1, 12);
  assert.equal(isTransactionInPeriod(d, "2026-01-01", "2026-01-31"), true);
  assert.equal(isTransactionInPeriod(d, "2026-01-02", "2026-01-31"), false);
});

test("ISO 週次：年初跨年的週算在前一年", () => {
  assert.equal(toLocalWeekKey(new Date(2021, 0, 1)), "2020-W53");
  assert.equal(toLocalWeekKey(new Date(2026, 0, 5)), "2026-W02");
});
