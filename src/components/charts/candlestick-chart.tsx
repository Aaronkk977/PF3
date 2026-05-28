"use client";

import {
  TradeTriangleMarkersPrimitive,
  type TradeTriangleMarker,
} from "@/components/charts/trade-triangle-markers";
import { useChartTheme } from "@/hooks/use-chart-theme";
import { withAlpha } from "@/lib/chart-theme";
import { useEffect, useRef } from "react";
import {
  CandlestickSeries,
  ColorType,
  LineSeries,
  LineStyle,
  createChart,
  type IChartApi,
  type Time,
} from "lightweight-charts";

export type OhlcData = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
};

export type TransactionMarker = {
  date: string;
  type: "BUY" | "SELL" | "DIVIDEND";
  price: number;
};

function tradeMarkersFromTransactions(
  transactions: TransactionMarker[],
  data: OhlcData[],
): TradeTriangleMarker[] {
  const byDate = new Map(data.map((b) => [b.date, b]));
  return transactions
    .filter((tx): tx is TransactionMarker & { type: "BUY" | "SELL" } =>
      tx.type === "BUY" || tx.type === "SELL",
    )
    .map((tx) => {
      const bar = byDate.get(tx.date);
      const price =
        tx.type === "BUY"
          ? (bar?.low ?? tx.price)
          : (bar?.high ?? tx.price);
      return { date: tx.date, type: tx.type, price };
    });
}

function closingMA(
  data: OhlcData[],
  period: number,
): { time: Time; value: number }[] {
  const out: { time: Time; value: number }[] = [];
  if (data.length < period) return out;
  for (let i = period - 1; i < data.length; i++) {
    let sum = 0;
    for (let k = i - period + 1; k <= i; k++) sum += data[k].close;
    out.push({ time: data[i].date as Time, value: sum / period });
  }
  return out;
}

export function CandlestickChart({
  data,
  transactions = [],
}: {
  data: OhlcData[];
  transactions?: TransactionMarker[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const chartTheme = useChartTheme();

  useEffect(() => {
    const el = containerRef.current;
    if (!el || data.length === 0) return;

    const sorted = [...data].sort((a, b) => a.date.localeCompare(b.date));

    const grid = withAlpha(chartTheme.cardBorder, 0.2);
    const chart = createChart(el, {
      layout: {
        background: { type: ColorType.Solid, color: chartTheme.background },
        textColor: chartTheme.muted,
      },
      grid: {
        vertLines: { color: grid },
        horzLines: { color: grid },
      },
      width: el.clientWidth || el.offsetWidth || 600,
      height: 400,
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: chartTheme.positive,
      downColor: chartTheme.negative,
      borderUpColor: chartTheme.positive,
      borderDownColor: chartTheme.negative,
      wickUpColor: chartTheme.positive,
      wickDownColor: chartTheme.negative,
    });

    series.setData(
      sorted.map((d) => ({
        time: d.date as Time,
        open: d.open,
        high: d.high,
        low: d.low,
        close: d.close,
      })),
    );

    const ma10 = closingMA(sorted, 10);
    const ma20 = closingMA(sorted, 20);
    const ma60 = closingMA(sorted, 60);
    const ma250 = closingMA(sorted, 250);
    if (ma10.length > 0) {
      const ma10Series = chart.addSeries(LineSeries, {
        color: withAlpha(chartTheme.accent, 0.95),
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      ma10Series.setData(ma10);
    }
    if (ma20.length > 0) {
      const ma20Series = chart.addSeries(LineSeries, {
        color: withAlpha(chartTheme.primary, 0.9),
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      ma20Series.setData(ma20);
    }
    if (ma60.length > 0) {
      const ma60Series = chart.addSeries(LineSeries, {
        color: withAlpha(chartTheme.foreground, 0.45),
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      ma60Series.setData(ma60);
    }
    if (ma250.length > 0) {
      const ma250Series = chart.addSeries(LineSeries, {
        color: withAlpha(chartTheme.muted, 0.95),
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      ma250Series.setData(ma250);
    }

    const triangles = new TradeTriangleMarkersPrimitive(
      tradeMarkersFromTransactions(transactions, sorted),
      { buy: chartTheme.positive, sell: chartTheme.negative },
    );
    series.attachPrimitive(triangles);

    chart.timeScale().fitContent();
    chart.timeScale().applyOptions({ rightOffset: 14 });
    chartRef.current = chart;

    const handleResize = () => {
      if (containerRef.current) {
        chart.applyOptions({ width: containerRef.current.clientWidth });
      }
    };
    window.addEventListener("resize", handleResize);
    const ro =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(handleResize)
        : null;
    ro?.observe(el);

    return () => {
      window.removeEventListener("resize", handleResize);
      ro?.disconnect();
      chart.remove();
      chartRef.current = null;
    };
  }, [chartTheme, data, transactions]);

  if (data.length === 0) {
    return (
      <div className="flex h-[400px] items-center justify-center rounded-lg border border-[var(--color-card-border)] bg-[var(--color-card)] text-sm text-[var(--color-muted)]">
        無 K 線資料
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="h-[400px] w-full overflow-hidden rounded-lg"
    />
  );
}
