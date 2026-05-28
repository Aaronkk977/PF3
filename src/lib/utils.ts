import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Avoid `JSON.parse("")` / corrupted localStorage breaking the UI */
export function parseJsonSafe<T>(raw: string | null | undefined): T | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    return null;
  }
}

export async function parseResponseJson<T>(res: Response): Promise<T | null> {
  const text = await res.text();
  return parseJsonSafe<T>(text);
}

export function toNumber(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return value;
  if (typeof value === "object" && value !== null && "toNumber" in value) {
    return (value as { toNumber: () => number }).toNumber();
  }
  return Number(value);
}

export function formatCurrency(value: number, currency = "TWD"): string {
  const locale = currency === "USD" ? "en-US" : "zh-TW";
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: currency === "USD" ? 2 : 0,
  }).format(value);
}

/** 交易價格／金額列表顯示（最多 maxDecimals 位小數） */
export function formatTransactionAmount(
  value: number,
  maxDecimals = 8,
): string {
  if (!Number.isFinite(value)) return "—";
  const fixed = value.toFixed(maxDecimals);
  const trimmed = fixed.replace(/\.?0+$/, "");
  return trimmed === "" || trimmed === "-0" ? "0" : trimmed;
}

/** 編輯表單用：保留完整精度 */
export function numberToEditString(value: number): string {
  if (!Number.isFinite(value)) return "";
  const s = String(value);
  if (!/[eE]/.test(s)) return s;
  return value.toFixed(20).replace(/\.?0+$/, "");
}

/** 手續費／稅額顯示（保留有意義小數） */
export function formatFeeTaxAmount(value: number): string {
  if (!Number.isFinite(value)) return "0";
  const rounded = Math.round(value * 10000) / 10000;
  if (Number.isInteger(rounded)) return String(rounded);
  return rounded.toFixed(4).replace(/\.?0+$/, "");
}

/** 漲跌幅視為持平（顯示 0.00%） */
export const FLAT_CHANGE_EPSILON = 0.00005;

/** 金額漲跌視為持平 */
export const FLAT_MONEY_EPSILON = 0.005;

export function isFlatChange(value: number): boolean {
  return !Number.isFinite(value) || Math.abs(value) < FLAT_CHANGE_EPSILON;
}

export function isFlatMoney(value: number): boolean {
  return !Number.isFinite(value) || Math.abs(value) < FLAT_MONEY_EPSILON;
}

/** StatCard 等：持平回傳 undefined，不套用紅綠 */
export function changePositive(value: number): boolean | undefined {
  if (isFlatChange(value)) return undefined;
  return value > 0;
}

export function changePositiveMoney(value: number): boolean | undefined {
  if (isFlatMoney(value)) return undefined;
  return value > 0;
}

export function changeToneClass(
  value: number,
  kind: "percent" | "money" = "percent",
): string {
  const flat = kind === "money" ? isFlatMoney(value) : isFlatChange(value);
  if (flat) return "";
  return value > 0 ? "positive" : "negative";
}

export function formatPercent(
  value: number,
  options?: { showSign?: boolean },
): string {
  const pct = (value * 100).toFixed(2);
  if (options?.showSign === false) {
    return `${pct}%`;
  }
  if (isFlatChange(value)) {
    return `${pct}%`;
  }
  const sign = value > 0 ? "+" : "";
  return `${sign}${pct}%`;
}

export function formatDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("zh-TW");
}

export function encodeSymbol(symbol: string): string {
  return encodeURIComponent(symbol);
}

export function decodeSymbol(encoded: string): string {
  return decodeURIComponent(encoded);
}
