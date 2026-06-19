"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PageSection } from "@/components/layout/page-sections";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  FilterCheckbox,
  FilterCheckboxGroup,
} from "@/components/ui/filter-checkbox";
import type { EditableTransaction } from "@/components/portfolio/transaction-row";
import { TransactionsTable } from "@/components/portfolio/transactions-table";
import {
  DEFAULT_TX_COLUMN_ORDER,
  normalizeTxColumnOrder,
  type TxColumnId,
} from "@/lib/transaction-table-columns";
import { SymbolSearchInput } from "@/components/portfolio/symbol-search-input";
import {
  mergeInstrumentSuggestions,
  resolveSuggestionDisplayName,
  type InstrumentSuggestion,
} from "@/lib/instrument-suggestions";
import { formatSymbolWithName } from "@/lib/instrument-nav";
import { normalizeSymbolInput } from "@/lib/instrument-symbol";
import {
  PAGE_CACHE_KEYS,
  readClientCache,
  writeClientCache,
} from "@/lib/client-data-cache";
import { toLocalDateKey, toTransactionDateKey } from "@/lib/date-keys";
import { computeTransactionSettlement } from "@/lib/transaction-settlement";
import {
  cn,
  formatCurrency,
  formatFeeTaxAmount,
  parseResponseJson,
} from "@/lib/utils";
import {
  formatTransactionType,
  transactionTypeClass,
  transactionTypeSelectClass,
} from "@/lib/transaction-type-display";
import {
  loadRecentInstruments,
  loadTransactionsPrefs,
  recordRecentInstrument,
  saveTransactionsPrefs,
  type RecentInstrument,
} from "@/lib/ui-prefs";

function offsetLocalDateKey(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return toLocalDateKey(d);
}

type Transaction = {
  id: string;
  date: string;
  type: string;
  accountId: string;
  accountName: string;
  symbol: string | null;
  instrumentName: string | null;
  quantity: number;
  price: number;
  fee: number;
  tax: number;
  note: string | null;
};

type Account = {
  id: string;
  name: string;
  currency: string;
  cash: number;
  feeTaxRoundHalfUp: boolean;
};
type Instrument = { id: string; symbol: string; name: string | null };

const CASH_TYPES = new Set(["DEPOSIT", "WITHDRAWAL"]);

const TX_FILTER_TYPES = [
  "BUY",
  "SELL",
  "DIVIDEND",
  "DEPOSIT",
  "WITHDRAWAL",
] as const;

const PAGE_SIZE_OPTIONS = [25, 50, 100, 200] as const;

function toggleInList<T>(list: T[], item: T): T[] {
  return list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
}

function matchesSymbolOrNameFilter(
  tx: Transaction,
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const symbol = tx.symbol?.toLowerCase() ?? "";
  const name = tx.instrumentName?.toLowerCase() ?? "";
  return symbol.includes(q) || name.includes(q);
}

function recentFromTransactions(txs: Transaction[]): RecentInstrument[] {
  const seen = new Set<string>();
  const out: RecentInstrument[] = [];
  for (const t of txs) {
    if (!t.symbol) continue;
    const key = t.symbol.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      symbol: t.symbol,
      name: t.instrumentName?.trim() || t.symbol,
    });
    if (out.length >= 8) break;
  }
  return out;
}

function mergeRecentLists(...arrays: RecentInstrument[][]): RecentInstrument[] {
  const seen = new Set<string>();
  const out: RecentInstrument[] = [];
  for (const list of arrays) {
    for (const item of list) {
      const key = item.symbol.toUpperCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item);
      if (out.length >= 8) break;
    }
    if (out.length >= 8) break;
  }
  return out;
}

function toRecentSuggestions(recent: RecentInstrument[]): InstrumentSuggestion[] {
  return recent.map((r, i) => ({
    symbol: r.symbol,
    name: r.name,
    priority: -20 + i,
  }));
}

function normalizeTransactionRow(t: Transaction): Transaction {
  return { ...t, date: toTransactionDateKey(t.date) };
}

function parseTransactionList(raw: unknown): Transaction[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((t) => normalizeTransactionRow(t as Transaction));
}

export function TransactionsClient({
  initialTransactions,
  initialAccounts,
  instruments: initialInstruments,
  priorityInstruments,
}: {
  initialTransactions: Transaction[];
  initialAccounts: Account[];
  instruments: Instrument[];
  priorityInstruments: InstrumentSuggestion[];
}) {
  const [instrumentCatalog, setInstrumentCatalog] =
    useState<Instrument[]>(initialInstruments);

  useEffect(() => {
    setInstrumentCatalog(initialInstruments);
  }, [initialInstruments]);

  const refreshInstrumentCatalog = useCallback(async (): Promise<Instrument[]> => {
    try {
      const res = await fetch("/api/instruments");
      if (!res.ok) return [];
      const list = (await res.json()) as {
        id: string;
        symbol: string;
        name: string | null;
      }[];
      if (!Array.isArray(list)) return [];
      const next = list.map((i) => ({
        id: i.id,
        symbol: i.symbol,
        name: i.name,
      }));
      setInstrumentCatalog(next);
      return next;
    } catch {
      return [];
    }
  }, []);

  useEffect(() => {
    void refreshInstrumentCatalog();
  }, [refreshInstrumentCatalog]);

  const [transactions, setTransactions] = useState(() =>
    initialTransactions.map(normalizeTransactionRow),
  );
  const [accounts, setAccounts] = useState(initialAccounts);
  const [loading, setLoading] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);
  const [symbolQuery, setSymbolQuery] = useState("");
  const [resolvedSymbol, setResolvedSymbol] = useState<string | null>(null);
  const [recentInstruments, setRecentInstruments] = useState<RecentInstrument[]>(
    () =>
      mergeRecentLists(
        loadRecentInstruments(),
        recentFromTransactions(initialTransactions),
      ),
  );
  const [symbolSuggestions, setSymbolSuggestions] = useState<
    { symbol: string; name: string }[]
  >(() =>
    mergeInstrumentSuggestions(
      priorityInstruments,
      instrumentCatalog,
      [],
      "",
      15,
      toRecentSuggestions(
        mergeRecentLists(
          loadRecentInstruments(),
          recentFromTransactions(initialTransactions),
        ),
      ),
    ),
  );
  const priceTouched = useRef(false);
  const feeTaxTouched = useRef(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [form, setForm] = useState({
    accountId: initialAccounts[0]?.id ?? "",
    type: "BUY",
    date: toLocalDateKey(new Date()),
    quantity: "",
    price: "",
    fee: "0",
    tax: "0",
    note: "",
  });
  const [prefsReady, setPrefsReady] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [filterTypes, setFilterTypes] = useState<string[]>([]);
  const [filterAccountIds, setFilterAccountIds] = useState<string[]>([]);
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");
  // When true, filterDate always tracks "today" and auto-refreshes at midnight
  const [todayMode, setTodayMode] = useState(false);
  const [filterSymbol, setFilterSymbol] = useState("");
  const [filtersExpanded, setFiltersExpanded] = useState(true);
  const [columnOrder, setColumnOrder] = useState<TxColumnId[]>(
    DEFAULT_TX_COLUMN_ORDER,
  );

  const todayKey = toLocalDateKey(new Date());
  const isTodayFilter =
    filterDateFrom === todayKey && filterDateTo === todayKey;
  const hasDateFilter = Boolean(filterDateFrom || filterDateTo);
  const hasSymbolFilter = Boolean(filterSymbol.trim());
  const activeFilterCount =
    filterTypes.length +
    filterAccountIds.length +
    (hasDateFilter ? 1 : 0) +
    (hasSymbolFilter ? 1 : 0);

  useEffect(() => {
    const prefs = loadTransactionsPrefs();
    if (prefs) {
      setForm((f) => ({
        ...f,
        accountId:
          initialAccounts.some((a) => a.id === prefs.accountId)
            ? prefs.accountId
            : f.accountId,
        type: prefs.type || f.type,
      }));
      if (prefs.listPageSize) setPageSize(prefs.listPageSize);
      if (prefs.listFilterTypes) setFilterTypes(prefs.listFilterTypes);
      if (prefs.listFilterAccountIds) {
        setFilterAccountIds(
          prefs.listFilterAccountIds.filter((id) =>
            initialAccounts.some((a) => a.id === id),
          ),
        );
      }
      if (typeof prefs.listFiltersExpanded === "boolean") {
        setFiltersExpanded(prefs.listFiltersExpanded);
      }
      if (prefs.listFilterTodayMode) {
        // "Today mode" — always snap to the current date, regardless of what
        // date was saved (handles waking up the next day).
        setTodayMode(true);
        setFilterDateFrom(toLocalDateKey(new Date()));
        setFilterDateTo(toLocalDateKey(new Date()));
      } else {
        if (prefs.listFilterDateFrom) setFilterDateFrom(prefs.listFilterDateFrom);
        if (prefs.listFilterDateTo) setFilterDateTo(prefs.listFilterDateTo);
      }
      if (prefs.listFilterSymbol) setFilterSymbol(prefs.listFilterSymbol);
      if (prefs.listColumnOrder) {
        setColumnOrder(normalizeTxColumnOrder(prefs.listColumnOrder));
      }
    }
    setPrefsReady(true);
  }, [initialAccounts]);

  useEffect(() => {
    if (!prefsReady) return;
    saveTransactionsPrefs({
      accountId: form.accountId,
      type: form.type,
      listPageSize: pageSize,
      listFilterTypes: filterTypes,
      listFilterAccountIds: filterAccountIds,
      listFilterDateFrom: filterDateFrom,
      listFilterDateTo: filterDateTo,
      listFilterTodayMode: todayMode,
      listFilterSymbol: filterSymbol,
      listFiltersExpanded: filtersExpanded,
      listColumnOrder: columnOrder,
    });
  }, [
    form.accountId,
    form.type,
    pageSize,
    filterTypes,
    filterAccountIds,
    filterDateFrom,
    filterDateTo,
    todayMode,
    filterSymbol,
    filtersExpanded,
    columnOrder,
    prefsReady,
  ]);

  const filteredTransactions = useMemo(() => {
    return transactions.filter((t) => {
      if (filterTypes.length > 0 && !filterTypes.includes(t.type)) {
        return false;
      }
      if (
        filterAccountIds.length > 0 &&
        !filterAccountIds.includes(t.accountId)
      ) {
        return false;
      }
      const dateKey = toTransactionDateKey(t.date);
      if (filterDateFrom && dateKey < filterDateFrom) return false;
      if (filterDateTo && dateKey > filterDateTo) return false;
      if (!matchesSymbolOrNameFilter(t, filterSymbol)) return false;
      return true;
    });
  }, [
    transactions,
    filterTypes,
    filterAccountIds,
    filterDateFrom,
    filterDateTo,
    filterSymbol,
  ]);

  const totalPages = Math.max(
    1,
    Math.ceil(filteredTransactions.length / pageSize),
  );
  const safePage = Math.min(page, totalPages);

  useEffect(() => {
    setPage(1);
  }, [
    filterTypes,
    filterAccountIds,
    filterDateFrom,
    filterDateTo,
    filterSymbol,
    pageSize,
  ]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const pageTransactions = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return filteredTransactions.slice(start, start + pageSize);
  }, [filteredTransactions, safePage, pageSize]);

  const pageStart =
    filteredTransactions.length === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const pageEnd = Math.min(safePage * pageSize, filteredTransactions.length);

  const filteredTradeTotals = useMemo(() => {
    const accountCurrency = new Map(
      accounts.map((a) => [a.id, a.currency] as const),
    );
    const byCurrency = new Map<string, { buy: number; sell: number }>();
    for (const tx of filteredTransactions) {
      const type = tx.type.toUpperCase();
      if (type !== "BUY" && type !== "SELL") continue;
      const ccy = accountCurrency.get(tx.accountId) ?? "TWD";
      const settlement = computeTransactionSettlement(
        tx.type,
        tx.quantity,
        tx.price,
        tx.fee,
        tx.tax,
      );
      if (!settlement) continue;
      const bucket = byCurrency.get(ccy) ?? { buy: 0, sell: 0 };
      const netAbs = Math.abs(settlement.net);
      if (type === "BUY") bucket.buy += netAbs;
      else bucket.sell += netAbs;
      byCurrency.set(ccy, bucket);
    }
    return [...byCurrency.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [filteredTransactions, accounts]);

  const reloadTransactions = useCallback(async () => {
    const [txRes, accRes] = await Promise.all([
      fetch("/api/transactions", { cache: "no-store" }),
      fetch("/api/accounts", { cache: "no-store" }),
    ]);

    let list: Transaction[] | null = null;
    if (txRes.ok) {
      list = parseTransactionList(await parseResponseJson(txRes));
      setTransactions(list);
    }

    let accList: Account[] | null = null;
    if (accRes.ok) {
      accList = await parseResponseJson<Account[]>(accRes);
      if (accList) setAccounts(accList);
    }

    const cached = readClientCache<{
      initialTransactions: Transaction[];
      initialAccounts: Account[];
      instruments?: unknown;
      priorityInstruments?: unknown;
    }>(PAGE_CACHE_KEYS.transactions);
    if (cached && list) {
      writeClientCache(PAGE_CACHE_KEYS.transactions, {
        ...cached,
        initialTransactions: list,
        ...(accList ? { initialAccounts: accList } : {}),
      });
    }
  }, []);

  const isCashFlow = CASH_TYPES.has(form.type);

  const selectedAccount = accounts.find((a) => a.id === form.accountId);
  const accountCurrency = selectedAccount?.currency ?? "TWD";

  const settlement = useMemo(() => {
    if (isCashFlow) {
      return computeTransactionSettlement(
        form.type,
        1,
        parseFloat(form.price) || 0,
        0,
        0,
      );
    }
    return computeTransactionSettlement(
      form.type,
      parseFloat(form.quantity) || 0,
      parseFloat(form.price) || 0,
      parseFloat(form.fee) || 0,
      parseFloat(form.tax) || 0,
    );
  }, [form, isCashFlow]);

  const updateSuggestions = useCallback(
    async (query: string) => {
      const recent = toRecentSuggestions(recentInstruments);
      const local = mergeInstrumentSuggestions(
        priorityInstruments,
        instrumentCatalog,
        [],
        query,
        15,
        recent,
      );
      setSymbolSuggestions(local);

      const q = query.trim();
      const shouldFetch =
        q.length >= 2 || /^\d{3,4}$/.test(q) || /[\u4e00-\u9fff]/.test(q);
      if (!shouldFetch) return;

      const fetchedCatalog = await refreshInstrumentCatalog();
      const catalog =
        fetchedCatalog.length > 0 ? fetchedCatalog : instrumentCatalog;

      const res = await fetch(
        `/api/instruments/search?q=${encodeURIComponent(q)}`,
      );
      const remote: { symbol: string; name: string }[] = res.ok
        ? await res.json()
        : [];
      setSymbolSuggestions(
        mergeInstrumentSuggestions(
          priorityInstruments,
          catalog,
          remote,
          query,
          15,
          recent,
        ),
      );
    },
    [
      instrumentCatalog,
      priorityInstruments,
      recentInstruments,
      refreshInstrumentCatalog,
    ],
  );

  function handleSymbolQuery(query: string) {
    setSymbolQuery(query);
    setResolvedSymbol(null);
    feeTaxTouched.current = false;
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => updateSuggestions(query), 200);
  }

  function handleSymbolSelect(item: { symbol: string; name: string }) {
    setSymbolQuery(formatSymbolWithName(item.symbol, item.name));
    setResolvedSymbol(item.symbol);
    priceTouched.current = false;
    feeTaxTouched.current = false;
  }

  const symbolInputRaw = symbolQuery.split(" — ")[0]?.trim() ?? "";
  const effectiveSymbol =
    resolvedSymbol ??
    (symbolInputRaw ? normalizeSymbolInput(symbolInputRaw) : "");

  useEffect(() => {
    if (isCashFlow || !effectiveSymbol || !form.date) return;

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      const params = new URLSearchParams({
        symbol: effectiveSymbol,
        date: form.date,
        type: form.type,
        accountId: form.accountId,
        quantity: form.quantity || "0",
      });
      if (priceTouched.current && form.price) {
        params.set("price", form.price);
      }

      const res = await fetch(`/api/transactions/preview?${params}`, {
        signal: controller.signal,
      });
      if (!res.ok) return;
      const data = (await res.json()) as {
        symbol: string;
        name: string;
        price: number | null;
      };

      setResolvedSymbol(data.symbol);
      setForm((f) => {
        const next = { ...f };
        if (!priceTouched.current && data.price != null) {
          next.price = String(data.price);
        }
        return next;
      });
    }, 350);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [
    effectiveSymbol,
    form.date,
    form.type,
    form.accountId,
    isCashFlow,
  ]);

  useEffect(() => {
    if (isCashFlow || !effectiveSymbol || !form.date) return;
    if (!form.quantity || !form.price) return;

    const controller = new AbortController();
    const account = accounts.find((a) => a.id === form.accountId);
    const timer = setTimeout(async () => {
      const params = new URLSearchParams({
        symbol: effectiveSymbol,
        date: form.date,
        type: form.type,
        accountId: form.accountId,
        quantity: form.quantity,
        price: form.price,
        roundHalfUp: account?.feeTaxRoundHalfUp ? "1" : "0",
      });

      const res = await fetch(`/api/transactions/preview?${params}`, {
        signal: controller.signal,
      });
      if (!res.ok) return;
      const data = (await res.json()) as { fee: number; tax: number };

      if (!feeTaxTouched.current) {
        setForm((f) => ({
          ...f,
          fee: formatFeeTaxAmount(data.fee),
          tax: formatFeeTaxAmount(data.tax),
        }));
      }
    }, 350);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [
    effectiveSymbol,
    form.date,
    form.quantity,
    form.price,
    form.type,
    form.accountId,
    accounts,
    isCashFlow,
  ]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const payload: Record<string, unknown> = {
        accountId: form.accountId || undefined,
        type: form.type,
        date: form.date,
        note: form.note || undefined,
      };

      if (isCashFlow) {
        payload.price = parseFloat(form.price);
      } else {
        payload.symbol = effectiveSymbol.toUpperCase();
        payload.quantity = parseFloat(form.quantity);
        payload.price = parseFloat(form.price);
        payload.fee = parseFloat(form.fee) || 0;
        payload.tax = parseFloat(form.tax) || 0;
      }

      const res = await fetch("/api/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json();
        alert(err.error ?? "新增失敗");
        return;
      }
      if (!isCashFlow && effectiveSymbol) {
        const sym = effectiveSymbol.toUpperCase();
        const fromDb = instrumentCatalog.find(
          (i) => i.symbol.toUpperCase() === sym,
        )?.name;
        const namePart = symbolQuery.split(" — ")[1]?.trim();
        const name = resolveSuggestionDisplayName(
          sym,
          fromDb,
          namePart,
          effectiveSymbol,
        );
        recordRecentInstrument(effectiveSymbol, name);
        const nextRecent = mergeRecentLists(
          [{ symbol: effectiveSymbol.toUpperCase(), name }],
          recentInstruments,
        );
        setRecentInstruments(nextRecent);
        setSymbolSuggestions(
          mergeInstrumentSuggestions(
            priorityInstruments,
            instrumentCatalog,
            [],
            "",
            15,
            toRecentSuggestions(nextRecent),
          ),
        );
      }
      await reloadTransactions();
      setSymbolQuery("");
      setResolvedSymbol(null);
      priceTouched.current = false;
      feeTaxTouched.current = false;
      setForm((f) => ({
        ...f,
        quantity: "",
        price: "",
        fee: "0",
        tax: "0",
        note: "",
      }));
    } finally {
      setLoading(false);
    }
  }

  async function handleCsvImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    setImportResult(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/transactions/import", {
        method: "POST",
        body: formData,
      });
      const result = await res.json();
      if (result.imported > 0) {
        setImportResult(`成功匯入 ${result.imported} 筆`);
        await reloadTransactions();
      }
      if (result.errors?.length > 0) {
        setImportResult(
          (prev) =>
            `${prev ?? ""} ${result.errors.length} 筆錯誤: ${result.errors.map((err: { row: number; message: string }) => `列${err.row} ${err.message}`).join("; ")}`,
        );
      }
    } finally {
      setLoading(false);
      e.target.value = "";
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-mono text-2xl font-bold text-[var(--color-primary)] glow-text">
          Transactions
        </h1>
        <p className="mt-1 text-sm text-[var(--color-muted)]">
          記錄買賣與出入金
        </p>
      </div>

      <PageSection id="transactions-add" title="新增交易" navOrder={10}>
      <Card>
          <CardHeader>
            <CardTitle>新增交易</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="form-label mb-1 block text-xs">帳戶</label>
                  <Select
                    value={form.accountId}
                    onChange={(e) => setForm({ ...form, accountId: e.target.value })}
                    required
                  >
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} ({a.currency})
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <label className="form-label mb-1 block text-xs">類型</label>
                  <Select
                    value={form.type}
                    className={transactionTypeSelectClass(form.type)}
                    onChange={(e) => setForm({ ...form, type: e.target.value })}
                  >
                    <option value="BUY">買入 BUY</option>
                    <option value="SELL">賣出 SELL</option>
                    <option value="DIVIDEND">股息 DIVIDEND</option>
                    <option value="DEPOSIT">入金 DEPOSIT</option>
                    <option value="WITHDRAWAL">出金 WITHDRAWAL</option>
                  </Select>
                </div>
              </div>

              {isCashFlow ? (
                <div className="grid grid-cols-2 gap-4 items-start">
                  <div>
                    <label className="form-label mb-1 block text-xs">日期</label>
                    <Input
                      type="date"
                      value={form.date}
                      onChange={(e) =>
                        setForm({ ...form, date: e.target.value })
                      }
                      required
                    />
                    <div className="mt-1 flex gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2"
                        onClick={() =>
                          setForm((f) => ({
                            ...f,
                            date: toLocalDateKey(new Date()),
                          }))
                        }
                      >
                        今天
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2"
                        onClick={() =>
                          setForm((f) => ({
                            ...f,
                            date: offsetLocalDateKey(-1),
                          }))
                        }
                      >
                        昨天
                      </Button>
                    </div>
                  </div>
                  <div>
                    <label className="form-label mb-1 block text-xs">金額</label>
                    <Input
                      type="number"
                      step="any"
                      value={form.price}
                      onChange={(e) =>
                        setForm({ ...form, price: e.target.value })
                      }
                      required
                    />
                  </div>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="form-label mb-1 block text-xs">
                        代碼或公司名稱
                      </label>
                      <SymbolSearchInput
                        value={symbolQuery}
                        suggestions={symbolSuggestions}
                        onQueryChange={handleSymbolQuery}
                        onSelect={handleSymbolSelect}
                        placeholder="台積電 / 2330 / AAPL / BTC-USD"
                        required
                      />
                      <div className="mt-1 min-h-7" aria-hidden />
                    </div>
                    <div>
                      <label className="form-label mb-1 block text-xs">日期</label>
                      <Input
                        type="date"
                        className="h-10"
                        value={form.date}
                        onChange={(e) =>
                          setForm({ ...form, date: e.target.value })
                        }
                        required
                      />
                      <div className="mt-1 flex min-h-7 gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2"
                          onClick={() =>
                            setForm((f) => ({
                              ...f,
                              date: toLocalDateKey(new Date()),
                            }))
                          }
                        >
                          今天
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2"
                          onClick={() =>
                            setForm((f) => ({
                              ...f,
                              date: offsetLocalDateKey(-1),
                            }))
                          }
                        >
                          昨天
                        </Button>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                    <div>
                      <label className="form-label mb-1 block text-xs">數量</label>
                      <Input
                        type="number"
                        step="any"
                        value={form.quantity}
                        onChange={(e) => {
                          feeTaxTouched.current = false;
                          setForm({ ...form, quantity: e.target.value });
                        }}
                        required
                      />
                    </div>
                    <div>
                      <label className="form-label mb-1 block text-xs">單價</label>
                      <Input
                        type="number"
                        step="any"
                        value={form.price}
                        onChange={(e) => {
                          priceTouched.current = true;
                          feeTaxTouched.current = false;
                          setForm({ ...form, price: e.target.value });
                        }}
                        required
                      />
                    </div>
                    <div>
                      <label className="form-label mb-1 block text-xs">手續費</label>
                      <Input
                        type="number"
                        step="any"
                        value={form.fee}
                        onChange={(e) => {
                          feeTaxTouched.current = true;
                          setForm({ ...form, fee: e.target.value });
                        }}
                      />
                    </div>
                    <div>
                      <label className="form-label mb-1 block text-xs">稅</label>
                      <Input
                        type="number"
                        step="any"
                        value={form.tax}
                        onChange={(e) => {
                          feeTaxTouched.current = true;
                          setForm({ ...form, tax: e.target.value });
                        }}
                      />
                    </div>
                  </div>
                </>
              )}

              <div>
                <label className="form-label mb-1 block text-xs">備註</label>
                <Input
                  placeholder="選填"
                  value={form.note}
                  onChange={(e) => setForm({ ...form, note: e.target.value })}
                />
              </div>

              {settlement && (
                <div className="rounded-lg border border-[var(--color-card-border)]/60 bg-[var(--color-card-border)]/10 p-4 space-y-2">
                  <p className="text-xs uppercase tracking-wider text-[var(--color-muted)]">
                    收付試算
                  </p>
                  {!isCashFlow && (
                    <div className="grid gap-1 text-sm sm:grid-cols-3">
                      <div className="flex justify-between gap-2 sm:block">
                        <span className="text-[var(--color-muted)]">成交金額</span>
                        <span className="tabular-nums font-medium">
                          {formatCurrency(settlement.gross, accountCurrency)}
                        </span>
                      </div>
                      <div className="flex justify-between gap-2 sm:block">
                        <span className="text-[var(--color-muted)]">手續費</span>
                        <span className="tabular-nums font-medium">
                          {formatCurrency(settlement.fee, accountCurrency)}
                        </span>
                      </div>
                      <div className="flex justify-between gap-2 sm:block">
                        <span className="text-[var(--color-muted)]">稅</span>
                        <span className="tabular-nums font-medium">
                          {formatCurrency(settlement.tax, accountCurrency)}
                        </span>
                      </div>
                    </div>
                  )}
                  <div className="flex flex-wrap items-baseline justify-between gap-2 border-t border-[var(--color-card-border)]/40 pt-2">
                    <div>
                      <p className="text-sm font-medium">{settlement.label}</p>
                      <p className="text-xs text-[var(--color-muted)]">
                        {settlement.detail}
                      </p>
                    </div>
                    <p
                      className={cn(
                        "tabular-nums text-xl font-semibold",
                        settlement.isOutflow ? "negative" : "positive",
                      )}
                    >
                      {settlement.isOutflow ? "−" : "+"}
                      {formatCurrency(Math.abs(settlement.net), accountCurrency)}
                    </p>
                  </div>
                </div>
              )}

              <Button type="submit" disabled={loading}>
                {loading ? "處理中..." : isCashFlow ? "新增出入金" : "新增交易"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </PageSection>

      <PageSection id="transactions-list" title="交易列表" className="mt-8" navOrder={20}>
      <Card>
        <CardHeader>
          <CardTitle>交易列表</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-md border border-[var(--color-card-border)]/60 bg-[var(--color-card)]">
            <button
              type="button"
              onClick={() => setFiltersExpanded((v) => !v)}
              className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
            >
              <span className="text-sm font-medium">篩選</span>
              <span className="flex items-center gap-2 text-xs text-[var(--color-muted)]">
                {!filtersExpanded && activeFilterCount > 0 && (
                  <span>已選 {activeFilterCount} 項</span>
                )}
                <svg
                  aria-hidden
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className={`h-3.5 w-3.5 shrink-0 transition-transform duration-300 ease-in-out ${filtersExpanded ? "rotate-180" : "rotate-0"}`}
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </span>
            </button>
            <div
              className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${filtersExpanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
            >
              <div className="overflow-hidden">
              <div className="space-y-4 border-t border-[var(--color-card-border)]/60 px-4 pb-4 pt-3">
            <div>
              <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-[var(--color-muted)]">
                標的／名稱
              </p>
              <Input
                type="search"
                placeholder="代號或名稱關鍵字…"
                value={filterSymbol}
                onChange={(e) => setFilterSymbol(e.target.value)}
                className="h-8 max-w-xs text-xs"
              />
            </div>
            <div>
              <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-[var(--color-muted)]">
                時間（未選表示全部）
              </p>
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label className="mb-1 block text-[10px] text-[var(--color-muted)]">
                    起
                  </label>
                  <Input
                    type="date"
                    value={filterDateFrom}
                    onChange={(e) => { setTodayMode(false); setFilterDateFrom(e.target.value); }}
                    className="h-8 text-xs"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] text-[var(--color-muted)]">
                    迄
                  </label>
                  <Input
                    type="date"
                    value={filterDateTo}
                    onChange={(e) => { setTodayMode(false); setFilterDateTo(e.target.value); }}
                    className="h-8 text-xs"
                  />
                </div>
                <div className="flex flex-wrap gap-1 pb-0.5">
                  <Button
                    type="button"
                    variant={isTodayFilter ? "default" : "outline"}
                    size="sm"
                    className="h-8 px-2.5 text-xs"
                    onClick={() => {
                      if (isTodayFilter) {
                        // Toggle off — clear the date filter
                        setTodayMode(false);
                        setFilterDateFrom("");
                        setFilterDateTo("");
                      } else {
                        // Toggle on — set to today and remember the mode
                        setTodayMode(true);
                        setFilterDateFrom(todayKey);
                        setFilterDateTo(todayKey);
                      }
                    }}
                  >
                    今日交易
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 px-2.5 text-xs"
                    onClick={() => {
                      setTodayMode(false);
                      setFilterDateFrom("");
                      setFilterDateTo("");
                    }}
                    disabled={!hasDateFilter}
                  >
                    全部日期
                  </Button>
                </div>
              </div>
            </div>
            <FilterCheckboxGroup label="交易類型（未選表示全部）" compact>
              {TX_FILTER_TYPES.map((type) => (
                <FilterCheckbox
                  key={type}
                  compact
                  checked={filterTypes.includes(type)}
                  onChange={() =>
                    setFilterTypes((prev) => toggleInList(prev, type))
                  }
                  label={formatTransactionType(type)}
                  className={transactionTypeClass(type)}
                />
              ))}
            </FilterCheckboxGroup>
            <FilterCheckboxGroup label="帳戶（未選表示全部）" compact>
              {accounts.map((a) => (
                <FilterCheckbox
                  key={a.id}
                  compact
                  checked={filterAccountIds.includes(a.id)}
                  onChange={() =>
                    setFilterAccountIds((prev) => toggleInList(prev, a.id))
                  }
                  label={`${a.name} (${a.currency})`}
                />
              ))}
            </FilterCheckboxGroup>
            {activeFilterCount > 0 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-xs"
                onClick={() => {
                  setFilterTypes([]);
                  setFilterAccountIds([]);
                  setFilterDateFrom("");
                  setFilterDateTo("");
                  setFilterSymbol("");
                }}
              >
                清除篩選
              </Button>
            )}
              </div>
              </div>
            </div>
          </div>

          <TransactionsTable
            columnOrder={columnOrder}
            onColumnOrderChange={setColumnOrder}
            transactions={pageTransactions as EditableTransaction[]}
            accounts={accounts}
            onSaved={reloadTransactions}
            onDeleted={reloadTransactions}
          />

          <div className="mt-4 rounded-lg border border-[var(--color-card-border)] bg-[var(--color-background)]/40 px-4 py-3">
            <p className="mb-3 text-xs text-[var(--color-muted)]">
              列表合計（含手續費與稅之淨收付）
            </p>
            {filteredTradeTotals.length === 0 ? (
              <div className="flex flex-wrap gap-8">
                <div>
                  <p className="text-xs text-[var(--color-muted)]">總買入</p>
                  <p className="mt-0.5 font-mono text-sm trade-buy">—</p>
                </div>
                <div>
                  <p className="text-xs text-[var(--color-muted)]">總賣出</p>
                  <p className="mt-0.5 font-mono text-sm trade-sell">—</p>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredTradeTotals.map(([ccy, { buy, sell }]) => (
                  <div
                    key={ccy}
                    className={cn(
                      "flex flex-wrap gap-8",
                      filteredTradeTotals.length > 1 &&
                        "border-t border-[var(--color-card-border)]/50 pt-3 first:border-0 first:pt-0",
                    )}
                  >
                    {filteredTradeTotals.length > 1 && (
                      <p className="w-full text-[10px] font-medium uppercase tracking-wide text-[var(--color-muted)]">
                        {ccy}
                      </p>
                    )}
                    <div>
                      <p className="text-xs text-[var(--color-muted)]">總買入</p>
                      <p className="mt-0.5 font-mono text-sm trade-buy">
                        {formatCurrency(buy, ccy)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-[var(--color-muted)]">總賣出</p>
                      <p className="mt-0.5 font-mono text-sm trade-sell">
                        {formatCurrency(sell, ccy)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-card-border)]/60 pt-4">
            <p className="text-xs text-[var(--color-muted)]">
              顯示 {pageStart}–{pageEnd} / 共 {filteredTransactions.length} 筆
              {filteredTransactions.length !== transactions.length &&
                `（全部 ${transactions.length} 筆）`}
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-xs text-[var(--color-muted)]">
                每頁
                <Select
                  value={String(pageSize)}
                  className="h-8 w-20"
                  onChange={(e) => setPageSize(Number(e.target.value))}
                >
                  {PAGE_SIZE_OPTIONS.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </Select>
              </label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={safePage <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  上一頁
                </Button>
                <span className="flex items-center px-2 font-mono text-xs text-[var(--color-muted)]">
                  {safePage} / {totalPages}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={safePage >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  下一頁
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
      </PageSection>

      <PageSection id="transactions-import" title="CSV 匯入" className="mt-8" navOrder={30}>
      <Card>
        <CardHeader>
          <CardTitle>CSV 匯入</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-[var(--color-muted)]">
            可上傳 <code className="text-[var(--color-primary)]">data/import/transactions.csv</code>{" "}
            標準格式，或舊版{" "}
            <code className="text-[var(--color-primary)]">data/import/legacy/All_transactions.csv</code>
          </p>
          <Input type="file" accept=".csv" onChange={handleCsvImport} disabled={loading} />
          {importResult && (
            <p className="text-sm text-[var(--color-primary)]">{importResult}</p>
          )}
        </CardContent>
      </Card>
      </PageSection>
    </div>
  );
}
