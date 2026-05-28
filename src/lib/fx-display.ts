/** 以系統結算幣別為基準，格式化「1 外幣 = ? 結算幣」 */
export function formatExchangeRateLabel(
  currency: string,
  baseCurrency: string,
  rateToBase: number | null,
): string | null {
  const code = currency.toUpperCase();
  const base = baseCurrency.toUpperCase();
  if (code === base) return `1 ${base} = 1 ${base}`;
  if (rateToBase == null || rateToBase <= 0) return null;

  const decimals =
    rateToBase >= 100 ? 2 : rateToBase >= 1 ? 4 : rateToBase >= 0.01 ? 4 : 6;
  return `1 ${code} = ${rateToBase.toFixed(decimals)} ${base}`;
}
