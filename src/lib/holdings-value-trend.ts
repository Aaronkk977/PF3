import { prisma } from "@/lib/db";
import {
  ENTIRE_PORTFOLIO_COLOR,
  ENTIRE_PORTFOLIO_DATA_KEY,
  ENTIRE_PORTFOLIO_LABEL,
} from "@/lib/chart-constants";
import type { CashFlowEvent } from "@/lib/portfolio-history";
import { resolvePortfolioValueSeries } from "@/lib/portfolio-value-series";
import { STANDARD_ACCOUNTS, accountDataKey } from "@/lib/standard-accounts";

export type ValueTrendLine = {
  dataKey: string;
  label: string;
  color: string;
  kind: "account" | "entire";
  points: { date: string; value: number }[];
};

export type HoldingsValueTrendResult = {
  lines: ValueTrendLine[];
  cashFlows: CashFlowEvent[];
  chartData: Record<string, string | number>[];
};

const FALLBACK_COLORS = [
  "#00f0ff",
  "#00c4e0",
  "#4de8f5",
  "#7dd3fc",
  "#38bdf8",
  "#22d3ee",
];

function colorForAccountName(name: string, index: number): string {
  const std = STANDARD_ACCOUNTS.find((s) => s.name === name);
  if (std) return std.color;
  return FALLBACK_COLORS[index % FALLBACK_COLORS.length]!;
}

export function mergeTrendChartData(
  lines: ValueTrendLine[],
  cashFlows: CashFlowEvent[],
): Record<string, string | number>[] {
  const dateSet = new Set<string>();
  for (const line of lines) {
    for (const p of line.points) dateSet.add(p.date);
  }
  for (const f of cashFlows) dateSet.add(f.date);

  const byDate = new Map<string, Record<string, string | number>>();
  for (const line of lines) {
    for (const p of line.points) {
      let row = byDate.get(p.date);
      if (!row) {
        row = { date: p.date };
        byDate.set(p.date, row);
      }
      row[line.dataKey] = p.value;
    }
  }

  for (const f of cashFlows) {
    let row = byDate.get(f.date);
    if (!row) {
      row = { date: f.date };
      byDate.set(f.date, row);
    }
    if (f.deposit > 0) {
      row.deposit = ((row.deposit as number) ?? 0) + f.deposit;
    }
    if (f.withdrawal > 0) {
      row.withdrawal = ((row.withdrawal as number) ?? 0) + f.withdrawal;
    }
  }

  return [...byDate.values()].sort((a, b) =>
    String(a.date).localeCompare(String(b.date)),
  );
}

export async function buildHoldingsValueTrend(
  periodStart: Date,
  periodEnd: Date,
  options: {
    accountIds?: string[];
    showEntirePortfolioLine: boolean;
    includeCashFlows: boolean;
  },
): Promise<HoldingsValueTrendResult> {
  const allAccounts = await prisma.account.findMany({ orderBy: { name: "asc" } });
  const scopeAccounts =
    options.accountIds?.length && options.accountIds.length > 0
      ? allAccounts.filter((a) => options.accountIds!.includes(a.id))
      : allAccounts;

  const scopeIds = scopeAccounts.map((a) => a.id);
  const lines: ValueTrendLine[] = [];

  for (let i = 0; i < scopeAccounts.length; i++) {
    const acc = scopeAccounts[i]!;
    const { points } = await resolvePortfolioValueSeries(periodStart, periodEnd, {
      accountIds: [acc.id],
    });
    if (points.length === 0) continue;
    lines.push({
      dataKey: accountDataKey(acc.id),
      label: acc.name,
      color: colorForAccountName(acc.name, i),
      kind: "account",
      points,
    });
  }

  // 「整體」這條線的區間跟現金流查詢，帳戶組合是同一組 scopeIds，兩者共用
  // 同一次 resolvePortfolioValueSeries 呼叫（它本身回傳的 cashFlows 就是
  // 這個帳戶組合的現金流），不用另外再查一次。
  let cashFlows: CashFlowEvent[] = [];
  if (options.showEntirePortfolioLine && scopeIds.length > 0) {
    const { points: entirePoints, cashFlows: entireFlows } =
      await resolvePortfolioValueSeries(periodStart, periodEnd, {
        accountIds: scopeIds,
      });
    if (entirePoints.length > 0) {
      lines.push({
        dataKey: ENTIRE_PORTFOLIO_DATA_KEY,
        label: ENTIRE_PORTFOLIO_LABEL,
        color: ENTIRE_PORTFOLIO_COLOR,
        kind: "entire",
        points: entirePoints,
      });
    }
    if (options.includeCashFlows) cashFlows = entireFlows;
  } else if (options.includeCashFlows && scopeIds.length > 0) {
    ({ cashFlows } = await resolvePortfolioValueSeries(periodStart, periodEnd, {
      accountIds: scopeIds,
    }));
  }

  return {
    lines,
    cashFlows,
    chartData: mergeTrendChartData(lines, cashFlows),
  };
}
