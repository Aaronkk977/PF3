/** 推斷標的計價幣別（修正未設定 currency 時美股被當 TWD 的低估問題） */
export function inferInstrumentCurrency(
  symbol: string,
  stored?: string | null,
  quoteCurrency?: string | null,
): string {
  if (quoteCurrency?.trim()) return quoteCurrency.trim().toUpperCase();
  if (stored?.trim()) return stored.trim().toUpperCase();

  const s = symbol.toUpperCase();
  if (s.endsWith(".TW") || s.endsWith(".TWO")) return "TWD";
  if (s.includes("-USD") || s.includes("-USDT") || s.includes("-EUR")) {
    if (s.includes("-USD") || s.includes("-USDT")) return "USD";
  }
  if (/^\d{4,5}\.TW$/.test(s) || /^\d{4,5}\.TWO$/.test(s)) return "TWD";
  if (/^[A-Z^][A-Z0-9.\-^]{0,14}$/.test(s) && !s.endsWith(".TW") && !s.endsWith(".TWO")) {
    return "USD";
  }
  return "TWD";
}
