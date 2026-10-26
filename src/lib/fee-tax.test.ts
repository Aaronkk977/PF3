import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyFeeTaxAmount,
  legacyFeeToPermille,
  legacyTaxToPermille,
  resolveFeePermille,
  resolveTaxPermille,
} from "@/lib/account-fee-rules";
import { applyAutoFeeTax, calculateFeeTax } from "@/lib/fee-tax";
import { computeTransactionSettlement } from "@/lib/transaction-settlement";

test("舊版費率單位換算成千分比", () => {
  assert.equal(legacyFeeToPermille(4), 0.4);
  assert.equal(legacyTaxToPermille(0.003), 3);
  // 已經是千分比的值不重複換算
  assert.equal(legacyTaxToPermille(3), 3);
});

test("買賣分開設定的手續費優先於舊欄位", () => {
  assert.equal(resolveFeePermille({ feeRateBpsBuy: 1.425, feeRateBps: 4 }, "BUY"), 1.425);
  assert.equal(resolveFeePermille({ feeRateBps: 4 }, "SELL"), 0.4);
});

test("交易稅：買進預設 0，台股賣出預設 3‰，其他市場 0", () => {
  assert.equal(resolveTaxPermille({}, "BUY", "2330.TW"), 0);
  assert.equal(resolveTaxPermille({}, "SELL", "2330.TW"), 3);
  assert.equal(resolveTaxPermille({}, "SELL", "AAPL"), 0);
});

test("無條件捨去且低消 1 元；不捨去時保留 4 位小數", () => {
  assert.equal(applyFeeTaxAmount(0.3, true), 1);
  assert.equal(applyFeeTaxAmount(20.9, true), 20);
  assert.equal(applyFeeTaxAmount(0, true), 0);
  assert.equal(applyFeeTaxAmount(1.234567, false), 1.2346);
});

test("台股賣出：手續費 1.425‰ 捨去、交易稅 3‰", () => {
  const r = calculateFeeTax(
    "SELL",
    1000,
    100,
    {
      account: { feeRateBpsSell: 1.425, taxRatePctSell: 3 },
      instrument: { symbol: "2330.TW" },
    },
    { floorWithMinOne: true },
  );
  assert.deepEqual(r, { fee: 142, tax: 300 });
});

test("股息不計手續費與稅", () => {
  assert.deepEqual(
    calculateFeeTax("DIVIDEND", 10, 5, {
      account: { feeRateBps: 4 },
      instrument: { symbol: "2330.TW" },
    }),
    { fee: 0, tax: 0 },
  );
});

test("使用者手動填的手續費／稅不會被自動計算覆蓋", () => {
  const r = applyAutoFeeTax(
    { feeRateBpsBuy: 1.425 },
    { symbol: "2330.TW" },
    "BUY",
    1000,
    100,
    20,
    undefined,
  );
  assert.deepEqual(r, { fee: 20, tax: 0 });
});

test("交割金額：買進付出、賣出收回、入金出金", () => {
  assert.equal(computeTransactionSettlement("BUY", 10, 100, 1, 0)?.net, -1001);
  assert.equal(computeTransactionSettlement("SELL", 10, 100, 1, 3)?.net, 996);
  assert.equal(computeTransactionSettlement("DEPOSIT", 0, 500, 0, 0)?.net, 500);
  assert.equal(computeTransactionSettlement("WITHDRAWAL", 0, 500, 0, 0)?.net, -500);
  assert.equal(computeTransactionSettlement("BUY", 0, 100, 0, 0), null);
});
