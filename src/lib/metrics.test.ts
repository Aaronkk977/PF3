import assert from "node:assert/strict";
import { test } from "node:test";
import {
  analyzeValueSeries,
  buildDrawdownSeries,
  computeMaxDrawdownEpisode,
  computeSemiVariance,
  computeSharpeRatio,
  computeVolatility,
  computeXirr,
  dailyReturnsFromValues,
  dailyReturnsNeutralizingFlows,
} from "@/lib/metrics";

const close = (actual: number, expected: number, eps = 1e-6) =>
  assert.ok(Math.abs(actual - expected) < eps, `${actual} ≉ ${expected}`);

test("XIRR：投入 100、一年後拿回 110，年化約 10%", () => {
  const r = computeXirr([
    { date: new Date("2024-01-01"), amount: -100 },
    { date: new Date("2024-12-31T12:00:00Z"), amount: 110 },
  ]);
  assert.ok(r != null);
  close(r, 0.1, 0.002);
});

test("XIRR：現金流不到兩筆回傳 null", () => {
  assert.equal(computeXirr([{ date: new Date(), amount: -1 }]), null);
});

test("日報酬只用前一天市值 > 0 的區間", () => {
  assert.deepEqual(dailyReturnsFromValues([0, 100, 110]), [0.1]);
});

test("扣除當日淨入金：入金造成的市值增加不算報酬", () => {
  const { returns } = dailyReturnsNeutralizingFlows(
    [
      { date: "d1", value: 100 },
      { date: "d2", value: 210 },
    ],
    [{ date: "d2", deposit: 100, withdrawal: 0 }],
  );
  close(returns[0]!, 0.1);
});

test("波動率／夏普：報酬恆定時標準差為 0，夏普回傳 0", () => {
  assert.equal(computeVolatility([0.01, 0.01, 0.01]), 0);
  assert.equal(computeSharpeRatio([0.01, 0.01, 0.01]), 0);
});

test("半變異數只計入負報酬", () => {
  close(computeSemiVariance([0.02, -0.01]), ((0.01 * 0.01) / 2) * 252);
});

test("回撤序列以歷史高點為基準", () => {
  const dd = buildDrawdownSeries([
    { date: "a", wealth: 1 },
    { date: "b", wealth: 1.2 },
    { date: "c", wealth: 0.9 },
  ]);
  close(dd[2]!.drawdownPct, -25);
});

test("最大回撤區間：高點、低點、回復日與持續天數", () => {
  const ep = computeMaxDrawdownEpisode([
    { date: "a", wealth: 1 },
    { date: "b", wealth: 1.2 },
    { date: "c", wealth: 0.9 },
    { date: "d", wealth: 1.0 },
    { date: "e", wealth: 1.25 },
  ]);
  close(ep.maxDrawdown, 0.25);
  assert.equal(ep.peakDate, "b");
  assert.equal(ep.troughDate, "c");
  assert.equal(ep.recoveryDate, "e");
  assert.equal(ep.durationDays, 3);
});

test("analyzeValueSeries：空序列回傳全 0 而不是丟錯", () => {
  const r = analyzeValueSeries([]);
  assert.equal(r.maxDrawdown, 0);
  assert.equal(r.periodReturn, 0);
});

test("analyzeValueSeries：區間報酬扣掉入金", () => {
  const r = analyzeValueSeries(
    [
      { date: "d1", value: 100 },
      { date: "d2", value: 210 },
    ],
    [{ date: "d2", deposit: 100, withdrawal: 0 }],
  );
  close(r.periodReturn, 0.1);
});
