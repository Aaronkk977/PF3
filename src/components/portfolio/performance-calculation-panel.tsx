"use client";

import type { PerformanceCalculation } from "@/lib/performance-calculation";
import { formatCurrency } from "@/lib/utils";

type Row = {
  id: string;
  label: string;
  amount: number;
  op: string;
  emphasis?: boolean;
};

function buildRows(calc: PerformanceCalculation): Row[] {
  const rows: Row[] = [
    { id: "start", label: "期初市值", amount: calc.startValue, op: "" },
    {
      id: "netCashFlow",
      label: "淨出入金",
      amount: calc.netDeposits,
      op: calc.netDeposits >= 0 ? "+" : "−",
    },
    {
      id: "realizedPnl",
      label: "實現損益（成交價）",
      amount: calc.realizedPnl,
      op: calc.realizedPnl >= 0 ? "+" : "−",
    },
    { id: "fees", label: "手續費", amount: calc.fees, op: "−" },
    { id: "taxes", label: "稅", amount: calc.taxes, op: "−" },
    {
      id: "motion",
      label: "股息",
      amount: calc.dividends,
      op: calc.dividends >= 0 ? "+" : "−",
    },
    {
      id: "capitalGains",
      label: "投資損益（股價）",
      amount: calc.capitalGains,
      op: calc.capitalGains >= 0 ? "+" : "−",
    },
  ];

  if (Math.abs(calc.fxDifference) >= 1) {
    rows.push({
      id: "fxDifference",
      label: "匯差",
      amount: calc.fxDifference,
      op: calc.fxDifference >= 0 ? "+" : "−",
    });
  }

  rows.push({
    id: "end",
    label: "期末市值",
    amount: calc.endValue,
    op: "",
    emphasis: true,
  });

  return rows;
}

function amountClass(emphasis?: boolean): string {
  if (emphasis) return "font-semibold tabular-nums text-[var(--color-foreground)]";
  return "tabular-nums text-[var(--color-foreground)]";
}

export function PerformanceCalculationPanel({
  calculation,
}: {
  calculation: PerformanceCalculation;
}) {
  const rows = buildRows(calculation);
  const currency = calculation.baseCurrency;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <tbody>
          {rows.map((row) => {
            const display = Math.abs(row.amount);

            return (
              <tr
                key={row.id}
                className={
                  row.emphasis
                    ? "border-t border-[var(--color-accent)]/40 bg-[var(--color-accent)]/6"
                    : "border-b border-[var(--color-card-border)]/30 last:border-0"
                }
              >
                <td className="py-1.5 pr-2 text-[var(--color-muted)]">
                  {row.op && (
                    <span className="mr-1.5 inline-block w-3 text-center font-medium text-[var(--color-accent)]">
                      {row.op}
                    </span>
                  )}
                  <span className={row.emphasis ? "font-medium text-[var(--color-foreground)]" : ""}>
                    {row.label}
                  </span>
                </td>
                <td
                  className={`py-1.5 pl-2 text-right ${amountClass(row.emphasis)}`}
                >
                  {row.op === "−" && display > 0 ? "−" : ""}
                  {formatCurrency(display, currency)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
