import { encodeSymbol } from "@/lib/utils";

/** 允許返回的站內路徑（防 open redirect） */
export function isValidReturnPath(path: string): boolean {
  if (!path.startsWith("/") || path.startsWith("//")) return false;
  if (path.includes("://")) return false;
  return true;
}

export function instrumentHref(symbol: string, from?: string): string {
  const base = `/instruments/${encodeSymbol(symbol)}`;
  if (!from || !isValidReturnPath(from)) return base;
  return `${base}?from=${encodeURIComponent(from)}`;
}

export function formatSymbolWithName(symbol: string, name: string): string {
  const label = symbol.trim();
  const cleanName = name.trim();
  if (!cleanName || cleanName.toUpperCase() === label.toUpperCase()) {
    return label;
  }
  return `${label} — ${cleanName}`;
}
