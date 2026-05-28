/** 將 TWD 換算為目標結算幣別（需傳入 1 TWD = ? target 的匯率） */
export function convertFromTwd(
  amountTwd: number,
  targetCurrency: string,
  twdToTargetRate: number | null,
  usdToTwdFallback?: number,
): number {
  const target = targetCurrency.toUpperCase();
  if (target === "TWD" || !target) return amountTwd;
  if (twdToTargetRate != null && twdToTargetRate > 0) {
    return amountTwd * twdToTargetRate;
  }
  if (target === "USD" && usdToTwdFallback && usdToTwdFallback > 0) {
    return amountTwd / usdToTwdFallback;
  }
  return amountTwd;
}
