"use client";

import { useMemo } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { TooltipProps } from "recharts";
import { useChartTheme } from "@/hooks/use-chart-theme";
import { ENTIRE_PORTFOLIO_DATA_KEY } from "@/lib/chart-constants";
import { applyThemeToChartLines } from "@/lib/chart-palette";

export type ChartLineConfig = {
  dataKey: string;
  label: string;
  color: string;
  kind: "portfolio" | "benchmark";
};

type ChartRow = Record<string, string | number>;

type PerformanceTooltipProps = TooltipProps<number, string> & {
  lineByKey: Map<string, ChartLineConfig>;
};

function PerformanceTooltip({
  active,
  payload,
  label,
  lineByKey,
}: PerformanceTooltipProps) {
  if (!active || !payload?.length) return null;

  const sortedPayload = [...payload].sort((a, b) => {
    const av = Number(a.value);
    const bv = Number(b.value);
    if (Number.isNaN(av) && Number.isNaN(bv)) return 0;
    if (Number.isNaN(av)) return 1;
    if (Number.isNaN(bv)) return -1;
    return bv - av;
  });

  return (
    <div
      className="rounded-lg border border-[var(--color-card-border)] px-3 py-2 text-xs shadow-lg"
      style={{
        background: "var(--color-card)",
        color: "var(--color-foreground)",
      }}
    >
      <p className="mb-1.5 text-[10px] text-[var(--color-muted)]">
        {String(label ?? "")}
      </p>
      <ul className="space-y-1">
        {sortedPayload.map((entry) => {
          const key = String(entry.dataKey ?? "");
          const line = lineByKey.get(key);
          const name = line?.label ?? entry.name ?? key;
          const value = entry.value;
          if (value == null || Number.isNaN(Number(value))) return null;
          return (
            <li
              key={key}
              className="flex items-center justify-between gap-4 tabular-nums"
            >
              <span className="flex items-center gap-1.5">
                <span
                  className="inline-block h-2 w-2 shrink-0 rounded-full"
                  style={{ background: entry.color ?? line?.color }}
                />
                <span>{name}</span>
              </span>
              <span className="font-medium">{Number(value).toFixed(2)}%</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function PerformanceChart({
  data,
  lines,
}: {
  data: ChartRow[];
  lines: ChartLineConfig[];
}) {
  const chartTheme = useChartTheme();
  const themedLines = useMemo(
    () => applyThemeToChartLines(lines, chartTheme),
    [lines, chartTheme],
  );
  const lineByKey = new Map(themedLines.map((l) => [l.dataKey, l]));

  if (data.length === 0 || themedLines.length === 0) {
    return (
      <div className="flex h-[28rem] items-center justify-center text-sm text-[var(--color-muted)]">
        尚無績效資料（可能需要 Yahoo 行情或更多歷史資料）
      </div>
    );
  }

  const portfolioLines = themedLines.filter((l) => l.kind === "portfolio");
  const benchmarkLines = themedLines.filter((l) => l.kind === "benchmark");

  return (
    <div className="pb-4">
      <div className="h-[28rem]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
          <CartesianGrid
            stroke="var(--color-card-border)"
            strokeDasharray="3 3"
          />
          <XAxis
            dataKey="date"
            tick={{ fill: "var(--color-muted)", fontSize: 10 }}
            tickFormatter={(v) => String(v).slice(5)}
          />
          <YAxis
            tick={{ fill: "var(--color-muted)", fontSize: 10 }}
            tickCount={9}
            domain={[
              (min: number) => Math.min(min, 0) * 1.05,
              (max: number) => max * 1.05,
            ]}
            tickFormatter={(v) => `${Number(v).toFixed(1)}%`}
          />
          <ReferenceLine y={0} stroke="var(--color-muted)" strokeDasharray="4 4" />
          <Tooltip
            content={(props) => (
              <PerformanceTooltip
                {...(props as PerformanceTooltipProps)}
                lineByKey={lineByKey}
              />
            )}
          />
          {portfolioLines.map((line) => (
            <Line
              key={line.dataKey}
              type="monotone"
              dataKey={line.dataKey}
              name={line.label}
              stroke={line.color}
              strokeWidth={
                line.dataKey === ENTIRE_PORTFOLIO_DATA_KEY ? 3.5 : 2.5
              }
              dot={false}
              connectNulls={line.dataKey !== ENTIRE_PORTFOLIO_DATA_KEY}
            />
          ))}
          {benchmarkLines.map((line) => (
            <Line
              key={line.dataKey}
              type="monotone"
              dataKey={line.dataKey}
              name={line.label}
              stroke={line.color}
              strokeWidth={1.75}
              strokeDasharray="6 4"
              dot={false}
              connectNulls
            />
          ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-center gap-x-5 gap-y-1.5 pb-2 text-center text-[10px] text-[var(--color-muted)]">
        {themedLines.map((line) => (
          <span
            key={line.dataKey}
            className="inline-flex items-center gap-1.5"
          >
            {line.kind === "benchmark" ? (
              <span
                className="inline-block h-0 w-5 shrink-0 border-t-[2px] border-dashed"
                style={{ borderColor: line.color }}
                aria-hidden
              />
            ) : (
              <span
                className="inline-block w-5 shrink-0 rounded-sm"
                style={{
                  height: line.dataKey === ENTIRE_PORTFOLIO_DATA_KEY ? 3 : 2,
                  background: line.color,
                }}
                aria-hidden
              />
            )}
            {line.label}
          </span>
        ))}
      </div>
    </div>
  );
}
