import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCsv, parseCsvLine } from "@/lib/csv-parse";

test("引號內的逗號不切欄位", () => {
  assert.deepEqual(parseCsvLine('2330,"台積電, TSMC",100'), [
    "2330",
    "台積電, TSMC",
    "100",
  ]);
});

test("標頭轉小寫、略過空白行、支援 CRLF", () => {
  assert.deepEqual(parseCsv("Date,Symbol\r\n\r\n2026-01-01,2330\r\n"), {
    headers: ["date", "symbol"],
    rows: [["2026-01-01", "2330"]],
  });
});

test("空內容回傳空結果", () => {
  assert.deepEqual(parseCsv(""), { headers: [], rows: [] });
});
