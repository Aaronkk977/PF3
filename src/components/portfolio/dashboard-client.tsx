"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PageSection } from "@/components/layout/page-sections";
import { DashboardClock } from "@/components/portfolio/dashboard-clock";
import { HoldingsDayChange } from "@/components/portfolio/holdings-day-change";
import { StatCard } from "@/components/portfolio/stat-card";
import { SymbolSearchInput } from "@/components/portfolio/symbol-search-input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { HoldingPosition, PortfolioSummary } from "@/lib/portfolio-engine";
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
import type { WatchlistEntry, WatchlistWithEntries } from "@/lib/watchlist";
import {
  PAGE_CACHE_KEYS,
  patchClientCache,
} from "@/lib/client-data-cache";
import {
  changePositive,
  changePositiveMoney,
  formatCurrency,
  formatPercent,
} from "@/lib/utils";

async function fetchWatchlists(): Promise<WatchlistWithEntries[]> {
  const res = await fetch("/api/watchlist");
  const json = (await res.json()) as { lists: WatchlistWithEntries[] };
  return json.lists ?? [];
}

type Instrument = { id: string; symbol: string; name: string | null };

export function DashboardClient({
  summary,
  holdings,
  watchlists: initialWatchlists,
  instruments,
  priorityInstruments,
}: {
  summary: PortfolioSummary;
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
  const [showNewList, setShowNewList] = useState(false);
  const [draggingListId, setDraggingListId] = useState<string | null>(null);
  const [listDropTargetId, setListDropTargetId] = useState<string | null>(null);
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

  const isBuiltinList =
    activeList != null && isBuiltinWatchlistName(activeList.name);

  useEffect(() => {
    setWatchlistPrefsReady(true);
  }, []);

  useEffect(() => {
    if (!watchlistPrefsReady || !activeListId) return;
    saveDashboardPrefs({ activeWatchlistId: activeListId });
  }, [activeListId, watchlistPrefsReady]);

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

  function handleListDrop(targetId: string) {
    if (!draggingListId || draggingListId === targetId) {
      setDraggingListId(null);
      setListDropTargetId(null);
      return;
    }
    const from = lists.findIndex((l) => l.id === draggingListId);
    const to = lists.findIndex((l) => l.id === targetId);
    setDraggingListId(null);
    setListDropTargetId(null);
    if (from < 0 || to < 0) return;
    const next = [...lists];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved!);
    setLists(next);
    persistWatchlistsToCache(next);
    void persistListOrder(next.map((l) => l.id));
  }

  async function addWatchlistItem(e: React.FormEvent) {
    e.preventDefault();
    if (!effectiveSymbol || !activeList) return;
    setLoading(true);
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
    }
  }

  async function createList(e: React.FormEvent) {
    e.preventDefault();
    if (!newListName.trim()) return;
    setLoading(true);
    try {
      const res = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "createList",
          name: newListName.trim(),
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

  async function addWatchlistSeparator() {
    if (!activeList) return;
    const label = prompt("輸入標題文字")?.trim();
    if (!label) return;
    setLoading(true);
    try {
      const res = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "addSeparator",
          listId: activeList.id,
          label,
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

  async function renameActiveList() {
    if (!activeList || isBuiltinList) return;
    const name = prompt("重新命名清單", activeList.name)?.trim();
    if (!name || name === activeList.name) return;
    setLoading(true);
    try {
      const res = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "renameList",
          listId: activeList.id,
          name,
        }),
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        alert(err.error ?? "重新命名失敗");
        return;
      }
      await refreshLists(activeList.id);
    } finally {
      setLoading(false);
    }
  }

  async function clearActiveList() {
    if (!activeList) return;
    if (!confirm(`確定清空「${activeList.name}」的所有標的？`)) return;
    setLoading(true);
    try {
      const res = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "clearList", listId: activeList.id }),
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        alert(err.error ?? "清空失敗");
        return;
      }
      await refreshLists(activeList.id);
    } finally {
      setLoading(false);
    }
  }

  async function deleteActiveList() {
    if (!activeList || isBuiltinList) return;
    if (!confirm(`確定刪除清單「${activeList.name}」？此操作無法復原。`)) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/watchlist?list=1&listId=${encodeURIComponent(activeList.id)}`,
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

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-mono text-2xl font-bold text-[var(--color-primary)] glow-text">
            Dashboard
          </h1>
          <p className="mt-1 text-sm text-[var(--color-muted)]">投資組合總覽</p>
        </div>
        <DashboardClock />
      </div>

      <PageSection id="dashboard-overview" title="總覽" navOrder={10}>
      <div className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(min(100%,10.5rem),1fr))]">
        <StatCard
          title="總資產"
          value={summary.totalMarketValue + summary.cash}
          isCurrency
          currency={summary.baseCurrency}
        />
        <StatCard
          title="證券市值"
          value={summary.totalMarketValue}
          isCurrency
          currency={summary.baseCurrency}
        />
        <StatCard
          title="現金"
          value={summary.cash}
          isCurrency
          currency={summary.baseCurrency}
        />
        <StatCard
          title="今日漲跌"
          value={summary.todayChange}
          isCurrency
          currency={summary.baseCurrency}
          positive={changePositiveMoney(summary.todayChange)}
          subtitle={formatPercent(summary.todayChangePct)}
          animated
        />
        <StatCard
          title="未實現損益"
          value={summary.totalUnrealizedPnl}
          isCurrency
          currency={summary.baseCurrency}
          positive={changePositiveMoney(summary.totalUnrealizedPnl)}
          subtitle={formatPercent(summary.totalUnrealizedPnlPct)}
        />
      </div>
      </PageSection>

      {(summary.accountSummaries ?? []).length > 0 && (
        <PageSection id="dashboard-accounts" title="各帳戶表現" className="mt-8" navOrder={20}>
          <div className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(min(100%,10.5rem),1fr))]">
            {(summary.accountSummaries ?? []).map((acc) => (
              <StatCard
                key={acc.accountId}
                title={acc.name}
                value={acc.totalAssets}
                isCurrency
                currency={summary.baseCurrency}
                subtitle={`今日 ${formatCurrency(acc.todayChange, summary.baseCurrency)} (${formatPercent(acc.todayChangePct)})`}
                positive={changePositive(acc.todayChangePct)}
              />
            ))}
          </div>
        </PageSection>
      )}

      <div className="mt-8 grid gap-6 xl:grid-cols-2">
      <PageSection id="dashboard-watchlist" title="追蹤清單" navOrder={30}>
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
                {watchlistTab === "list" && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setShowNewList((v) => !v)}
                  >
                    {showNewList ? "取消" : "新增清單"}
                  </Button>
                )}
              </div>
            </div>
            {watchlistTab === "list" && (
              <div className="flex flex-wrap gap-2">
                {lists.map((list) => (
                  <button
                    key={list.id}
                    type="button"
                    draggable
                    onClick={() => setActiveListId(list.id)}
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", list.id);
                      setDraggingListId(list.id);
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                      if (draggingListId && draggingListId !== list.id) {
                        setListDropTargetId(list.id);
                      }
                    }}
                    onDragLeave={() =>
                      setListDropTargetId((id) => (id === list.id ? null : id))
                    }
                    onDrop={(e) => {
                      e.preventDefault();
                      handleListDrop(list.id);
                    }}
                    onDragEnd={() => {
                      setDraggingListId(null);
                      setListDropTargetId(null);
                    }}
                    className={`cursor-grab rounded-full px-3 py-1 text-xs font-medium transition-colors active:cursor-grabbing ${
                      list.id === activeList?.id
                        ? "bg-[var(--color-primary)]/20 text-[var(--color-primary)] ring-1 ring-[var(--color-primary)]/40"
                        : "bg-[var(--color-card-border)]/30 text-[var(--color-muted)] hover:text-[var(--color-foreground)]"
                    } ${draggingListId === list.id ? "opacity-50" : ""} ${
                      listDropTargetId === list.id && draggingListId !== list.id
                        ? "ring-1 ring-[var(--color-primary)]/50"
                        : ""
                    }`}
                  >
                    {list.name}
                    <span className="ml-1 opacity-60">
                      ({list.items.filter((i) => i.kind === "SYMBOL").length})
                    </span>
                  </button>
                ))}
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
                {showNewList && (
                  <form
                    onSubmit={createList}
                    className="flex flex-nowrap items-stretch gap-2"
                  >
                    <Input
                      className="min-w-0 flex-1"
                      value={newListName}
                      onChange={(e) => setNewListName(e.target.value)}
                      placeholder="新清單名稱"
                    />
                    <Button
                      type="submit"
                      disabled={loading}
                      className="shrink-0 whitespace-nowrap px-5"
                    >
                      建立
                    </Button>
                  </form>
                )}

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
                        加入
                      </Button>
                    </form>

                    <div className="flex flex-wrap gap-2 border-t border-[var(--color-card-border)]/40 pt-3">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={loading}
                        onClick={() => void addWatchlistSeparator()}
                      >
                        新增標題
                      </Button>
                      {!isBuiltinList && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={loading}
                          onClick={() => void renameActiveList()}
                        >
                          重新命名
                        </Button>
                      )}
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={loading || activeList.items.length === 0}
                        onClick={() => void clearActiveList()}
                      >
                        清空標的
                      </Button>
                      {!isBuiltinList && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={loading}
                          className="text-[var(--color-negative)] hover:border-[var(--color-negative)]/50"
                          onClick={() => void deleteActiveList()}
                        >
                          刪除清單
                        </Button>
                      )}
                    </div>

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
                    />
                  </>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </PageSection>

      <PageSection id="dashboard-day-change" title="本日持倉表現" navOrder={40}>
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

    </div>
  );
}
