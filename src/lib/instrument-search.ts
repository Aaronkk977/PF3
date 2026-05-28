import { prisma } from "@/lib/db";
import {
  fetchTaiwanChineseName,
  isTaiwanSymbol,
  pickDisplayName,
} from "@/lib/instrument-display-name";
import { normalizeSymbolInput } from "@/lib/instrument-symbol";

export { normalizeSymbolInput };

export type SearchResult = {
  symbol: string;
  name: string;
  exchange?: string;
  type?: string;
};

type YahooSearchResponse = {
  quotes?: Array<{
    symbol?: string;
    shortname?: string;
    longname?: string;
    exchange?: string;
    quoteType?: string;
  }>;
};

function hasCjk(text: string): boolean {
  return /[\u4e00-\u9fff]/.test(text);
}

function isPoorInstrumentName(symbol: string, name: string): boolean {
  const s = symbol.trim().toUpperCase();
  const n = name.trim();
  if (!n) return true;
  if (n.toUpperCase() === s) return true;
  const base = s.replace(/\.(TW|TWO)$/i, "");
  if (n.toUpperCase() === base || n.toUpperCase() === `${base}.TW`) return true;
  return false;
}

/** Search local database for instruments by symbol or name (supports Chinese) */
async function searchLocalInstruments(query: string): Promise<SearchResult[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const instruments = await prisma.instrument.findMany({
    select: { symbol: true, name: true },
    orderBy: { symbol: "asc" },
  });

  return instruments
    .filter((i) => {
      if (!i.symbol) return false;
      const sym = i.symbol.toLowerCase();
      const name = (i.name ?? "").toLowerCase();
      return sym.includes(q) || name.includes(q);
    })
    .slice(0, 10)
    .map((i) => ({
      symbol: i.symbol,
      name: i.name ?? i.symbol,
    }));
}

async function searchYahooInstruments(query: string): Promise<SearchResult[]> {
  const langParam = "&lang=zh-Hant-TW";
  const url = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=12&newsCount=0${langParam}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6_000);
  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
      },
      next: { revalidate: 3600 },
      signal: controller.signal,
    });
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) return [];

  const data = (await res.json()) as YahooSearchResponse;
  return (data.quotes ?? [])
    .filter((item) => item.symbol)
    .map((item) => ({
      symbol: item.symbol!,
      name: item.shortname ?? item.longname ?? item.symbol!,
      exchange: item.exchange,
      type: item.quoteType,
    }));
}

async function enrichSearchResult(item: SearchResult): Promise<SearchResult> {
  let name = pickDisplayName(item.symbol, [item.name]);

  if (
    isTaiwanSymbol(item.symbol) &&
    (isPoorInstrumentName(item.symbol, name) || !hasCjk(name))
  ) {
    const twName = await fetchTaiwanChineseName(item.symbol);
    if (twName) name = twName;
  }

  return { ...item, name };
}

export async function searchInstruments(query: string): Promise<SearchResult[]> {
  const q = query.trim();
  if (!q) return [];

  const upperQ = q.toUpperCase();
  const shouldSuggestTaiwanVix =
    upperQ.includes("VIX") || upperQ.includes("TWN");

  const [local, remote] = await Promise.all([
    searchLocalInstruments(q),
    searchYahooInstruments(q).catch(() => [] as SearchResult[]),
  ]);

  const seen = new Set<string>();
  const merged: SearchResult[] = [];
  if (shouldSuggestTaiwanVix) {
    merged.push({
      symbol: "VIXTWN",
      name: "TAIWAN VIX",
      exchange: "TAIFEX",
      type: "INDEX",
    });
    seen.add("VIXTWN");
  }
  for (const item of [...local, ...remote]) {
    const key = item.symbol.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }

  const slice = merged.slice(0, 15);
  return Promise.all(slice.map(enrichSearchResult));
}
