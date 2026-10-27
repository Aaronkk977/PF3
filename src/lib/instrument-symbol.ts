import { isCustomSeriesSymbol } from "@/lib/custom-series-symbols";

/** Client-safe symbol normalization (no Yahoo / DB imports). */
export function normalizeSymbolInput(input: string): string {
  const trimmed = input.trim().toUpperCase();
  if (isCustomSeriesSymbol(trimmed)) return trimmed;
  if (/^\d{4}$/.test(trimmed)) return `${trimmed}.TW`;
  return trimmed;
}
