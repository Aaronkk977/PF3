"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PageSection } from "@/components/layout/page-sections";
import { DashboardClock } from "@/components/portfolio/dashboard-clock";
import { HoldingsDayChange } from "@/components/portfolio/holdings-day-change";
import { SymbolSearchInput } from "@/components/portfolio/symbol-search-input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { HoldingPosition } from "@/lib/portfolio-engine";
import {
  mergeInstrumentSuggestions,
  type InstrumentSuggestion,
} from "@/lib/instrument-suggestions";
import {
  loadDashboardPrefs,
  saveDashboardPrefs,
} from "@/lib/ui-prefs";
import { formatSymbolWithName } from "@/lib/instrument-nav";
import { normalizeSymbolInput } from "@/lib/instrument-symbol";
import { isBuiltinWatchlistName } from "@/lib/watchlist-presets";
import { WatchlistItemsList } from "@/components/portfolio/watchlist-items-list";
import { ScreenerPanel } from "@/components/portfolio/screener-panel";
import {
  ContextMenu,
  useContextMenu,
  type ContextMenuItem,
} from "@/components/ui/context-menu";
import { Plus } from "lucide-react";
import type { WatchlistEntry, WatchlistWithEntries } from "@/lib/watchlist";
import {
  PAGE_CACHE_KEYS,
  patchClientCache,
} from "@/lib/client-data-cache";

async function fetchWatchlists(): Promise<WatchlistWithEntries[]> {
  const res = await fetch("/api/watchlist");
  const json = (await res.json()) as { lists: WatchlistWithEntries[] };
  return json.lists ?? [];
}

type Instrument = { id: string; symbol: string; name: string | null };

/** 新增清單橢圓輸入框的最小寬度（約等於「+」圓鈕 pill 的觀感起點） */
const NEW_LIST_MIN_WIDTH = 88;

export function MarketClient({
  holdings,
  watchlists: initialWatchlists,
  instruments,
  priorityInstruments,
}: {
  holdings: HoldingPosition[];
  watchlists: WatchlistWithEntries[];
  instruments: Instrument[];
  priorityInstruments: InstrumentSuggestion[];
}) {
  const router = useRouter();
  const [lists, setLists] = useState(initialWatchlists);

  useEffect(() => {
    setLists(initialWatchlists);
  }, [initialWatchlists]);

  const [activeListId, setActiveListId] = useState(() => {
    const prefs = loadDashboardPrefs();
    const saved = prefs.activeWatchlistId;
    if (saved && initialWatchlists.some((l) => l.id === saved)) return saved;
    return initialWatchlists[0]?.id ?? "";
  });
  const [watchlistPrefsReady, setWatchlistPrefsReady] = useState(false);
  const [watchlistTab, setWatchlistTab] = useState<"list" | "screener">("list");
  const [symbolQuery, setSymbolQuery] = useState("");
  const [resolvedSymbol, setResolvedSymbol] = useState<string | null>(null);
  const [resolvedName, setResolvedName] = useState<string | null>(null);
  const [symbolSuggestions, setSymbolSuggestions] = useState<
    { symbol: string; name: string }[]
  >(() =>
    mergeInstrumentSuggestions(priorityInstruments, instruments, [], ""),
  );
  const [newListName, setNewListName] = useState("");
  const [loading, setLoading] = useState(false);
  const [addingItem, setAddingItem] = useState(false);
  const [showNewList, setShowNewList] = useState(false);
  const [newListInputWidth, setNewListInputWidth] = useState(0);
  const newListMeasureRef = useRef<HTMLSpanElement>(null);
  const newListInputRef = useRef<HTMLInputElement>(null);
  const [draggingListId, setDraggingListId] = useState<string | null>(null);
  const [listMenuTargetId, setListMenuTargetId] = useState<string | null>(null);
  const [itemsMenuTarget, setItemsMenuTarget] = useState<WatchlistEntry | null>(
    null,
  );
  const listMenu = useContextMenu();
  const itemsAreaMenu = useContextMenu();
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const updateSuggestions = useCallback(
    async (query: string) => {
      const local = mergeInstrumentSuggestions(
        priorityInstruments,
        instruments,
        [],
        query,
      );
      setSymbolSuggestions(local);

      const q = query.trim();
      const shouldFetch =
        q.length >= 2 || /^\d{3,4}$/.test(q) || /[\u4e00-\u9fff]/.test(q);
      if (!shouldFetch) return;

      const res = await fetch(
        `/api/instruments/search?q=${encodeURIComponent(q)}`,
      );
      const remote: { symbol: string; name: string }[] = res.ok
        ? await res.json()
        : [];
      setSymbolSuggestions(
        mergeInstrumentSuggestions(
          priorityInstruments,
          instruments,
          remote,
          query,
        ),
      );
    },
    [instruments, priorityInstruments],
  );

  function handleSymbolQuery(query: string) {
    setSymbolQuery(query);
    setResolvedSymbol(null);
    setResolvedName(null);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => void updateSuggestions(query), 200);
  }

  function handleSymbolSelect(item: { symbol: string; name: string }) {
    setSymbolQuery(formatSymbolWithName(item.symbol, item.name));
    setResolvedSymbol(item.symbol);
    setResolvedName(item.name);
    setSymbolSuggestions([]);
  }

  const symbolInputRaw = symbolQuery.split(" — ")[0]?.trim() ?? "";
  const effectiveSymbol =
    resolvedSymbol ??
    (symbolInputRaw ? normalizeSymbolInput(symbolInputRaw) : "");

  const activeList = useMemo(
    () => lists.find((l) => l.id === activeListId) ?? lists[0],
    [lists, activeListId],
  );

  useEffect(() => {
    setWatchlistPrefsReady(true);
  }, []);

  useEffect(() => {
    if (!watchlistPrefsReady || !activeListId) return;
    saveDashboardPrefs({ activeWatchlistId: activeListId });
  }, [activeListId, watchlistPrefsReady]);

  // 新增清單的橢圓輸入框：依文字內容量測寬度，讓輸入框像跟著文字長度伸縮
  useEffect(() => {
    if (!showNewList) return;
    const measured = newListMeasureRef.current?.offsetWidth ?? 0;
    setNewListInputWidth(Math.max(NEW_LIST_MIN_WIDTH, measured + 28));
  }, [showNewList, newListName]);

  function persistWatchlistsToCache(next: WatchlistWithEntries[]) {
    patchClientCache(PAGE_CACHE_KEYS.dashboard, { watchlists: next });
  }

  async function refreshLists(selectId?: string) {
    const next = await fetchWatchlists();
    setLists(next);
    persistWatchlistsToCache(next);
    if (selectId) setActiveListId(selectId);
    else if (!next.some((l) => l.id === activeListId)) {
      setActiveListId(next[0]?.id ?? "");
    }
    router.refresh();
  }

  async function persistListOrder(listIds: string[]) {
    const res = await fetch("/api/watchlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reorderLists", listIds }),
    });
    if (!res.ok) {
      const err = (await res.json()) as { error?: string };
      alert(err.error ?? "排序儲存失敗");
    }
  }

  function handleListDragOver(targetId: string) {
    if (!draggingListId || draggingListId === targetId) return;
    const from = lists.findIndex((l) => l.id === draggingListId);
    const to = lists.findIndex((l) => l.id === targetId);
    if (from < 0 || to < 0 || from === to) return;
    const next = [...lists];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved!);
    setLists(next);
  }

  function handleListDragEnd() {
    setDraggingListId(null);
    persistWatchlistsToCache(lists);
    void persistListOrder(lists.map((l) => l.id));
  }

  async function addWatchlistItem(e: React.FormEvent) {
    e.preventDefault();
    if (!effectiveSymbol || !activeList) return;
    setLoading(true);
    setAddingItem(true);
    try {
      const res = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          listId: activeList.id,
          symbol: effectiveSymbol,
          name: resolvedName ?? undefined,
        }),
      });
      if (res.ok) {
        await refreshLists(activeList.id);
        setSymbolQuery("");
        setResolvedSymbol(null);
        setResolvedName(null);
        setSymbolSuggestions(
          mergeInstrumentSuggestions(priorityInstruments, instruments, [], ""),
        );
      } else {
        const err = (await res.json()) as { error?: string };
        alert(err.error ?? "加入失敗");
      }
    } finally {
      setLoading(false);
      setAddingItem(false);
    }
  }

  function startNewList() {
    setNewListName("");
    setShowNewList(true);
  }

  function cancelNewList() {
    setShowNewList(false);
    setNewListName("");
  }

  async function commitNewList() {
    const name = newListName.trim();
    if (!name) {
      cancelNewList();
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "createList",
          name,
        }),
      });
      if (res.ok) {
        const list = (await res.json()) as { id: string };
        setNewListName("");
        setShowNewList(false);
        await refreshLists(list.id);
      }
    } finally {
      setLoading(false);
    }
  }

  async function removeWatchlistItem(item: WatchlistEntry) {
    if (!activeList) return;
    if (item.kind === "SYMBOL") {
      await fetch(
        `/api/watchlist?listId=${encodeURIComponent(activeList.id)}&symbol=${encodeURIComponent(item.symbol)}`,
        { method: "DELETE" },
      );
    } else {
      await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "removeItem", itemId: item.id }),
      });
    }
    setLists((prev) => {
      const next = prev.map((l) =>
        l.id === activeList.id
          ? { ...l, items: l.items.filter((i) => i.id !== item.id) }
          : l,
      );
      persistWatchlistsToCache(next);
      return next;
    });
  }

  async function addWatchlistSeparator(afterItemId?: string | null) {
    if (!activeList) return;
    const label = prompt("輸入標題文字", "小標題");
    if (label == null) return;
    setLoading(true);
    try {
      const res = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "addSeparator",
          listId: activeList.id,
          label: label.trim(),
          afterItemId: afterItemId ?? undefined,
        }),
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        alert(err.error ?? "新增失敗");
        return;
      }
      await refreshLists(activeList.id);
    } finally {
      setLoading(false);
    }
  }

  async function renameWatchlistSeparator(itemId: string, label: string) {
    if (!activeList) return;
    const res = await fetch("/api/watchlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "updateSeparator", itemId, label }),
    });
    if (!res.ok) {
      const err = (await res.json()) as { error?: string };
      alert(err.error ?? "更新失敗");
      return;
    }
    setLists((prev) => {
      const next = prev.map((l) =>
        l.id === activeList.id
          ? {
              ...l,
              items: l.items.map((i) =>
                i.id === itemId && i.kind === "SEPARATOR" ? { ...i, label } : i,
              ),
            }
          : l,
      );
      persistWatchlistsToCache(next);
      return next;
    });
  }

  async function renameList(list: WatchlistWithEntries) {
    if (isBuiltinWatchlistName(list.name)) return;
    const name = prompt("重新命名清單", list.name)?.trim();
    if (!name || name === list.name) return;
    setLoading(true);
    try {
      const res = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "renameList",
          listId: list.id,
          name,
        }),
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        alert(err.error ?? "重新命名失敗");
        return;
      }
      await refreshLists(list.id);
    } finally {
      setLoading(false);
    }
  }

  async function clearList(list: WatchlistWithEntries) {
    if (!confirm(`確定清空「${list.name}」的所有標的？`)) return;
    setLoading(true);
    try {
      const res = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "clearList", listId: list.id }),
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        alert(err.error ?? "清空失敗");
        return;
      }
      await refreshLists(list.id);
    } finally {
      setLoading(false);
    }
  }

  async function deleteList(list: WatchlistWithEntries) {
    if (isBuiltinWatchlistName(list.name)) return;
    if (!confirm(`確定刪除清單「${list.name}」？此操作無法復原。`)) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/watchlist?list=1&listId=${encodeURIComponent(list.id)}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        alert(err.error ?? "刪除失敗");
        return;
      }
      await refreshLists();
    } finally {
      setLoading(false);
    }
  }

  const listMenuTarget = lists.find((l) => l.id === listMenuTargetId) ?? null;
  const listMenuIsBuiltin =
    listMenuTarget != null && isBuiltinWatchlistName(listMenuTarget.name);
  const listMenuItems: ContextMenuItem[] = listMenuTarget
    ? [
        ...(!listMenuIsBuiltin
          ? [
              {
                key: "rename",
                label: "重新命名",
                onSelect: () => void renameList(listMenuTarget),
                disabled: loading,
              },
            ]
          : []),
        {
          key: "clear",
          label: "清空標的",
          onSelect: () => void clearList(listMenuTarget),
          disabled:
            loading ||
            listMenuTarget.items.filter((i) => i.kind === "SYMBOL").length === 0,
        },
        ...(!listMenuIsBuiltin
          ? [
              {
                key: "delete",
                label: "刪除清單",
                onSelect: () => void deleteList(listMenuTarget),
                disabled: loading,
                danger: true,
              },
            ]
          : []),
      ]
    : [];

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-mono text-2xl font-bold text-[var(--color-primary)] glow-text">
            Market
          </h1>
          <p className="mt-1 text-sm text-[var(--color-muted)]">
            追蹤清單與市場觀察
          </p>
        </div>
        <DashboardClock />
      </div>

      <div className="mt-8 grid gap-6 xl:grid-cols-2">
      <PageSection id="market-watchlist" title="追蹤清單" navOrder={10}>
        <Card className="h-full">
          <CardHeader className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle>追蹤清單</CardTitle>
              <div className="flex items-center gap-2">
                {/* Tab 切換 */}
                {(["list", "screener"] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setWatchlistTab(tab)}
                    className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                      watchlistTab === tab
                        ? "bg-[var(--color-primary)]/15 text-[var(--color-primary)]"
                        : "text-[var(--color-muted)] hover:text-[var(--color-foreground)]"
                    }`}
                  >
                    {tab === "list" ? "清單" : "篩選"}
                  </button>
                ))}
              </div>
            </div>
            {watchlistTab === "list" && (
              <div className="flex flex-wrap items-center gap-2">
                {lists.map((list) => (
                  <button
                    key={list.id}
                    type="button"
                    draggable
                    onClick={() => setActiveListId(list.id)}
                    onContextMenu={(e) => {
                      setListMenuTargetId(list.id);
                      listMenu.open(e);
                    }}
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", list.id);
                      setDraggingListId(list.id);
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                      handleListDragOver(list.id);
                    }}
                    onDrop={(e) => e.preventDefault()}
                    onDragEnd={handleListDragEnd}
                    title="右鍵可管理清單"
                    className={`cursor-grab rounded-full px-3 py-1 text-xs font-medium transition-[opacity,background-color,color,box-shadow] duration-150 active:cursor-grabbing ${
                      list.id === activeList?.id
                        ? "bg-[var(--color-primary)]/20 text-[var(--color-primary)] ring-1 ring-[var(--color-primary)]/40"
                        : "bg-[var(--color-card-border)]/30 text-[var(--color-muted)] hover:text-[var(--color-foreground)]"
                    } ${draggingListId === list.id ? "opacity-50" : ""}`}
                  >
                    {list.name}
                    <span className="ml-1 opacity-60">
                      ({list.items.filter((i) => i.kind === "SYMBOL").length})
                    </span>
                  </button>
                ))}
                {showNewList ? (
                  <span className="relative inline-flex">
                    {/* 隱形量測用文字，決定輸入框該有多寬 */}
                    <span
                      ref={newListMeasureRef}
                      aria-hidden
                      className="pointer-events-none invisible absolute whitespace-pre px-3 py-1 text-xs font-medium"
                    >
                      {newListName || "新清單名稱"}
                    </span>
                    <input
                      ref={newListInputRef}
                      autoFocus
                      value={newListName}
                      onChange={(e) => setNewListName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void commitNewList();
                        } else if (e.key === "Escape") {
                          e.preventDefault();
                          cancelNewList();
                        }
                      }}
                      onBlur={() => void commitNewList()}
                      placeholder="新清單名稱"
                      style={{ width: newListInputWidth || NEW_LIST_MIN_WIDTH }}
                      className="rounded-full border-none bg-[var(--color-primary)]/20 px-3 py-1 text-xs font-medium text-[var(--color-primary)] outline-none ring-1 ring-[var(--color-primary)]/40 transition-[width] duration-150 ease-out placeholder:text-[var(--color-primary)]/50"
                    />
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={startNewList}
                    aria-label="新增清單"
                    title="新增清單"
                    className="flex h-[1.625rem] w-[1.625rem] items-center justify-center rounded-full bg-[var(--color-card-border)]/30 text-[var(--color-muted)] transition-colors hover:text-[var(--color-foreground)]"
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden />
                  </button>
                )}
              </div>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            {/* ── 篩選 tab ── */}
            {watchlistTab === "screener" && (
              <ScreenerPanel
                watchlistId={activeList?.id}
                onAddToWatchlist={async (symbol, name) => {
                  if (!activeList) return;
                  await fetch("/api/watchlist", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ listId: activeList.id, symbol, name }),
                  });
                  const updated = await fetchWatchlists();
                  setLists(updated);
                  persistWatchlistsToCache(updated);
                }}
              />
            )}

            {/* ── 清單 tab ── */}
            {watchlistTab === "list" && (
              <>
                {activeList && (
                  <>
                    <form
                      onSubmit={addWatchlistItem}
                      className="flex flex-nowrap items-stretch gap-2"
                    >
                      <div className="relative min-w-0 flex-1">
                        <SymbolSearchInput
                          value={symbolQuery}
                          suggestions={symbolSuggestions}
                          onQueryChange={handleSymbolQuery}
                          onSelect={handleSymbolSelect}
                          placeholder="台積電 / 2330 / AAPL / BTC-USD"
                        />
                      </div>
                      <Button
                        type="submit"
                        disabled={loading || !effectiveSymbol}
                        className="shrink-0 whitespace-nowrap px-5"
                      >
                        {addingItem ? "加入中…" : "加入"}
                      </Button>
                    </form>

                    <div
                      onContextMenu={(e) => {
                        setItemsMenuTarget(null);
                        itemsAreaMenu.open(e);
                      }}
                      title="右鍵可新增標題"
                    >
                      <WatchlistItemsList
                        listId={activeList.id}
                        items={activeList.items}
                        onItemsChange={(items) =>
                          setLists((prev) => {
                            const next = prev.map((l) =>
                              l.id === activeList.id ? { ...l, items } : l,
                            );
                            persistWatchlistsToCache(next);
                            return next;
                          })
                        }
                        onRemove={removeWatchlistItem}
                        onRenameSeparator={renameWatchlistSeparator}
                        onItemContextMenu={(item, e) => {
                          setItemsMenuTarget(item);
                          itemsAreaMenu.open(e);
                        }}
                      />
                    </div>
                  </>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </PageSection>

      <PageSection id="market-day-change" title="本日持倉表現" navOrder={20}>
        <Card className="h-full">
          <CardHeader>
            <CardTitle>本日持倉表現</CardTitle>
          </CardHeader>
          <CardContent>
            <HoldingsDayChange holdings={holdings} />
          </CardContent>
        </Card>
      </PageSection>
      </div>

      <ContextMenu
        position={listMenu.position}
        items={listMenuItems}
        onClose={listMenu.close}
      />
      <ContextMenu
        position={itemsAreaMenu.position}
        items={
          activeList
            ? itemsMenuTarget?.kind === "SEPARATOR"
              ? [
                  {
                    key: "delete-separator",
                    label: "刪除標題",
                    onSelect: () => void removeWatchlistItem(itemsMenuTarget),
                    disabled: loading,
                    danger: true,
                  },
                ]
              : [
                  {
                    key: "add-separator",
                    label: "新增標題",
                    onSelect: () =>
                      void addWatchlistSeparator(itemsMenuTarget?.id ?? null),
                    disabled: loading,
                  },
                ]
            : []
        }
        onClose={itemsAreaMenu.close}
      />
    </div>
  );
}
