"use client";

import { useMemo } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { TooltipProps } from "recharts";
import { useChartTheme } from "@/hooks/use-chart-theme";
import type { TradesPeriodBucket } from "@/lib/trades-report";
import { isGrayscaleChartTheme } from "@/lib/theme-utils";
import { formatCurrency } from "@/lib/utils";

type ChartRow = {
  label: string;
  realizedPnl: number;
  fees: number;
  taxes: number;
};

function TradesTooltip({
  active,
  payload,
  label,
  baseCurrency,
}: TooltipProps<number, string> & { baseCurrency: string }) {
  if (!active || !payload?.length) return null;

  return (
    <div
      className="rounded-lg border border-[var(--color-card-border)] px-3 py-2 text-xs shadow-lg"
      style={{
        background: "var(--color-card)",
        color: "var(--color-foreground)",
      }}
    >
      <p className="mb-1.5 font-medium">{String(label ?? "")}</p>
      <ul className="space-y-1 tabular-nums">
        {payload.map((entry) => (
          <li
            key={String(entry.dataKey)}
            className="flex items-center justify-between gap-4"
          >
            <span className="flex items-center gap-1.5">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ background: entry.color }}
              />
              {entry.name}
            </span>
            <span>{formatCurrency(Number(entry.value), baseCurrency)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function TradesPeriodChart({
  buckets,
  baseCurrency,
}: {
  buckets: TradesPeriodBucket[];
  baseCurrency: string;
}) {
  const chartTheme = useChartTheme();
  const data: ChartRow[] = useMemo(
    () =>
      buckets.map((b) => ({
        label: b.label,
        realizedPnl: b.realizedPnl,
        fees: b.fees,
        taxes: b.taxes,
      })),
    [buckets],
  );

  const colors = useMemo(() => {
    if (isGrayscaleChartTheme(chartTheme)) {
      return {
        pnl: "var(--color-foreground)",
        fees: "var(--color-muted)",
        taxes: "#888",
      };
    }
    return {
      pnl: "var(--color-primary)",
      fees: "var(--color-accent)",
      taxes: "#f59e0b",
    };
  }, [chartTheme]);

  if (data.length === 0) {
    return (
      <div className="flex h-56 items-center justify-center text-sm text-[var(--color-muted)]">
        此期間無可繪製的彙總資料
      </div>
    );
  }

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={data}
          margin={{ top: 8, right: 52, left: 8, bottom: 4 }}
        >
          <CartesianGrid
            stroke="var(--color-card-border)"
            strokeDasharray="3 3"
          />
          <XAxis
            dataKey="label"
            tick={{ fill: "var(--color-muted)", fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: "var(--color-card-border)" }}
            interval="preserveStartEnd"
          />
          <YAxis
            yAxisId="pnl"
            orientation="left"
            tick={{ fill: colors.pnl, fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: "var(--color-card-border)" }}
            tickFormatter={(v) =>
              Number(v).toLocaleString("zh-TW", { maximumFractionDigits: 0 })
            }
            label={{
              value: "實現損益",
              angle: -90,
              position: "insideLeft",
              fill: "var(--color-muted)",
              fontSize: 10,
              dx: -4,
            }}
          />
          <YAxis
            yAxisId="fees"
            orientation="right"
            tick={{ fill: colors.fees, fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: "var(--color-card-border)" }}
            tickFormatter={(v) =>
              Number(v).toLocaleString("zh-TW", { maximumFractionDigits: 0 })
            }
            label={{
              value: "手續費／稅",
              angle: 90,
              position: "insideRight",
              fill: "var(--color-muted)",
              fontSize: 10,
              dx: 4,
            }}
          />
          <Tooltip
            content={<TradesTooltip baseCurrency={baseCurrency} />}
          />
          <Legend
            wrapperStyle={{ fontSize: 12, color: "var(--color-muted)" }}
          />
          <Line
            yAxisId="pnl"
            type="monotone"
            dataKey="realizedPnl"
            name="實現損益"
            stroke={colors.pnl}
            strokeWidth={2}
            dot={{ r: 3 }}
            activeDot={{ r: 5 }}
          />
          <Line
            yAxisId="fees"
            type="monotone"
            dataKey="fees"
            name="手續費"
            stroke={colors.fees}
            strokeWidth={1.5}
            dot={{ r: 2 }}
            activeDot={{ r: 4 }}
          />
          <Line
            yAxisId="fees"
            type="monotone"
            dataKey="taxes"
            name="稅"
            stroke={colors.taxes}
            strokeWidth={1.5}
            dot={{ r: 2 }}
            activeDot={{ r: 4 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
