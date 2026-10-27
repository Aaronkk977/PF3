/** Yahoo 沒有、由我們自己從官方資料源組出來的日序列（client-safe，無 server 依賴）。 */

export const TAIWAN_VIX_SYMBOL = "VIXTWN";
/** 台股融資餘額（上市＋上櫃，單位：億元） */
export const TAIWAN_MARGIN_BALANCE_SYMBOL = "TWMARGIN";
/** 大盤融資維持率（上市＋上櫃，單位：%），自行計算 */
export const TAIWAN_MARGIN_RATIO_SYMBOL = "TWMARGINRATIO";

export const CUSTOM_SERIES = [
  { symbol: TAIWAN_VIX_SYMBOL, name: "TAIWAN VIX", exchange: "TAIFEX" },
  { symbol: TAIWAN_MARGIN_BALANCE_SYMBOL, name: "台股融資餘額（億元）", exchange: "TWSE+TPEx" },
  { symbol: TAIWAN_MARGIN_RATIO_SYMBOL, name: "大盤融資維持率（%）", exchange: "TWSE+TPEx" },
] as const;

export function isCustomSeriesSymbol(symbol: string): boolean {
  const s = symbol.trim().toUpperCase();
  return CUSTOM_SERIES.some((c) => c.symbol === s);
}

export function isTaiwanMarginSymbol(symbol: string): boolean {
  const s = symbol.trim().toUpperCase();
  return s === TAIWAN_MARGIN_BALANCE_SYMBOL || s === TAIWAN_MARGIN_RATIO_SYMBOL;
}
