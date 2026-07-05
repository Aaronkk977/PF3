"use client";

import { useChartTheme } from "@/hooks/use-chart-theme";
import { isGrayscaleChartTheme } from "@/lib/theme-utils";
import { cn, formatCurrency } from "@/lib/utils";
import { useCallback, useMemo, useState } from "react";
import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Sector,
  type PieLabelRenderProps,
} from "recharts";
import type { PieSectorDataItem } from "recharts/types/polar/Pie";

type Slice = {
  name: string;
  displayName?: string;
  value: number;
  pct: number;
  key?: string;
};

const CASH_LABEL = "\u73fe\u91d1";
const CASH_FILL_CYBER = "hsl(186, 75%, 84%)";
const CASH_FILL_LIGHT = "#a8a29e";

function orderSlices(data: Slice[]): Slice[] {
  const cash = data.filter((s) => s.name === CASH_LABEL);
  const rest = data
    .filter((s) => s.name !== CASH_LABEL)
    .sort((a, b) => b.value - a.value);
  return [...cash, ...rest];
}

/** 持倉配置：Cyberpunk 霓虹青藍漸層（高飽和、偏亮，避免彩虹色過花） */
function sliceFill(index: number, total: number, monochrome: boolean): string {
  if (monochrome) {
    if (total <= 1) return "#a3a3a3";
    const t = index / (total - 1);
    const gray = Math.round(130 + t * 90);
    return `rgb(${gray},${gray},${gray})`;
  }
  if (total <= 1) return "#00f0ff";
  const t = index / (total - 1);
  const hue = 184 + t * 28;
  const lightness = 54 + t * 16;
  return `hsl(${hue}, 100%, ${lightness}%)`;
}

const MIN_LABEL_PCT = 0.01;

function shouldShowSliceLabel(percent: number): boolean {
  return percent >= MIN_LABEL_PCT;
}

function renderActiveShape(props: PieSectorDataItem) {
  const {
    cx,
    cy,
    innerRadius = 0,
    outerRadius = 0,
    startAngle,
    endAngle,
    fill,
  } = props;
  return (
    <Sector
      cx={cx}
      cy={cy}
      innerRadius={innerRadius}
      outerRadius={Number(outerRadius) + 12}
      startAngle={startAngle}
      endAngle={endAngle}
      fill={fill}
      stroke="var(--color-primary)"
      strokeWidth={2}
      style={{
        filter:
          "drop-shadow(0 0 16px color-mix(in srgb, var(--color-primary) 75%, transparent))",
      }}
    />
  );
}

export function AllocationChart({
  data,
  centerValue,
  centerCurrency = "TWD",
  onSliceClick,
  drillHint,
}: {
  data: Slice[];
  centerValue: number;
  centerCurrency?: string;
  onSliceClick?: (slice: Slice, index: number) => void;
  drillHint?: string | null;
}) {
  const chartTheme = useChartTheme();
  const monochrome = isGrayscaleChartTheme(chartTheme);
  const [activeIndex, setActiveIndex] = useState<number | undefined>(undefined);

  const ordered = useMemo(() => orderSlices(data), [data]);

  const fills = useMemo(() => {
    const nonCash = ordered.filter((s) => s.name !== CASH_LABEL);
    let gradIdx = 0;
    return ordered.map((slice) => {
      if (slice.name === CASH_LABEL) {
        return monochrome ? CASH_FILL_LIGHT : CASH_FILL_CYBER;
      }
      const fill = sliceFill(gradIdx, nonCash.length, monochrome);
      gradIdx++;
      return fill;
    });
  }, [ordered, monochrome]);

  const renderSliceLabel = useCallback((props: PieLabelRenderProps) => {
    const {
      cx = 0,
      cy = 0,
      midAngle = 0,
      outerRadius = 0,
      percent = 0,
      name,
      payload,
    } = props;
    const slice = payload as Slice | undefined;
    const label = slice?.displayName ?? slice?.name ?? String(name ?? "");
    if (!label || !shouldShowSliceLabel(percent)) return null;

    const RADIAN = Math.PI / 180;
    const labelRadius = Number(outerRadius) * 1.18;
    const x = Number(cx) + labelRadius * Math.cos(-midAngle * RADIAN);
    const y = Number(cy) + labelRadius * Math.sin(-midAngle * RADIAN);
    const anchor = x > Number(cx) ? "start" : "end";

    return (
      <text
        x={x}
        y={y}
        fill="var(--color-foreground)"
        textAnchor={anchor}
        dominantBaseline="central"
        fontSize={11}
        fontFamily="var(--font-sans)"
      >
        {label}
      </text>
    );
  }, []);

  const renderSliceLabelLine = useCallback((props: PieLabelRenderProps) => {
    const { percent = 0, points } = props;
    if (!shouldShowSliceLabel(percent) || !points || points.length < 2) {
      return <path d="M0,0 L0,0" fill="none" stroke="none" />;
    }
    const [start, end] = points;
    return (
      <path
        d={`M${start.x},${start.y}L${end.x},${end.y}`}
        stroke="var(--color-muted)"
        strokeWidth={1}
        strokeOpacity={0.55}
        fill="none"
      />
    );
  }, []);

  const showOuterLabels = activeIndex === undefined;

  const activeSlice =
    activeIndex !== undefined ? ordered[activeIndex] : undefined;
  const centerTitle = activeSlice
    ? (activeSlice.displayName ?? activeSlice.name)
    : "\u7e3d\u5e02\u503c";
  const centerAmount = activeSlice ? activeSlice.value : centerValue;
  const centerSub = activeSlice
    ? `${(activeSlice.pct * 100).toFixed(1)}%`
    : null;

  if (data.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-[var(--color-muted)]">
        {"\u5c1a\u7121\u8cc7\u6599"}
      </div>
    );
  }

  return (
    <div className="flex h-[36rem] flex-col overflow-visible py-2">
      {drillHint && (
        <p className="mb-2 shrink-0 text-xs text-[var(--color-primary)]">
          {drillHint}
        </p>
      )}
      <div className="relative min-h-0 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart margin={{ top: 24, right: 36, bottom: 24, left: 36 }}>
            <Pie
              data={ordered}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius="38%"
              outerRadius="86%"
              paddingAngle={0.35}
              stroke="var(--color-background)"
              strokeWidth={2}
              isAnimationActive
              animationDuration={220}
              activeIndex={activeIndex}
              activeShape={renderActiveShape}
              onMouseEnter={(_, index) => setActiveIndex(index)}
              onMouseLeave={() => setActiveIndex(undefined)}
              onClick={(_, index) => {
                const slice = ordered[index];
                if (slice && onSliceClick) onSliceClick(slice, index);
              }}
              label={showOuterLabels ? renderSliceLabel : false}
              labelLine={showOuterLabels ? renderSliceLabelLine : false}
            >
            {ordered.map((_, i) => {
              const isActive = activeIndex === i;
              const isDimmed = activeIndex !== undefined && !isActive;
              return (
                <Cell
                  key={i}
                  fill={fills[i]}
                  fillOpacity={isDimmed ? 0.28 : 1}
                  stroke={
                    isActive
                      ? "var(--color-primary)"
                      : "var(--color-background)"
                  }
                  strokeWidth={isActive ? 2 : 2}
                  style={{
                    cursor: "pointer",
                    transition: "fill-opacity 0.2s ease",
                    filter: isActive
                      ? "drop-shadow(0 0 10px color-mix(in srgb, var(--color-primary) 50%, transparent))"
                      : undefined,
                  }}
                />
              );
            })}
          </Pie>
        </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div
            className={cn(
              "flex max-w-[min(42%,12rem)] flex-col items-center justify-center gap-1 text-center transition-opacity duration-200",
              activeSlice && "opacity-95",
            )}
          >
            <p
              className={cn(
                "w-full truncate text-[10px] uppercase tracking-widest transition-colors duration-200",
                activeSlice
                  ? "text-[var(--color-primary)]"
                  : "text-[var(--color-muted)]",
              )}
            >
              {centerTitle}
            </p>
            <p
              className={cn(
                "w-full text-lg font-bold leading-none tabular-nums transition-colors duration-200 sm:text-xl",
                monochrome
                  ? "text-[var(--color-foreground)]"
                  : "text-[var(--color-primary)] glow-text",
              )}
            >
              {formatCurrency(centerAmount, centerCurrency)}
            </p>
            {centerSub && (
              <p className="w-full text-xs leading-none text-[var(--color-primary)] tabular-nums">
                {centerSub}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}


