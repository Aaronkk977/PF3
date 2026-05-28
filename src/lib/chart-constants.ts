export const BENCHMARK_COLORS = [
  "#ff6bcc",
  "#ff8844",
  "#e066ff",
  "#ffaa66",
  "#ff5588",
  "#cc77ff",
];

export function benchmarkDataKey(symbol: string): string {
  return `benchmark_${symbol.replace(/[^a-zA-Z0-9]/g, "_")}`;
}

export const ENTIRE_PORTFOLIO_DATA_KEY = "portfolio_entire";
export const ENTIRE_PORTFOLIO_LABEL = "Entire Portfolio";
export const ENTIRE_PORTFOLIO_COLOR = "#e8f4ff";
/** 市值走勢設定中的 Entire Portfolio 選項 */
export const ENTIRE_PORTFOLIO_FILTER_ID = "__entire_portfolio__";
