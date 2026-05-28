export type PriceBar = { date: string; close: number };

/** 取指定日期（含）以前最近一個交易日的收盤價 */
export function findCloseOnOrBefore(
  bars: PriceBar[],
  dateStr: string,
): PriceBar | null {
  const target = dateStr.slice(0, 10);
  let best: PriceBar | null = null;
  for (const bar of bars) {
    const d = bar.date.slice(0, 10);
    if (d <= target) best = bar;
    else break;
  }
  return best;
}
