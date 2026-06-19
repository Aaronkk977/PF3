"use client";

import { useState, useCallback } from "react";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { instrumentHref } from "@/lib/instrument-nav";

type ScreenerResult = {
  symbol: string;
  name: string | null;
  exchange: string;
  close: number;
  changePercent: number | null;
  turnoverB: number | null;
  bias: number | null;
  inWatchlist: boolean;
};

const BIAS_PERIODS = [
  { value: 5,  label: "5日" },
  { value: 10, label: "10日" },
  { value: 20, label: "20日" },
  { value: 60, label: "60日" },
  { value: 25, label: "5週" },
  { value: 50, label: "10週" },
] as const;

const HIGH_DAYS_OPTIONS = [
  { value: 10,  label: "10日" },
  { value: 20,  label: "20日" },
  { value: 60,  label: "60日" },
  { value: 120, label: "120日" },
  { value: 240, label: "52週" },
] as const;

type Filters = {
  minTurnover: string;
  minChangePct: string;
  maxChangePct: string;
  is52wHigh: boolean; // kept for compat, unused
  exchange: "ALL" | "TWSE" | "TPEx";
  highDays: number;   // 0 = 不篩選
  biasPeriod: number; // 0 = 不篩選
  biasMin: string;
  biasMax: string;
};

const DEFAULT_FILTERS: Filters = {
  minTurnover: "",
  minChangePct: "",
  maxChangePct: "",
  is52wHigh: false,
  exchange: "ALL",
  highDays: 0,
  biasPeriod: 0,
  biasMin: "",
  biasMax: "",
};

function PillGroup<T extends number | string>({
  label,
  options,
  value,
  offValue,
  offLabel = "不篩選",
  onChange,
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  offValue: T;
  offLabel?: string;
  onChange: (v: T) => void;
}) {
  return (
    <div>
      <label className="mb-1 block text-[10px] text-[var(--color-muted)]">{label}</label>
      <div className="flex flex-wrap gap-1">
        <button
          type="button"
          onClick={() => onChange(offValue)}
          className={cn(
            "rounded-full border px-2.5 py-0.5 text-[11px] transition-colors",
            value === offValue
              ? "border-[var(--color-primary)] bg-[var(--color-primary)]/15 text-[var(--color-primary)]"
              : "border-[var(--color-card-border)] text-[var(--color-muted)] hover:text-[var(--color-foreground)]",
          )}
        >
          {offLabel}
        </button>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={cn(
              "rounded-full border px-2.5 py-0.5 text-[11px] transition-colors",
              value === o.value
                ? "border-[var(--color-primary)] bg-[var(--color-primary)]/15 text-[var(--color-primary)]"
                : "border-[var(--color-card-border)] text-[var(--color-muted)] hover:text-[var(--color-foreground)]",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ScreenerPanel({
  watchlistId,
  onAddToWatchlist,
}: {
  watchlistId?: string;
  onAddToWatchlist?: (symbol: string, name: string | null) => Promise<void>;
}) {
  const pathname = usePathname();
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [results, setResults] = useState<ScreenerResult[] | null>(null);
  const [dataDate, setDataDate] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<keyof ScreenerResult>("turnoverB");
  const [sortAsc, setSortAsc] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);

  const runScreener = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (filters.minTurnover) params.set("minTurnover", filters.minTurnover);
      if (filters.minChangePct) params.set("minChangePct", filters.minChangePct);
      if (filters.maxChangePct) params.set("maxChangePct", filters.maxChangePct);
      if (filters.exchange !== "ALL") params.set("exchange", filters.exchange);
      if (watchlistId) params.set("watchlistId", watchlistId);
      if (filters.highDays > 0) params.set("highDays", String(filters.highDays));
      if (filters.biasPeriod > 0) {
        params.set("biasPeriod", String(filters.biasPeriod));
        if (filters.biasMin) params.set("biasMin", filters.biasMin);
        if (filters.biasMax) params.set("biasMax", filters.biasMax);
      }

      const res = await fetch(`/api/screener?${params}`);
      if (!res.ok) throw new Error("篩選失敗");
      const json = (await res.json()) as { date: string | null; results: ScreenerResult[] };
      setDataDate(json.date);
      setResults(json.results);
    } catch (e) {
      setError(e instanceof Error ? e.message : "未知錯誤");
    } finally {
      setLoading(false);
    }
  }, [filters, watchlistId]);

  const handleSort = (key: keyof ScreenerResult) => {
    if (sortKey === key) setSortAsc((v) => !v);
    else { setSortKey(key); setSortAsc(key === "symbol" || key === "name"); }
  };

  const sorted = results
    ? [...results].sort((a, b) => {
        const av = a[sortKey] ?? (sortAsc ? Infinity : -Infinity);
        const bv = b[sortKey] ?? (sortAsc ? Infinity : -Infinity);
        if (typeof av === "string" && typeof bv === "string")
          return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
        return sortAsc ? (av as number) - (bv as number) : (bv as number) - (av as number);
      })
    : null;

  const set = <K extends keyof Filters>(k: K, v: Filters[K]) =>
    setFilters((f) => ({ ...f, [k]: v }));

  const showBiasCol = filters.biasPeriod > 0 && results !== null;

  const cols = [
    { key: "symbol" as keyof ScreenerResult, label: "代號" },
    { key: "name" as keyof ScreenerResult, label: "名稱" },
    { key: "close" as keyof ScreenerResult, label: "收盤" },
    { key: "changePercent" as keyof ScreenerResult, label: "漲跌%" },
    ...(showBiasCol ? [{ key: "bias" as keyof ScreenerResult, label: `乖離%(${BIAS_PERIODS.find(b => b.value === filters.biasPeriod)?.label ?? ""})` }] : []),
    { key: "turnoverB" as keyof ScreenerResult, label: "成交額(億)" },
  ];

  return (
    <div className="space-y-4">
      {/* ── 篩選條件 ── */}
      <div className="space-y-3 rounded-lg border border-[var(--color-card-border)]/60 bg-[var(--color-card)]/40 p-4">

        {/* 第一行：成交額 + 漲跌幅 */}
        <div className="flex flex-wrap gap-3">
          <div className="min-w-[110px] flex-1">
            <label className="mb-1 block text-[10px] text-[var(--color-muted)]">成交金額 ≥（億）</label>
            <Input
              type="number" min={0} placeholder="例：10"
              value={filters.minTurnover}
              onChange={(e) => set("minTurnover", e.target.value)}
              className="h-8 text-sm"
            />
          </div>
          <div className="min-w-[90px] flex-1">
            <label className="mb-1 block text-[10px] text-[var(--color-muted)]">漲幅 ≥（%）</label>
            <Input
              type="number" placeholder="例：3"
              value={filters.minChangePct}
              onChange={(e) => set("minChangePct", e.target.value)}
              className="h-8 text-sm"
            />
          </div>
          <div className="min-w-[90px] flex-1">
            <label className="mb-1 block text-[10px] text-[var(--color-muted)]">漲幅 ≤（%）</label>
            <Input
              type="number" placeholder="例：10"
              value={filters.maxChangePct}
              onChange={(e) => set("maxChangePct", e.target.value)}
              className="h-8 text-sm"
            />
          </div>
        </div>

        {/* 第二行：N日新高 */}
        <PillGroup
          label="N 日內新高"
          options={HIGH_DAYS_OPTIONS}
          value={filters.highDays}
          offValue={0}
          onChange={(v) => set("highDays", v)}
        />

        {/* 第三行：乖離率 */}
        <div className="flex flex-wrap items-end gap-3">
          <PillGroup
            label="乖離率 MA"
            options={BIAS_PERIODS}
            value={filters.biasPeriod}
            offValue={0}
            onChange={(v) => set("biasPeriod", v)}
          />
          <div className={cn("flex items-end gap-2 transition-opacity", filters.biasPeriod === 0 ? "pointer-events-none opacity-30" : "")}>
            <div>
              <label className="mb-1 block text-[10px] text-[var(--color-muted)]">乖離 ≥（%）</label>
              <Input
                type="number" placeholder="例：-10"
                value={filters.biasMin}
                onChange={(e) => set("biasMin", e.target.value)}
                className="h-8 w-24 text-sm"
                disabled={filters.biasPeriod === 0}
              />
            </div>
            <div>
              <label className="mb-1 block text-[10px] text-[var(--color-muted)]">乖離 ≤（%）</label>
              <Input
                type="number" placeholder="例：10"
                value={filters.biasMax}
                onChange={(e) => set("biasMax", e.target.value)}
                className="h-8 w-24 text-sm"
                disabled={filters.biasPeriod === 0}
              />
            </div>
          </div>
        </div>

        {/* 第四行：交易所 + 操作 */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-[var(--color-muted)]">交易所</span>
            {(["ALL", "TWSE", "TPEx"] as const).map((ex) => (
              <button
                key={ex}
                type="button"
                onClick={() => set("exchange", ex)}
                className={cn(
                  "rounded-full border px-2.5 py-0.5 text-[11px] transition-colors",
                  filters.exchange === ex
                    ? "border-[var(--color-primary)] bg-[var(--color-primary)]/15 text-[var(--color-primary)]"
                    : "border-[var(--color-card-border)] text-[var(--color-muted)] hover:text-[var(--color-foreground)]",
                )}
              >
                {ex === "ALL" ? "全部" : ex}
              </button>
            ))}
          </div>

          <div className="ml-auto flex gap-2">
            <Button
              type="button" size="sm" variant="ghost" className="h-7 text-xs"
              onClick={() => { setFilters(DEFAULT_FILTERS); setResults(null); }}
            >
              清除
            </Button>
            <Button
              type="button" size="sm" className="h-7 text-xs"
              onClick={runScreener} disabled={loading}
            >
              {loading ? "篩選中…" : "篩選"}
            </Button>
          </div>
        </div>
      </div>

      {/* ── 結果 ── */}
      {error && <p className="text-xs text-[var(--color-negative)]">{error}</p>}

      {results === null && !loading && (
        <p className="py-6 text-center text-sm text-[var(--color-muted)]">設定條件後點「篩選」</p>
      )}

      {sorted && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-[11px] text-[var(--color-muted)]">
            <span>找到 <span className="font-semibold text-[var(--color-foreground)]">{sorted.length}</span> 支</span>
            {dataDate && <span>· 資料日期 {dataDate}</span>}
          </div>

          <div className="overflow-x-auto rounded-lg border border-[var(--color-card-border)]/50">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-card-border)]/50 text-[10px] uppercase tracking-wide text-[var(--color-muted)]">
                  {cols.map(({ key, label }) => (
                    <th
                      key={key}
                      className={cn(
                        "cursor-pointer select-none px-3 py-2 text-left hover:text-[var(--color-foreground)]",
                        sortKey === key && "text-[var(--color-primary)]",
                      )}
                      onClick={() => handleSort(key)}
                    >
                      {label}
                      {sortKey === key && (sortAsc ? " ↑" : " ↓")}
                    </th>
                  ))}
                  {onAddToWatchlist && <th className="px-3 py-2" />}
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => {
                  const bare = r.symbol.replace(/\.(TW|TWO)$/, "");
                  const href = instrumentHref(bare, pathname ?? undefined);
                  return (
                    <tr
                      key={r.symbol}
                      className="border-b border-[var(--color-card-border)]/30 transition-colors hover:bg-[var(--color-primary)]/5 last:border-0"
                    >
                      {/* 代號：可點 */}
                      <td className="px-3 py-2">
                        <a
                          href={href}
                          className="font-mono text-xs font-medium hover:text-[var(--color-primary)] hover:underline"
                        >
                          {bare}
                        </a>
                        <span className="ml-1 text-[9px] text-[var(--color-muted)]">{r.exchange}</span>
                      </td>
                      {/* 名稱：可點 */}
                      <td className="max-w-[8rem] truncate px-3 py-2 text-xs text-[var(--color-muted)]">
                        <a href={href} className="hover:text-[var(--color-foreground)] hover:underline">
                          {r.name ?? "—"}
                        </a>
                      </td>
                      <td className="px-3 py-2 tabular-nums">{r.close.toFixed(2)}</td>
                      <td
                        className={cn(
                          "px-3 py-2 tabular-nums font-medium",
                          r.changePercent != null && r.changePercent > 0
                            ? "text-[var(--color-positive)]"
                            : r.changePercent != null && r.changePercent < 0
                            ? "text-[var(--color-negative)]"
                            : "text-[var(--color-muted)]",
                        )}
                      >
                        {r.changePercent != null
                          ? `${r.changePercent > 0 ? "+" : ""}${r.changePercent.toFixed(2)}%`
                          : "—"}
                      </td>
                      {showBiasCol && (
                        <td
                          className={cn(
                            "px-3 py-2 tabular-nums font-medium",
                            r.bias != null && r.bias > 0
                              ? "text-[var(--color-positive)]"
                              : r.bias != null && r.bias < 0
                              ? "text-[var(--color-negative)]"
                              : "text-[var(--color-muted)]",
                          )}
                        >
                          {r.bias != null
                            ? `${r.bias > 0 ? "+" : ""}${r.bias.toFixed(2)}%`
                            : "—"}
                        </td>
                      )}
                      <td className="px-3 py-2 tabular-nums text-[var(--color-muted)]">
                        {r.turnoverB != null ? r.turnoverB.toFixed(1) : "—"}
                      </td>
                      {onAddToWatchlist && (
                        <td className="px-3 py-2">
                          {r.inWatchlist ? (
                            <span className="text-[10px] text-[var(--color-muted)]">已在清單</span>
                          ) : (
                            <button
                              type="button"
                              disabled={adding === r.symbol}
                              onClick={async () => {
                                setAdding(r.symbol);
                                await onAddToWatchlist(bare, r.name);
                                setResults((prev) =>
                                  prev?.map((x) =>
                                    x.symbol === r.symbol ? { ...x, inWatchlist: true } : x,
                                  ) ?? prev,
                                );
                                setAdding(null);
                              }}
                              className="text-[11px] text-[var(--color-primary)] hover:underline disabled:opacity-50"
                            >
                              {adding === r.symbol ? "加入中…" : "+ 加入清單"}
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
