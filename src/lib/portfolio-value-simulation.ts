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
  // 起點前的真實 K 線優先，seed 只在回溯區間完全抓不到價時才用：seed 來自
  // 快取 endState.lastPriceBySymbol，很可能是上一次跑在盤中時記下的即時價，
  // 讓它蓋過已經收盤的正式 close，會把盤中價一路往後前向填充。
  let lastPrice: number | null =
    beforeStart.length > 0
      ? beforeStart[beforeStart.length - 1]!.close
      : seedPrice !== undefined && seedPrice > 0
        ? seedPrice
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
 * 2. 只有「今天」這個資料點才會去打即時報價（歷史日期缺價就是真的缺價，
 *    不該為了補歷史資料狂打報價 API）；同一天內多檔標的都要報價，只會批次
 *    打一次，不會每個標的各打一次。
 *
 * 今天的價格判斷：priceBySymbol 是前向填充過的，今天就算 Yahoo 還沒給
 * 今天那根 K 線（盤前、假日，或盤中回 close:null），也會被填上前一天的
 * close——光看「有沒有價格」分不出來。所以另外由 todayBarSymbols 標出
 * 「今天真的有 K 線」的標的：有就用 K 線；沒有就打即時報價；報價失敗或
 * 為 0 再退回前向填充的價格，不讓今天整檔變成 0。
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
  deps?: {
    fetchLiveQuotes?: LiveQuoteFetcher;
    today?: string;
    /** 今天有真實 K 線（非前向填充）的標的；未提供時視為都沒有 */
    todayBarSymbols?: Set<string>;
  },
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
      if (
        dateStr === todayKey &&
        deps?.fetchLiveQuotes &&
        !deps.todayBarSymbols?.has(symbol)
      ) {
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

  // endState 的持倉／現金／txIdx 是「最後一個模擬日」結束時的狀態，date 必須
  // 對上同一天——不能用最後一個有點的日期：尾端若有幾天 total<=0 被跳過，
  // 兩者會錯開，增量續算時就會拿較晚的持倉去重算較早的日子。
  const lastDate =
    dateKeys.length > 0 ? dateKeys[dateKeys.length - 1]! : "";

  return {
    points,
    endState: {
      date: lastDate,
      txIdx,
      positions: recordFromMap(positions),
      cashByAccount: recordFromMap(cashByAccount),
      lastPriceBySymbol,
    },
  };
}
