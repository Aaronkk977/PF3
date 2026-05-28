"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  SymbolSearchInput,
  type SymbolSuggestion as SearchSymbolSuggestion,
} from "@/components/portfolio/symbol-search-input";
import { formatSymbolWithName } from "@/lib/instrument-nav";
import { normalizeSymbolInput } from "@/lib/instrument-symbol";
import type { HoldingPosition } from "@/lib/holding-types";

export type CategoryRow = {
  id: string;
  name: string;
  instrumentCount: number;
};

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
  const [newName, setNewName] = useState("");
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

  useEffect(() => {
    void loadCategories();
  }, [loadCategories]);

  useEffect(() => {
    const raw = addSymbolQuery.split(" — ")[0]?.trim() ?? addSymbolQuery.trim();
    if (raw.length < 1) {
      setAddSuggestions([]);
      return;
    }
    const shouldFetch =
      raw.length >= 2 || /^\d{3,4}$/.test(raw) || /[\u4e00-\u9fff]/.test(raw);
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

  async function createCategory() {
    const name = newName.trim();
    if (!name) return;
    setError(null);
    const res = await fetch("/api/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setError(j.error ?? "建立失敗");
      return;
    }
    setNewName("");
    await loadCategories();
  }

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
        <CardTitle>類別</CardTitle>
        <p className="text-xs text-[var(--color-muted)]">
          管理投資類別並指派標的。持倉配置可選「彙總」中的類別（含帳戶）；未分類標的仍逐檔顯示。
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="新類別名稱"
            className="max-w-xs"
            onKeyDown={(e) => {
              if (e.key === "Enter") void createCategory();
            }}
          />
          <Button type="button" size="sm" onClick={() => void createCategory()}>
            新增類別
          </Button>
        </div>
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
                      <div className="flex gap-1">
                        <Button
                          type="button"
                          size="sm"
                          variant={expandedId === cat.id ? "default" : "ghost"}
                          onClick={() => toggleAddInstrument(cat.id)}
                        >
                          新增標的
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
    </Card>
  );
}
