"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  SymbolSearchInput,
  type SymbolSuggestion as SearchSymbolSuggestion,
} from "@/components/portfolio/symbol-search-input";
import { instrumentHref } from "@/lib/instrument-nav";
import { normalizeSymbolInput } from "@/lib/instrument-symbol";
import {
  filterCategories,
  type CategoryInstrument,
} from "@/lib/category-filter";
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

const UNCATEGORIZED_ID = "__uncategorized";
const NEW_CATEGORY_ID = "__new";

/** 台股代號去掉 .TW / .TWO 後綴，其餘原樣顯示 */
function shortSymbol(symbol: string): string {
  return symbol.replace(/\.(TW|TWO)$/i, "");
}

/** 搜尋框輸入時向 /api/instruments/search 取建議（防抖 280ms） */
function useSymbolSuggestions(query: string): [
  SearchSymbolSuggestion[],
  (s: SearchSymbolSuggestion[]) => void,
] {
  const [suggestions, setSuggestions] = useState<SearchSymbolSuggestion[]>([]);

  useEffect(() => {
    const raw = query.split(" — ")[0]?.trim() ?? query.trim();
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
  }, [query]);

  return [suggestions, setSuggestions];
}

/** 量測 grid 目前有幾欄，用來把展開區插在被點卡片那一列的後面 */
function useGridColumnCount(enabled: boolean) {
  const ref = useRef<HTMLUListElement>(null);
  const [columns, setColumns] = useState(1);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!enabled || !el) return;
    const measure = () => {
      const count = getComputedStyle(el)
        .gridTemplateColumns.split(" ")
        .filter(Boolean).length;
      setColumns(Math.max(1, count));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [enabled]);

  return [ref, columns] as const;
}

/** 收合狀態的卡片：只顯示名稱與檔數，點了在原地展開 */
function Tile({
  label,
  count,
  open,
  dashed,
  icon,
  onClick,
}: {
  label: string;
  count?: number;
  open: boolean;
  dashed?: boolean;
  icon?: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      className={cn(
        "flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors",
        dashed && "border-dashed",
        open
          ? "border-[color-mix(in_srgb,var(--color-primary)_60%,transparent)] bg-[color-mix(in_srgb,var(--color-primary)_8%,transparent)]"
          : "border-[var(--color-card-border)] hover:border-[color-mix(in_srgb,var(--color-primary)_40%,transparent)] hover:bg-[color-mix(in_srgb,var(--color-foreground)_3%,transparent)]",
      )}
    >
      <span className="flex min-w-0 items-baseline gap-2">
        {icon}
        <span
          className={cn(
            "truncate font-medium",
            dashed && !open && "text-[var(--color-muted)]",
          )}
        >
          {label}
        </span>
        {count !== undefined && (
          <span className="tabular-nums text-xs text-[var(--color-muted)]">
            {count}
          </span>
        )}
      </span>
      {count !== undefined && (
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-[var(--color-muted)] transition-transform duration-300 ease-in-out",
            open && "rotate-180",
          )}
          aria-hidden
        />
      )}
    </button>
  );
}

/** 展開區外框（橫跨整列） */
function DetailShell({
  title,
  actions,
  children,
}: {
  title: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-[var(--color-card-border)] bg-[color-mix(in_srgb,var(--color-foreground)_3%,transparent)] p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-baseline gap-2">{title}</div>
        {actions && <div className="flex items-center gap-1">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

/** 展開區裡的一行標的：代號＋名稱，未持有的字變淡，滑過才出現移除鈕 */
function InstrumentRow({
  symbol,
  name,
  held,
  highlighted,
  from,
  onRemove,
}: {
  symbol: string;
  name: string | null;
  held: boolean;
  highlighted?: boolean;
  from: string;
  onRemove?: () => void;
}) {
  const cleanName = name?.trim();
  const showName =
    cleanName && cleanName.toUpperCase() !== symbol.toUpperCase();
  return (
    <li
      className={cn(
        "group flex items-center gap-2 border-b border-[var(--color-card-border)]/40 py-1.5 text-sm",
        highlighted &&
          "rounded bg-[color-mix(in_srgb,var(--color-primary)_12%,transparent)] px-1.5",
      )}
    >
      <Link
        href={instrumentHref(symbol, from)}
        title={`${symbol}${held ? "" : "（目前未持有）"}`}
        className={cn(
          "flex min-w-0 flex-1 items-baseline gap-2 hover:text-[var(--color-primary)]",
          held ? "text-[var(--color-foreground)]" : "text-[var(--color-muted)]",
        )}
      >
        <span className="min-w-[3.5rem] shrink-0 font-mono tabular-nums">
          {shortSymbol(symbol)}
        </span>
        {showName && <span className="truncate">{cleanName}</span>}
      </Link>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`從類別移除 ${symbol}`}
          title="從此類別移除"
          className="shrink-0 rounded p-0.5 text-[var(--color-muted)] opacity-0 transition-opacity hover:text-[var(--color-negative)] focus-visible:opacity-100 group-hover:opacity-100"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      )}
    </li>
  );
}

/**
 * 清單尾端的空白列：平常是「＋ 新增標的」，點了原地變成代號輸入框。
 * 選建議或按 Enter 加入，加入後保持開啟可以連續輸入；Esc 或清空後離開就收起。
 */
function AddInstrumentRow({
  onAdd,
}: {
  onAdd: (symbol: string, name?: string | null) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [suggestions, setSuggestions] = useSymbolSuggestions(query);

  async function add(symbol: string, name?: string | null) {
    setBusy(true);
    try {
      if (await onAdd(symbol, name)) {
        setQuery("");
        setSuggestions([]);
      }
    } finally {
      setBusy(false);
    }
  }

  function close() {
    setEditing(false);
    setQuery("");
    setSuggestions([]);
  }

  if (!editing) {
    return (
      <li>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="flex w-full items-center gap-2 border-b border-dashed border-[var(--color-card-border)]/60 py-1.5 text-left text-sm text-[var(--color-muted)] transition-colors hover:text-[var(--color-foreground)]"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden />
          新增標的
        </button>
      </li>
    );
  }

  return (
    <li className="py-1">
      <SymbolSearchInput
        value={query}
        suggestions={suggestions}
        onQueryChange={setQuery}
        onSelect={(item) => void add(item.symbol, item.name)}
        autoFocus
        inputClassName="h-7 px-2 text-sm"
        placeholder={busy ? "加入中…" : "代號或名稱，Enter 加入"}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            const raw = query.split(" — ")[0]?.trim() ?? "";
            if (raw && !busy) void add(normalizeSymbolInput(raw));
          } else if (e.key === "Escape") {
            e.preventDefault();
            close();
          }
        }}
        onBlur={() => {
          if (!query.trim() && !busy) close();
        }}
      />
    </li>
  );
}

const rowGridClass = "grid gap-x-6 sm:grid-cols-2 lg:grid-cols-3";

const dangerButtonClass =
  "border border-[color-mix(in_srgb,var(--color-negative)_40%,transparent)] bg-[color-mix(in_srgb,var(--color-negative)_15%,transparent)] text-[var(--color-negative)] hover:bg-[color-mix(in_srgb,var(--color-negative)_25%,transparent)]";

function CategoryDetail({
  category,
  holdings,
  heldInstrumentIds,
  highlightedIds,
  watchlistOptions,
  from,
  onChanged,
  onDeleted,
  onError,
}: {
  category: CategoryRow;
  holdings: HoldingPosition[];
  heldInstrumentIds: Set<string>;
  highlightedIds: Set<string>;
  watchlistOptions: WatchlistOption[];
  from: string;
  onChanged: () => Promise<void>;
  onDeleted: () => Promise<void>;
  onError: (message: string | null) => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [editName, setEditName] = useState(category.name);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [applyWatchlistId, setApplyWatchlistId] = useState("");
  const [applying, setApplying] = useState(false);

  async function saveRename() {
    const name = editName.trim();
    if (!name) return;
    onError(null);
    const res = await fetch(`/api/categories/${category.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      onError(j.error ?? "更新失敗");
      return;
    }
    setRenaming(false);
    await onChanged();
  }

  async function deleteCategory() {
    onError(null);
    setDeleting(true);
    try {
      const res = await fetch(`/api/categories/${category.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        onError("刪除失敗");
        return;
      }
      await onDeleted();
    } finally {
      setDeleting(false);
    }
  }

  async function removeInstrument(instrumentId: string) {
    onError(null);
    const res = await fetch(
      `/api/categories/${category.id}/instruments?instrumentId=${encodeURIComponent(instrumentId)}`,
      { method: "DELETE" },
    );
    if (!res.ok) {
      onError("移除失敗");
      return;
    }
    await onChanged();
  }

  async function addInstrument(
    symbol: string,
    displayName?: string | null,
  ): Promise<boolean> {
    onError(null);
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
        onError(j.error ?? "找不到持倉或無法建立標的");
        return false;
      }
      const created = (await createRes.json()) as { id: string };
      instrumentId = created.id;
    }

    const res = await fetch(`/api/categories/${category.id}/instruments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instrumentId }),
    });
    if (!res.ok) {
      onError("加入失敗");
      return false;
    }
    await onChanged();
    return true;
  }

  async function applyWatchlist() {
    if (!applyWatchlistId) return;
    onError(null);
    setApplying(true);
    try {
      const res = await fetch(`/api/categories/${category.id}/from-watchlist`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ watchlistId: applyWatchlistId }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        onError(j.error ?? "套用失敗");
        return;
      }
      setApplyWatchlistId("");
      await onChanged();
    } finally {
      setApplying(false);
    }
  }

  const title = renaming ? (
    <Input
      value={editName}
      onChange={(e) => setEditName(e.target.value)}
      className="h-8 w-48 px-2 text-sm"
      autoFocus
      aria-label="類別名稱"
      onKeyDown={(e) => {
        if (e.key === "Enter") void saveRename();
        if (e.key === "Escape") {
          setRenaming(false);
          setEditName(category.name);
        }
      }}
    />
  ) : (
    <>
      <h4 className="truncate text-sm font-semibold">{category.name}</h4>
      <span className="tabular-nums text-xs text-[var(--color-muted)]">
        {category.instrumentCount} 檔
      </span>
    </>
  );

  const actions = renaming ? (
    <>
      <Button type="button" size="sm" onClick={() => void saveRename()}>
        儲存
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={() => {
          setRenaming(false);
          setEditName(category.name);
        }}
      >
        取消
      </Button>
    </>
  ) : confirmingDelete ? (
    <>
      <span className="mr-1 text-xs text-[var(--color-muted)]">
        {category.instrumentCount > 0
          ? `${category.instrumentCount} 檔會解除此分類，交易紀錄不受影響`
          : "此類別沒有標的"}
      </span>
      <Button
        type="button"
        size="sm"
        className={dangerButtonClass}
        disabled={deleting}
        autoFocus
        onClick={() => void deleteCategory()}
      >
        {deleting ? "刪除中…" : "確定刪除"}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={() => setConfirmingDelete(false)}
      >
        取消
      </Button>
    </>
  ) : (
    <>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="text-[var(--color-muted)] hover:text-[var(--color-foreground)]"
        onClick={() => setRenaming(true)}
      >
        <Pencil className="mr-1 h-3.5 w-3.5" aria-hidden />
        改名
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="text-[var(--color-muted)] hover:text-[var(--color-negative)]"
        onClick={() => setConfirmingDelete(true)}
      >
        <Trash2 className="mr-1 h-3.5 w-3.5" aria-hidden />
        刪除類別
      </Button>
    </>
  );

  return (
    <DetailShell title={title} actions={actions}>
      <ul className={rowGridClass}>
        {category.instruments.map((inst) => (
          <InstrumentRow
            key={inst.id}
            symbol={inst.symbol}
            name={inst.name}
            held={heldInstrumentIds.has(inst.id)}
            highlighted={highlightedIds.has(inst.id)}
            from={from}
            onRemove={() => void removeInstrument(inst.id)}
          />
        ))}
        <AddInstrumentRow onAdd={addInstrument} />
      </ul>
      {watchlistOptions.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <p className="text-xs text-[var(--color-muted)]">或套用整個追蹤清單</p>
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
            onClick={() => void applyWatchlist()}
          >
            {applying ? "套用中…" : "套用"}
          </Button>
        </div>
      )}
    </DetailShell>
  );
}

function NewCategoryForm({
  watchlists,
  onCancel,
  onCreated,
}: {
  watchlists: WatchlistWithEntries[];
  onCancel: () => void;
  onCreated: (id: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [symbolQuery, setSymbolQuery] = useState("");
  const [suggestions, setSuggestions] = useSymbolSuggestions(symbolQuery);
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

      await onCreated(created.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "建立失敗");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <DetailShell
      title={<h4 className="text-sm font-semibold">新增類別</h4>}
      actions={
        <>
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
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
        </>
      }
    >
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <Input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="類別名稱"
          aria-label="新類別名稱"
          className="max-w-[14rem]"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !suggestions.length) void submit();
            if (e.key === "Escape") onCancel();
          }}
        />
        <div className="w-full max-w-sm">
          <SymbolSearchInput
            value={symbolQuery}
            suggestions={suggestions}
            onQueryChange={setSymbolQuery}
            onSelect={addPending}
            placeholder="搜尋代碼一併加入（選填）"
          />
        </div>
        {watchlists.length > 0 && (
          <div className="flex items-center gap-2 pt-1">
            <p className="text-xs text-[var(--color-muted)]">或從追蹤清單帶入</p>
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
      </div>
      {pending.length > 0 && (
        <ul className={cn(rowGridClass, "mt-3")}>
          {pending.map((p) => (
            <li
              key={p.symbol}
              className="group flex items-center gap-2 border-b border-[var(--color-card-border)]/40 py-1.5 text-sm"
            >
              <span className="min-w-[3.5rem] shrink-0 font-mono tabular-nums">
                {shortSymbol(p.symbol)}
              </span>
              <span className="min-w-0 flex-1 truncate text-[var(--color-muted)]">
                {p.name !== p.symbol ? p.name : ""}
              </span>
              <button
                type="button"
                onClick={() =>
                  setPending((prev) => prev.filter((x) => x.symbol !== p.symbol))
                }
                aria-label={`移除 ${p.symbol}`}
                className="shrink-0 rounded p-0.5 text-[var(--color-muted)] hover:text-[var(--color-negative)]"
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p className="mt-2 text-xs text-[var(--color-negative)]">{error}</p>
      )}
    </DetailShell>
  );
}

type TileItem =
  | { kind: "category"; id: string; category: CategoryRow; highlightedIds: Set<string> }
  | { kind: "uncategorized"; id: typeof UNCATEGORIZED_ID }
  | { kind: "new"; id: typeof NEW_CATEGORY_ID };

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
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filterQuery, setFilterQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [watchlists, setWatchlists] = useState<WatchlistWithEntries[]>([]);
  const [gridRef, columns] = useGridColumnCount(!loading);

  const watchlistOptions: WatchlistOption[] = watchlists.map((w) => ({
    id: w.id,
    name: w.name,
    symbolCount: w.items.filter((i) => i.kind === "SYMBOL").length,
  }));

  // 重新載入時不切回「載入中」，避免加入／移除標的時整個面板閃一下
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

  async function refreshAfterChange() {
    await loadCategories();
    onHoldingsRefresh();
  }

  const heldInstrumentIds = useMemo(
    () =>
      new Set(holdings.filter((h) => h.quantity > 0).map((h) => h.instrumentId)),
    [holdings],
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

  const searching = filterQuery.trim().length > 0;

  const tiles = useMemo<TileItem[]>(() => {
    const items: TileItem[] = filterCategories(categories, filterQuery).map(
      ({ category, matchedInstrumentIds }) => ({
        kind: "category",
        id: category.id,
        category,
        highlightedIds: matchedInstrumentIds,
      }),
    );
    if (!searching) {
      if (uncategorizedHoldings.length > 0) {
        items.push({ kind: "uncategorized", id: UNCATEGORIZED_ID });
      }
      items.push({ kind: "new", id: NEW_CATEGORY_ID });
    }
    return items;
  }, [categories, filterQuery, searching, uncategorizedHoldings.length]);

  /** 搜尋時自動展開第一個符合的類別（目前展開的若仍符合就保持） */
  function handleFilterChange(value: string) {
    setFilterQuery(value);
    if (!value.trim()) return;
    const matches = filterCategories(categories, value);
    if (matches.length === 0) return;
    if (!matches.some((m) => m.category.id === expandedId)) {
      setExpandedId(matches[0].category.id);
    }
  }

  function toggle(id: string) {
    setError(null);
    setExpandedId((current) => (current === id ? null : id));
  }

  // 展開區插在被點卡片那一列的最後一張後面
  const expandedIndex = tiles.findIndex((t) => t.id === expandedId);
  const detailAfterIndex =
    expandedIndex < 0
      ? -1
      : Math.min(
          Math.floor(expandedIndex / columns) * columns + columns - 1,
          tiles.length - 1,
        );
  const expandedTile = expandedIndex >= 0 ? tiles[expandedIndex] : null;

  function renderDetail(tile: TileItem) {
    if (tile.kind === "category") {
      return (
        <CategoryDetail
          key={tile.id}
          category={tile.category}
          holdings={holdings}
          heldInstrumentIds={heldInstrumentIds}
          highlightedIds={tile.highlightedIds}
          watchlistOptions={watchlistOptions}
          from={pathname}
          onChanged={refreshAfterChange}
          onDeleted={async () => {
            setExpandedId(null);
            await refreshAfterChange();
          }}
          onError={setError}
        />
      );
    }
    if (tile.kind === "uncategorized") {
      return (
        <DetailShell
          title={
            <>
              <h4 className="text-sm font-semibold">未分類持倉</h4>
              <span className="tabular-nums text-xs text-[var(--color-muted)]">
                {uncategorizedHoldings.length} 檔
              </span>
            </>
          }
        >
          <ul className={rowGridClass}>
            {uncategorizedHoldings.map((h) => (
              <InstrumentRow
                key={h.instrumentId}
                symbol={h.symbol}
                name={h.name}
                held
                from={pathname}
              />
            ))}
          </ul>
        </DetailShell>
      );
    }
    return (
      <NewCategoryForm
        watchlists={watchlists}
        onCancel={() => setExpandedId(null)}
        onCreated={async (id) => {
          await refreshAfterChange();
          setExpandedId(id);
        }}
      />
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>類別</CardTitle>
            <p className="mt-1 text-xs text-[var(--color-muted)]">
              點類別展開明細；灰字為目前未持有。持倉配置的「彙總」可依類別分組。
            </p>
          </div>
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-muted)]"
              aria-hidden
            />
            <Input
              value={filterQuery}
              onChange={(e) => handleFilterChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setFilterQuery("");
              }}
              placeholder="搜尋類別或標的"
              aria-label="搜尋類別或標的"
              className="h-8 w-48 pl-8 text-xs"
            />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && (
          <p className="text-xs text-[var(--color-negative)]">{error}</p>
        )}
        {loading ? (
          <p className="text-sm text-[var(--color-muted)]">載入中…</p>
        ) : (
          <>
            {tiles.length === 0 && (
              <p className="text-sm text-[var(--color-muted)]">
                沒有符合「{filterQuery.trim()}」的類別或標的。
              </p>
            )}
            {/* 沒有結果時也保留 grid，欄數量測才不會失效 */}
            <ul
              ref={gridRef}
              className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
            >
              {tiles.map((tile, index) => (
                <Fragment key={tile.id}>
                  <li>
                    {tile.kind === "category" ? (
                      <Tile
                        label={tile.category.name}
                        count={tile.category.instrumentCount}
                        open={expandedId === tile.id}
                        onClick={() => toggle(tile.id)}
                      />
                    ) : tile.kind === "uncategorized" ? (
                      <Tile
                        label="未分類持倉"
                        count={uncategorizedHoldings.length}
                        open={expandedId === tile.id}
                        dashed
                        onClick={() => toggle(tile.id)}
                      />
                    ) : (
                      <Tile
                        label="新增類別"
                        open={expandedId === tile.id}
                        dashed
                        icon={
                          <Plus
                            className="h-3.5 w-3.5 self-center text-[var(--color-muted)]"
                            aria-hidden
                          />
                        }
                        onClick={() => toggle(tile.id)}
                      />
                    )}
                  </li>
                  {index === detailAfterIndex && expandedTile && (
                    <li className="col-span-full">{renderDetail(expandedTile)}</li>
                  )}
                </Fragment>
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}
