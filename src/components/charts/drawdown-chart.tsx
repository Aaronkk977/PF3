"use client";

import { useChartTheme } from "@/hooks/use-chart-theme";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DrawdownPoint } from "@/lib/metrics";

/** 回撤幅度通常落在 0 到負幾十趴之間，用固定的整數級距畫刻度，才能維持
 *  等距、又不會讓回撤很淺的帳戶被拉伸出一堆空白刻度。 */
function pickTickStep(maxDrawdownAbs: number): number {
  if (maxDrawdownAbs <= 10) return 2;
  if (maxDrawdownAbs <= 25) return 5;
  if (maxDrawdownAbs <= 60) return 10;
  return 20;
}

function buildDrawdownTicks(data: DrawdownPoint[]): number[] {
  const minDrawdown = Math.min(0, ...data.map((d) => d.drawdownPct));
  const step = pickTickStep(Math.abs(minDrawdown));
  const lowestTick = Math.floor(minDrawdown / step) * step;
  const ticks: number[] = [];
  for (let t = 0; t >= lowestTick; t -= step) ticks.push(t);
  return ticks;
}

export function DrawdownChart({ data }: { data: DrawdownPoint[] }) {
  const theme = useChartTheme();

  if (data.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-[var(--color-muted)]">
        尚無回撤資料
      </div>
    );
  }

  const ticks = buildDrawdownTicks(data);

  return (
    <div className="h-52">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data}>
          <defs>
            <linearGradient id="drawdownFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={theme.accent} stopOpacity={0.35} />
              <stop offset="100%" stopColor={theme.accent} stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <CartesianGrid
            stroke="var(--color-card-border)"
            strokeDasharray="3 3"
            vertical={false}
          />
          <XAxis
            dataKey="date"
            tick={{ fill: "var(--color-muted)", fontSize: 10 }}
            tickFormatter={(v) => String(v).slice(5)}
          />
          <YAxis
            tick={{ fill: "var(--color-muted)", fontSize: 10 }}
            tickFormatter={(v) => `${Number(v).toFixed(0)}%`}
            domain={[ticks[ticks.length - 1] ?? 0, 0]}
            ticks={ticks}
          />
          <ReferenceLine y={0} stroke="var(--color-muted)" strokeDasharray="4 4" />
          <Tooltip
            contentStyle={{
              background: "var(--color-card)",
              border: "1px solid var(--color-card-border)",
              borderRadius: 8,
            }}
            formatter={(value: number) => [`${value.toFixed(2)}%`, "回撤"]}
            labelFormatter={(label) => String(label)}
          />
          <Area
            type="monotone"
            dataKey="drawdownPct"
            stroke={theme.accent}
            strokeWidth={1.5}
            fill="url(#drawdownFill)"
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
