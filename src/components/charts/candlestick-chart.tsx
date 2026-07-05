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
  HistogramSeries,
  LineSeries,
  LineStyle,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type Time,
} from "lightweight-charts";

export type OhlcData = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
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
    for (let k = i - period + 1; k <= i; k++) sum += data[k]!.close;
    out.push({ time: data[i]!.date as Time, value: sum / period });
  }
  return out;
}

function mergeOhlc(a: OhlcData[], b: OhlcData[]): OhlcData[] {
  const map = new Map<string, OhlcData>();
  for (const d of [...a, ...b]) map.set(d.date, d);
  return [...map.values()].sort((x, y) => x.date.localeCompare(y.date));
}

export function CandlestickChart({
  data,
  transactions = [],
  symbol,
}: {
  data: OhlcData[];
  transactions?: TransactionMarker[];
  /** Symbol used to fetch older data on scroll-left. */
  symbol?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const chartTheme = useChartTheme();

  // Accumulated data (grows backwards as user scrolls left)
  const allDataRef = useRef<OhlcData[]>([]);
  // Series refs so we can update them from the fetch callback
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const ma10Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const ma20Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const ma60Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const ma250Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const volumeRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const loadingRef = useRef(false);
  // How far back we've already fetched (in years from today)
  const fetchedYearsRef = useRef(1);

  // Update all series with the current allDataRef content
  function refreshSeries() {
    const sorted = allDataRef.current;
    candleRef.current?.setData(
      sorted.map((d) => ({
        time: d.date as Time,
        open: d.open,
        high: d.high,
        low: d.low,
        close: d.close,
      })),
    );
    ma10Ref.current?.setData(closingMA(sorted, 10));
    ma20Ref.current?.setData(closingMA(sorted, 20));
    ma60Ref.current?.setData(closingMA(sorted, 60));
    ma250Ref.current?.setData(closingMA(sorted, 250));
    volumeRef.current?.setData(
      sorted.map((d) => ({
        time: d.date as Time,
        value: d.volume ?? 0,
        color:
          d.close >= d.open
            ? withAlpha(chartTheme.positive, 0.5)
            : withAlpha(chartTheme.negative, 0.5),
      })),
    );
  }

  async function fetchOlderData() {
    if (!symbol || loadingRef.current) return;
    loadingRef.current = true;
    try {
      const nextYears = fetchedYearsRef.current + 1;
      const end = new Date();
      const endDate = new Date(
        end.getFullYear() - fetchedYearsRef.current,
        end.getMonth(),
        end.getDate(),
      );
      const startDate = new Date(
        end.getFullYear() - nextYears,
        end.getMonth(),
        end.getDate(),
      );
      const endStr = endDate.toISOString().slice(0, 10);
      const startStr = startDate.toISOString().slice(0, 10);

      const res = await fetch(
        `/api/charts/${encodeURIComponent(symbol)}?start=${startStr}&end=${endStr}`,
      );
      if (!res.ok) return;
      const older = (await res.json()) as OhlcData[];
      if (!Array.isArray(older) || older.length === 0) return;

      allDataRef.current = mergeOhlc(older, allDataRef.current);
      fetchedYearsRef.current = nextYears;
      refreshSeries();
    } catch {
      // swallow — user can scroll further to retry
    } finally {
      loadingRef.current = false;
    }
  }

  useEffect(() => {
    const el = containerRef.current;
    if (!el || data.length === 0) return;

    // Initialise accumulated data from the prop
    const sorted = [...data].sort((a, b) => a.date.localeCompare(b.date));
    allDataRef.current = sorted;
    fetchedYearsRef.current = 1;

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
    chartRef.current = chart;

    // ── Candlestick series（保留下方空間給成交量）─────────────────────
    const candle = chart.addSeries(CandlestickSeries, {
      upColor: chartTheme.positive,
      downColor: chartTheme.negative,
      borderUpColor: chartTheme.positive,
      borderDownColor: chartTheme.negative,
      wickUpColor: chartTheme.positive,
      wickDownColor: chartTheme.negative,
    });
    candle.priceScale().applyOptions({
      scaleMargins: { top: 0.05, bottom: 0.22 },
    });
    candleRef.current = candle;

    // ── Volume series（獨立價格軸，疊在下方 22% 區域）───────────────────
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
      lastValueVisible: false,
      priceLineVisible: false,
    });
    volumeSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.82, bottom: 0 },
    });
    volumeRef.current = volumeSeries;

    // ── MA series ─────────────────────────────────────────────────────
    const ma10s = chart.addSeries(LineSeries, {
      color: withAlpha(chartTheme.accent, 0.95),
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    ma10Ref.current = ma10s;

    const ma20s = chart.addSeries(LineSeries, {
      color: withAlpha(chartTheme.primary, 0.9),
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    ma20Ref.current = ma20s;

    const ma60s = chart.addSeries(LineSeries, {
      color: withAlpha(chartTheme.foreground, 0.45),
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    ma60Ref.current = ma60s;

    const ma250s = chart.addSeries(LineSeries, {
      color: withAlpha(chartTheme.muted, 0.95),
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    ma250Ref.current = ma250s;

    // Initial render
    refreshSeries();

    // Trade markers
    const triangles = new TradeTriangleMarkersPrimitive(
      tradeMarkersFromTransactions(transactions, sorted),
      { buy: chartTheme.positive, sell: chartTheme.negative },
    );
    candle.attachPrimitive(triangles);

    chart.timeScale().fitContent();
    chart.timeScale().applyOptions({ rightOffset: 14 });

    // ── Lazy-load older data when user scrolls to the left edge ────────
    if (symbol) {
      chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
        if (!range) return;
        // When the left edge is within 20 bars of the data start, fetch more
        if (range.from < 20 && !loadingRef.current) {
          void fetchOlderData();
        }
      });
    }

    // ── Resize handling ────────────────────────────────────────────────
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
      candleRef.current = null;
      ma10Ref.current = null;
      ma20Ref.current = null;
      ma60Ref.current = null;
      ma250Ref.current = null;
      volumeRef.current = null;
    };
    // Re-create chart only when theme or initial data/transactions change.
    // Scroll-triggered fetches mutate allDataRef directly via refreshSeries().
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
