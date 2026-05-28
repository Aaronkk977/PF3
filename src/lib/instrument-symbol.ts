/** Client-safe symbol normalization (no Yahoo / DB imports). */
export function normalizeSymbolInput(input: string): string {
  const trimmed = input.trim().toUpperCase();
  if (trimmed === "VIXTWN") return "VIXTWN";
  if (/^\d{4}$/.test(trimmed)) return `${trimmed}.TW`;
  return trimmed;
}
