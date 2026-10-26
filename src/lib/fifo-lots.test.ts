import assert from "node:assert/strict";
import { test } from "node:test";
import {
  consumeFifoLots,
  reduceFifoLotsCost,
  sumFifoLots,
  type FifoLot,
} from "@/lib/fifo-lots";

test("賣出從最早的批次開始扣，成本按該批的平均成本配對", () => {
  const lots: FifoLot[] = [
    { qty: 10, costBase: 1000 },
    { qty: 10, costBase: 2000 },
  ];
  const match = consumeFifoLots(lots, 15);
  assert.equal(match.matchedQty, 15);
  // 第一批全部 1000 + 第二批一半 1000
  assert.equal(match.matchedCostBase, 2000);
  assert.deepEqual(lots, [{ qty: 5, costBase: 1000 }]);
  assert.deepEqual(
    match.slices.map((s) => s.qty),
    [10, 5],
  );
});

test("批次不夠扣時只扣到現有數量，不會變成負數", () => {
  const lots: FifoLot[] = [{ qty: 3, costBase: 300 }];
  const match = consumeFifoLots(lots, 5);
  assert.equal(match.matchedQty, 3);
  assert.equal(match.matchedCostBase, 300);
  assert.equal(lots.length, 0);
});

test("零股小數誤差：剩下極小數量的批次直接移除", () => {
  const lots: FifoLot[] = [{ qty: 0.3, costBase: 30 }];
  consumeFifoLots(lots, 0.1 + 0.2);
  assert.equal(lots.length, 0);
});

test("slices 帶出各批的買進日期，供呼叫端算持有天數", () => {
  const d1 = new Date("2024-01-01");
  const d2 = new Date("2024-02-01");
  const lots: FifoLot[] = [
    { qty: 1, costBase: 10, buyDate: d1 },
    { qty: 1, costBase: 20, buyDate: d2 },
  ];
  const match = consumeFifoLots(lots, 2);
  assert.deepEqual(
    match.slices.map((s) => s.buyDate),
    [d1, d2],
  );
});

test("股息從最早的批次開始沖減成本，每批最多沖到 0", () => {
  const lots: FifoLot[] = [
    { qty: 1, costBase: 50 },
    { qty: 1, costBase: 100 },
  ];
  reduceFifoLotsCost(lots, 80);
  assert.deepEqual(
    lots.map((l) => l.costBase),
    [0, 70],
  );
});

test("sumFifoLots 加總剩餘數量與成本", () => {
  assert.deepEqual(
    sumFifoLots([
      { qty: 2, costBase: 20 },
      { qty: 3, costBase: 45 },
    ]),
    { quantity: 5, costBase: 65 },
  );
});
