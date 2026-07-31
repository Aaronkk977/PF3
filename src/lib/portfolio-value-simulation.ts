/** 投資組合價值時間序列的「純計算核心」——刻意不 import yahoo.ts／
 *  portfolio-history.ts，只依賴 fx.ts（幣別換算）跟純資料結構，這樣才能在
 *  node:test 底下直接單元測試，不用被 yahoo-finance2 的套件匯出設定或
 *  "server-only" 這種只有 Next.js bundler 認得的特殊 import 卡住。真正的
 *  I/O（抓歷史價、即時報價）由呼叫端（portfolio-value-series.ts）注入。 */
import { toBaseCurrency } from "@/lib/fx";
import { toLocalDateKey } from "@/lib/date-keys";
import type { PortfolioValueEndState } from "@/lib/portfolio-value-cache";

export type TxRow = {
  date: Date;
  type: string;
  quantity: unknown;
  price: unknown;
  fee: unknown;
  tax: unknown;
  accountId: string;
  account: { currency: string };
  instrument: { symbol: string; currency: string | null } | null;
};

export type SeriesContext = {
  allTxs: TxRow[];
  allowedAccountIds: Set<string>;
  accountCurrencies: Map<string, string>;
  currencyBySymbol: Map<string, string | null>;
  usdRate: number;
};

/** 注入的即時報價來源；回傳的 Map 裡每個標的至少要有 price 欄位。 */
export type LiveQuoteFetcher = (
  symbols: string[],
) => Promise<Map<string, { price?: number }>>;

function toNumber(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  if (typeof v === "object" && "toNumber" in (v as Record<string, unknown>)) {
    return (v as { toNumber: () => number }).toNumber();
  }
  return Number(v) || 0;
}

export function applyCashToAccount(
  cashByAccount: Map<string, number>,
  tx: TxRow,
): void {
  const qty = toNumber(tx.quantity);
  const price = toNumber(tx.price);
  const fee = toNumber(tx.fee);
  const tax = toNumber(tx.tax);
  const gross = qty * price;
  const cur = cashByAccount.get(tx.accountId) ?? 0;

  switch (tx.type) {
    case "DEPOSIT":
      cashByAccount.set(tx.accountId, cur + gross);
      break;
    case "WITHDRAWAL":
      cashByAccount.set(tx.accountId, cur - gross);
      break;
    case "BUY":
      cashByAccount.set(tx.accountId, cur - gross - fee - tax);
      break;
    case "SELL":
      cashByAccount.set(tx.accountId, cur + gross - fee - tax);
      break;
    case "DIVIDEND":
      cashByAccount.set(tx.accountId, cur + gross);
      break;
  }
}

export function applySecurityPosition(
  positions: Map<string, number>,
  tx: TxRow,
): void {
  if (!tx.instrument) return;
  const symbol = tx.instrument.symbol;
  const qty = toNumber(tx.quantity);

  if (tx.type === "BUY") {
    positions.set(symbol, (positions.get(symbol) ?? 0) + qty);
  } else if (tx.type === "SELL") {
    const next = (positions.get(symbol) ?? 0) - qty;
    if (next <= 0.0000001) positions.delete(symbol);
    else positions.set(symbol, next);
  }
}

export async function sumCashInBase(
  cashByAccount: Map<string, number>,
  currencies: Map<string, string>,
  usdRate: number,
): Promise<number> {
  let total = 0;
  for (const [accountId, balance] of cashByAccount) {
    const currency = currencies.get(accountId) ?? "TWD";
    if (currency === "TWD" || !currency) {
      total += balance;
    } else if (currency === "USD") {
      total += balance * usdRate;
    } else {
      total += await toBaseCurrency(balance, currency);
    }
  }
  return total;
}

export function calendarDateKeys(periodStart: Date, periodEnd: Date): string[] {
  const keys: string[] = [];
  const cursor = new Date(periodStart);
  cursor.setHours(0, 0, 0, 0);
  const end = new Date(periodEnd);
  end.setHours(23, 59, 59, 999);

  while (cursor <= end) {
    keys.push(toLocalDateKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return keys;
}

export function forwardFillPrices(
  bars: { date: string; close: number }[],
  periodStart: Date,
  periodEnd: Date,
  seedPrice?: number,
): Map<string, number> {
  const byDate = new Map(bars.map((b) => [b.date, b.close]));
  const result = new Map<string, number>();

  const cursor = new Date(periodStart);
  cursor.setHours(0, 0, 0, 0);
  const end = new Date(periodEnd);
  end.setHours(23, 59, 59, 999);
  const periodStartKey = toLocalDateKey(cursor);

  const beforeStart = bars
    .filter((b) => b.date < periodStartKey && b.close > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  let lastPrice: number | null =
    seedPrice !== undefined && seedPrice > 0
      ? seedPrice
      : beforeStart.length > 0
        ? beforeStart[beforeStart.length - 1]!.close
        : null;

  while (cursor <= end) {
    const key = toLocalDateKey(cursor);
    if (byDate.has(key)) {
      lastPrice = byDate.get(key)!;
    }
    if (lastPrice !== null && lastPrice > 0) {
      result.set(key, lastPrice);
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  return result;
}

/** 走勢圖第一個點如果比第二個點小超過一半，通常是期初當天部分持股還沒
 *  進場、估值失真造成的異常低點，直接丟掉比較不會誤導使用者。 */
export function trimAnomalousLeadingPoint(
  points: { date: string; value: number }[],
): { date: string; value: number }[] {
  if (points.length < 2) return points;
  const first = points[0]!.value;
  const second = points[1]!.value;
  if (second > 0 && first < second * 0.5) {
    return points.slice(1);
  }
  return points;
}

export function mapFromRecord(rec: Record<string, number>): Map<string, number> {
  return new Map(Object.entries(rec));
}

export function recordFromMap(map: Map<string, number>): Record<string, number> {
  return Object.fromEntries(map);
}

export function nextDateKey(dateStr: string): string {
  const d = new Date(dateStr);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 1);
  return toLocalDateKey(d);
}

/**
 * 逐日回放交易、算出每天的投資組合總市值。
 *
 * 兩個關鍵設計（都曾經是實際發生過的 bug）：
 * 1. 當天持股「部分」缺價時不整天跳過——只有「全部」持股都缺價且現金也是 0
 *    才跳過。舊版本一度改成「只要有一檔缺價就跳過整天」，會讓走勢圖中段
 *    無故消失一大截。
 * 2. 只有「今天」這個資料點缺價時才會去打即時報價補洞（歷史日期缺價就是
 *    真的缺價，不該為了補歷史資料狂打報價 API）；同一天內多檔標的都缺價，
 *    只會批次打一次，不會每個標的各打一次。
 */
export async function simulateValueDays(
  ctx: SeriesContext,
  dateKeys: string[],
  initial: {
    txIdx: number;
    positions: Map<string, number>;
    cashByAccount: Map<string, number>;
  },
  priceBySymbol: Map<string, Map<string, number>>,
  deps?: { fetchLiveQuotes?: LiveQuoteFetcher; today?: string },
): Promise<{
  points: { date: string; value: number }[];
  endState: PortfolioValueEndState;
}> {
  const positions = new Map(initial.positions);
  const cashByAccount = new Map(initial.cashByAccount);
  let txIdx = initial.txIdx;
  const points: { date: string; value: number }[] = [];
  const lastPriceBySymbol: Record<string, number> = {};
  const todayKey = deps?.today ?? toLocalDateKey(new Date());
  let liveQuotesCache: Map<string, { price?: number }> | null = null;

  for (const dateStr of dateKeys) {
    while (txIdx < ctx.allTxs.length) {
      const tx = ctx.allTxs[txIdx]!;
      const txDay = toLocalDateKey(tx.date);
      if (txDay > dateStr) break;
      if (ctx.allowedAccountIds.has(tx.accountId)) {
        applyCashToAccount(cashByAccount, tx);
        applySecurityPosition(positions, tx);
      }
      txIdx++;
    }

    const cashTotal = await sumCashInBase(
      cashByAccount,
      ctx.accountCurrencies,
      ctx.usdRate,
    );

    const held = [...positions.entries()].filter(([, qty]) => qty > 0);
    let securitiesValue = 0;

    for (const [symbol, qty] of held) {
      let price = priceBySymbol.get(symbol)?.get(dateStr);
      if ((price === undefined || price <= 0) && dateStr === todayKey && deps?.fetchLiveQuotes) {
        if (!liveQuotesCache) {
          liveQuotesCache = await deps.fetchLiveQuotes([...positions.keys()]);
        }
        const live = liveQuotesCache.get(symbol)?.price;
        if (live != null && live > 0) price = live;
      }
      if (price !== undefined && price > 0) {
        const fx = ctx.currencyBySymbol.get(symbol) === "USD" ? ctx.usdRate : 1;
        securitiesValue += qty * price * fx;
        lastPriceBySymbol[symbol] = price;
      }
    }

    // 只在「完全沒東西可以計價值」時才跳過這天——不要另外用「持股全部缺價」
    // 當跳過條件：那樣即使當天有現金也會被硬跳過，等於平白丟掉一個其實還有
    // 意義的資料點（原本的用意是避免走勢圖中段消失，結果反而製造了同一種
    // 問題的另一個變形）。total<=0 已經足以擋掉「真的什麼都沒有」的情況。
    const total = securitiesValue + Math.max(0, cashTotal);
    if (total <= 0) continue;

    points.push({ date: dateStr, value: total });
  }

  const lastDate =
    dateKeys.length > 0 ? dateKeys[dateKeys.length - 1]! : initial.txIdx.toString();

  return {
    points,
    endState: {
      date: points.length > 0 ? points[points.length - 1]!.date : lastDate,
      txIdx,
      positions: recordFromMap(positions),
      cashByAccount: recordFromMap(cashByAccount),
      lastPriceBySymbol,
    },
  };
}
