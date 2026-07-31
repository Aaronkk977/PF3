import { prisma } from "@/lib/db";
import { toLocalDateKey } from "@/lib/date-keys";
import { toBaseCurrency } from "@/lib/fx";
import { toNumber } from "@/lib/utils";

/** 單日入出金（實際交易日） */
export type CashFlowEvent = {
  date: string;
  deposit: number;
  withdrawal: number;
};

/** @deprecated 請改用 CashFlowEvent */
export type CashFlowMonth = CashFlowEvent & { month?: string };

function isCashFlowType(type: string): boolean {
  const t = type.toUpperCase();
  return t === "DEPOSIT" || t === "WITHDRAWAL";
}

/** 依實際交易日彙總入金／出金（換算為 TWD） */
export async function buildCashFlowSeries(
  periodStart: Date,
  periodEnd: Date,
  options?: { accountIds?: string[] },
): Promise<CashFlowEvent[]> {
  const accountFilter = options?.accountIds?.length
    ? { accountId: { in: options.accountIds } }
    : {};

  const txs = await prisma.transaction.findMany({
    where: {
      date: { gte: periodStart, lte: periodEnd },
      ...accountFilter,
    },
    include: { account: true },
    orderBy: { date: "asc" },
  });

  const cashTxs = txs.filter((tx) => isCashFlowType(tx.type));
  const byDate = new Map<string, { deposit: number; withdrawal: number }>();

  for (const tx of cashTxs) {
    const gross = toNumber(tx.quantity) * toNumber(tx.price);
    const amount = await toBaseCurrency(gross, tx.account.currency);
    const date = toLocalDateKey(tx.date);
    const entry = byDate.get(date) ?? { deposit: 0, withdrawal: 0 };
    const kind = tx.type.toUpperCase();
    if (kind === "DEPOSIT") entry.deposit += amount;
    else entry.withdrawal += amount;
    byDate.set(date, entry);
  }

  return [...byDate.entries()]
    .map(([date, { deposit, withdrawal }]) => ({
      date,
      deposit,
      withdrawal,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// 逐日回放持倉＋算組合總市值的邏輯已經搬到 portfolio-value-simulation.ts
// （純計算，可單元測試）+ portfolio-value-series.ts（帶增量快取），這裡的
// buildPortfolioValueSeries 已經沒有任何呼叫者，直接移除，避免留著兩份會
// 各自累積、彼此分歧的實作。

function netFlowByDate(flows: CashFlowEvent[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const f of flows) {
    map.set(f.date, (map.get(f.date) ?? 0) + f.deposit - f.withdrawal);
  }
  return map;
}

/** 市值序列 → 累積報酬率 %（鏈結日報酬；含入出金造成的市值跳動） */
export function buildCumulativeReturnPctSeries(
  points: { date: string; value: number }[],
): Map<string, number> {
  if (points.length === 0) return new Map();
  const result = new Map<string, number>();
  result.set(points[0]!.date, 0);

  let factor = 1;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]!.value;
    const curr = points[i]!.value;
    if (prev > 0 && curr > 0) {
      factor *= curr / prev;
    }
    result.set(points[i]!.date, (factor - 1) * 100);
  }
  return result;
}

/**
 * 績效用：鏈結日報酬，並自當日市值變動扣除淨入金（入金－出金），
 * 使累積報酬率不受外部資金流入流出影響。
 */
export function buildCumulativeReturnPctNeutralizingFlows(
  points: { date: string; value: number }[],
  flows: CashFlowEvent[],
): Map<string, number> {
  if (points.length === 0) return new Map();
  const flowByDate = netFlowByDate(flows);
  const result = new Map<string, number>();
  result.set(points[0]!.date, 0);

  let factor = 1;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]!.value;
    const curr = points[i]!.value;
    const date = points[i]!.date;
    const netFlow = flowByDate.get(date) ?? 0;

    if (prev > 0 && curr > 0) {
      const dailyReturn = (curr - prev - netFlow) / prev;
      factor *= 1 + dailyReturn;
    }
    result.set(date, (factor - 1) * 100);
  }
  return result;
}

/** 將收盤價 forward-fill 至區間內每個曆日（假日沿用最近交易日收盤價） */
export function buildForwardFilledCloseSeries(
  bars: { date: string; close: number }[],
  periodStart: Date,
  periodEnd: Date,
): { date: string; value: number }[] {
  const filled = buildForwardFilledPriceMap(bars, periodStart, periodEnd);
  return [...filled.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, value]) => ({ date, value }));
}

/** 供績效拆解等模組與組合市值使用相同 forward-fill 報價 */
export function buildForwardFilledPriceMap(
  bars: { date: string; close: number }[],
  periodStart: Date,
  periodEnd: Date,
): Map<string, number> {
  const byDate = new Map(bars.map((b) => [b.date, b.close]));
  const result = new Map<string, number>();

  const cursor = new Date(periodStart);
  cursor.setHours(0, 0, 0, 0);
  const end = new Date(periodEnd);
  end.setHours(23, 59, 59, 999);
  const periodStartKey = toLocalDateKey(cursor);

  const beforeStart = bars
    .filter((b) => b.date < periodStartKey && b.close > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  let lastPrice: number | null =
    beforeStart.length > 0
      ? beforeStart[beforeStart.length - 1]!.close
      : null;

  while (cursor <= end) {
    const key = toLocalDateKey(cursor);
    if (byDate.has(key)) {
      lastPrice = byDate.get(key)!;
    }
    if (lastPrice !== null && lastPrice > 0) {
      result.set(key, lastPrice);
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  return result;
}
