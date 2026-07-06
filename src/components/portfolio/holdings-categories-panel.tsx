"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Check, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Modal } from "@/components/ui/modal";
import {
  SymbolSearchInput,
  type SymbolSuggestion as SearchSymbolSuggestion,
} from "@/components/portfolio/symbol-search-input";
import { formatSymbolWithName } from "@/lib/instrument-nav";
import { normalizeSymbolInput } from "@/lib/instrument-symbol";
import { cn } from "@/lib/utils";
import type { HoldingPosition } from "@/lib/holding-types";
import type { WatchlistWithEntries } from "@/lib/watchlist";

export type CategoryRow = {
  id: string;
  name: string;
  instrumentCount: number;
};

type WatchlistOption = { id: string; name: string; symbolCount: number };

/** 圖示按鈕，滑鼠移上去才滑順展開文字標籤（用 grid-template-columns 動畫） */
function HoverExpandButton({
  icon,
  label,
  onClick,
  tone = "muted",
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  tone?: "muted" | "primary" | "danger";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className={cn(
        "group inline-flex items-center rounded-md p-1.5 transition-colors",
        tone === "danger" &&
          "text-[var(--color-muted)] hover:bg-[color-mix(in_srgb,var(--color-negative)_12%,transparent)] hover:text-[var(--color-negative)]",
        tone === "primary" &&
          "bg-[var(--color-primary)]/15 text-[var(--color-primary)] hover:bg-[var(--color-primary)]/25",
        tone === "muted" &&
          "text-[var(--color-muted)] hover:bg-[var(--color-card-border)]/40 hover:text-[var(--color-foreground)]",
      )}
    >
      <span className="shrink-0">{icon}</span>
      <span className="grid grid-cols-[0fr] transition-[grid-template-columns] duration-200 ease-out group-hover:grid-cols-[1fr]">
        <span className="overflow-hidden whitespace-nowrap text-xs font-medium">
          <span className="inline-block pl-0 transition-[padding] duration-200 ease-out group-hover:pl-1.5">
            {label}
          </span>
        </span>
      </span>
    </button>
  );
}

function NewCategoryModal({
  watchlists,
  onClose,
  onCreated,
}: {
  watchlists: WatchlistWithEntries[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [symbolQuery, setSymbolQuery] = useState("");
  const [suggestions, setSuggestions] = useState<SearchSymbolSuggestion[]>([]);
  const [pending, setPending] = useState<{ symbol: string; name: string }[]>(
    [],
  );
  const [watchlistId, setWatchlistId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function pickWatchlist(id: string) {
    setWatchlistId(id);
    const wl = watchlists.find((w) => w.id === id);
    if (!wl) return;
    if (!name.trim()) setName(wl.name);
    const symbolItems = wl.items.filter((i) => i.kind === "SYMBOL");
    setPending((prev) => {
      const existing = new Set(prev.map((p) => p.symbol.toUpperCase()));
      const additions = symbolItems
        .filter((i) => !existing.has(i.symbol.toUpperCase()))
        .map((i) => ({ symbol: i.symbol, name: i.name?.trim() || i.symbol }));
      return [...prev, ...additions];
    });
  }

  useEffect(() => {
    const raw = symbolQuery.split(" — ")[0]?.trim() ?? symbolQuery.trim();
    if (raw.length < 1) {
      setSuggestions([]);
      return;
    }
    const shouldFetch =
      raw.length >= 2 || /^\d{3,4}$/.test(raw) || /[一-鿿]/.test(raw);
    if (!shouldFetch) {
      setSuggestions([]);
      return;
    }
    const t = setTimeout(() => {
      void fetch(`/api/instruments/search?q=${encodeURIComponent(raw)}`)
        .then((r) => (r.ok ? r.json() : []))
        .then((j: SearchSymbolSuggestion[]) => {
          setSuggestions(
            Array.isArray(j)
              ? j
                  .filter((i) => i.symbol)
                  .slice(0, 8)
                  .map((i) => ({
                    symbol: i.symbol,
                    name: i.name?.trim() ? i.name : i.symbol,
                  }))
              : [],
          );
        })
        .catch(() => setSuggestions([]));
    }, 280);
    return () => clearTimeout(t);
  }, [symbolQuery]);

  function addPending(item: SearchSymbolSuggestion) {
    const symbol = normalizeSymbolInput(item.symbol);
    setPending((prev) =>
      prev.some((p) => p.symbol.toUpperCase() === symbol.toUpperCase())
        ? prev
        : [...prev, { symbol, name: item.name?.trim() || symbol }],
    );
    setSymbolQuery("");
    setSuggestions([]);
  }

  function removePending(symbol: string) {
    setPending((prev) => prev.filter((p) => p.symbol !== symbol));
  }

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? "建立失敗");
      }
      const created = (await res.json()) as { id: string };

      for (const p of pending) {
        const instrumentRes = await fetch("/api/instruments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ symbol: p.symbol, name: p.name }),
        });
        if (!instrumentRes.ok) continue;
        const instrument = (await instrumentRes.json()) as { id: string };
        await fetch(`/api/categories/${created.id}/instruments`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ instrumentId: instrument.id }),
        });
      }

      onCreated();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "建立失敗");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title="新增類別" onClose={onClose}>
      <div className="space-y-4">
        <Input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="類別名稱"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !suggestions.length) void submit();
          }}
        />
        {watchlists.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--color-card-border)]/50 bg-[var(--color-card-border)]/10 p-2.5">
            <p className="text-xs text-[var(--color-muted)]">
              或從追蹤清單快速帶入：
            </p>
            <Select
              value={watchlistId}
              onChange={(e) => pickWatchlist(e.target.value)}
              className="h-8 max-w-[10rem] py-1 text-xs"
            >
              <option value="">選擇追蹤清單</option>
              {watchlists.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}（{w.items.filter((i) => i.kind === "SYMBOL").length}）
                </option>
              ))}
            </Select>
          </div>
        )}
        <div>
          <p className="mb-1.5 text-xs text-[var(--color-muted)]">
            可直接加入子項目（選填）
          </p>
          <SymbolSearchInput
            value={symbolQuery}
            suggestions={suggestions}
            onQueryChange={setSymbolQuery}
            onSelect={addPending}
            placeholder="搜尋代碼加入此類別"
          />
        </div>
        {pending.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {pending.map((p) => (
              <li
                key={p.symbol}
                className="flex items-center gap-1.5 rounded-full border border-[var(--color-card-border)] px-2.5 py-1 text-xs"
              >
                <span className="font-mono text-[var(--color-primary)]">
                  {p.symbol}
                </span>
                <button
                  type="button"
                  onClick={() => removePending(p.symbol)}
                  aria-label={`移除 ${p.symbol}`}
                  className="text-[var(--color-muted)] hover:text-[var(--color-negative)]"
                >
                  <X className="h-3 w-3" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
        {error && <p className="text-xs text-[var(--color-negative)]">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            取消
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!name.trim() || submitting}
            onClick={() => void submit()}
          >
            {submitting ? "建立中…" : "建立"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function HoldingsCategoriesPanel({
  holdings,
  onCategoriesChange,
  onHoldingsRefresh,
}: {
  holdings: HoldingPosition[];
  onCategoriesChange: (categories: CategoryRow[]) => void;
  onHoldingsRefresh: () => void;
}) {
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewCategoryModal, setShowNewCategoryModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [addSymbolQuery, setAddSymbolQuery] = useState("");
  const [addResolvedSymbol, setAddResolvedSymbol] = useState<string | null>(
    null,
  );
  const [addResolvedName, setAddResolvedName] = useState<string | null>(null);
  const [addSuggestions, setAddSuggestions] = useState<SearchSymbolSuggestion[]>(
    [],
  );
  const [error, setError] = useState<string | null>(null);
  const [watchlists, setWatchlists] = useState<WatchlistWithEntries[]>([]);
  const [applyWatchlistId, setApplyWatchlistId] = useState("");
  const [applying, setApplying] = useState(false);

  const watchlistOptions: WatchlistOption[] = watchlists.map((w) => ({
    id: w.id,
    name: w.name,
    symbolCount: w.items.filter((i) => i.kind === "SYMBOL").length,
  }));

  const loadCategories = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/categories");
      if (res.ok) {
        const json = (await res.json()) as { categories: CategoryRow[] };
        setCategories(json.categories);
        onCategoriesChange(json.categories);
      }
    } finally {
      setLoading(false);
    }
  }, [onCategoriesChange]);

  const loadWatchlists = useCallback(async () => {
    const res = await fetch("/api/watchlist");
    if (!res.ok) return;
    const json = (await res.json()) as { lists: WatchlistWithEntries[] };
    setWatchlists(json.lists);
  }, []);

  useEffect(() => {
    void loadCategories();
    void loadWatchlists();
  }, [loadCategories, loadWatchlists]);

  useEffect(() => {
    const raw = addSymbolQuery.split(" — ")[0]?.trim() ?? addSymbolQuery.trim();
    if (raw.length < 1) {
      setAddSuggestions([]);
      return;
    }
    const shouldFetch =
      raw.length >= 2 || /^\d{3,4}$/.test(raw) || /[一-鿿]/.test(raw);
    if (!shouldFetch) {
      setAddSuggestions([]);
      return;
    }
    const t = setTimeout(() => {
      void fetch(`/api/instruments/search?q=${encodeURIComponent(raw)}`)
        .then((r) => (r.ok ? r.json() : []))
        .then((j: SearchSymbolSuggestion[]) => {
          setAddSuggestions(
            Array.isArray(j)
              ? j
                  .filter((i) => i.symbol)
                  .slice(0, 8)
                  .map((i) => ({
                    symbol: i.symbol,
                    name: i.name?.trim() ? i.name : i.symbol,
                  }))
              : [],
          );
        })
        .catch(() => setAddSuggestions([]));
    }, 280);
    return () => clearTimeout(t);
  }, [addSymbolQuery]);

  function startRename(cat: CategoryRow) {
    setEditingId(cat.id);
    setEditName(cat.name);
    setExpandedId(null);
  }

  function cancelRename() {
    setEditingId(null);
    setEditName("");
  }

  function toggleAddInstrument(categoryId: string) {
    setExpandedId((id) => (id === categoryId ? null : categoryId));
    setEditingId(null);
    setAddSymbolQuery("");
    setAddResolvedSymbol(null);
    setAddResolvedName(null);
    setAddSuggestions([]);
    setApplyWatchlistId("");
  }

  async function postApplyWatchlist(categoryId: string, watchlistId: string) {
    const res = await fetch(`/api/categories/${categoryId}/from-watchlist`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ watchlistId }),
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(j.error ?? "套用失敗");
    }
  }

  async function applyWatchlistToCategory(categoryId: string) {
    if (!applyWatchlistId) return;
    setError(null);
    setApplying(true);
    try {
      await postApplyWatchlist(categoryId, applyWatchlistId);
      setApplyWatchlistId("");
      await loadCategories();
      onHoldingsRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "套用失敗");
    } finally {
      setApplying(false);
    }
  }

  async function saveRename(id: string) {
    const name = editName.trim();
    if (!name) return;
    setError(null);
    const res = await fetch(`/api/categories/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setError(j.error ?? "更新失敗");
      return;
    }
    cancelRename();
    await loadCategories();
    onHoldingsRefresh();
  }

  async function removeCategory(id: string) {
    if (!confirm("確定刪除此類別？標的將不再屬於此類別。")) return;
    setError(null);
    const res = await fetch(`/api/categories/${id}`, { method: "DELETE" });
    if (!res.ok) {
      setError("刪除失敗");
      return;
    }
    if (expandedId === id) setExpandedId(null);
    await loadCategories();
    onHoldingsRefresh();
  }

  async function addInstrumentToCategory(
    categoryId: string,
    symbol: string,
    displayName?: string | null,
  ) {
    const normalized = normalizeSymbolInput(symbol);
    const holding = holdings.find(
      (h) => h.symbol.toUpperCase() === normalized.toUpperCase(),
    );
    let instrumentId = holding?.instrumentId;

    if (!instrumentId) {
      const createRes = await fetch("/api/instruments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: normalized,
          name: displayName?.trim() || undefined,
        }),
      });
      if (!createRes.ok) {
        const j = (await createRes.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(j.error ?? "找不到持倉或無法建立標的");
        return;
      }
      const created = (await createRes.json()) as { id: string };
      instrumentId = created.id;
    }

    const res = await fetch(`/api/categories/${categoryId}/instruments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instrumentId }),
    });
    if (!res.ok) {
      setError("加入失敗");
      return;
    }
    setAddSymbolQuery("");
    setAddResolvedSymbol(null);
    setAddResolvedName(null);
    setAddSuggestions([]);
    await loadCategories();
    onHoldingsRefresh();
  }

  function handleAddSymbolQuery(query: string) {
    setAddSymbolQuery(query);
    setAddResolvedSymbol(null);
    setAddResolvedName(null);
  }

  function handleAddSymbolSelect(
    categoryId: string,
    item: SearchSymbolSuggestion,
  ) {
    setAddSymbolQuery(formatSymbolWithName(item.symbol, item.name));
    setAddResolvedSymbol(item.symbol);
    setAddResolvedName(item.name);
    setAddSuggestions([]);
    void addInstrumentToCategory(categoryId, item.symbol, item.name);
  }

  const addSymbolInputRaw =
    addSymbolQuery.split(" — ")[0]?.trim() ?? addSymbolQuery.trim();
  const effectiveAddSymbol =
    addResolvedSymbol ??
    (addSymbolInputRaw ? normalizeSymbolInput(addSymbolInputRaw) : "");

  const instrumentsInCategory = (categoryName: string) =>
    holdings.filter((h) => h.tags.includes(categoryName));

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle>類別</CardTitle>
            <p className="mt-1 text-xs text-[var(--color-muted)]">
              管理投資類別並指派標的。持倉配置可選「彙總」中的類別（含帳戶）；未分類標的仍逐檔顯示。
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowNewCategoryModal(true)}
            aria-label="新增類別"
            title="新增類別"
            className="shrink-0 rounded-md p-1.5 text-[var(--color-muted)] transition-colors hover:bg-[var(--color-primary)]/15 hover:text-[var(--color-primary)]"
          >
            <Plus className="h-5 w-5" aria-hidden />
          </button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <p className="text-xs text-[var(--color-negative)]">{error}</p>
        )}
        {loading ? (
          <p className="text-sm text-[var(--color-muted)]">載入中…</p>
        ) : categories.length === 0 ? (
          <p className="text-sm text-[var(--color-muted)]">尚無類別，請先新增。</p>
        ) : (
          <ul className="space-y-2">
            {categories.map((cat) => (
              <li
                key={cat.id}
                className="rounded-lg border border-[var(--color-card-border)]/80 p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  {editingId === cat.id ? (
                    <div className="flex flex-1 flex-wrap items-center gap-2">
                      <Input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="max-w-[12rem]"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void saveRename(cat.id);
                          if (e.key === "Escape") cancelRename();
                        }}
                      />
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => void saveRename(cat.id)}
                      >
                        儲存
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={cancelRename}
                      >
                        取消
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="text-[var(--color-negative)]"
                        onClick={() => void removeCategory(cat.id)}
                      >
                        刪除
                      </Button>
                    </div>
                  ) : (
                    <>
                      <button
                        type="button"
                        title="點擊變更名稱"
                        className="text-left font-medium text-[var(--color-foreground)] underline-offset-2 hover:text-[var(--color-primary)] hover:underline"
                        onClick={() => startRename(cat)}
                      >
                        {cat.name}
                        <span className="ml-2 text-xs font-normal text-[var(--color-muted)] no-underline">
                          ({cat.instrumentCount} 檔)
                        </span>
                      </button>
                      <div className="flex items-center gap-0.5">
                        <HoverExpandButton
                          icon={
                            expandedId === cat.id ? (
                              <Check className="h-4 w-4" aria-hidden />
                            ) : (
                              <Plus className="h-4 w-4" aria-hidden />
                            )
                          }
                          label={expandedId === cat.id ? "完成" : "新增標的"}
                          tone={expandedId === cat.id ? "primary" : "muted"}
                          onClick={() => toggleAddInstrument(cat.id)}
                        />
                        <HoverExpandButton
                          icon={<X className="h-4 w-4" aria-hidden />}
                          label="刪除"
                          tone="danger"
                          onClick={() => void removeCategory(cat.id)}
                        />
                      </div>
                    </>
                  )}
                </div>
                {expandedId === cat.id && editingId !== cat.id && (
                  <div className="mt-3 space-y-3 border-t border-[var(--color-card-border)]/60 pt-3">
                    <div className="max-w-md">
                      <SymbolSearchInput
                        value={addSymbolQuery}
                        suggestions={addSuggestions}
                        onQueryChange={handleAddSymbolQuery}
                        onSelect={(s) => handleAddSymbolSelect(cat.id, s)}
                        placeholder="搜尋代碼加入此類別"
                      />
                      {effectiveAddSymbol && !addResolvedSymbol && (
                        <Button
                          type="button"
                          size="sm"
                          className="mt-2"
                          onClick={() =>
                            void addInstrumentToCategory(
                              cat.id,
                              effectiveAddSymbol,
                              addResolvedName,
                            )
                          }
                        >
                          加入 {effectiveAddSymbol}
                        </Button>
                      )}
                    </div>
                    {watchlistOptions.length > 0 && (
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-xs text-[var(--color-muted)]">
                          或套用整個追蹤清單：
                        </p>
                        <Select
                          value={applyWatchlistId}
                          onChange={(e) => setApplyWatchlistId(e.target.value)}
                          className="h-8 max-w-[10rem] py-1 text-xs"
                        >
                          <option value="">選擇追蹤清單</option>
                          {watchlistOptions.map((w) => (
                            <option key={w.id} value={w.id}>
                              {w.name}（{w.symbolCount}）
                            </option>
                          ))}
                        </Select>
                        <Button
                          type="button"
                          size="sm"
                          disabled={!applyWatchlistId || applying}
                          onClick={() => void applyWatchlistToCategory(cat.id)}
                        >
                          {applying ? "套用中…" : "套用"}
                        </Button>
                      </div>
                    )}
                    <ul className="flex flex-wrap gap-2 text-xs text-[var(--color-muted)]">
                      {instrumentsInCategory(cat.name).map((h) => (
                        <li
                          key={h.instrumentId}
                          className="rounded border border-[var(--color-card-border)]/60 px-2 py-0.5 font-mono"
                        >
                          {h.symbol}
                        </li>
                      ))}
                      {instrumentsInCategory(cat.name).length === 0 && (
                        <li>此類別尚無持倉標的</li>
                      )}
                    </ul>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      {showNewCategoryModal && (
        <NewCategoryModal
          watchlists={watchlists}
          onClose={() => setShowNewCategoryModal(false)}
          onCreated={() => {
            void loadCategories();
            onHoldingsRefresh();
          }}
        />
      )}
    </Card>
  );
}
