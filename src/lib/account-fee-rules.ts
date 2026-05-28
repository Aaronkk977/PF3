import { toNumber } from "@/lib/utils";

/** 費率單位：千分之一（‰），例如 3 表示 3‰ = 0.3% */
export const PER_MILLE_DIVISOR = 1000;

/** 未捨去時保留小數位數 */
export const FEE_TAX_DECIMAL_PLACES = 4;

export type AccountFeeRules = {
  feeRateBps?: number | null;
  taxRatePct?: number | null;
  feeRateBpsBuy?: number | null;
  feeRateBpsSell?: number | null;
  taxRatePctBuy?: number | null;
  taxRatePctSell?: number | null;
  feeTaxRoundHalfUp?: boolean | null;
};

/** 舊版 bps 轉千分比（4 bps → 0.4‰） */
export function legacyFeeToPermille(bps: number): number {
  return bps / 10;
}

/** 舊版小數稅率轉千分比（0.003 → 3‰） */
export function legacyTaxToPermille(pct: number): number {
  return pct < 0.05 ? pct * 1000 : pct;
}

export function resolveFeePermille(
  account: AccountFeeRules,
  side: "BUY" | "SELL",
): number {
  const raw =
    side === "BUY" ? account.feeRateBpsBuy : account.feeRateBpsSell;
  if (raw != null) return toNumber(raw);
  return legacyFeeToPermille(toNumber(account.feeRateBps ?? 4));
}

export function resolveTaxPermille(
  account: AccountFeeRules,
  side: "BUY" | "SELL",
  symbol: string,
): number {
  const raw = side === "BUY" ? account.taxRatePctBuy : account.taxRatePctSell;
  if (raw != null) return legacyTaxToPermille(toNumber(raw));
  if (side === "BUY") return 0;
  const legacy = toNumber(account.taxRatePct ?? 0.003);
  if (symbol.endsWith(".TW")) return legacyTaxToPermille(legacy);
  return 0;
}

/**
 * floorWithMinOne：無條件捨去至整數，金額 > 0 時低消 1 元
 * 否則保留小數（最多 FEE_TAX_DECIMAL_PLACES 位）
 */
export function applyFeeTaxAmount(value: number, floorWithMinOne: boolean): number {
  if (floorWithMinOne) {
    if (value <= 0) return 0;
    const floored = Math.floor(value);
    return floored < 1 ? 1 : floored;
  }
  const factor = 10 ** FEE_TAX_DECIMAL_PLACES;
  return Math.round(value * factor) / factor;
}

export function feeFromPermille(
  amount: number,
  permille: number,
  floorWithMinOne = false,
): number {
  const raw = (amount * permille) / PER_MILLE_DIVISOR;
  return applyFeeTaxAmount(raw, floorWithMinOne);
}

export function taxFromPermille(
  amount: number,
  permille: number,
  floorWithMinOne = false,
): number {
  const raw = (amount * permille) / PER_MILLE_DIVISOR;
  return applyFeeTaxAmount(raw, floorWithMinOne);
}

/** Settings UI：顯示千分比 */
export function displayFeePermille(
  stored: number | null | undefined,
  legacyBps: number,
): number {
  if (stored != null) return toNumber(stored);
  return legacyFeeToPermille(legacyBps);
}

export function displayTaxPermille(
  stored: number | null | undefined,
  legacyPct: number,
): number {
  if (stored != null) return legacyTaxToPermille(toNumber(stored));
  return legacyTaxToPermille(legacyPct);
}
