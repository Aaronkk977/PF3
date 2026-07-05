import { Suspense } from "react";
import { InstrumentDetailClient } from "@/components/portfolio/instrument-detail-client";
import {
  ensureInstrument,
  watchlistNameForSymbol,
} from "@/lib/ensure-instrument";
import { prisma } from "@/lib/db";
import {
  isTaiwanSymbol,
  fetchTaiwanChineseName,
  hasCjk,
} from "@/lib/instrument-display-name";
import { inferInstrumentCurrency } from "@/lib/instrument-currency";
import {
  computeInstrumentPnl,
  mapSecurityTransactionsToPnlInput,
} from "@/lib/instrument-pnl";
import {
  computePeriodChangePercent,
  getHistoricalPrices,
  getQuote,
} from "@/lib/yahoo";
import {
  DEPRECATED_TAG_NAMES,
  withoutDeprecatedTags,
} from "@/lib/deprecated-tags";
import { toTransactionDateKey } from "@/lib/date-keys";
import { normalizeSymbolInput } from "@/lib/instrument-search";
import { decodeSymbol, toNumber } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function InstrumentPage({
  params,
}: {
  params: Promise<{ symbol: string }>;
}) {
  const { symbol: encoded } = await params;
  const symbol = normalizeSymbolInput(decodeSymbol(encoded));

  let instrument = await prisma.instrument.findUnique({
    where: { symbol },
    include: { tags: { include: { tag: true } } },
  });

  if (!instrument) {
    const hintName = await watchlistNameForSymbol(symbol);
    instrument = await ensureInstrument(symbol, { name: hintName });
  }

  // Backfill: TW stocks that were created before the Chinese-name fix
  if (isTaiwanSymbol(instrument.symbol) && (!instrument.name || !hasCjk(instrument.name))) {
    try {
      const cn = await fetchTaiwanChineseName(instrument.symbol);
      if (cn) {
        await prisma.instrument.update({ where: { id: instrument.id }, data: { name: cn } });
        instrument = { ...instrument, name: cn };
      }
    } catch {}
  }

  const end = new Date();
  /** 初始載入一年日線；K 線圖往左滑時會自動 lazy-load 更早的歷史資料 */
  const start = new Date(end.getFullYear() - 1, end.getMonth(), end.getDate());

  let quote = null;
  let ohlc: Awaited<ReturnType<typeof getHistoricalPrices>> = [];
  try {
    quote = await getQuote(symbol);
    ohlc = await getHistoricalPrices(symbol, start, end);
  } catch {
    // Yahoo may fail offline
  }

  const hasHistoricalBars = ohlc.length >= 2;
  const weekChangePct = hasHistoricalBars
    ? computePeriodChangePercent(ohlc, 7)
    : null;
  const monthChangePct = hasHistoricalBars
    ? computePeriodChangePercent(ohlc, 30)
    : null;
  const quarterChangePct = hasHistoricalBars
    ? computePeriodChangePercent(ohlc, 90)
    : null;
  const yearChangePct = hasHistoricalBars
    ? computePeriodChangePercent(ohlc, 365)
    : null;

  await prisma.tag.deleteMany({
    where: { name: { in: [...DEPRECATED_TAG_NAMES] } },
  });
  const allTags = await prisma.tag.findMany({ orderBy: { name: "asc" } });

  const [txRows, accounts] = await Promise.all([
    prisma.transaction.findMany({
      where: { instrumentId: instrument.id },
      include: { account: true },
      orderBy: { date: "desc" },
    }),
    prisma.account.findMany({
      select: { id: true, name: true, currency: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const transactionHistory = txRows.map((t) => ({
    id: t.id,
    date: toTransactionDateKey(t.date),
    type: t.type,
    accountId: t.account.id,
    accountName: t.account.name,
    symbol: instrument.symbol,
    instrumentName: instrument.name,
    quantity: toNumber(t.quantity),
    price: toNumber(t.price),
    fee: toNumber(t.fee),
    tax: toNumber(t.tax),
    note: t.note,
  }));

  const transactionMarkers = txRows.map((t) => ({
    date: toTransactionDateKey(t.date),
    type: t.type as "BUY" | "SELL" | "DIVIDEND",
    price: toNumber(t.price),
  }));

  const instrumentCurrency = inferInstrumentCurrency(
    instrument.symbol,
    instrument.currency,
    quote?.currency,
  );
  const marketPrice =
    quote?.price && quote.price > 0
      ? quote.price
      : txRows.length > 0
        ? toNumber(txRows.find((t) => t.type === "BUY")?.price ?? 0)
        : 0;

  const pnlSummary = await computeInstrumentPnl(
    mapSecurityTransactionsToPnlInput(
      txRows.map((t) => ({
        date: t.date,
        type: t.type,
        quantity: toNumber(t.quantity),
        price: toNumber(t.price),
        fee: toNumber(t.fee),
        tax: toNumber(t.tax),
        currency: t.account.currency,
      })),
    ),
    marketPrice,
    instrumentCurrency,
  );

  const isVix = symbol.toUpperCase() === "VIXTWN";

  return (
    <Suspense fallback={<div className="text-sm text-[var(--color-muted)]">載入中…</div>}>
    <InstrumentDetailClient
      instrument={{
        id: instrument.id,
        symbol: instrument.symbol,
        name: instrument.name,
        notes: instrument.notes,
        assetClass: instrument.assetClass,
        currency: instrument.currency,
        tags: withoutDeprecatedTags(
          instrument.tags.map((t) => t.tag.name),
        ),
      }}
      quote={quote}
      weekChangePct={weekChangePct}
      monthChangePct={monthChangePct}
      quarterChangePct={quarterChangePct}
      yearChangePct={yearChangePct}
      hasHistoricalBars={hasHistoricalBars}
      ohlc={ohlc}
      allTags={withoutDeprecatedTags(allTags.map((t) => t.name))}
      transactions={transactionMarkers}
      transactionHistory={transactionHistory}
      accounts={accounts}
      pnlSummary={pnlSummary}
      chartType={isVix ? "line" : "candlestick"}
    />
    </Suspense>
  );
}
