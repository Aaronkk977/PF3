import assert from "node:assert/strict";
import { test } from "node:test";
import { AUTO_REFRESH_MS, shouldAutoRefresh } from "@/lib/auto-refresh";

const tw = (iso: string) => new Date(`${iso}+08:00`);

const base = {
  visible: true,
  inFlight: false,
  symbols: ["2330.TW"],
};

test("台股盤中、滿 5 分鐘就更新", () => {
  const now = tw("2026-11-03T10:00:00");
  assert.equal(
    shouldAutoRefresh({ ...base, now, lastUpdatedAt: now.getTime() - AUTO_REFRESH_MS }),
    true,
  );
  assert.equal(
    shouldAutoRefresh({ ...base, now, lastUpdatedAt: now.getTime() - 4 * 60_000 }),
    false,
  );
});

test("收盤後不更新", () => {
  const now = tw("2026-11-03T20:00:00");
  assert.equal(shouldAutoRefresh({ ...base, now, lastUpdatedAt: 0 }), false);
});

test("有加密貨幣就 24 小時都更新", () => {
  const now = tw("2026-11-08T03:00:00"); // 週日半夜
  assert.equal(
    shouldAutoRefresh({ ...base, now, lastUpdatedAt: 0, symbols: ["2330.TW", "BTC-USD"] }),
    true,
  );
});

test("視窗不在前景或上一次還沒跑完都不更新", () => {
  const now = tw("2026-11-03T10:00:00");
  assert.equal(shouldAutoRefresh({ ...base, now, lastUpdatedAt: 0, visible: false }), false);
  assert.equal(shouldAutoRefresh({ ...base, now, lastUpdatedAt: 0, inFlight: true }), false);
});

test("畫面上沒有任何標的就不更新", () => {
  const now = tw("2026-11-03T10:00:00");
  assert.equal(shouldAutoRefresh({ ...base, now, lastUpdatedAt: 0, symbols: [] }), false);
});

test("美股盤中（台北半夜）只要畫面上有美股就更新", () => {
  const now = tw("2026-11-04T00:00:00"); // 紐約 11/3 11:00
  assert.equal(
    shouldAutoRefresh({ ...base, now, lastUpdatedAt: 0, symbols: ["2330.TW", "AAPL"] }),
    true,
  );
  assert.equal(shouldAutoRefresh({ ...base, now, lastUpdatedAt: 0 }), false);
});
