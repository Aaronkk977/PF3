"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SymbolSearchInput } from "@/components/portfolio/symbol-search-input";
import { BENCHMARK_COLORS } from "@/lib/chart-constants";
import type { BenchmarkRecord } from "@/lib/benchmarks";
import { cn, parseResponseJson } from "@/lib/utils";

function toggleInList<T>(list: T[], item: T): T[] {
  return list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
}

export function BenchmarkSelector({
  benchmarks,
  selectedSymbols,
  onSelectionChange,
  onBenchmarksChange,
}: {
  benchmarks: BenchmarkRecord[];
  selectedSymbols: string[];
  onSelectionChange: (symbols: string[]) => void;
  onBenchmarksChange: (benchmarks: BenchmarkRecord[]) => void;
}) {
  const [managing, setManaging] = useState(false);
  const [symbolQuery, setSymbolQuery] = useState("");
  const [draftLabel, setDraftLabel] = useState("");
  const [suggestions, setSuggestions] = useState<
    { symbol: string; name: string }[]
  >([]);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchSuggestions = useCallback((q: string) => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!q.trim()) {
      setSuggestions([]);
      return;
    }
    searchTimer.current = setTimeout(() => {
      void fetch(`/api/instruments/search?q=${encodeURIComponent(q)}`)
        .then((r) => parseResponseJson<{ symbol: string; name: string }[]>(r))
        .then((list) => setSuggestions(list ?? []))
        .catch(() => setSuggestions([]));
    }, 280);
  }, []);

  useEffect(() => {
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, []);

  const addBenchmark = async () => {
    setError(null);
    const symbol = symbolQuery.trim();
    if (!symbol) {
      setError("請輸入代碼");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/benchmarks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol,
          label: draftLabel.trim() || undefined,
        }),
      });
      const json = await parseResponseJson<BenchmarkRecord & { error?: string }>(
        res,
      );
      if (!res.ok) {
        setError(json?.error ?? "新增失敗");
        return;
      }
      if (!json) return;
      onBenchmarksChange(
        [...benchmarks, json].sort((a, b) =>
          a.symbol.localeCompare(b.symbol),
        ),
      );
      setSymbolQuery("");
      setDraftLabel("");
      setSuggestions([]);
    } finally {
      setSaving(false);
    }
  };

  const removeBenchmark = async (id: string) => {
    const target = benchmarks.find((b) => b.id === id);
    if (!target) return;
    setError(null);
    setDeletingId(id);
    try {
      const res = await fetch(`/api/benchmarks/${id}`, { method: "DELETE" });
      const json = await parseResponseJson<{ error?: string }>(res);
      if (!res.ok) {
        setError(json?.error ?? "刪除失敗");
        return;
      }
      onBenchmarksChange(benchmarks.filter((b) => b.id !== id));
      onSelectionChange(selectedSymbols.filter((s) => s !== target.symbol));
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] text-[var(--color-muted)]">
          勾選後顯示於累積報酬圖（虛線）
        </p>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 text-xs"
          onClick={() => {
            setManaging((v) => !v);
            setError(null);
          }}
        >
          {managing ? "完成" : "管理基準"}
        </Button>
      </div>

      {benchmarks.length === 0 ? (
        <p className="text-xs text-[var(--color-muted)]">
          尚無基準，請點「管理基準」新增（例：0050.TW、^GSPC）
        </p>
      ) : (
        <div className="flex flex-wrap gap-3">
          {benchmarks.map((b) => (
            <label
              key={b.id}
              className="flex cursor-pointer items-center gap-2 text-sm"
            >
              <input
                type="checkbox"
                checked={selectedSymbols.includes(b.symbol)}
                onChange={() =>
                  onSelectionChange(toggleInList(selectedSymbols, b.symbol))
                }
                className="rounded border-[var(--color-card-border)] accent-[var(--color-accent)]"
              />
              {b.label}
              <span className="font-mono text-xs text-[var(--color-muted)]">
                ({b.symbol})
              </span>
            </label>
          ))}
        </div>
      )}

      {managing && (
        <div className="space-y-4 rounded-lg border border-[var(--color-card-border)]/60 bg-[var(--color-card)]/30 p-4">
          <p className="text-xs text-[var(--color-muted)]">
            新增 Yahoo 行情代碼作為比較基準；刪除後需重新計算圖表。
          </p>

          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[10rem] flex-1">
              <label className="mb-1 block text-[10px] text-[var(--color-muted)]">
                代碼
              </label>
              <SymbolSearchInput
                value={symbolQuery}
                suggestions={suggestions}
                onQueryChange={(q) => {
                  setSymbolQuery(q);
                  fetchSuggestions(q);
                }}
                onSelect={(item) => {
                  setSymbolQuery(item.symbol);
                  if (!draftLabel.trim()) setDraftLabel(item.name);
                  setSuggestions([]);
                }}
                placeholder="0050、^GSPC、AAPL"
                required
              />
            </div>
            <div className="min-w-[8rem] flex-1">
              <label className="mb-1 block text-[10px] text-[var(--color-muted)]">
                顯示名稱（選填）
              </label>
              <Input
                value={draftLabel}
                onChange={(e) => setDraftLabel(e.target.value)}
                placeholder="例：台灣50"
                className="h-9 text-sm"
              />
            </div>
            <Button
              type="button"
              size="sm"
              disabled={saving}
              onClick={() => void addBenchmark()}
            >
              {saving ? "新增中…" : "新增"}
            </Button>
          </div>

          {error && (
            <p className="text-xs text-[var(--color-negative)]">{error}</p>
          )}

          {benchmarks.length > 0 && (
            <ul className="space-y-2 border-t border-[var(--color-card-border)]/40 pt-3">
              {benchmarks.map((b, index) => (
                <li
                  key={b.id}
                  className="flex items-center justify-between gap-2 rounded border border-[var(--color-card-border)]/40 px-3 py-2 text-sm"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      className="inline-block h-0 w-4 shrink-0 border-t-[2px] border-dashed"
                      style={{
                        borderColor:
                          BENCHMARK_COLORS[index % BENCHMARK_COLORS.length],
                      }}
                      aria-hidden
                    />
                    <span className="truncate">
                      {b.label}
                      <span className="ml-1 font-mono text-xs text-[var(--color-muted)]">
                        {b.symbol}
                      </span>
                    </span>
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className={cn(
                      "h-7 shrink-0 text-xs text-[var(--color-negative)]",
                      deletingId === b.id && "opacity-50",
                    )}
                    disabled={deletingId === b.id}
                    onClick={() => void removeBenchmark(b.id)}
                  >
                    {deletingId === b.id ? "刪除中…" : "刪除"}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
