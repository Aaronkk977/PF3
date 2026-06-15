import { normalizeSymbolInput } from "@/lib/instrument-symbol";

export type InstrumentSuggestion = {
  symbol: string;
  name: string;
  /** 數字越小越優先：≤-10 最近使用、0 持倉、1 追蹤清單、2 資料庫、3 遠端搜尋 */
  priority: number;
};

/** 名稱若等於代號或空白，不適合顯示在推薦列 */
export function isPoorSuggestionName(symbol: string, name: string): boolean {
  const s = symbol.trim().toUpperCase();
  const n = name.trim();
  if (!n) return true;
  if (n.toUpperCase() === s) return true;
  const base = s.replace(/\.(TW|TWO)$/i, "");
  if (n.toUpperCase() === base) return true;
  return false;
}

/** 優先採用資料庫已更新的中文／公司名 */
export function resolveSuggestionDisplayName(
  symbol: string,
  ...candidates: (string | null | undefined)[]
): string {
  for (const c of candidates) {
    if (c && !isPoorSuggestionName(symbol, c)) return c.trim();
  }
  return symbol.trim();
}

function symbolMatchScore(symbol: string, name: string, query: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const sym = symbol.toLowerCase();
  const base = sym.replace(/\.tw$/i, "");
  const nm = name.toLowerCase();
  const normalized = normalizeSymbolInput(query).toLowerCase();

  if (sym === q || sym === normalized) return 0;
  if (base === q) return 1;
  if (sym.startsWith(q) || base.startsWith(q)) return 2;
  if (nm === q) return 3;
  if (nm.includes(q) || sym.includes(q)) return 4;
  return 5;
}

export function mergeInstrumentSuggestions(
  priority: InstrumentSuggestion[],
  database: { symbol: string; name: string | null }[],
  remote: { symbol: string; name: string }[],
  query: string,
  limit = 15,
  recent: InstrumentSuggestion[] = [],
): { symbol: string; name: string }[] {
  const q = query.trim().toLowerCase();
  const seen = new Set<string>();
  const merged: InstrumentSuggestion[] = [];

  const matches = (symbol: string, name: string) => {
    if (!q) return true;
    const sym = symbol.toLowerCase();
    const nm = name.toLowerCase();
    const base = sym.replace(/\.tw$/i, "");
    const normalized = normalizeSymbolInput(query).toLowerCase();
    return (
      sym.includes(q) ||
      nm.includes(q) ||
      base.includes(q) ||
      sym === normalized ||
      base === q
    );
  };
  const add = (symbol: string, name: string, priority: number) => {
    const key = symbol.toUpperCase();
    if (seen.has(key)) return;
    if (!matches(symbol, name)) return;
    seen.add(key);
    merged.push({ symbol, name, priority });
  };

  for (let i = 0; i < recent.length; i++) {
    const item = recent[i]!;
    add(item.symbol, item.name, -20 + i);
  }

  for (const item of priority) {
    add(item.symbol, item.name, item.priority);
  }

  for (const item of database) {
    add(item.symbol, item.name ?? item.symbol, 2);
  }

  for (const item of remote) {
    add(item.symbol, item.name, 3);
  }

  merged.sort((a, b) => {
    // 1. 字串比對品質優先（前綴 > 包含）
    const scoreA = symbolMatchScore(a.symbol, a.name, query);
    const scoreB = symbolMatchScore(b.symbol, b.name, query);
    if (scoreA !== scoreB) return scoreA - scoreB;
    // 2. 同品質時，最近交易／持倉順序優先
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.symbol.localeCompare(b.symbol);
  });

  const dbNames = new Map(
    database.map((i) => [i.symbol.toUpperCase(), i.name]),
  );

  return merged.slice(0, limit).map(({ symbol, name }) => ({
    symbol,
    name: resolveSuggestionDisplayName(
      symbol,
      dbNames.get(symbol.toUpperCase()),
      name,
    ),
  }));
}
