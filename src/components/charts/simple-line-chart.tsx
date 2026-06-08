"use client";

import { useChartTheme } from "@/hooks/use-chart-theme";
import { useEffect, useRef } from "react";
import {
  ColorType,
  LineSeries,
  createChart,
  type IChartApi,
  type Time,
} from "lightweight-charts";

type LinePoint = {
  date: string;
  close: number;
};

export function SimpleLineChart({
  data,
  height = 320,
}: {
  data: LinePoint[];
  height?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const theme = useChartTheme();

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const chart = createChart(el, {
      width: el.clientWidth,
      height,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: theme.foreground,
      },
      grid: {
        vertLines: { color: theme.cardBorder },
        horzLines: { color: theme.cardBorder },
      },
      crosshair: { vertLine: { color: theme.muted }, horzLine: { color: theme.muted } },
      rightPriceScale: { borderColor: theme.cardBorder },
      timeScale: { borderColor: theme.cardBorder },
    });
    chartRef.current = chart;

    const series = chart.addSeries(LineSeries, {
      color: theme.primary,
      lineWidth: 2,
    });

    const points = data
      .filter((d) => d.close > 0)
      .map((d) => ({ time: d.date as Time, value: d.close }))
      .sort((a, b) => (a.time < b.time ? -1 : 1));

    series.setData(points);
    chart.timeScale().fitContent();

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) chart.applyOptions({ width: entry.contentRect.width });
    });
    observer.observe(el);

    return () => {
      observer.disconnect();
      chart.remove();
      chartRef.current = null;
    };
  }, [data, height, theme]);

  return <div ref={containerRef} style={{ height }} />;
}
