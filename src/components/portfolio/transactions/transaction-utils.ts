import { toLocalDateKey, toTransactionDateKey } from "@/lib/date-keys";
import type { InstrumentSuggestion } from "@/lib/instrument-suggestions";
import type { RecentInstrument } from "@/lib/ui-prefs";

export type Transaction = {
  id: string;
  date: string;
  type: string;
  accountId: string;
  accountName: string;
  symbol: string | null;
  instrumentName: string | null;
  quantity: number;
  price: number;
  fee: number;
  tax: number;
  note: string | null;
};

export type Account = {
  id: string;
  name: string;
  currency: string;
  cash: number;
  feeTaxRoundHalfUp: boolean;
};

export type Instrument = { id: string; symbol: string; name: string | null };

export const CASH_TYPES = new Set(["DEPOSIT", "WITHDRAWAL"]);

export const TX_FILTER_TYPES = [
  "BUY",
  "SELL",
  "DIVIDEND",
  "DEPOSIT",
  "WITHDRAWAL",
] as const;

export const PAGE_SIZE_OPTIONS = [25, 50, 100, 200] as const;

export function offsetLocalDateKey(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return toLocalDateKey(d);
}

export function toggleInList<T>(list: T[], item: T): T[] {
  return list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
}

export function matchesSymbolOrNameFilter(
  tx: Transaction,
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const symbol = tx.symbol?.toLowerCase() ?? "";
  const name = tx.instrumentName?.toLowerCase() ?? "";
  return symbol.includes(q) || name.includes(q);
}

export function recentFromTransactions(txs: Transaction[]): RecentInstrument[] {
  const seen = new Set<string>();
  const out: RecentInstrument[] = [];
  for (const t of txs) {
    if (!t.symbol) continue;
    const key = t.symbol.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      symbol: t.symbol,
      name: t.instrumentName?.trim() || t.symbol,
    });
    if (out.length >= 8) break;
  }
  return out;
}

export function mergeRecentLists(...arrays: RecentInstrument[][]): RecentInstrument[] {
  const seen = new Set<string>();
  const out: RecentInstrument[] = [];
  for (const list of arrays) {
    for (const item of list) {
      const key = item.symbol.toUpperCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item);
      if (out.length >= 8) break;
    }
    if (out.length >= 8) break;
  }
  return out;
}

export function toRecentSuggestions(recent: RecentInstrument[]): InstrumentSuggestion[] {
  return recent.map((r, i) => ({
    symbol: r.symbol,
    name: r.name,
    priority: -20 + i,
  }));
}

export function normalizeTransactionRow(t: Transaction): Transaction {
  return { ...t, date: toTransactionDateKey(t.date) };
}

export function parseTransactionList(raw: unknown): Transaction[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((t) => normalizeTransactionRow(t as Transaction));
}
