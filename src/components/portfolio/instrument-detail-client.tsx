"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSettings } from "@/components/settings/settings-provider";
import { Pencil, Plus } from "lucide-react";
import {
  CandlestickChart,
  type OhlcData,
  type TransactionMarker,
} from "@/components/charts/candlestick-chart";
import { SimpleLineChart } from "@/components/charts/simple-line-chart";
import { TransactionsTable } from "@/components/portfolio/transactions-table";
import type { EditableTransaction } from "@/components/portfolio/transaction-row";
import { PageSection } from "@/components/layout/page-sections";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useNotesDrawer } from "@/components/notes/notes-drawer-context";
import { clearClientCache, PAGE_CACHE_KEYS } from "@/lib/client-data-cache";
import { toLocalDateKey } from "@/lib/date-keys";
import { convertFromTwd } from "@/lib/fx-convert";
import type { InstrumentPnlSummary } from "@/lib/instrument-pnl";
import type { QuoteResult } from "@/lib/yahoo";
import { isValidReturnPath } from "@/lib/instrument-nav";
import {
  changeToneClass,
  formatCurrency,
  formatPercent,
  parseResponseJson,
} from "@/lib/utils";

import type { TxColumnId } from "@/lib/transaction-table-columns";
import { pageRequestHeaders } from "@/lib/page-request-headers";

const INSTRUMENT_TX_COLUMN_ORDER: TxColumnId[] = [
  "date",
  "account",
  "type",
  "quantity",
  "price",
  "fee",
  "tax",
  "note",
];

type Instrument = {
  id: string;
  symbol: string;
  name: string | null;
  assetClass: string;
  currency: string | null;
  tags: string[];
};

type RelatedNote = {
  id: string;
  title: string;
  kind: string;
  noteDate: string;
  tags: string[];
};

export function InstrumentDetailClient({
  instrument,
  quote,
  weekChangePct,
  monthChangePct,
  quarterChangePct,
  yearChangePct,
  ohlc: initialOhlc,
  allTags,
  transactions,
  transactionHistory,
  accounts,
  pnlSummary,
  chartType = "candlestick",
  lineOverlay,
  relatedNotes,
}: {
  instrument: Instrument;
  quote: QuoteResult | null;
  weekChangePct: number | null;
  monthChangePct: number | null;
  quarterChangePct: number | null;
  yearChangePct: number | null;
  hasHistoricalBars: boolean;
  ohlc: OhlcData[];
  allTags: string[];
  transactions: TransactionMarker[];
  transactionHistory: EditableTransaction[];
  accounts: { id: string; name: string; currency: string }[];
  pnlSummary: InstrumentPnlSummary;
  chartType?: "candlestick" | "line";
  /** 折線圖疊加的對照線（左側刻度），例如 VIX／融資頁的加權指數 */
  lineOverlay?: { label: string; ohlc: OhlcData[] };
  relatedNotes: RelatedNote[];
}) {
  const { open: openNote, openNewNoteFor } = useNotesDrawer();
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnTo = searchParams.get("from");
  const { settings } = useSettings();
  const displayCurrency = settings.baseCurrency;
  const [usdToTwd, setUsdToTwd] = useState(32);
  const [twdToBase, setTwdToBase] = useState<number | null>(1);
  const [displayName, setDisplayName] = useState(instrument.name ?? "");

  // ── 快速新增交易：直接在標的頁記錄，不必跑去 Transactions 頁再回來 ──
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickAddAccountId, setQuickAddAccountId] = useState(
    accounts[0]?.id ?? "",
  );
  const [quickAddType, setQuickAddType] = useState<"BUY" | "SELL" | "DIVIDEND">(
    "BUY",
  );
  const [quickAddDate, setQuickAddDate] = useState(() => toLocalDateKey(new Date()));
  const [quickAddQuantity, setQuickAddQuantity] = useState("");
  const [quickAddPrice, setQuickAddPrice] = useState("");
  const [quickAddFee, setQuickAddFee] = useState("0");
  const [quickAddTax, setQuickAddTax] = useState("0");
  const [quickAddNote, setQuickAddNote] = useState("");
  const [quickAddSubmitting, setQuickAddSubmitting] = useState(false);
  const quickAddQuantityRef = useRef<HTMLInputElement>(null);

  const quickAddHeldQty = (() => {
    let qty = 0;
    for (const t of transactionHistory) {
      if (t.accountId !== quickAddAccountId) continue;
      if (t.type === "BUY") qty += t.quantity;
      else if (t.type === "SELL") qty -= t.quantity;
    }
    return qty;
  })();

  const quickAddSellWarning = (() => {
    if (quickAddType !== "SELL") return null;
    const qty = parseFloat(quickAddQuantity);
    if (!Number.isFinite(qty) || qty <= 0) return null;
    if (qty <= quickAddHeldQty + 1e-7) return null;
    const overBy = qty - quickAddHeldQty;
    return `目前持有 ${quickAddHeldQty.toLocaleString("zh-TW")} 股，這筆賣出 ${qty.toLocaleString("zh-TW")} 股將超賣 ${overBy.toLocaleString("zh-TW")} 股`;
  })();

  async function submitQuickAdd(e: React.FormEvent) {
    e.preventDefault();
    if (quickAddSubmitting) return;
    if (
      quickAddSellWarning &&
      !window.confirm(`${quickAddSellWarning}\n\n確定要繼續新增這筆交易嗎？`)
    ) {
      return;
    }
    setQuickAddSubmitting(true);
    try {
      const res = await fetch("/api/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId: quickAddAccountId || undefined,
          symbol: instrument.symbol,
          type: quickAddType,
          date: quickAddDate,
          quantity: parseFloat(quickAddQuantity),
          price: parseFloat(quickAddPrice),
          fee: parseFloat(quickAddFee) || 0,
          tax: parseFloat(quickAddTax) || 0,
          note: quickAddNote || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        alert(err.error ?? "新增失敗");
        return;
      }
      const created = (await res.json()) as { warning?: string | null };
      if (created.warning) alert(created.warning);
      setQuickAddQuantity("");
      setQuickAddPrice("");
      setQuickAddFee("0");
      setQuickAddTax("0");
      setQuickAddNote("");
      clearClientCache(PAGE_CACHE_KEYS.dashboard);
      clearClientCache(PAGE_CACHE_KEYS.holdings);
      clearClientCache(PAGE_CACHE_KEYS.transactions);
      router.refresh();
      quickAddQuantityRef.current?.focus();
    } finally {
      setQuickAddSubmitting(false);
    }
  }

  // Client-side OHLC fallback: when the server render got no data (Yahoo
  // timed out), try fetching the chart data directly from the browser.
  const [ohlc, setOhlc] = useState<OhlcData[]>(initialOhlc);
  const [chartLoading, setChartLoading] = useState(false);
  const hasHistoricalBars = ohlc.length >= 2;

  useEffect(() => {
    if (ohlc.length > 0) return; // already have data
    setChartLoading(true);
    fetch(`/api/charts/${encodeURIComponent(instrument.symbol)}`, {
      headers: pageRequestHeaders(PAGE_CACHE_KEYS.instrument),
    })
      .then(async (r) => {
        if (!r.ok) return;
        const bars = (await r.json()) as OhlcData[];
        if (Array.isArray(bars) && bars.length > 0) setOhlc(bars);
      })
      .catch(() => {})
      .finally(() => setChartLoading(false));
  // Run once on mount only
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [tags, setTags] = useState(instrument.tags.join(", "));
  const [tagsSaving, setTagsSaving] = useState(false);

  const [nameEditing, setNameEditing] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (nameEditing) {
      nameInputRef.current?.focus();
      nameInputRef.current?.select();
    }
  }, [nameEditing]);

  useEffect(() => {
    void fetch(
      `/api/fx/rates?base=${encodeURIComponent(displayCurrency)}&codes=TWD,USD`,
    )
      .then(async (r) =>
        r.ok
          ? parseResponseJson<{
              usdToTwd?: number;
              rates?: { code: string; rateToBase: number }[];
            }>(r)
          : null,
      )
      .then((j) => {
        if (j?.usdToTwd && j.usdToTwd > 0) setUsdToTwd(j.usdToTwd);
        const twdRow = j?.rates?.find((row) => row.code === "TWD");
        if (displayCurrency === "TWD") {
          setTwdToBase(1);
        } else if (twdRow?.rateToBase && twdRow.rateToBase > 0) {
          setTwdToBase(twdRow.rateToBase);
        } else {
          setTwdToBase(null);
        }
      })
      .catch(() => {});
  }, [displayCurrency]);

  const toSettlement = useCallback(
    (amountTwd: number) =>
      convertFromTwd(amountTwd, displayCurrency, twdToBase, usdToTwd),
    [displayCurrency, twdToBase, usdToTwd],
  );

  async function persistProfile() {
    const res = await fetch(`/api/instruments/${instrument.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: displayName.trim() || null,
      }),
    });
    if (!res.ok) {
      const err = await res.json();
      alert(err.error ?? "儲存失敗");
      return;
    }
    const data = (await res.json()) as { name: string | null };
    setDisplayName(data.name ?? "");
    // Invalidate all page-level client caches that embed instrument names,
    // so Holdings / Transactions / Dashboard show the new name immediately
    // on next visit instead of serving stale sessionStorage data.
    clearClientCache(PAGE_CACHE_KEYS.dashboard);
    clearClientCache(PAGE_CACHE_KEYS.holdings);
    clearClientCache(PAGE_CACHE_KEYS.transactions);
    router.refresh();
  }

  async function commitNameEdit() {
    if (!nameEditing) return;
    setNameEditing(false);
    const next = displayName.trim();
    const prev = (instrument.name ?? "").trim();
    if (next === prev) return;
    await persistProfile();
  }

  async function saveTags() {
    setTagsSaving(true);
    try {
      const tagList = tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      await fetch(`/api/instruments/${instrument.id}/tags`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tags: tagList }),
      });
      router.refresh();
    } finally {
      setTagsSaving(false);
    }
  }

  async function suggestTags() {
    const res = await fetch("/api/tags/suggest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol: instrument.symbol }),
    });
    const data = await res.json();
    if (data.suggestedTags) {
      setTags(data.suggestedTags.join(", "));
    }
  }

  const titleName = displayName.trim() || instrument.symbol;

  function goBack() {
    if (returnTo && isValidReturnPath(returnTo)) {
      router.push(returnTo);
      return;
    }
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
      return;
    }
    router.push("/");
  }

  return (
    <div className="space-y-8">
      <div className="sticky top-14 z-30 -mx-6 border-b border-[var(--color-card-border)]/50 bg-[var(--color-background)]/95 px-6 py-2 backdrop-blur-md">
        <button
          type="button"
          onClick={goBack}
          className="-mx-2 -my-1 rounded-md px-2 py-1 text-sm font-medium text-[var(--color-muted)] transition-colors hover:bg-[color-mix(in_srgb,var(--color-foreground)_6%,transparent)] hover:text-[var(--color-primary)]"
        >
          ← 返回
        </button>
      </div>
      <div className="-mt-4">
        <h1 className="font-mono text-2xl font-bold text-[var(--color-primary)] glow-text">
          {instrument.symbol}
        </h1>
        <div className="mt-2 flex flex-col gap-1">
          {nameEditing ? (
            <Input
              ref={nameInputRef}
              className="max-w-md text-sm"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void commitNameEdit();
                }
                if (e.key === "Escape") {
                  setDisplayName(instrument.name ?? "");
                  setNameEditing(false);
                }
              }}
              onBlur={() => void commitNameEdit()}
              placeholder={`顯示名稱（留空則僅顯示 ${instrument.symbol}）`}
              aria-label="顯示名稱"
            />
          ) : (
            <button
              type="button"
              className="group inline-flex max-w-full items-center gap-1.5 rounded-md py-0.5 pr-1.5 text-left text-sm transition-colors hover:bg-[var(--color-card-border)]/35"
              onClick={() => setNameEditing(true)}
            >
              <span className="font-medium text-[var(--color-foreground)]">
                {titleName}
              </span>
              <Pencil
                className="h-3.5 w-3.5 shrink-0 text-[var(--color-muted)] opacity-60 group-hover:opacity-100"
                aria-hidden
              />
              <span className="sr-only">編輯顯示名稱</span>
            </button>
          )}
          <p className="text-xs text-[var(--color-muted)]">
            {instrument.assetClass}
            {instrument.currency ? ` · ${instrument.currency}` : ""}
          </p>
        </div>
      </div>

      {(quote ||
        weekChangePct != null ||
        monthChangePct != null ||
        quarterChangePct != null ||
        yearChangePct != null ||
        hasHistoricalBars) && (
        <PageSection id="instrument-quote" title="行情" navOrder={20}>
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              {quote && quote.price > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle>現價</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="tabular-nums text-2xl font-semibold text-[var(--color-foreground)]">
                      {formatCurrency(
                        quote.price,
                        quote.currency ?? instrument.currency ?? "TWD",
                      )}
                    </p>
                  </CardContent>
                </Card>
              )}
              {quote && quote.changePercent !== undefined && (
                <Card>
                  <CardHeader>
                    <CardTitle>今日漲跌</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p
                      className={`tabular-nums text-2xl font-semibold ${changeToneClass(quote.changePercent)}`}
                    >
                      {formatPercent(quote.changePercent)}
                    </p>
                  </CardContent>
                </Card>
              )}
            </div>
            {hasHistoricalBars && (
              <div className="rounded-lg border border-[var(--color-card-border)] bg-[var(--color-card)] px-4 py-3">
                <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-[var(--color-muted)]">
                  區間表現
                </p>
                <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2 text-sm">
                  <span className="inline-flex flex-wrap items-baseline gap-2">
                    <span className="text-xs text-[var(--color-muted)]">
                      過去一週
                    </span>
                    <span
                      className={`tabular-nums font-semibold ${weekChangePct != null ? changeToneClass(weekChangePct) : ""}`}
                    >
                      {weekChangePct != null
                        ? formatPercent(weekChangePct)
                        : "—"}
                    </span>
                  </span>
                  <span className="text-[var(--color-muted)]" aria-hidden>
                    ·
                  </span>
                  <span className="inline-flex flex-wrap items-baseline gap-2">
                    <span className="text-xs text-[var(--color-muted)]">
                      過去一月
                    </span>
                    <span
                      className={`tabular-nums font-semibold ${monthChangePct != null ? changeToneClass(monthChangePct) : ""}`}
                    >
                      {monthChangePct != null
                        ? formatPercent(monthChangePct)
                        : "—"}
                    </span>
                  </span>
                  <span className="text-[var(--color-muted)]" aria-hidden>
                    ·
                  </span>
                  <span className="inline-flex flex-wrap items-baseline gap-2">
                    <span className="text-xs text-[var(--color-muted)]">
                      過去一季
                    </span>
                    <span
                      className={`tabular-nums font-semibold ${quarterChangePct != null ? changeToneClass(quarterChangePct) : ""}`}
                    >
                      {quarterChangePct != null
                        ? formatPercent(quarterChangePct)
                        : "—"}
                    </span>
                  </span>
                  <span className="text-[var(--color-muted)]" aria-hidden>
                    ·
                  </span>
                  <span className="inline-flex flex-wrap items-baseline gap-2">
                    <span className="text-xs text-[var(--color-muted)]">
                      過去一年
                    </span>
                    <span
                      className={`tabular-nums font-semibold ${yearChangePct != null ? changeToneClass(yearChangePct) : ""}`}
                    >
                      {yearChangePct != null
                        ? formatPercent(yearChangePct)
                        : "—"}
                    </span>
                  </span>
                </div>
              </div>
            )}
          </div>
        </PageSection>
      )}

      <PageSection
        id="instrument-chart"
        title={chartType === "line" ? "折線圖" : "K 線圖"}
        className="mt-8"
        navOrder={30}
      >
        <Card>
          <CardHeader>
            <CardTitle>
              {chartType === "line" ? "折線圖（日線）" : "K 線圖（日線）"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {chartLoading ? (
              <div className="flex h-[400px] items-center justify-center rounded-lg border border-[var(--color-card-border)] bg-[var(--color-card)] text-sm text-[var(--color-muted)]">
                載入圖表資料中…
              </div>
            ) : chartType === "line" ? (
              <>
                <SimpleLineChart data={ohlc} overlay={lineOverlay?.ohlc} />
                {lineOverlay && lineOverlay.ohlc.length > 0 && (
                  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-[var(--color-muted)]">
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        className="inline-block h-0.5 w-5 rounded-full bg-[var(--color-primary)]"
                        aria-hidden
                      />
                      {instrument.symbol}（右軸）
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        className="inline-block h-px w-5 rounded-full bg-[var(--color-muted)]"
                        aria-hidden
                      />
                      {lineOverlay.label}（左軸）
                    </span>
                  </div>
                )}
              </>
            ) : (
              <CandlestickChart data={ohlc} transactions={transactions} symbol={instrument.symbol} />
            )}
            {chartType !== "line" && (
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-[var(--color-muted)]">
              <span className="trade-buy">▲ 買進</span>
              <span className="trade-sell">▼ 賣出</span>
              <span className="inline-flex items-center gap-1.5">
                <span
                  className="inline-block h-0.5 w-5 rounded-full bg-[var(--color-accent)]"
                  aria-hidden
                />
                MA10
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span
                  className="inline-block h-0.5 w-5 rounded-full bg-[var(--color-primary)]"
                  aria-hidden
                />
                MA20
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span
                  className="inline-block h-0 w-5 border-t-2 border-dashed border-[var(--color-foreground)]/45"
                  aria-hidden
                />
                季線 MA60
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span
                  className="inline-block h-0 w-5 border-t-2 border-dashed border-[var(--color-muted)]"
                  aria-hidden
                />
                年線 MA250
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-sm bg-[var(--color-muted)]/60"
                  aria-hidden
                />
                成交量
              </span>
            </div>
            )}
          </CardContent>
        </Card>
      </PageSection>

      <PageSection id="instrument-transactions" title="交易記錄" className="mt-8" navOrder={40}>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <CardTitle>交易記錄</CardTitle>
            <Button
              type="button"
              variant="outline"
              className="h-8 px-2.5 text-xs"
              onClick={() => setQuickAddOpen((v) => !v)}
            >
              <Plus className="h-3.5 w-3.5" aria-hidden />
              新增交易
            </Button>
          </CardHeader>
          <CardContent className="space-y-6">
            {quickAddOpen && (
              <form
                onSubmit={submitQuickAdd}
                className="space-y-3 rounded-lg border border-[var(--color-card-border)]/60 bg-[var(--color-card-border)]/10 p-4"
              >
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <label className="form-label mb-1 block text-xs">帳戶</label>
                    <select
                      value={quickAddAccountId}
                      onChange={(e) => setQuickAddAccountId(e.target.value)}
                      className="h-9 w-full rounded-md border border-[var(--color-card-border)] bg-[var(--color-background)] px-2 text-sm"
                      required
                    >
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}（{a.currency}）
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="form-label mb-1 block text-xs">類型</label>
                    <select
                      value={quickAddType}
                      onChange={(e) =>
                        setQuickAddType(e.target.value as "BUY" | "SELL" | "DIVIDEND")
                      }
                      className="h-9 w-full rounded-md border border-[var(--color-card-border)] bg-[var(--color-background)] px-2 text-sm"
                    >
                      <option value="BUY">買入 BUY</option>
                      <option value="SELL">賣出 SELL</option>
                      <option value="DIVIDEND">股息 DIVIDEND</option>
                    </select>
                  </div>
                  <div>
                    <label className="form-label mb-1 block text-xs">日期</label>
                    <Input
                      type="date"
                      className="h-9"
                      value={quickAddDate}
                      onChange={(e) => setQuickAddDate(e.target.value)}
                      required
                    />
                  </div>
                  <div>
                    <label className="form-label mb-1 block text-xs">數量</label>
                    <Input
                      ref={quickAddQuantityRef}
                      type="number"
                      step="any"
                      className="h-9"
                      value={quickAddQuantity}
                      onChange={(e) => setQuickAddQuantity(e.target.value)}
                      required
                      autoFocus
                    />
                  </div>
                  <div>
                    <label className="form-label mb-1 block text-xs">單價</label>
                    <Input
                      type="number"
                      step="any"
                      className="h-9"
                      value={quickAddPrice}
                      onChange={(e) => setQuickAddPrice(e.target.value)}
                      required
                    />
                  </div>
                  <div>
                    <label className="form-label mb-1 block text-xs">手續費</label>
                    <Input
                      type="number"
                      step="any"
                      className="h-9"
                      value={quickAddFee}
                      onChange={(e) => setQuickAddFee(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="form-label mb-1 block text-xs">稅</label>
                    <Input
                      type="number"
                      step="any"
                      className="h-9"
                      value={quickAddTax}
                      onChange={(e) => setQuickAddTax(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="form-label mb-1 block text-xs">備註</label>
                    <Input
                      className="h-9"
                      placeholder="選填"
                      value={quickAddNote}
                      onChange={(e) => setQuickAddNote(e.target.value)}
                    />
                  </div>
                </div>

                {quickAddSellWarning && (
                  <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200/90">
                    ⚠ {quickAddSellWarning}
                  </p>
                )}

                <div className="flex items-center gap-3">
                  <Button type="submit" disabled={quickAddSubmitting} className="h-9">
                    {quickAddSubmitting ? "新增中…" : "確認新增"}
                  </Button>
                  <button
                    type="button"
                    className="text-xs text-[var(--color-muted)] hover:text-[var(--color-primary)]"
                    onClick={() => setQuickAddOpen(false)}
                  >
                    取消
                  </button>
                </div>
              </form>
            )}
            <TransactionsTable
              columnOrder={INSTRUMENT_TX_COLUMN_ORDER}
              onColumnOrderChange={() => {}}
              transactions={transactionHistory}
              accounts={accounts}
              onSaved={() => {
                clearClientCache(PAGE_CACHE_KEYS.transactions);
                clearClientCache(PAGE_CACHE_KEYS.holdings);
                router.refresh();
              }}
              onDeleted={() => {
                clearClientCache(PAGE_CACHE_KEYS.transactions);
                clearClientCache(PAGE_CACHE_KEYS.holdings);
                router.refresh();
              }}
            />
            <div className="grid gap-4 border-t border-[var(--color-card-border)]/60 pt-4 sm:grid-cols-2">
              <div className="rounded-lg border border-[var(--color-card-border)]/50 bg-[var(--color-card-border)]/10 p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-muted)]">
                  實現損益（結算）
                </p>
                <p
                  className={`mt-2 tabular-nums text-xl font-semibold ${changeToneClass(pnlSummary.realizedPnl, "money")}`}
                >
                  {formatCurrency(
                    toSettlement(pnlSummary.realizedPnl),
                    displayCurrency,
                  )}
                </p>
                <p
                  className={`mt-1 text-sm tabular-nums ${changeToneClass(pnlSummary.realizedPnlPct)}`}
                >
                  {pnlSummary.realizedCostBasis > 0
                    ? formatPercent(pnlSummary.realizedPnlPct)
                    : "—"}
                </p>
                <p className="mt-1 text-xs text-[var(--color-muted)]">
                  已平倉部位累計（FIFO）
                </p>
              </div>
              <div className="rounded-lg border border-[var(--color-card-border)]/50 bg-[var(--color-card-border)]/10 p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-muted)]">
                  未實現損益
                </p>
                <p
                  className={`mt-2 tabular-nums text-xl font-semibold ${changeToneClass(pnlSummary.unrealizedPnl, "money")}`}
                >
                  {formatCurrency(
                    toSettlement(pnlSummary.unrealizedPnl),
                    displayCurrency,
                  )}
                </p>
                <p
                  className={`mt-1 text-sm tabular-nums ${changeToneClass(pnlSummary.unrealizedPnlPct)}`}
                >
                  {formatPercent(pnlSummary.unrealizedPnlPct)}
                </p>
                {pnlSummary.quantity > 0 ? (
                  <p className="mt-1 text-xs text-[var(--color-muted)]">
                    持倉 {pnlSummary.quantity.toLocaleString()} · 市值{" "}
                    {formatCurrency(
                      toSettlement(pnlSummary.marketValue),
                      displayCurrency,
                    )}
                  </p>
                ) : (
                  <p className="mt-1 text-xs text-[var(--color-muted)]">
                    目前無持倉
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </PageSection>

      <PageSection id="instrument-related-notes" title="相關筆記" className="mt-8" navOrder={45}>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <CardTitle>相關筆記</CardTitle>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() =>
                openNewNoteFor({
                  id: instrument.id,
                  symbol: instrument.symbol,
                  name: instrument.name,
                })
              }
            >
              + 新增筆記
            </Button>
          </CardHeader>
          <CardContent className="space-y-2">
            {relatedNotes.length === 0 ? (
              <p className="text-sm text-[var(--color-muted)]">尚無相關筆記</p>
            ) : (
              relatedNotes.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => openNote(n.id)}
                  className="block w-full rounded-md border border-[var(--color-card-border)]/60 px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--color-card-border)]/20"
                >
                  <span className="font-medium text-[var(--color-foreground)]">
                    {n.title}
                  </span>
                  <span className="ml-2 text-xs text-[var(--color-muted)]">
                    {n.kind} · {n.noteDate}
                  </span>
                </button>
              ))
            )}
          </CardContent>
        </Card>
      </PageSection>

      <PageSection id="instrument-tags" title="標籤" className="mt-8" navOrder={50}>
        <Card>
          <CardHeader>
            <CardTitle>標籤</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {instrument.tags.map((tag) => (
                <Badge key={tag}>{tag}</Badge>
              ))}
            </div>
            <Input
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="輸入標籤，逗號分隔"
            />
            <p className="text-xs text-[var(--color-muted)]">
              既有標籤：{allTags.join(", ") || "無"}
            </p>
            <div className="flex gap-2">
              <Button onClick={saveTags} disabled={tagsSaving}>
                {tagsSaving ? "儲存中..." : "儲存標籤"}
              </Button>
              <Button variant="outline" onClick={suggestTags}>
                AI 建議（Mock）
              </Button>
            </div>
          </CardContent>
        </Card>
      </PageSection>
    </div>
  );
}
