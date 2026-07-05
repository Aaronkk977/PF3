/** 常見以 USD 計價的加密貨幣代號（含無 -USD 後綴的持倉） */

const CRYPTO_BASE_SYMBOLS = new Set([

  "ADA",

  "AVAX",

  "BNB",

  "BTC",

  "DOGE",

  "DOT",

  "ETH",

  "LINK",

  "MATIC",

  "SOL",

  "XRP",

]);



export type HoldingMarketBucket = "tw" | "us" | "crypto" | "other";



export function isCryptoSymbol(symbol: string): boolean {

  const s = symbol.trim().toUpperCase();

  if (!s) return false;

  if (s.includes("-USD") || s.includes("-USDT")) return true;

  const base = s.split("-")[0] ?? s;

  return CRYPTO_BASE_SYMBOLS.has(s) || CRYPTO_BASE_SYMBOLS.has(base);

}



export function isCryptoMarket(h: {

  symbol: string;

  assetClass?: string | null;

}): boolean {

  return h.assetClass === "crypto" || isCryptoSymbol(h.symbol);

}



export function isTaiwanMarket(h: {

  symbol: string;

  currency: string | null;

}): boolean {

  const s = h.symbol.toUpperCase();

  return s.endsWith(".TW") || s.endsWith(".TWO") || h.currency === "TWD";

}



export function isUsStockMarket(h: {

  symbol: string;

  currency: string | null;

  assetClass?: string | null;

}): boolean {

  if (isTaiwanMarket(h) || isCryptoMarket(h)) return false;

  if (h.assetClass === "index") return false;

  return true;

}



export function isUsMarket(h: {

  symbol: string;

  currency: string | null;

  assetClass?: string | null;

}): boolean {

  return isUsStockMarket(h);

}



export function getHoldingMarketBucket(h: {

  symbol: string;

  currency: string | null;

  assetClass?: string | null;

}): HoldingMarketBucket {

  if (isTaiwanMarket(h)) return "tw";

  if (isCryptoMarket(h)) return "crypto";

  if (h.assetClass === "index") return "other";

  return "us";

}



/** 台股代號（含 4 碼無後綴） */

export function isTaiwanStockSymbol(symbol: string): boolean {

  const s = symbol.trim().toUpperCase();

  return s.endsWith(".TW") || s.endsWith(".TWO") || /^\d{4}$/.test(s);

}



/** 漲跌幅統一為小數（0.1 = 10%）；相容 Yahoo 百分比格式 */

export function normalizeChangePercentDecimal(

  changePct: number | null | undefined,

): number | null {

  if (changePct == null || !Number.isFinite(changePct)) return null;

  const abs = Math.abs(changePct);

  if (abs > 0.2) return changePct / 100;

  return changePct;

}



/** 台股現貨升降單位（依該筆價格所屬級距） */
export function getTaiwanTickSize(price: number): number {
  const p = Math.abs(price);
  if (p < 10) return 0.01;
  if (p < 50) return 0.05;
  if (p < 100) return 0.1;
  if (p < 500) return 0.5;
  if (p < 1000) return 1;
  return 5;
}

function floorToTaiwanTick(value: number, tick: number): number {
  if (tick <= 0) return value;
  return Math.floor(value / tick + 1e-9) * tick;
}

function ceilToTaiwanTick(value: number, tick: number): number {
  if (tick <= 0) return value;
  const q = Math.floor(value / tick);
  const remainder = value - q * tick;
  return remainder > 1e-9 ? (q + 1) * tick : q * tick;
}

/**
 * 台股漲停價：理論值 = 昨收 × (1 + limitPct)，tick 取「理論漲停價」級距，再向下捨去（不得超過漲幅）。
 * 例：昨收 46.5 → 理論 51.15 → tick 0.1 → 漲停 51.1
 */
export function computeTaiwanLimitUpPrice(
  prevClose: number,
  limitPct = 0.1,
): number {
  const rawUp = prevClose * (1 + limitPct);
  const tick = getTaiwanTickSize(rawUp);
  return floorToTaiwanTick(rawUp, tick);
}

/**
 * 台股跌停價：理論值 = 昨收 × (1 - limitPct)，tick 取「理論跌停價」級距，再向上進位（不得跌穿跌幅）。
 */
export function computeTaiwanLimitDownPrice(
  prevClose: number,
  limitPct = 0.1,
): number {
  const rawDown = prevClose * (1 - limitPct);
  const tick = getTaiwanTickSize(rawDown);
  return ceilToTaiwanTick(rawDown, tick);
}

/** 成交價依該價格級距四捨五入 */
export function roundToTaiwanTick(price: number, refPrice?: number): number {
  const tick = getTaiwanTickSize(refPrice ?? price);
  return Math.round(price / tick) * tick;
}

/**
 * 台股適用漲跌幅。
 * 一般上市/上櫃皆為 10%；5% 限制標的需透過明確的外部資料才能判斷，
 * 無法從當天漲幅反推（若漲幅碰巧在 ~5% 會造成誤判），故固定回傳 10%。
 */
export function inferTaiwanLimitPercent(): number {
  return 0.1;
}

function actualLimitUpPercent(prevClose: number, limitPct: number): number {
  const limitPrice = computeTaiwanLimitUpPrice(prevClose, limitPct);
  return (limitPrice - prevClose) / prevClose;
}

function isPriceAtTaiwanLimitUp(
  price: number,
  prevClose: number,
  limitPct: number,
): boolean {
  if (price <= 0 || prevClose <= 0) return false;
  const limitPrice = computeTaiwanLimitUpPrice(prevClose, limitPct);
  const tick = getTaiwanTickSize(limitPrice);
  return Math.abs(price - limitPrice) <= tick / 2;
}

function isPctAtTaiwanLimitUp(
  changePct: number,
  prevClose: number,
  limitPct: number,
): boolean {
  const actual = actualLimitUpPercent(prevClose, limitPct);
  const tick = getTaiwanTickSize(computeTaiwanLimitUpPrice(prevClose, limitPct));
  const tol = prevClose > 0 ? tick / prevClose / 2 : 0.001;
  return Math.abs(changePct - actual) <= tol;
}

export type TaiwanLimitUpContext = {
  price?: number | null;
  prevClose?: number | null;
};

/**
 * 台股漲停：收盤價須等於漲停價（tick 容差內）。
 * 有現價時僅比對價格；無現價時才以漲幅是否等於漲停價對應之實際漲幅判定。
 */
export function isTaiwanLimitUp(
  symbol: string,
  changePct: number | null | undefined,
  context?: TaiwanLimitUpContext,
): boolean {
  if (!isTaiwanStockSymbol(symbol)) return false;

  const pct = normalizeChangePercentDecimal(changePct);
  const price = context?.price;
  const prevClose = context?.prevClose;

  if (prevClose == null || prevClose <= 0) return false;

  const limitPct = inferTaiwanLimitPercent();

  if (price != null && price > 0) {
    return isPriceAtTaiwanLimitUp(price, prevClose, limitPct);
  }

  if (pct != null) {
    return isPctAtTaiwanLimitUp(pct, prevClose, limitPct);
  }

  return false;
}

/** 以昨收與漲跌幅校正台股現價（避免 Yahoo 殘留盤中漲停價） */
export function reconcileTaiwanQuoteFromPreviousClose(
  quote: {
    price: number;
    change?: number | null;
    changePercent?: number | null;
  },
  prevClose: number,
): { price: number; change: number; changePercent: number } {
  let pct = normalizeChangePercentDecimal(quote.changePercent ?? undefined);
  if (pct == null && quote.change != null && Number.isFinite(quote.change)) {
    pct = quote.change / prevClose;
  }
  if (pct != null) {
    const implied = prevClose * (1 + pct);
    const price = roundToTaiwanTick(implied, implied);
    const change = price - prevClose;
    return { price, change, changePercent: change / prevClose };
  }
  const price = roundToTaiwanTick(quote.price, quote.price);
  const change = price - prevClose;
  return { price, change, changePercent: prevClose > 0 ? change / prevClose : 0 };
}


