import { isQuoteMarketActive, QUOTE_REFRESH_MS } from "@/lib/quote-freshness";

/** 頁面放著不動時，盤中自動重新載入的間隔；跟報價快取同一個數字（3 分鐘），
 *  每次自動更新都剛好拿得到新報價 */
export const AUTO_REFRESH_MS = QUOTE_REFRESH_MS;

/** 該不該現在自動更新：視窗在前景、沒有更新在跑、頁面上有標的在交易時段
 *  （加密貨幣 24 小時都算），而且距離上次更新已經滿一個間隔。 */
export function shouldAutoRefresh({
  now,
  visible,
  inFlight,
  lastUpdatedAt,
  symbols,
  intervalMs = AUTO_REFRESH_MS,
}: {
  now: Date;
  visible: boolean;
  inFlight: boolean;
  /** 上次成功更新的時間（epoch ms）；還沒更新過是 null */
  lastUpdatedAt: number | null;
  symbols: readonly string[];
  intervalMs?: number;
}): boolean {
  if (!visible || inFlight) return false;
  if (lastUpdatedAt != null && now.getTime() - lastUpdatedAt < intervalMs) {
    return false;
  }
  return symbols.some((s) => isQuoteMarketActive(s, now));
}
