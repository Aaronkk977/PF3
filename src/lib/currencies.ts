import { normalizeCurrencyCode } from "@/lib/fx-rates";
import { parseJsonSafe } from "@/lib/utils";

export const DEFAULT_CURRENCIES = ["TWD", "USD"] as const;

const STORAGE_KEY = "portfolio-custom-currencies";

export function isDefaultCurrency(code: string): boolean {
  const normalized = normalizeCurrencyCode(code);
  return (DEFAULT_CURRENCIES as readonly string[]).includes(normalized);
}

function loadCustomOnly(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = parseJsonSafe<string[]>(raw);
    if (!parsed) return [];
    return [
      ...new Set(
        parsed
          .map((c) => normalizeCurrencyCode(c))
          .filter(
            (c) =>
              c.length >= 2 &&
              c.length <= 8 &&
              !isDefaultCurrency(c),
          ),
      ),
    ].sort();
  } catch {
    return [];
  }
}

export function loadCurrencyList(): string[] {
  const set = new Set<string>(DEFAULT_CURRENCIES);
  for (const c of loadCustomOnly()) set.add(c);
  return [...set].sort();
}

export function saveCustomCurrencies(codes: string[]): void {
  if (typeof window === "undefined") return;
  const custom = codes
    .map((c) => normalizeCurrencyCode(c))
    .filter((c) => c.length >= 2 && c.length <= 8 && !isDefaultCurrency(c));
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...new Set(custom)]));
}

export function addCustomCurrency(code: string): string[] {
  const normalized = normalizeCurrencyCode(code);
  if (normalized.length < 2 || normalized.length > 8) {
    throw new Error("幣別代碼須為 2–8 個英數字元");
  }
  if (!isValidCurrencyCode(normalized)) {
    throw new Error("幣別代碼格式不正確");
  }
  const custom = loadCustomOnly();
  if (!custom.includes(normalized) && !isDefaultCurrency(normalized)) {
    saveCustomCurrencies([...custom, normalized]);
  }
  return loadCurrencyList();
}

export function removeCustomCurrency(code: string): string[] {
  const normalized = normalizeCurrencyCode(code);
  if (isDefaultCurrency(normalized)) {
    throw new Error("無法刪除內建幣別 TWD、USD");
  }
  const custom = loadCustomOnly();
  if (!custom.includes(normalized)) {
    throw new Error("此幣別不在自訂清單中");
  }
  saveCustomCurrencies(custom.filter((c) => c !== normalized));
  return loadCurrencyList();
}

export function isValidCurrencyCode(code: string): boolean {
  return /^[A-Z0-9]{2,8}$/.test(code.trim().toUpperCase());
}
