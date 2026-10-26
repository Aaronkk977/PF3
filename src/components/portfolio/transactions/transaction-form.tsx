"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { SymbolSearchInput } from "@/components/portfolio/symbol-search-input";
import {
  CASH_TYPES,
  mergeRecentLists,
  offsetLocalDateKey,
  recentFromTransactions,
  toRecentSuggestions,
  type Account,
  type Instrument,
  type Transaction,
} from "@/components/portfolio/transactions/transaction-utils";
import { PAGE_CACHE_KEYS } from "@/lib/client-data-cache";
import { toLocalDateKey } from "@/lib/date-keys";
import { formatSymbolWithName } from "@/lib/instrument-nav";
import {
  inferAccountMarkets,
  mergeInstrumentSuggestions,
  resolveSuggestionDisplayName,
  suggestionMarketOf,
  type InstrumentSuggestion,
} from "@/lib/instrument-suggestions";
import { normalizeSymbolInput } from "@/lib/instrument-symbol";
import { pageRequestHeaders } from "@/lib/page-request-headers";
import {
  computeTransactionSettlement,
  type TransactionSettlement,
} from "@/lib/transaction-settlement";
import { transactionTypeSelectClass } from "@/lib/transaction-type-display";
import {
  loadRecentInstruments,
  loadTransactionsPrefs,
  recordRecentInstrument,
  updateTransactionsPrefs,
  type RecentInstrument,
} from "@/lib/ui-prefs";
import { cn, formatCurrency, formatFeeTaxAmount } from "@/lib/utils";

/** 「新增交易」表單：標的搜尋與推薦、自動帶入價格與手續費／稅、收付試算、送出。 */
export function TransactionForm({
  accounts,
  initialAccounts,
  transactions,
  instrumentCatalog,
  priorityInstruments,
  refreshInstrumentCatalog,
  onCreated,
}: {
  accounts: Account[];
  initialAccounts: Account[];
  transactions: Transaction[];
  instrumentCatalog: Instrument[];
  priorityInstruments: InstrumentSuggestion[];
  refreshInstrumentCatalog: () => Promise<Instrument[]>;
  onCreated: () => Promise<void>;
}) {
  const [loading, setLoading] = useState(false);
  const [symbolQuery, setSymbolQuery] = useState("");
  const [resolvedSymbol, setResolvedSymbol] = useState<string | null>(null);
  const [recentInstruments, setRecentInstruments] = useState<RecentInstrument[]>(
    () =>
      mergeRecentLists(
        loadRecentInstruments(),
        recentFromTransactions(transactions),
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
          recentFromTransactions(transactions),
        ),
      ),
    ),
  );
  const priceTouched = useRef(false);
  const feeTaxTouched = useRef(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchAbort = useRef<AbortController | null>(null);
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
    }
    setPrefsReady(true);
  }, [initialAccounts]);

  useEffect(() => {
    if (!prefsReady) return;
    updateTransactionsPrefs({ accountId: form.accountId, type: form.type });
  }, [form.accountId, form.type, prefsReady]);

  const isCashFlow = CASH_TYPES.has(form.type);

  const selectedAccount = accounts.find((a) => a.id === form.accountId);
  const accountCurrency = selectedAccount?.currency ?? "TWD";

  // 標的推薦只列選定帳戶所屬市場的標的（台股帳戶不推美股，反之亦然）
  const accountTransactions = useMemo(
    () => transactions.filter((t) => t.accountId === form.accountId),
    [transactions, form.accountId],
  );
  const accountMarkets = useMemo(
    () =>
      inferAccountMarkets(
        selectedAccount?.currency,
        accountTransactions.flatMap((t) => (t.symbol ? [t.symbol] : [])),
      ),
    [selectedAccount?.currency, accountTransactions],
  );
  // 全域最近使用清單只留 8 筆，篩掉其他市場後可能所剩無幾，用這個帳戶自己
  // 的交易紀錄補上。
  const accountRecent = useMemo(() => {
    const inMarket = (r: RecentInstrument) =>
      !accountMarkets || accountMarkets.has(suggestionMarketOf(r.symbol));
    return toRecentSuggestions(
      mergeRecentLists(
        recentInstruments.filter(inMarket),
        recentFromTransactions(accountTransactions),
      ),
    );
  }, [recentInstruments, accountTransactions, accountMarkets]);

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
      // 取消上一次尚未完成的搜尋，避免舊結果蓋掉新結果
      searchAbort.current?.abort();
      const controller = new AbortController();
      searchAbort.current = controller;

      const local = mergeInstrumentSuggestions(
        priorityInstruments,
        instrumentCatalog,
        [],
        query,
        15,
        accountRecent,
        accountMarkets,
      );
      setSymbolSuggestions(local);

      const q = query.trim();
      const shouldFetch =
        q.length >= 2 || /^\d{3,4}$/.test(q) || /[一-鿿]/.test(q);
      if (!shouldFetch) return;

      try {
        const fetchedCatalog = await refreshInstrumentCatalog();
        if (controller.signal.aborted) return;
        const catalog =
          fetchedCatalog.length > 0 ? fetchedCatalog : instrumentCatalog;

        const res = await fetch(
          `/api/instruments/search?q=${encodeURIComponent(q)}`,
          {
            signal: controller.signal,
            headers: pageRequestHeaders(PAGE_CACHE_KEYS.transactions),
          },
        );
        if (!res.ok) return;
        const remote: { symbol: string; name: string }[] = await res.json();
        if (controller.signal.aborted) return;
        setSymbolSuggestions(
          mergeInstrumentSuggestions(
            priorityInstruments,
            catalog,
            remote,
            query,
            15,
            accountRecent,
            accountMarkets,
          ),
        );
      } catch (e) {
        if (e instanceof Error && e.name === "AbortError") return;
      }
    },
    [
      instrumentCatalog,
      priorityInstruments,
      accountRecent,
      accountMarkets,
      refreshInstrumentCatalog,
    ],
  );

  useEffect(() => {
    void updateSuggestions(symbolQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在切換帳戶時重算推薦；updateSuggestions 會隨標的目錄更新換身分，納入會反覆打遠端搜尋
  }, [form.accountId]);

  function handleSymbolQuery(query: string) {
    setSymbolQuery(query);
    setResolvedSymbol(null);
    feeTaxTouched.current = false;
    if (searchTimer.current) clearTimeout(searchTimer.current);
    // 輸入中止尚未發出的舊搜尋
    searchAbort.current?.abort();
    searchAbort.current = null;
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

  /** 目前表單所選帳戶＋標的的持有股數（依已載入的交易紀錄加總，BUY 為正、SELL 為負） */
  const currentHeldQty = useMemo(() => {
    if (isCashFlow || !effectiveSymbol || !form.accountId) return null;
    const sym = effectiveSymbol.toUpperCase();
    let qty = 0;
    for (const t of transactions) {
      if (t.accountId !== form.accountId) continue;
      if ((t.symbol ?? "").toUpperCase() !== sym) continue;
      if (t.type === "BUY") qty += t.quantity;
      else if (t.type === "SELL") qty -= t.quantity;
    }
    return qty;
  }, [transactions, form.accountId, effectiveSymbol, isCashFlow]);

  /** 賣出數量超過目前持有股數時的警告文字；否則為 null */
  const sellExceedsHoldingWarning = useMemo(() => {
    if (form.type !== "SELL" || currentHeldQty == null) return null;
    const qty = parseFloat(form.quantity);
    if (!Number.isFinite(qty) || qty <= 0) return null;
    if (qty <= currentHeldQty + 1e-7) return null;
    const overBy = qty - currentHeldQty;
    return `目前持有 ${currentHeldQty.toLocaleString("zh-TW")} 股，這筆賣出 ${qty.toLocaleString("zh-TW")} 股將超賣 ${overBy.toLocaleString("zh-TW")} 股`;
  }, [form.type, form.quantity, currentHeldQty]);

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
        headers: pageRequestHeaders(PAGE_CACHE_KEYS.transactions),
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- debounced preview; omit price/qty to avoid refetch on every keystroke
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
        headers: pageRequestHeaders(PAGE_CACHE_KEYS.transactions),
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
    // 備註通常是使用者最後填的欄位，打完習慣性按 Enter 會直接觸發表單送出；
    // 如果送出後（尤其是新標的要打外部 API 查名稱/價格，可能要等好幾秒）畫面
    // 看起來沒反應，使用者常會再按一次 Enter 或點「新增交易」，若沒有這個
    // 同步防護，disabled={loading} 在極端情況下可能來不及在第二次觸發前生效，
    // 造成同一筆交易被送出兩次。
    if (loading) return;
    if (
      sellExceedsHoldingWarning &&
      !window.confirm(`${sellExceedsHoldingWarning}\n\n確定要繼續新增這筆交易嗎？`)
    ) {
      return;
    }
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
      const created = (await res.json()) as {
        instrument?: { name?: string | null } | null;
        warning?: string | null;
      };
      if (created.warning) alert(created.warning);
      if (!isCashFlow && effectiveSymbol) {
        const sym = effectiveSymbol.toUpperCase();
        const fromServer = created.instrument?.name;
        const fromDb = instrumentCatalog.find(
          (i) => i.symbol.toUpperCase() === sym,
        )?.name;
        const namePart = symbolQuery.split(" — ")[1]?.trim();
        const name = resolveSuggestionDisplayName(
          sym,
          fromServer,
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
            accountMarkets,
          ),
        );
      }
      await onCreated();
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

  const setDate = (date: string) => setForm((f) => ({ ...f, date }));

  return (
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
                <DateQuickPick onPick={setDate} className="mt-1 flex gap-1" />
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
                  <DateQuickPick onPick={setDate} className="mt-1 flex min-h-7 gap-1" />
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

          {sellExceedsHoldingWarning && (
            <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200/90">
              ⚠ {sellExceedsHoldingWarning}
            </p>
          )}

          {settlement && (
            <SettlementPreview
              settlement={settlement}
              currency={accountCurrency}
              showBreakdown={!isCashFlow}
            />
          )}

          <Button type="submit" disabled={loading}>
            {loading ? "處理中..." : isCashFlow ? "新增出入金" : "新增交易"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function DateQuickPick({
  onPick,
  className,
}: {
  onPick: (date: string) => void;
  className: string;
}) {
  return (
    <div className={className}>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 px-2"
        onClick={() => onPick(toLocalDateKey(new Date()))}
      >
        今天
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 px-2"
        onClick={() => onPick(offsetLocalDateKey(-1))}
      >
        昨天
      </Button>
    </div>
  );
}

function SettlementPreview({
  settlement,
  currency,
  showBreakdown,
}: {
  settlement: TransactionSettlement;
  currency: string;
  showBreakdown: boolean;
}) {
  return (
    <div className="rounded-lg border border-[var(--color-card-border)]/60 bg-[var(--color-card-border)]/10 p-4 space-y-2">
      <p className="text-xs uppercase tracking-wider text-[var(--color-muted)]">
        收付試算
      </p>
      {showBreakdown && (
        <div className="grid gap-1 text-sm sm:grid-cols-3">
          <div className="flex justify-between gap-2 sm:block">
            <span className="text-[var(--color-muted)]">成交金額</span>
            <span className="tabular-nums font-medium">
              {formatCurrency(settlement.gross, currency)}
            </span>
          </div>
          <div className="flex justify-between gap-2 sm:block">
            <span className="text-[var(--color-muted)]">手續費</span>
            <span className="tabular-nums font-medium">
              {formatCurrency(settlement.fee, currency)}
            </span>
          </div>
          <div className="flex justify-between gap-2 sm:block">
            <span className="text-[var(--color-muted)]">稅</span>
            <span className="tabular-nums font-medium">
              {formatCurrency(settlement.tax, currency)}
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
          {formatCurrency(Math.abs(settlement.net), currency)}
        </p>
      </div>
    </div>
  );
}
