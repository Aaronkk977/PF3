import { prisma } from "@/lib/db";
import { searchInstruments } from "@/lib/instrument-search";
import { normalizeSymbolInput } from "@/lib/instrument-symbol";
import { fetchWithShortTimeout } from "@/lib/http-fetch";
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

/** 上市（TWSE）代碼／中文名查詢——與交易所官網搜尋列同源 */
async function twseCodeQuery(code: string): Promise<string | null> {
  const res = await fetchWithShortTimeout(
    `https://www.twse.com.tw/rwd/zh/api/codeQuery?query=${encodeURIComponent(code)}`,
    { next: { revalidate: 86400 } },
    6_000,
  );
  if (!res?.ok) return null;
  try {
    const data = (await res.json()) as { suggestions?: string[] };
    for (const s of data.suggestions ?? []) {
      const [c, name] = s.split("\t");
      if (c === code && name) return name.trim();
    }
  } catch {
    // ignore parse errors
  }
  return null;
}

/** 上櫃（TPEx）代碼／中文名查詢——與交易所官網搜尋列同源 */
async function tpexCodeQuery(code: string): Promise<string | null> {
  const res = await fetchWithShortTimeout(
    `https://www.tpex.org.tw/www/zh-tw/api/codeQuery?query=${encodeURIComponent(code)}`,
    { next: { revalidate: 86400 } },
    6_000,
  );
  if (!res?.ok) return null;
  try {
    const data = (await res.json()) as {
      suggestions?: { type?: string; data?: string[] }[];
    };
    for (const group of data.suggestions ?? []) {
      for (const entry of group.data ?? []) {
        const [label, c] = entry.split("\t");
        if (c !== code || !label) continue;
        return label.startsWith(code)
          ? label.slice(code.length).trim()
          : label.trim();
      }
    }
  } catch {
    // ignore parse errors
  }
  return null;
}

/**
 * 台股中文名稱：改用 TWSE／TPEx 官方代碼查詢 API（與交易所官網搜尋列同源）。
 * Yahoo 的 finance/search 已不再依 lang 參數回傳中文名，故不再採用。
 */
export async function fetchTaiwanChineseName(
  symbol: string,
): Promise<string | null> {
  const sym = symbol.toUpperCase();
  const code = sym.replace(/\.(TW|TWO)$/i, "");

  if (sym.endsWith(".TWO")) {
    return (await tpexCodeQuery(code)) ?? (await twseCodeQuery(code));
  }
  return (await twseCodeQuery(code)) ?? (await tpexCodeQuery(code));
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
