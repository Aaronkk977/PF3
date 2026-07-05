import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;

  const minTurnover = parseFloat(p.get("minTurnover") ?? "0") * 1e8; // 億 → 元
  const minChangePct = parseFloat(p.get("minChangePct") ?? "-999");
  const maxChangePct = parseFloat(p.get("maxChangePct") ?? "999");
  const watchlistOnly = p.get("watchlistOnly") === "1";
  const watchlistId = p.get("watchlistId") ?? undefined;
  const exchange = p.get("exchange") ?? "ALL"; // TWSE | TPEx | ALL

  // N日內新高：highDays 0 = 不篩選
  const highDays = parseInt(p.get("highDays") ?? "0");

  // 乖離率：biasPeriod 0 = 不篩選
  const biasPeriod = parseInt(p.get("biasPeriod") ?? "0");
  const biasMin = parseFloat(p.get("biasMin") ?? "-999");
  const biasMax = parseFloat(p.get("biasMax") ?? "999");
  const hasBiasFilter = biasPeriod > 0;
  const hasHighFilter = highDays > 0;

  // Latest date with data
  const latest = await prisma.marketDailySnapshot.findFirst({
    orderBy: { date: "desc" },
    select: { date: true },
  });
  if (!latest) return NextResponse.json({ date: null, results: [] });
  const latestDate = latest.date;

  // Watchlist symbols if needed
  let watchlistSymbols: Set<string> | null = null;
  if (watchlistOnly) {
    const items = await prisma.watchlistItem.findMany({
      where: watchlistId ? { watchlistId } : undefined,
      select: { symbol: true },
    });
    watchlistSymbols = new Set(
      items.map((i: { symbol: string }) => i.symbol.replace(/\.(TW|TWO)$/, "")),
    );
  }

  // N日內新高的起始日期
  let sinceHighStr: string | null = null;
  if (hasHighFilter) {
    const tradingDates = await prisma.marketDailySnapshot.findMany({
      distinct: ["date"],
      where: { date: { lte: latestDate } },
      orderBy: { date: "desc" },
      take: highDays,
      select: { date: true },
    });
    sinceHighStr = tradingDates[tradingDates.length - 1]?.date ?? null;
  }

  // Fetch today's snapshots
  const initialTake = hasBiasFilter || hasHighFilter ? 3000 : 500;
  const rows = await prisma.marketDailySnapshot.findMany({
    where: {
      date: latestDate,
      ...(exchange !== "ALL" ? { exchange } : {}),
      ...(minTurnover > 0 ? { turnover: { gte: minTurnover } } : {}),
      changePercent: { gte: minChangePct, lte: maxChangePct },
    },
    orderBy: { turnover: "desc" },
    take: initialTake,
  });

  // ── N日內新高：每支股票 MAX(high) ─────────────────────────────────────────
  let highMap: Map<string, number> | null = null;
  if (hasHighFilter && sinceHighStr) {
    const highs = await prisma.$queryRaw<{ symbol: string; maxHigh: number }[]>`
      SELECT symbol, MAX(high) as maxHigh
      FROM MarketDailySnapshot
      WHERE date >= ${sinceHighStr} AND date <= ${latestDate}
      GROUP BY symbol
    `;
    highMap = new Map(
      highs.map((h: { symbol: string; maxHigh: number }) => [h.symbol, h.maxHigh]),
    );
  }

  // ── 乖離率計算 ─────────────────────────────────────────────────────────────
  const biasMap = new Map<string, number>();
  if (hasBiasFilter) {
    const tradingDates = await prisma.marketDailySnapshot.findMany({
      distinct: ["date"],
      where: { date: { lte: latestDate } },
      orderBy: { date: "desc" },
      take: biasPeriod,
      select: { date: true },
    });
    const oldestDate = tradingDates[tradingDates.length - 1]?.date;

    if (oldestDate) {
      const symbols = rows.map((r) => r.symbol);
      const BATCH = 500;
      const allHistory: { symbol: string; close: number; date: string }[] = [];
      for (let i = 0; i < symbols.length; i += BATCH) {
        const batch = symbols.slice(i, i + BATCH);
        const chunk = await prisma.marketDailySnapshot.findMany({
          where: {
            symbol: { in: batch },
            date: { gte: oldestDate, lte: latestDate },
          },
          select: { symbol: true, close: true, date: true },
          orderBy: [{ symbol: "asc" }, { date: "desc" }],
        });
        allHistory.push(...chunk);
      }

      const bySymbol = new Map<string, number[]>();
      for (const row of allHistory) {
        const arr = bySymbol.get(row.symbol) ?? [];
        if (arr.length < biasPeriod) arr.push(row.close);
        bySymbol.set(row.symbol, arr);
      }

      for (const [sym, closes] of bySymbol) {
        if (closes.length < biasPeriod) continue;
        const ma = closes.reduce((a, b) => a + b, 0) / closes.length;
        biasMap.set(sym, ((closes[0] - ma) / ma) * 100);
      }
    }
  }

  // ── 所有追蹤清單標記 ──────────────────────────────────────────────────────
  const allWatchlistItems = await prisma.watchlistItem.findMany({
    select: { symbol: true },
  });
  const allWatchlistSymbols = new Set(
    allWatchlistItems.map((i: { symbol: string }) =>
      i.symbol.replace(/\.(TW|TWO)$/, ""),
    ),
  );

  // ── 過濾 + 組裝結果 ────────────────────────────────────────────────────────
  const results = rows
    .filter((r: { symbol: string; close: number }) => {
      if (watchlistSymbols) {
        const bare = r.symbol.replace(/\.(TW|TWO)$/, "");
        if (!watchlistSymbols.has(bare) && !watchlistSymbols.has(r.symbol))
          return false;
      }
      if (hasHighFilter && highMap) {
        const max = highMap.get(r.symbol);
        if (!max || r.close < max * 0.999) return false;
      }
      if (hasBiasFilter) {
        const bias = biasMap.get(r.symbol);
        if (bias == null) return false;
        if (bias < biasMin || bias > biasMax) return false;
      }
      return true;
    })
    .slice(0, 200)
    .map((r) => ({
      symbol: r.symbol,
      name: r.name,
      exchange: r.exchange,
      close: r.close,
      changePercent: r.changePercent,
      turnoverB:
        r.turnover != null ? Math.round((r.turnover / 1e8) * 10) / 10 : null,
      volume: r.volume,
      high52w: highMap?.get(r.symbol) ?? null,
      bias: biasMap.get(r.symbol) ?? null,
      inWatchlist:
        allWatchlistSymbols.has(r.symbol.replace(/\.(TW|TWO)$/, "")) ||
        allWatchlistSymbols.has(r.symbol),
    }));

  return NextResponse.json({
    date: latestDate,
    biasPeriod: hasBiasFilter ? biasPeriod : null,
    highDays: hasHighFilter ? highDays : null,
    results,
  });
}
