import { prisma } from "@/lib/db";
import { searchInstruments } from "@/lib/instrument-search";
import { normalizeSymbolInput } from "@/lib/instrument-symbol";
import { getQuote } from "@/lib/yahoo";

export function hasCjk(text: string): boolean {
  return /[\u4e00-\u9fff]/.test(text);
}

function isPrimarilyLatin(text: string): boolean {
  const cjk = (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
  const latin = (text.match(/[a-zA-Z]/g) ?? []).length;
  return latin > 0 && latin >= cjk;
}

export function isTaiwanSymbol(symbol: string): boolean {
  const s = symbol.toUpperCase();
  return s.endsWith(".TW") || s.endsWith(".TWO");
}

type YahooSearchQuote = {
  symbol?: string;
  shortname?: string;
  longname?: string;
  exchange?: string;
};

async function yahooSearchQuotes(
  query: string,
  lang?: string,
): Promise<YahooSearchQuote[]> {
  const langParam = lang ? `&lang=${encodeURIComponent(lang)}` : "";
  const url = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=12&newsCount=0${langParam}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6_000);
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
      },
      next: { revalidate: 86400 },
      signal: controller.signal,
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { quotes?: YahooSearchQuote[] };
    return data.quotes ?? [];
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

function symbolMatchesQuote(target: string, quote: YahooSearchQuote): boolean {
  const sym = (quote.symbol ?? "").toUpperCase();
  const t = target.toUpperCase();
  const code = t.replace(/\.(TW|TWO)$/i, "");
  return sym === t || sym === `${code}.TW` || sym === `${code}.TWO` || sym === code;
}

/** 台股中文名稱（Yahoo 搜尋 zh-TW） */
export async function fetchTaiwanChineseName(
  symbol: string,
): Promise<string | null> {
  const sym = symbol.toUpperCase();
  const code = sym.replace(/\.(TW|TWO)$/i, "");
  const queries = [sym, code, `${code}.TW`];

  for (const lang of ["zh-Hant-TW", "zh-TW", undefined]) {
    for (const q of queries) {
      const quotes = await yahooSearchQuotes(q, lang);
      for (const item of quotes) {
        if (!symbolMatchesQuote(sym, item)) continue;
        const name = (item.shortname ?? item.longname ?? "").trim();
        if (name && hasCjk(name)) return name;
      }
    }
  }

  return null;
}

/** 台股優先中文名、美股優先英文名 */
export function pickDisplayName(
  symbol: string,
  names: (string | null | undefined)[],
): string {
  const candidates = [
    ...new Set(
      names
        .filter((n): n is string => typeof n === "string" && n.trim().length > 0)
        .map((n) => n.trim()),
    ),
  ].filter((n) => n.toUpperCase() !== symbol.toUpperCase());

  if (candidates.length === 0) {
    const any = names.find((n) => typeof n === "string" && n.trim());
    return any?.trim() || symbol;
  }

  if (isTaiwanSymbol(symbol)) {
    const chinese = candidates.find(hasCjk);
    if (chinese) return chinese;
    const nonLatin = candidates.find((n) => !isPrimarilyLatin(n));
    if (nonLatin) return nonLatin;
  } else {
    const english = candidates.find(isPrimarilyLatin);
    if (english) return english;
  }

  return candidates[0]!;
}

export async function resolveInstrumentDisplayName(
  symbol: string,
  extraNames: (string | null | undefined)[] = [],
): Promise<string> {
  const sym = normalizeSymbolInput(symbol);
  const names: (string | null | undefined)[] = [...extraNames];

  const instrument = await prisma.instrument.findUnique({
    where: { symbol: sym },
    select: { name: true },
  });
  if (instrument?.name) names.push(instrument.name);

  const searchResults = await searchInstruments(sym).catch(() => []);
  for (const r of searchResults) {
    if (r.symbol.toUpperCase() === sym.toUpperCase()) {
      names.push(r.name);
    }
  }

  const quote = await getQuote(sym).catch(() => null);
  if (quote?.name) names.push(quote.name);

  const result = pickDisplayName(sym, names);

  if (isTaiwanSymbol(sym) && !hasCjk(result)) {
    const twName = await fetchTaiwanChineseName(sym);
    if (twName) return twName;
  }

  return result;
}
