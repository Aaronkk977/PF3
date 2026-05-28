/** 內建追蹤清單（啟動時若不存在會自動建立） */
export const INTERNATIONAL_MARKET_WATCHLIST = {
  name: "International Market",
  items: [
    { symbol: "^IXIC", name: "納斯達克綜合" },
    { symbol: "^GSPC", name: "S&P 500" },
    { symbol: "^DJI", name: "道瓊工業" },
    { symbol: "^N225", name: "日經225" },
    { symbol: "^KS11", name: "韓國綜合" },
    { symbol: "^TWII", name: "台灣加權" },
  ],
} as const;

export const DEFAULT_WATCHLIST_NAME = "我的追蹤";

export function isBuiltinWatchlistName(name: string): boolean {
  return name === INTERNATIONAL_MARKET_WATCHLIST.name;
}
