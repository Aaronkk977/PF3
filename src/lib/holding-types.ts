export type HoldingPosition = {
  instrumentId: string;
  symbol: string;
  name: string | null;
  assetClass: string;
  currency: string | null;
  quantity: number;
  avgCost: number;
  costBasis: number;
  marketPrice: number;
  marketValue: number;
  marketValueBase: number;
  unrealizedPnl: number;
  unrealizedPnlPct: number;
  dayChangePct: number | null;
  dayChange: number;
  /** 昨收（台股漲停判定用，來自報價） */
  previousClose?: number | null;
  /** 即時報價來源本次呼叫失敗，價格／漲跌為本機快取的舊資料 */
  quoteStale?: boolean;
  tags: string[];
  weight: number;
  accountIds: string[];
  accounts: { id: string; name: string; quantity: number }[];
};
