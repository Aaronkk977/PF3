"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { instrumentHref } from "@/lib/instrument-nav";
import type { HoldingPosition } from "@/lib/portfolio-engine";
import {
  loadDashboardPrefs,
  saveDashboardPrefs,
  type DayChangeSortKey,
} from "@/lib/ui-prefs";
import {
  getHoldingMarketBucket,
  isTaiwanLimitUp,
} from "@/lib/market-utils";
import {
  getScheduledMarketFilter,
  nextMarketFilter,
  type MarketFilter,
} from "@/lib/market-session";
import {
  changeToneClass,
  formatCurrency,
  formatPercent,
} from "@/lib/utils";

type SortDir = "asc" | "desc";

const MARKET_FILTER_LABEL: Record<MarketFilter, string> = {
  all: "全部",
  tw: "台股",
  us: "美股",
  crypto: "加密",
};

function lacksTodayChange(h: HoldingPosition): boolean {
  return h.dayChangePct === null;
}

function matchesMarketFilter(h: HoldingPosition, filter: MarketFilter): boolean {
  const bucket = getHoldingMarketBucket(h);
  if (filter === "all") return true;
  if (filter === "tw") return bucket === "tw";
  if (filter === "us") return bucket === "us";
  if (filter === "crypto") return bucket === "crypto";
  return false;
}

function compareHoldings(
  a: HoldingPosition,
  b: HoldingPosition,
  dir: number,
  compare: () => number,
): number {
  const aMiss = lacksTodayChange(a);
  const bMiss = lacksTodayChange(b);
  if (aMiss !== bMiss) return aMiss ? 1 : -1;
  if (aMiss) return 0;
  return compare();
}

function SortHeader({
  label,
  sortKey,
  activeKey,
  dir,
  onSort,
}: {
  label: string;
  sortKey: DayChangeSortKey;
  activeKey: DayChangeSortKey;
  dir: SortDir;
  onSort: (key: DayChangeSortKey) => void;
}) {
  const active = activeKey === sortKey;
  const arrow = !active ? "↕" : dir === "asc" ? "↑" : "↓";
  return (
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      className={`inline-flex items-center gap-1 text-[10px] uppercase tracking-wider transition-colors hover:text-[var(--color-primary)] ${
        active
          ? "text-[var(--color-primary)]"
          : "text-[var(--color-muted)]"
      }`}
    >
      <span>{label}</span>
      <span className={active ? "" : "opacity-50"} aria-hidden>
        {arrow}
      </span>
    </button>
  );
}

export function HoldingsDayChange({ holdings }: { holdings: HoldingPosition[] }) {
  const pathname = usePathname();
  const [sortKey, setSortKey] = useState<DayChangeSortKey>("dayChangePct");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [marketFilter, setMarketFilter] = useState<MarketFilter>(() =>
    getScheduledMarketFilter(),
  );
  const [filterManual, setFilterManual] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [prefsReady, setPrefsReady] = useState(false);

  useEffect(() => {
    const prefs = loadDashboardPrefs();
    setSortKey(prefs.dayChangeSortKey);
    setSortDir(prefs.dayChangeSortDir);
    if (prefs.dayChangeMarketFilter) {
      setMarketFilter(prefs.dayChangeMarketFilter);
      setFilterManual(true);
    } else {
      setMarketFilter(getScheduledMarketFilter());
      setFilterManual(false);
    }
    setPrefsReady(true);
  }, []);

  useEffect(() => {
    if (!prefsReady) return;
    saveDashboardPrefs({
      dayChangeSortKey: sortKey,
      dayChangeSortDir: sortDir,
      ...(filterManual
        ? { dayChangeMarketFilter: marketFilter }
        : { dayChangeMarketFilter: undefined }),
    });
  }, [sortKey, sortDir, marketFilter, filterManual, prefsReady]);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!prefsReady || filterManual) return;
    setMarketFilter(getScheduledMarketFilter(now));
  }, [now, filterManual, prefsReady]);

  function cycleSort(key: DayChangeSortKey) {
    if (sortKey !== key) {
      setSortKey(key);
      setSortDir("asc");
      return;
    }
    setSortDir((d) => (d === "asc" ? "desc" : "asc"));
  }

  function cycleMarketFilter() {
    setFilterManual(true);
    setMarketFilter((current) => nextMarketFilter(current));
  }

  const filtered = useMemo(
    () => holdings.filter((h) => matchesMarketFilter(h, marketFilter)),
    [holdings, marketFilter],
  );

  const sorted = useMemo(() => {
    const list = [...filtered];
    const dir = sortDir === "asc" ? 1 : -1;

    list.sort((a, b) => {
      switch (sortKey) {
        case "symbol":
          return compareHoldings(a, b, dir, () =>
            a.symbol.localeCompare(b.symbol) * dir,
          );
        case "marketPrice":
          return compareHoldings(a, b, dir, () =>
            (a.marketPrice - b.marketPrice) * dir,
          );
        case "marketValue":
          return compareHoldings(a, b, dir, () =>
            (a.marketValueBase - b.marketValueBase) * dir,
          );
        case "dayChangePct":
        default:
          return compareHoldings(a, b, dir, () =>
            (a.dayChangePct! - b.dayChangePct!) * dir,
          );
      }
    });
    return list;
  }, [filtered, sortKey, sortDir]);

  return (
    <div className="space-y-3">
      <div className="flex w-full flex-wrap items-center gap-y-2 border-b border-[var(--color-card-border)]/40 pb-2">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
            篩選
          </span>
          <span
            className="text-[10px] text-[var(--color-card-border)]"
            aria-hidden
          >
            |
          </span>
          <button
            type="button"
            onClick={cycleMarketFilter}
            className="text-[10px] uppercase tracking-wider text-[var(--color-primary)] transition-colors hover:opacity-80"
            title={
              filterManual
                ? "已手動選擇；點擊切換：台股 → 美股 → 加密 → 全部"
                : "依開市時間自動切換；點擊可改為手動：台股 → 美股 → 加密 → 全部"
            }
          >
            {MARKET_FILTER_LABEL[marketFilter]}
            {!filterManual && (
              <span className="ml-1 normal-case text-[var(--color-muted)]">
                （自動）
              </span>
            )}
          </button>
        </div>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
          <div className="flex items-center gap-x-2">
            <span className="text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
              排序
            </span>
            <span
              className="text-[10px] text-[var(--color-card-border)]"
              aria-hidden
            >
              |
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-x-3">
            <SortHeader
              label="Symbol"
            sortKey="symbol"
            activeKey={sortKey}
            dir={sortDir}
            onSort={cycleSort}
          />
          <SortHeader
            label="現價"
            sortKey="marketPrice"
            activeKey={sortKey}
            dir={sortDir}
            onSort={cycleSort}
          />
          <SortHeader
            label="現值"
            sortKey="marketValue"
            activeKey={sortKey}
            dir={sortDir}
            onSort={cycleSort}
          />
          <SortHeader
            label="漲跌 %"
            sortKey="dayChangePct"
            activeKey={sortKey}
            dir={sortDir}
            onSort={cycleSort}
          />
          </div>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {sorted.map((h) => {
          const limitUp = isTaiwanLimitUp(h.symbol, h.dayChangePct, {
            price: h.marketPrice,
            prevClose:
              h.previousClose ??
              (h.dayChangePct != null && h.marketPrice > 0
                ? h.marketPrice / (1 + h.dayChangePct)
                : null),
          });
          return (
            <div
              key={h.instrumentId}
              className={`flex flex-col gap-2 rounded-lg border border-[var(--color-card-border)]/50 bg-[var(--color-card-border)]/10 p-3 ${
                limitUp ? "tw-limit-up" : "overflow-hidden"
              }`}
            >
              <div className="min-w-0">
                <Link
                  href={instrumentHref(h.symbol, pathname)}
                  className="font-mono text-sm text-[var(--color-primary)] hover:underline"
                >
                  {h.symbol}
                </Link>
                {h.name && (
                  <p className="truncate text-xs text-[var(--color-muted)]">
                    {h.name}
                  </p>
                )}
              </div>
              <div className="flex items-end justify-between gap-3">
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
                    現價
                  </p>
                  <span className="tabular-nums text-sm font-medium">
                    {formatCurrency(h.marketPrice, h.currency ?? "TWD")}
                  </span>
                </div>
                <div className="text-right">
                  <p className="text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
                    漲跌 %
                  </p>
                  <span
                    className={`tabular-nums text-sm font-medium ${
                      changeToneClass(h.dayChangePct ?? 0)
                    }`}
                  >
                    {h.dayChangePct !== null ? formatPercent(h.dayChangePct) : "—"}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
        {sorted.length === 0 && (
          <p className="col-span-full py-4 text-sm text-[var(--color-muted)]">
            {holdings.length === 0
              ? "尚無持倉"
              : "此篩選條件下無持倉"}
          </p>
        )}
      </div>
    </div>
  );
}
