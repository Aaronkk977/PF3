"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSettings } from "@/components/settings/settings-provider";
import { Pencil } from "lucide-react";
import {
  CandlestickChart,
  type OhlcData,
  type TransactionMarker,
} from "@/components/charts/candlestick-chart";
import { SimpleLineChart } from "@/components/charts/simple-line-chart";
import {
  InstrumentTransactionsTable,
  type InstrumentTransactionRow,
} from "@/components/portfolio/instrument-transactions-table";
import { PageSection } from "@/components/layout/page-sections";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { MarkdownNotesEditor } from "@/components/ui/markdown-notes-editor";
import { MarkdownPreview } from "@/components/ui/markdown-preview";
import { clearClientCache, PAGE_CACHE_KEYS } from "@/lib/client-data-cache";
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

type Instrument = {
  id: string;
  symbol: string;
  name: string | null;
  notes: string | null;
  assetClass: string;
  currency: string | null;
  tags: string[];
};

export function InstrumentDetailClient({
  instrument,
  quote,
  weekChangePct,
  monthChangePct,
  quarterChangePct,
  yearChangePct,
  hasHistoricalBars: initialHasHistoricalBars,
  ohlc: initialOhlc,
  allTags,
  transactions,
  transactionHistory,
  pnlSummary,
  chartType = "candlestick",
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
  transactionHistory: InstrumentTransactionRow[];
  pnlSummary: InstrumentPnlSummary;
  chartType?: "candlestick" | "line";
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnTo = searchParams.get("from");
  const { settings } = useSettings();
  const displayCurrency = settings.baseCurrency;
  const [usdToTwd, setUsdToTwd] = useState(32);
  const [twdToBase, setTwdToBase] = useState<number | null>(1);
  const [displayName, setDisplayName] = useState(instrument.name ?? "");
  const [notes, setNotes] = useState(instrument.notes ?? "");

  // Client-side OHLC fallback: when the server render got no data (Yahoo
  // timed out), try fetching the chart data directly from the browser.
  const [ohlc, setOhlc] = useState<OhlcData[]>(initialOhlc);
  const [chartLoading, setChartLoading] = useState(false);
  const hasHistoricalBars = ohlc.length >= 2;

  useEffect(() => {
    if (ohlc.length > 0) return; // already have data
    setChartLoading(true);
    fetch(`/api/charts/${encodeURIComponent(instrument.symbol)}`)
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
  const [notesEditing, setNotesEditing] = useState(
    () => !(instrument.notes ?? "").trim(),
  );
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);

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
    setProfileSaving(true);
    setProfileSaved(false);
    try {
      const res = await fetch(`/api/instruments/${instrument.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: displayName.trim() || null,
          notes: notes.trim() || null,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        alert(err.error ?? "儲存失敗");
        return;
      }
      const data = (await res.json()) as {
        name: string | null;
        notes: string | null;
      };
      setDisplayName(data.name ?? "");
      setNotes(data.notes ?? "");
      if ((data.notes ?? "").trim()) {
        setNotesEditing(false);
      }
      setProfileSaved(true);
      // Invalidate all page-level client caches that embed instrument names,
      // so Holdings / Transactions / Dashboard show the new name immediately
      // on next visit instead of serving stale sessionStorage data.
      clearClientCache(PAGE_CACHE_KEYS.dashboard);
      clearClientCache(PAGE_CACHE_KEYS.holdings);
      clearClientCache(PAGE_CACHE_KEYS.transactions);
      router.refresh();
    } finally {
      setProfileSaving(false);
    }
  }

  async function saveProfile() {
    await persistProfile();
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
          className="text-xs text-[var(--color-muted)] hover:text-[var(--color-primary)]"
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
              onChange={(e) => {
                setDisplayName(e.target.value);
                setProfileSaved(false);
              }}
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
              <SimpleLineChart data={ohlc} />
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
            </div>
            )}
          </CardContent>
        </Card>
      </PageSection>

      <PageSection id="instrument-notes" title="投資筆記" className="mt-8" navOrder={35}>
        <Card>
          <CardHeader>
            <CardTitle>投資筆記（Markdown）</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-[var(--color-muted)]">
                  支援 Markdown，可記錄論點與風險。
                </p>
                {notes.trim() && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => setNotesEditing((v) => !v)}
                  >
                    {notesEditing ? "僅預覽" : "編輯筆記"}
                  </Button>
                )}
              </div>

              {notesEditing ? (
                <MarkdownNotesEditor
                  value={notes}
                  onChange={(v) => {
                    setNotes(v);
                    setProfileSaved(false);
                  }}
                  placeholder={"## 投資論點\n- 進場理由\n- 目標價\n- 風險…"}
                  minHeight="16rem"
                />
              ) : (
                <div className="min-h-[8rem] rounded-md border border-[var(--color-card-border)]/80 bg-[color-mix(in_srgb,var(--color-background)_60%,var(--color-card))] px-3 py-3">
                  <MarkdownPreview
                    content={notes}
                    emptyHint="尚無筆記。點「編輯筆記」或切換編輯後撰寫並儲存。"
                  />
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={saveProfile} disabled={profileSaving}>
                {profileSaving ? "儲存中…" : "儲存筆記"}
              </Button>
              {profileSaved && (
                <span className="text-xs text-[var(--color-positive)]">已儲存</span>
              )}
            </div>
          </CardContent>
        </Card>
      </PageSection>

      <PageSection id="instrument-transactions" title="交易記錄" className="mt-8" navOrder={40}>
        <Card>
          <CardHeader>
            <CardTitle>交易記錄</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <InstrumentTransactionsTable
              transactions={transactionHistory}
              currency={instrument.currency ?? "TWD"}
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

      <PageSection id="instrument-tags" title="類別" className="mt-8" navOrder={50}>
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
