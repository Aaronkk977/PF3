"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Check, Plus, Search, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Modal } from "@/components/ui/modal";
import {
  SymbolSearchInput,
  type SymbolSuggestion as SearchSymbolSuggestion,
} from "@/components/portfolio/symbol-search-input";
import { formatSymbolWithName, instrumentHref } from "@/lib/instrument-nav";
import {
  filterCategories,
  type CategoryInstrument,
} from "@/lib/category-filter";
import { normalizeSymbolInput } from "@/lib/instrument-symbol";
import { cn } from "@/lib/utils";
import type { HoldingPosition } from "@/lib/holding-types";
import type { WatchlistWithEntries } from "@/lib/watchlist";
import { pageRequestHeaders } from "@/lib/page-request-headers";
import { PAGE_CACHE_KEYS } from "@/lib/client-data-cache";

export type CategoryRow = {
  id: string;
  name: string;
  instrumentCount: number;
  instruments: CategoryInstrument[];
};

type WatchlistOption = { id: string; name: string; symbolCount: number };

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
      void fetch(`/api/instruments/search?q=${encodeURIComponent(raw)}`, {
        headers: pageRequestHeaders(PAGE_CACHE_KEYS.holdings),
      })
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

/** 類別裡的單一標的 chip：點代號進標的頁，滑過才明顯出現移除鈕 */
function InstrumentChip({
  instrument,
  held,
  highlighted,
  from,
  onRemove,
}: {
  instrument: CategoryInstrument;
  held: boolean;
  highlighted: boolean;
  from: string;
  onRemove: () => void;
}) {
  const name = instrument.name?.trim();
  return (
    <li
      className={cn(
        "group/chip inline-flex max-w-full items-center rounded-md border text-xs transition-colors",
        highlighted
          ? "border-[var(--color-primary)] bg-[var(--color-primary)]/15"
          : held
            ? "border-[var(--color-card-border)] bg-[var(--color-card-border)]/20"
            : "border-dashed border-[var(--color-card-border)]",
      )}
    >
      <Link
        href={instrumentHref(instrument.symbol, from)}
        title={held ? "目前持有" : "目前未持有"}
        className="flex min-w-0 items-center gap-1.5 py-0.5 pl-2 pr-1 hover:text-[var(--color-primary)]"
      >
        <span
          className={cn(
            "font-mono",
            held ? "text-[var(--color-foreground)]" : "text-[var(--color-muted)]",
          )}
        >
          {instrument.symbol}
        </span>
        {name && name.toUpperCase() !== instrument.symbol.toUpperCase() && (
          <span className="truncate text-[var(--color-muted)]">{name}</span>
        )}
      </Link>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`從類別移除 ${instrument.symbol}`}
        title="從此類別移除"
        className="mr-0.5 rounded p-0.5 text-[var(--color-muted)] opacity-40 transition-opacity hover:bg-[color-mix(in_srgb,var(--color-negative)_15%,transparent)] hover:text-[var(--color-negative)] focus-visible:opacity-100 group-hover/chip:opacity-100"
      >
        <X className="h-3 w-3" aria-hidden />
      </button>
    </li>
  );
}

function DeleteCategoryModal({
  category,
  onClose,
  onConfirm,
}: {
  category: CategoryRow;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [deleting, setDeleting] = useState(false);
  return (
    <Modal title={`刪除類別「${category.name}」？`} onClose={onClose}>
      <p className="text-sm text-[var(--color-muted)]">
        {category.instrumentCount > 0
          ? `底下 ${category.instrumentCount} 檔標的會解除此分類，標的本身與交易紀錄不受影響。`
          : "此類別沒有任何標的。"}
      </p>
      <div className="mt-5 flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          取消
        </Button>
        <Button
          type="button"
          size="sm"
          autoFocus
          disabled={deleting}
          className="border-[color-mix(in_srgb,var(--color-negative)_40%,transparent)] bg-[color-mix(in_srgb,var(--color-negative)_15%,transparent)] text-[var(--color-negative)] hover:bg-[color-mix(in_srgb,var(--color-negative)_25%,transparent)]"
          onClick={() => {
            setDeleting(true);
            void onConfirm().finally(() => setDeleting(false));
          }}
        >
          {deleting ? "刪除中…" : "刪除"}
        </Button>
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
  const pathname = usePathname();
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewCategoryModal, setShowNewCategoryModal] = useState(false);
  const [deletingCategory, setDeletingCategory] = useState<CategoryRow | null>(
    null,
  );
  const [filterQuery, setFilterQuery] = useState("");
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

  // 重新載入時不切回「載入中」，避免移除／加入標的時整個列表閃一下
  const loadCategories = useCallback(async () => {
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
    const res = await fetch("/api/watchlist", {
      headers: pageRequestHeaders(PAGE_CACHE_KEYS.holdings),
    });
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
      void fetch(`/api/instruments/search?q=${encodeURIComponent(raw)}`, {
        headers: pageRequestHeaders(PAGE_CACHE_KEYS.holdings),
      })
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

  const heldInstrumentIds = useMemo(
    () =>
      new Set(holdings.filter((h) => h.quantity > 0).map((h) => h.instrumentId)),
    [holdings],
  );

  const filtered = useMemo(
    () => filterCategories(categories, filterQuery),
    [categories, filterQuery],
  );

  /** 有持倉但沒有任何類別的標的 */
  const uncategorizedHoldings = useMemo(() => {
    const categorized = new Set(
      categories.flatMap((c) => c.instruments.map((i) => i.id)),
    );
    return holdings.filter(
      (h) => h.quantity > 0 && !categorized.has(h.instrumentId),
    );
  }, [categories, holdings]);

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
    setError(null);
    const res = await fetch(`/api/categories/${id}`, { method: "DELETE" });
    if (!res.ok) {
      setError("刪除失敗");
      return;
    }
    setDeletingCategory(null);
    if (expandedId === id) setExpandedId(null);
    await loadCategories();
    onHoldingsRefresh();
  }

  async function removeInstrumentFromCategory(
    categoryId: string,
    instrumentId: string,
  ) {
    setError(null);
    const res = await fetch(
      `/api/categories/${categoryId}/instruments?instrumentId=${encodeURIComponent(instrumentId)}`,
      { method: "DELETE" },
    );
    if (!res.ok) {
      setError("移除失敗");
      return;
    }
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

  const iconButtonClass =
    "rounded-md p-1.5 text-[var(--color-muted)] transition-colors hover:bg-[var(--color-card-border)]/40 hover:text-[var(--color-foreground)]";

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>類別</CardTitle>
            <p className="mt-1 text-xs text-[var(--color-muted)]">
              點名稱改名、點代號看標的；虛線框為目前未持有。持倉配置的「彙總」可依類別分組。
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-muted)]"
                aria-hidden
              />
              <Input
                value={filterQuery}
                onChange={(e) => setFilterQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setFilterQuery("");
                }}
                placeholder="搜尋類別或標的"
                aria-label="搜尋類別或標的"
                className="h-8 w-44 pl-8 text-xs"
              />
            </div>
            <Button
              type="button"
              size="sm"
              onClick={() => setShowNewCategoryModal(true)}
            >
              <Plus className="mr-1 h-3.5 w-3.5" aria-hidden />
              新增類別
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && (
          <p className="text-xs text-[var(--color-negative)]">{error}</p>
        )}
        {loading ? (
          <p className="text-sm text-[var(--color-muted)]">載入中…</p>
        ) : categories.length === 0 ? (
          <p className="text-sm text-[var(--color-muted)]">尚無類別，請先新增。</p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-[var(--color-muted)]">
            沒有符合「{filterQuery.trim()}」的類別或標的。
          </p>
        ) : (
          <ul className="divide-y divide-[var(--color-card-border)]/60 rounded-lg border border-[var(--color-card-border)]/80">
            {filtered.map(({ category: cat, matchedInstrumentIds }) => (
              <li key={cat.id} className="px-3 py-2">
                <div className="flex items-start gap-3">
                  <div className="w-28 shrink-0 pt-0.5 sm:w-40">
                    {editingId === cat.id ? (
                      <Input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="h-7 px-2 text-sm"
                        autoFocus
                        aria-label="類別名稱"
                        onBlur={cancelRename}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void saveRename(cat.id);
                          if (e.key === "Escape") cancelRename();
                        }}
                      />
                    ) : (
                      <button
                        type="button"
                        title="點擊變更名稱"
                        className="max-w-full truncate text-left text-sm font-medium text-[var(--color-foreground)] hover:text-[var(--color-primary)]"
                        onClick={() => startRename(cat)}
                      >
                        {cat.name}
                        <span className="ml-1.5 text-xs font-normal tabular-nums text-[var(--color-muted)]">
                          {cat.instrumentCount}
                        </span>
                      </button>
                    )}
                  </div>
                  <ul className="flex min-w-0 flex-1 flex-wrap gap-1.5">
                    {cat.instruments.map((inst) => (
                      <InstrumentChip
                        key={inst.id}
                        instrument={inst}
                        held={heldInstrumentIds.has(inst.id)}
                        highlighted={matchedInstrumentIds.has(inst.id)}
                        from={pathname}
                        onRemove={() =>
                          void removeInstrumentFromCategory(cat.id, inst.id)
                        }
                      />
                    ))}
                    {cat.instruments.length === 0 && (
                      <li className="py-0.5 text-xs text-[var(--color-muted)]">
                        尚無標的
                      </li>
                    )}
                  </ul>
                  <div className="flex shrink-0 items-center gap-0.5">
                    <button
                      type="button"
                      onClick={() => toggleAddInstrument(cat.id)}
                      aria-label={
                        expandedId === cat.id ? "完成" : `新增標的到 ${cat.name}`
                      }
                      title={expandedId === cat.id ? "完成" : "新增標的"}
                      className={cn(
                        iconButtonClass,
                        expandedId === cat.id &&
                          "bg-[var(--color-primary)]/15 text-[var(--color-primary)] hover:bg-[var(--color-primary)]/25 hover:text-[var(--color-primary)]",
                      )}
                    >
                      {expandedId === cat.id ? (
                        <Check className="h-4 w-4" aria-hidden />
                      ) : (
                        <Plus className="h-4 w-4" aria-hidden />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeletingCategory(cat)}
                      aria-label={`刪除類別 ${cat.name}`}
                      title="刪除類別"
                      className={cn(
                        iconButtonClass,
                        "hover:bg-[color-mix(in_srgb,var(--color-negative)_12%,transparent)] hover:text-[var(--color-negative)]",
                      )}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </button>
                  </div>
                </div>
                {expandedId === cat.id && (
                  <div className="mt-2 flex flex-wrap items-start gap-3 border-t border-[var(--color-card-border)]/60 pt-2 sm:pl-[10.75rem]">
                    <div className="w-full max-w-sm">
                      <SymbolSearchInput
                        value={addSymbolQuery}
                        suggestions={addSuggestions}
                        onQueryChange={handleAddSymbolQuery}
                        onSelect={(s) => handleAddSymbolSelect(cat.id, s)}
                        placeholder={`搜尋代碼加入「${cat.name}」`}
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
                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <p className="text-xs text-[var(--color-muted)]">
                          或套用追蹤清單：
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
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {!loading && !filterQuery.trim() && uncategorizedHoldings.length > 0 && (
          <div className="flex items-start gap-3 rounded-lg border border-dashed border-[var(--color-card-border)]/80 px-3 py-2">
            <p className="w-28 shrink-0 pt-0.5 text-sm text-[var(--color-muted)] sm:w-40">
              未分類持倉
              <span className="ml-1.5 text-xs tabular-nums">
                {uncategorizedHoldings.length}
              </span>
            </p>
            <ul className="flex min-w-0 flex-1 flex-wrap gap-1.5 text-xs">
              {uncategorizedHoldings.map((h) => (
                <li key={h.instrumentId}>
                  <Link
                    href={instrumentHref(h.symbol, pathname)}
                    className="flex items-center gap-1.5 rounded-md border border-[var(--color-card-border)] px-2 py-0.5 hover:text-[var(--color-primary)]"
                  >
                    <span className="font-mono">{h.symbol}</span>
                    {h.name && (
                      <span className="text-[var(--color-muted)]">{h.name}</span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
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
      {deletingCategory && (
        <DeleteCategoryModal
          category={deletingCategory}
          onClose={() => setDeletingCategory(null)}
          onConfirm={() => removeCategory(deletingCategory.id)}
        />
      )}
    </Card>
  );
}
