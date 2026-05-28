import { normalizeSymbolInput } from "@/lib/instrument-symbol";

export type BenchmarkRecord = {
  id: string;
  symbol: string;
  label: string;
};

export function normalizeBenchmarkSymbol(input: string): string {
  return normalizeSymbolInput(input.trim());
}

export function isValidBenchmarkSymbol(symbol: string): boolean {
  if (!symbol || symbol.length > 48) return false;
  return /^[\^]?[A-Za-z0-9][\w.\-^=]*$/.test(symbol);
}

export function serializeBenchmark(row: {
  id: string;
  symbol: string;
  label: string;
}): BenchmarkRecord {
  return {
    id: row.id,
    symbol: row.symbol,
    label: row.label.trim() || row.symbol,
  };
}
