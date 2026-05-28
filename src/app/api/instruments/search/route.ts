import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { pickDisplayName } from "@/lib/instrument-display-name";
import { resolveSuggestionDisplayName } from "@/lib/instrument-suggestions";
import { normalizeSymbolInput, searchInstruments } from "@/lib/instrument-search";
import { getQuote } from "@/lib/yahoo";

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q") ?? "";

  if (!q.trim()) {
    return NextResponse.json([]);
  }

  const normalized = normalizeSymbolInput(q);
  const [results, quote] = await Promise.all([
    searchInstruments(q).catch(() => [] as { symbol: string; name: string }[]),
    getQuote(normalized).catch(() => null),
  ]);

  const symbolKeys = [
    ...new Set([
      normalized.toUpperCase(),
      ...results.map((r) => r.symbol.toUpperCase()),
      ...(quote?.symbol ? [quote.symbol.toUpperCase()] : []),
    ]),
  ];
  const dbInstruments =
    symbolKeys.length > 0
      ? await prisma.instrument.findMany({
          where: { symbol: { in: symbolKeys } },
          select: { symbol: true, name: true },
        })
      : [];
  const dbNames = new Map(
    dbInstruments.map((i) => [i.symbol.toUpperCase(), i.name]),
  );

  const merged: { symbol: string; name: string }[] = [];
  const seen = new Set<string>();

  const push = (symbol: string, name: string) => {
    const key = symbol.toUpperCase();
    if (seen.has(key)) return;
    seen.add(key);
    merged.push({
      symbol,
      name: resolveSuggestionDisplayName(
        symbol,
        dbNames.get(key),
        pickDisplayName(symbol, [name]),
      ),
    });
  };

  if (quote?.price && quote.price > 0) {
    const sym = quote.symbol ?? normalized;
    push(sym, pickDisplayName(sym, [quote.name, normalized]));
  }

  for (const r of results) {
    push(r.symbol, r.name);
  }

  return NextResponse.json(merged.slice(0, 15));
}
