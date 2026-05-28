"use client";

import {
  useCallback,
  useEffect,
  useState,
  type DragEvent,
  type ReactNode,
} from "react";
import { GripVertical } from "lucide-react";
import { DrawdownChart } from "@/components/charts/drawdown-chart";
import { PerformanceCalculationPanel } from "@/components/portfolio/performance-calculation-panel";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { DrawdownPoint } from "@/lib/metrics";
import type { PerformanceCalculation } from "@/lib/performance-calculation";
import {
  DEFAULT_METRIC_PANEL_ORDER,
  migrateMetricPanelOrder,
  loadPerformancePrefs,
  savePerformancePrefs,
  type MetricPanelId,
} from "@/lib/performance-cache-client";
import { formatPercent } from "@/lib/utils";

type MetricPanelsData = {
  keyIndicators: {
    periodReturn: number;
    absoluteReturn: number;
    xirr: number | null;
    startValue: number;
    endValue: number;
  };
  riskIndicators: {
    maxDrawdown: number;
    maxDrawdownPeakDate: string | null;
    maxDrawdownRecoveryDate: string | null;
    maxDrawdownDurationDays: number;
    sharpeRatio: number;
    volatility: number;
    semiDeviation: number;
  };
  tradingIndicators: {
    winRate: number;
    profitLossRatio: number;
    feeRate: number;
    taxRate: number;
    turnover: number;
    annualizedTurnover: number;
    avgHoldingDays: number;
    closedTrades: number;
  };
  drawdownSeries: DrawdownPoint[];
  calculation: PerformanceCalculation;
};

const PANEL_TITLES: Record<MetricPanelId, string> = {
  key: "關鍵指標",
  calculation: "結算明細",
  trading: "交易指標",
  risk: "風險指標",
};

function reorderPanels(
  order: MetricPanelId[],
  sourceId: MetricPanelId,
  targetId: MetricPanelId,
): MetricPanelId[] {
  if (sourceId === targetId) return order;
  const from = order.indexOf(sourceId);
  const to = order.indexOf(targetId);
  if (from < 0 || to < 0) return order;
  const next = [...order];
  next.splice(from, 1);
  next.splice(to, 0, sourceId);
  return next;
}

function MetricRow({
  label,
  value,
  subValue,
}: {
  label: string;
  value: string;
  subValue?: string | null;
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-[var(--color-card-border)]/40 py-2">
      <span className="shrink-0 text-sm text-[var(--color-muted)]">{label}</span>
      <div className="min-w-0 text-right">
        <span className="tabular-nums text-sm font-medium text-[var(--color-foreground)]">
          {value}
        </span>
        {subValue ? (
          <span className="mt-0.5 block text-xs tabular-nums text-[var(--color-muted)]">
            {subValue}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function formatMaxDrawdownPeriod(
  days: number,
  peak: string | null,
  recovery: string | null,
): { value: string; subValue: string | null } {
  if (!peak || days <= 0) return { value: "—", subValue: null };
  const range = recovery ? `${peak} → ${recovery}` : `${peak} → 尚未恢復`;
  return { value: `${days} 天`, subValue: `（${range}）` };
}

function DraggableMetricCard({
  panelId,
  dragging,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  children,
}: {
  panelId: MetricPanelId;
  dragging: boolean;
  onDragStart: (id: MetricPanelId) => void;
  onDragOver: (e: DragEvent) => void;
  onDrop: (id: MetricPanelId) => void;
  onDragEnd: () => void;
  children: ReactNode;
}) {
  return (
    <Card
      className={`transition-opacity ${dragging ? "opacity-50" : ""}`}
      onDragOver={onDragOver}
      onDrop={(e) => {
        e.preventDefault();
        onDrop(panelId);
      }}
    >
      <CardHeader
        className="flex flex-row items-center gap-2 space-y-0 pb-2"
        draggable
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", panelId);
          onDragStart(panelId);
        }}
        onDragEnd={onDragEnd}
      >
        <GripVertical
          className="h-4 w-4 shrink-0 cursor-grab text-[var(--color-muted)] active:cursor-grabbing"
          aria-hidden
        />
        <CardTitle className="flex-1">{PANEL_TITLES[panelId]}</CardTitle>
        <span className="text-[10px] uppercase tracking-wide text-[var(--color-muted)]/70">
          拖曳排序
        </span>
      </CardHeader>
      {children}
    </Card>
  );
}

export function PerformanceMetricPanels({ data }: { data: MetricPanelsData }) {
  const [order, setOrder] = useState<MetricPanelId[]>(DEFAULT_METRIC_PANEL_ORDER);
  const [draggingId, setDraggingId] = useState<MetricPanelId | null>(null);

  useEffect(() => {
    const prefs = loadPerformancePrefs();
    setOrder(migrateMetricPanelOrder(prefs?.metricPanelOrder));
  }, []);

  const persistOrder = useCallback((next: MetricPanelId[]) => {
    setOrder(next);
    const prefs = loadPerformancePrefs();
    savePerformancePrefs({
      start: prefs?.start ?? "",
      end: prefs?.end ?? "",
      ...prefs,
      metricPanelOrder: next,
    });
  }, []);

  const handleDrop = useCallback(
    (targetId: MetricPanelId) => {
      if (!draggingId) return;
      persistOrder(reorderPanels(order, draggingId, targetId));
      setDraggingId(null);
    },
    [draggingId, order, persistOrder],
  );

  const renderPanel = (panelId: MetricPanelId) => {
    const cardProps = {
      panelId,
      dragging: draggingId === panelId,
      onDragStart: setDraggingId,
      onDragOver: (e: DragEvent) => e.preventDefault(),
      onDrop: handleDrop,
      onDragEnd: () => setDraggingId(null),
    };

    if (panelId === "key") {
      return (
        <DraggableMetricCard key="key" {...cardProps}>
          <CardContent>
            <MetricRow
              label="期間報酬"
              value={formatPercent(data.keyIndicators.periodReturn)}
            />
            <MetricRow
              label="未實現報酬率"
              value={formatPercent(data.keyIndicators.absoluteReturn)}
            />
            <MetricRow
              label="XIRR"
              value={
                data.keyIndicators.xirr !== null
                  ? formatPercent(data.keyIndicators.xirr)
                  : "N/A"
              }
            />
            <MetricRow
              label="期初市值"
              value={data.keyIndicators.startValue.toLocaleString("zh-TW")}
            />
            <MetricRow
              label="期末市值"
              value={data.keyIndicators.endValue.toLocaleString("zh-TW")}
            />
          </CardContent>
        </DraggableMetricCard>
      );
    }

    if (panelId === "calculation") {
      return (
        <DraggableMetricCard key="calculation" {...cardProps}>
          <CardContent className="pt-0">
            <PerformanceCalculationPanel calculation={data.calculation} />
          </CardContent>
        </DraggableMetricCard>
      );
    }

    if (panelId === "trading") {
      return (
        <DraggableMetricCard key="trading" {...cardProps}>
          <CardContent>
            <MetricRow
              label="勝率"
              value={
                data.tradingIndicators.closedTrades > 0
                  ? formatPercent(data.tradingIndicators.winRate, {
                      showSign: false,
                    })
                  : "—"
              }
              subValue={
                data.tradingIndicators.closedTrades > 0
                  ? `已平倉 ${data.tradingIndicators.closedTrades} 筆`
                  : "尚無平倉（僅買入時不適用）"
              }
            />
            <MetricRow
              label="盈虧比"
              value={
                data.tradingIndicators.closedTrades > 0 &&
                data.tradingIndicators.profitLossRatio > 0
                  ? data.tradingIndicators.profitLossRatio.toFixed(2)
                  : "—"
              }
            />
            <MetricRow
              label="有效手續費率"
              value={formatPercent(data.tradingIndicators.feeRate, {
                showSign: false,
              })}
            />
            <MetricRow
              label="有效稅率"
              value={formatPercent(data.tradingIndicators.taxRate, {
                showSign: false,
              })}
            />
            <MetricRow
              label="週轉率（年化）"
              value={
                data.tradingIndicators.annualizedTurnover > 0
                  ? formatPercent(data.tradingIndicators.annualizedTurnover, {
                      showSign: false,
                    })
                  : "—"
              }
              subValue={
                data.tradingIndicators.turnover > 0 &&
                Math.abs(
                  data.tradingIndicators.annualizedTurnover -
                    data.tradingIndicators.turnover,
                ) > 0.005
                  ? `期間 ${formatPercent(data.tradingIndicators.turnover, {
                      showSign: false,
                    })}`
                  : null
              }
            />
            <MetricRow
              label="平均持有天數"
              value={`${data.tradingIndicators.avgHoldingDays.toFixed(0)} 天`}
            />
            <MetricRow
              label="已平倉筆數"
              value={String(data.tradingIndicators.closedTrades)}
            />
          </CardContent>
        </DraggableMetricCard>
      );
    }

    const maxDrawdownPeriod = formatMaxDrawdownPeriod(
      data.riskIndicators.maxDrawdownDurationDays ?? 0,
      data.riskIndicators.maxDrawdownPeakDate,
      data.riskIndicators.maxDrawdownRecoveryDate,
    );

    return (
      <DraggableMetricCard key="risk" {...cardProps}>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:gap-20">
            <div className="min-w-0 flex-1">
              <MetricRow
                label="最大回撤"
                value={formatPercent(-data.riskIndicators.maxDrawdown)}
              />
              <MetricRow
                label="最大回撤期間"
                value={maxDrawdownPeriod.value}
                subValue={maxDrawdownPeriod.subValue}
              />
              <MetricRow
                label="年化波動率"
                value={formatPercent(data.riskIndicators.volatility, {
                  showSign: false,
                })}
              />
            </div>
            <div className="min-w-0 flex-1">
              <MetricRow
                label="Sharpe Ratio（年化）"
                value={(data.riskIndicators.sharpeRatio ?? 0).toFixed(2)}
              />
              <MetricRow
                label="半標準差（年化）"
                value={formatPercent(data.riskIndicators.semiDeviation ?? 0, {
                  showSign: false,
                })}
              />
            </div>
          </div>
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--color-muted)]">
              回撤走勢
            </p>
            <DrawdownChart data={data.drawdownSeries ?? []} />
          </div>
        </CardContent>
      </DraggableMetricCard>
    );
  };

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {order.map((panelId) => renderPanel(panelId))}
    </div>
  );
}
