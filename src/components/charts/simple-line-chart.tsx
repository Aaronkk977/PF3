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

function toPoints(data: LinePoint[]) {
  return data
    .filter((d) => d.close > 0)
    .map((d) => ({ time: d.date as Time, value: d.close }))
    .sort((a, b) => (a.time < b.time ? -1 : 1));
}

/** overlay：疊一條對照用的線（例如加權指數）在左側獨立刻度上，
 *  兩條線單位不同，各自用自己的刻度才看得出走勢關係。 */
export function SimpleLineChart({
  data,
  overlay,
  height = 320,
}: {
  data: LinePoint[];
  overlay?: LinePoint[];
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
      leftPriceScale: { borderColor: theme.cardBorder, visible: !!overlay?.length },
      timeScale: { borderColor: theme.cardBorder },
    });
    chartRef.current = chart;

    if (overlay?.length) {
      // 先加對照線，讓主線畫在它上面
      const overlaySeries = chart.addSeries(LineSeries, {
        color: theme.muted,
        lineWidth: 1,
        priceScaleId: "left",
        lastValueVisible: true,
        priceLineVisible: false,
      });
      overlaySeries.setData(toPoints(overlay));
    }

    const series = chart.addSeries(LineSeries, {
      color: theme.primary,
      lineWidth: 2,
    });
    series.setData(toPoints(data));
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
  }, [data, overlay, height, theme]);

  return <div ref={containerRef} style={{ height }} />;
}
