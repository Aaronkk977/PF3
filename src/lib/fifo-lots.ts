/**
 * FIFO 批次（lot）的共用核心：買進一筆就是一批，賣出從最早買進的批次開始扣，
 * 股息從最早的批次開始沖減成本。只負責「數量／成本怎麼配對」，不管幣別換算、
 * 手續費要不要算進成本、哪些交易算在期間內——那些各報表的口徑不同，由呼叫端
 * 決定後把換算好的金額傳進來。
 *
 * 使用者：instrument-pnl（單一標的損益）、performance-realized-pnl（分析頁已實現）、
 * trades-report（交易檢討頁）、metrics（交易統計）。
 */

export type FifoLot = {
  qty: number;
  costBase: number;
  buyDate?: Date;
};

/** 批次剩餘數量低於這個值就視為賣光（零股小數運算的誤差） */
export const LOT_QTY_EPSILON = 0.0000001;

export type FifoSlice = {
  qty: number;
  costBase: number;
  buyDate?: Date;
};

export type FifoMatch = {
  matchedQty: number;
  matchedCostBase: number;
  /** 這次賣出各自扣到哪幾批、各扣多少；算持有天數等需要逐批資訊時用 */
  slices: FifoSlice[];
};

/** 從最早的批次開始扣掉 qty，原地修改 lots。批次不夠扣時只扣到有的部分
 *  （matchedQty 會小於 qty），不會產生負數批次。 */
export function consumeFifoLots<L extends FifoLot>(
  lots: L[],
  qty: number,
): FifoMatch {
  let remaining = qty;
  let matchedQty = 0;
  let matchedCostBase = 0;
  const slices: FifoSlice[] = [];

  while (remaining > 0 && lots.length > 0) {
    const lot = lots[0]!;
    const used = Math.min(remaining, lot.qty);
    const sliceCost = lot.qty > 0 ? (lot.costBase / lot.qty) * used : 0;
    matchedQty += used;
    matchedCostBase += sliceCost;
    slices.push({ qty: used, costBase: sliceCost, buyDate: lot.buyDate });
    lot.costBase -= sliceCost;
    lot.qty -= used;
    remaining -= used;
    if (lot.qty <= LOT_QTY_EPSILON) lots.shift();
  }

  return { matchedQty, matchedCostBase, slices };
}

/** 股息沖減成本：從最早的批次開始扣，每批最多扣到成本歸零，原地修改 lots。 */
export function reduceFifoLotsCost(lots: FifoLot[], amount: number): void {
  let remaining = amount;
  for (const lot of lots) {
    if (remaining <= 0) break;
    const cut = Math.min(lot.costBase, remaining);
    lot.costBase -= cut;
    remaining -= cut;
  }
}

export function sumFifoLots(lots: readonly FifoLot[]): {
  quantity: number;
  costBase: number;
} {
  let quantity = 0;
  let costBase = 0;
  for (const lot of lots) {
    quantity += lot.qty;
    costBase += lot.costBase;
  }
  return { quantity, costBase };
}
