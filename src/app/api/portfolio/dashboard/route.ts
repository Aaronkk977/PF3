import { NextResponse } from "next/server";
import { buildPriorityInstrumentSuggestions } from "@/lib/instrument-suggestions.server";
import { getHoldings, getPortfolioSummary } from "@/lib/portfolio-engine";
import { prisma } from "@/lib/db";
import { getWatchlists } from "@/lib/watchlist";

export async function GET() {
  try {
    const [holdings, watchlists, instruments] = await Promise.all([
      getHoldings(),
      getWatchlists(),
      prisma.instrument.findMany({ orderBy: { symbol: "asc" } }),
    ]);
    const [summary, priorityInstruments] = await Promise.all([
      getPortfolioSummary(holdings),
      buildPriorityInstrumentSuggestions(holdings),
    ]);

    return NextResponse.json({
      summary,
      holdings,
      watchlists,
      instruments: instruments.map((i) => ({
        id: i.id,
        symbol: i.symbol,
        name: i.name,
      })),
      priorityInstruments,
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "載入 Dashboard 失敗" },
      { status: 500 },
    );
  }
}
