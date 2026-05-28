"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  ComposedChart,
  Customized,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useChartTheme } from "@/hooks/use-chart-theme";
import { ENTIRE_PORTFOLIO_DATA_KEY } from "@/lib/chart-constants";
import { applyThemeToChartLines } from "@/lib/chart-palette";
import type { CashFlowEvent } from "@/lib/portfolio-history";
import { formatCurrency } from "@/lib/utils";

export type ValueTrendLineConfig = {
  dataKey: string;
  label: string;
  color: string;
  kind: "account" | "entire";
};

type ChartRow = Record<string, string | number | undefined>;

/** 入出金長條占 Y 軸最大值的比例（繪於 0 附近） */
const FLOW_BAND_MAX_RATIO = 0.24;

type AxisScale = ((v: string | number) => number) & {
  bandwidth?: () => number;
};

type CashFlowBarLayerProps = {
  rows: ChartRow[];
  xAxisMap?: Record<string, { scale: AxisScale }>;
  yAxisMap?: Record<string, { scale: AxisScale }>;
};

function CashFlowBarLayer({
  rows,
  xAxisMap,
  yAxisMap,
  flowBaseline,
  depositColor,
  withdrawalColor,
}: CashFlowBarLayerProps & {
  flowBaseline: number;
  depositColor: string;
  withdrawalColor: string;
}) {
  const xAxis = xAxisMap?.date ?? Object.values(xAxisMap ?? {})[0];
  const yAxis = yAxisMap?.value ?? Object.values(yAxisMap ?? {})[0];
  if (!xAxis?.scale || !yAxis?.scale) return null;

  const flowRows = rows.filter(
    (r) =>
      (typeof r.depositH === "number" && r.depositH > 0) ||
      (typeof r.withdrawalH === "number" && r.withdrawalH < 0),
  );
  if (flowRows.length === 0) return null;

  const bandwidth =
    typeof xAxis.scale.bandwidth === "function"
      ? xAxis.scale.bandwidth()
      : 0;
  const slotW =
    bandwidth > 0 ? bandwidth : Math.max(6, 300 / Math.max(rows.length, 1));
  const barW = Math.min(22, slotW * 0.75);

  return (
    <g className="cash-flow-bars">
      {flowRows.map((row) => {
        const x0 = xAxis.scale(String(row.date));
        if (typeof x0 !== "number" || Number.isNaN(x0)) return null;
        const cx = x0 + (bandwidth > 0 ? bandwidth / 2 : 0);

        if (typeof row.depositH === "number" && row.depositH > 0) {
          const yBase = yAxis.scale(flowBaseline);
          const yTop = yAxis.scale(row.depositH);
          const h = Math.abs(yBase - yTop);
          if (h < 2) return null;
          return (
            <rect
              key={`dep-${row.date}`}
              x={cx - barW / 2}
              y={Math.min(yBase, yTop)}
              width={barW}
              height={h}
              fill={depositColor}
              fillOpacity={0.92}
              rx={3}
            />
          );
        }

        if (typeof row.withdrawalH === "number" && row.withdrawalH < flowBaseline) {
          const yBase = yAxis.scale(flowBaseline);
          const yLow = yAxis.scale(row.withdrawalH);
          const h = Math.abs(yBase - yLow);
          if (h < 2) return null;
          return (
            <rect
              key={`wd-${row.date}`}
              x={cx - barW / 2}
              y={Math.min(yBase, yLow)}
              width={barW}
              height={h}
              fill={withdrawalColor}
              fillOpacity={0.92}
              rx={3}
            />
          );
        }
        return null;
      })}
    </g>
  );
}

function spanDays(rows: ChartRow[]): number {
  if (rows.length < 2) return Math.max(1, rows.length);
  const start = new Date(String(rows[0]!.date));
  const end = new Date(String(rows[rows.length - 1]!.date));
  return Math.max(
    1,
    Math.round((end.getTime() - start.getTime()) / 86_400_000),
  );
}

function rowValueMax(row: ChartRow, lineKeys: string[]): number {
  let max = 0;
  for (const key of lineKeys) {
    const v = row[key];
    if (typeof v === "number" && Number.isFinite(v)) {
      max = Math.max(max, v);
    }
  }
  return max;
}

function rowValueMin(row: ChartRow, lineKeys: string[]): number {
  let min = Infinity;
  for (const key of lineKeys) {
    const v = row[key];
    if (typeof v === "number" && Number.isFinite(v)) {
      min = Math.min(min, v);
    }
  }
  return min === Infinity ? 0 : min;
}

function downsampleRows(rows: ChartRow[], lineKeys: string[]): ChartRow[] {
  const n = rows.length;
  if (n <= 2) return rows;
  const span = spanDays(rows);
  let step = 1;
  if (span > 730) step = 28;
  else if (span > 365) step = 5;
  else if (span > 120) step = 2;
  if (step === 1) return rows;

  const mustKeep = new Set<number>();
  mustKeep.add(0);
  mustKeep.add(n - 1);
  for (let i = 0; i < n; i++) {
    if (rows[i]!.deposit || rows[i]!.withdrawal) mustKeep.add(i);
  }

  const out: ChartRow[] = [];
  for (let i = 0; i < n; i++) {
    if (mustKeep.has(i) || i % step === 0) out.push(rows[i]!);
  }
  return out;
}

function lineCurveType(span: number): "linear" | "monotone" {
  return span > 540 ? "monotone" : "linear";
}

function formatAxisValue(v: number): string {
  const n = Math.abs(Number(v));
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(0)}K`;
  return String(Math.round(n));
}

function preferQuarterAxis(span: number): boolean {
  return span > 420;
}

function quarterLabel(dateStr: string): string {
  const [y, m] = dateStr.split("-").map(Number);
  return `${y} Q${Math.ceil(m / 3)}`;
}

function monthLabel(dateStr: string): string {
  const [y, m] = dateStr.split("-");
  return `${y}/${m}`;
}

function buildAxisTicks(dates: string[], quarterMode: boolean): string[] {
  const ticks: string[] = [];
  let lastKey = "";
  for (const d of dates) {
    const key = quarterMode ? quarterLabel(d) : d.slice(0, 7);
    if (key !== lastKey) {
      ticks.push(d);
      lastKey = key;
    }
  }
  const first = dates[0];
  if (first && !ticks.includes(first)) {
    ticks.unshift(first);
  }
  return ticks;
}

/** Y 軸刻度：強制含 0，並比預設多 1～2 格 */
function buildYAxisTicks([min, max]: [number, number]): number[] {
  const span = max - min;
  if (!Number.isFinite(span) || span <= 0) {
    return min <= 0 && max >= 0 ? [0, Math.max(max, 1)] : [min, max];
  }

  const desired = 7;
  const roughStep = span / (desired - 1);
  const magnitude = Math.pow(10, Math.floor(Math.log10(roughStep)));
  const step =
    Math.ceil(roughStep / Math.max(magnitude, 1e-9)) * magnitude || magnitude;

  const start = min <= 0 ? 0 : Math.floor(min / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= max + step * 0.001; v += step) {
    ticks.push(v);
    if (ticks.length > desired + 2) break;
  }

  if (min <= 0 && max >= 0 && !ticks.some((t) => t === 0)) {
    ticks.push(0);
  }
  if (ticks[ticks.length - 1]! < max) {
    ticks.push(max);
  }

  return [...new Set(ticks.map((t) => Math.round(t * 100) / 100))].sort(
    (a, b) => a - b,
  );
}

function formatAxisTick(dateStr: string, quarterMode: boolean): string {
  return quarterMode ? quarterLabel(dateStr) : monthLabel(dateStr);
}

function maxCashFlowMagnitude(rows: ChartRow[]): number {
  let max = 0;
  for (const r of rows) {
    if (typeof r.deposit === "number") max = Math.max(max, r.deposit);
    if (typeof r.withdrawal === "number") max = Math.max(max, r.withdrawal);
  }
  return max;
}

function enrichFlowBars(
  rows: ChartRow[],
  lineKeys: string[],
): { rows: ChartRow[]; yDomain: [number, number]; flowBaseline: number } {
  const valueMax = Math.max(...rows.map((r) => rowValueMax(r, lineKeys)));
  const flowMax = maxCashFlowMagnitude(rows);
  const flowBaseline = 0;
  const yTop = valueMax > 0 ? valueMax * 1.02 : 1;

  if (flowMax <= 0) {
    return {
      rows,
      yDomain: [0, yTop],
      flowBaseline,
    };
  }

  // 長條高度上限固定為市值峰值的一小段（繪於 0 軸附近），
  // 勿用 flowMax 放大 band，否則大額出入金會與 Y 軸市值刻度對不齐（偏長）。
  const band = valueMax > 0 ? valueMax * FLOW_BAND_MAX_RATIO : flowMax;

  const enriched = rows.map((row) => {
    const hasFlow =
      (typeof row.deposit === "number" && row.deposit > 0) ||
      (typeof row.withdrawal === "number" && row.withdrawal > 0);
    if (!hasFlow) return row;

    return {
      ...row,
      depositH:
        typeof row.deposit === "number" && row.deposit > 0
          ? (row.deposit / flowMax) * band
          : undefined,
      withdrawalH:
        typeof row.withdrawal === "number" && row.withdrawal > 0
          ? -(row.withdrawal / flowMax) * band
          : undefined,
    };
  });

  let maxWithdrawalDepth = 0;
  for (const row of enriched) {
    if (typeof row.withdrawalH === "number" && row.withdrawalH < 0) {
      maxWithdrawalDepth = Math.max(maxWithdrawalDepth, -row.withdrawalH);
    }
  }
  const yBottom = maxWithdrawalDepth > 0 ? -(maxWithdrawalDepth * 1.2) : 0;
  return {
    rows: enriched,
    yDomain: [yBottom, yTop],
    flowBaseline,
  };
}

function MultiLineTooltip({
  active,
  payload,
  label,
  currency,
  lines,
  depositColor,
  withdrawalColor,
}: {
  active?: boolean;
  payload?: {
    dataKey?: string;
    value?: number;
    color?: string;
    payload?: ChartRow;
  }[];
  label?: string;
  currency: string;
  lines: ValueTrendLineConfig[];
  depositColor: string;
  withdrawalColor: string;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload as ChartRow | undefined;
  const dateLabel = label ?? String(row?.date ?? "");

  const lineByKey = new Map(lines.map((l) => [l.dataKey, l]));

  const lineItems = payload
    .filter(
      (p) =>
        p.dataKey &&
        p.dataKey !== "deposit" &&
        p.dataKey !== "withdrawal",
    )
    .map((p) => {
      const cfg = lineByKey.get(String(p.dataKey));
      const val = p.value;
      if (val == null || Number.isNaN(Number(val))) return null;
      return {
        key: String(p.dataKey),
        name: cfg?.label ?? String(p.dataKey),
        value: Number(val),
        color: p.color ?? cfg?.color,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .sort((a, b) => b.value - a.value);

  const flowItems: {
    key: string;
    label: string;
    value: number;
    color: string;
  }[] = [];
  if (typeof row?.deposit === "number" && row.deposit > 0) {
    flowItems.push({
      key: "deposit",
      label: "入金",
      value: row.deposit,
      color: depositColor,
    });
  }
  if (typeof row?.withdrawal === "number" && row.withdrawal > 0) {
    flowItems.push({
      key: "withdrawal",
      label: "出金",
      value: row.withdrawal,
      color: withdrawalColor,
    });
  }
  flowItems.sort((a, b) => b.value - a.value);

  return (
    <div
      className="rounded-lg border border-[var(--color-card-border)] px-3 py-2 text-xs shadow-lg"
      style={{ background: "var(--color-card)" }}
    >
      <p className="mb-1.5 text-[var(--color-muted)]">{dateLabel}</p>
      <ul className="space-y-0.5">
        {lineItems.map((item) => (
          <li
            key={item.key}
            className="tabular-nums"
            style={{ color: item.color }}
          >
            {item.name}: {formatCurrency(item.value, currency)}
          </li>
        ))}
        {flowItems.map((item) => (
          <li
            key={item.key}
            className="tabular-nums"
            style={{ color: item.color }}
          >
            {item.label}: {formatCurrency(item.value, currency)}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ChartPlaceholder({ text }: { text: string }) {
  return (
    <div className="flex h-80 items-center justify-center text-sm text-[var(--color-muted)]">
      {text}
    </div>
  );
}

export function ValueTrendChart({
  lines,
  chartData,
  cashFlows = [],
  loading = false,
  currency = "TWD",
}: {
  lines: ValueTrendLineConfig[];
  chartData: Record<string, string | number>[];
  cashFlows?: CashFlowEvent[];
  loading?: boolean;
  currency?: string;
}) {
  const [mounted, setMounted] = useState(false);
  const chartTheme = useChartTheme();
  const themedLines = useMemo(
    () => applyThemeToChartLines(lines, chartTheme),
    [lines, chartTheme],
  );
  const depositColor = chartTheme.primary;
  const withdrawalColor = chartTheme.accent;

  useEffect(() => setMounted(true), []);

  const lineKeys = useMemo(() => themedLines.map((l) => l.dataKey), [themedLines]);

  const span = useMemo(
    () => spanDays(chartData as ChartRow[]),
    [chartData],
  );
  const quarterMode = preferQuarterAxis(span);
  const curveType = useMemo(() => lineCurveType(span), [span]);

  const { rows: chartRows, yDomain, flowBaseline } = useMemo(() => {
    const sampled = downsampleRows(chartData as ChartRow[], lineKeys);
    return enrichFlowBars(sampled, lineKeys);
  }, [chartData, lineKeys]);

  const dates = useMemo(() => chartRows.map((r) => String(r.date)), [chartRows]);
  const axisTicks = useMemo(
    () => buildAxisTicks(dates, quarterMode),
    [dates, quarterMode],
  );
  const yAxisTicks = useMemo(() => buildYAxisTicks(yDomain), [yDomain]);
  const hasCashFlows = useMemo(
    () =>
      cashFlows.some((f) => f.deposit > 0 || f.withdrawal > 0) ||
      chartRows.some(
        (r) =>
          (typeof r.deposit === "number" && r.deposit > 0) ||
          (typeof r.withdrawal === "number" && r.withdrawal > 0),
      ),
    [cashFlows, chartRows],
  );

  const hasData = chartData.length > 0 && themedLines.length > 0;

  if (!hasData && loading) {
    return <ChartPlaceholder text="載入市值走勢…" />;
  }

  if (!hasData) {
    return <ChartPlaceholder text="尚無市值走勢資料" />;
  }

  if (!mounted || chartRows.length === 0) {
    return (
      <div className="flex h-80 min-h-[20rem] items-center justify-center text-sm text-[var(--color-muted)]">
        載入圖表…
      </div>
    );
  }

  return (
    <div className="relative space-y-3">
      {loading && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-start justify-end p-2">
          <span className="rounded-md border border-[var(--color-card-border)] bg-[var(--color-card)]/90 px-2 py-1 text-[10px] text-[var(--color-muted)]">
            更新中…
          </span>
        </div>
      )}
      <div
        className={`h-[28rem] min-h-[22rem] w-full sm:h-[32rem] ${loading ? "opacity-70" : ""}`}
      >
        <ResponsiveContainer width="100%" height="100%" minHeight={352}>
          <ComposedChart
            data={chartRows}
            margin={{ top: 36, right: 12, left: 4, bottom: 12 }}
          >
            <CartesianGrid
              stroke="var(--color-card-border)"
              strokeDasharray="3 3"
              vertical={false}
            />
            <XAxis
              xAxisId="date"
              dataKey="date"
              type="category"
              scale="band"
              orientation="top"
              ticks={axisTicks}
              interval={0}
              tick={{ fill: "var(--color-muted)", fontSize: 10 }}
              tickFormatter={(v) => formatAxisTick(String(v), quarterMode)}
              tickMargin={8}
            />
            <YAxis
              yAxisId="value"
              domain={yDomain}
              ticks={yAxisTicks}
              allowDataOverflow
              tick={{ fill: "var(--color-muted)", fontSize: 10 }}
              tickFormatter={formatAxisValue}
              width={48}
            />
            <Tooltip
              content={
                <MultiLineTooltip
                  currency={currency}
                  lines={themedLines}
                  depositColor={depositColor}
                  withdrawalColor={withdrawalColor}
                />
              }
            />
            <Legend
              wrapperStyle={{ fontSize: 10, paddingTop: 4 }}
              formatter={(value) => (
                <span style={{ color: "var(--color-foreground)" }}>{value}</span>
              )}
            />
            {themedLines.map((line) => (
              <Line
                key={line.dataKey}
                xAxisId="date"
                yAxisId="value"
                type={curveType}
                dataKey={line.dataKey}
                name={line.label}
                stroke={line.color}
                strokeWidth={
                  line.dataKey === ENTIRE_PORTFOLIO_DATA_KEY ? 3 : 2
                }
                strokeDasharray={line.kind === "entire" ? "6 3" : undefined}
                dot={chartRows.length <= 31}
                activeDot={{ r: 4 }}
                connectNulls={line.kind !== "entire"}
                isAnimationActive={false}
              />
            ))}
            {hasCashFlows && (
              <Customized
                component={(rawProps: unknown) => {
                  const props = rawProps as {
                    xAxisMap?: CashFlowBarLayerProps["xAxisMap"];
                    yAxisMap?: CashFlowBarLayerProps["yAxisMap"];
                  };
                  return (
                    <CashFlowBarLayer
                      rows={chartRows}
                      xAxisMap={props.xAxisMap}
                      yAxisMap={props.yAxisMap}
                      flowBaseline={flowBaseline}
                      depositColor={depositColor}
                      withdrawalColor={withdrawalColor}
                    />
                  );
                }}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="flex flex-wrap justify-center gap-3 text-[10px] text-[var(--color-muted)]">
        {themedLines.map((line) => (
          <span key={line.dataKey} className="inline-flex items-center gap-1">
            <span
              className="inline-block h-0.5 w-4"
              style={{
                background: line.color,
                borderTop:
                  line.kind === "entire" ? `2px dashed ${line.color}` : undefined,
              }}
            />
            {line.label}
          </span>
        ))}
        {hasCashFlows && (
          <>
            <span className="inline-flex items-center gap-1">
              <span
                className="inline-block h-2 w-2 rounded-sm"
                style={{ background: depositColor }}
              />
              入金
            </span>
            <span className="inline-flex items-center gap-1">
              <span
                className="inline-block h-2 w-2 rounded-sm"
                style={{ background: withdrawalColor }}
              />
              出金
            </span>
          </>
        )}
      </div>
    </div>
  );
}
