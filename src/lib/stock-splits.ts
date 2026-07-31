import "server-only";

import { mapWithConcurrency } from "@/lib/async-pool";
import { dbWriteLimiter } from "@/lib/concurrency-limiter";
import { prisma } from "@/lib/db";
import { invalidatePerformanceCache } from "@/lib/performance-cache";
import { fetchSplitEvents } from "@/lib/yahoo";
import { parseCalendarDate, toLocalDateKey } from "@/lib/date-keys";
import { isTaiwanStockSymbol } from "@/lib/market-utils";
import { toNumber } from "@/lib/utils";

const COOLDOWN_MS = 24 * 60 * 60 * 1000;
/** 分割比例化簡後，分子/分母任一方超過這個值就視為不像真正的分割設計 */
const MAX_RATIO_TERM = 25;
/** 真正的股票分割幅度會明顯偏離 1:1（最小型的大概是 5:4），用這個門檻濾掉
 *  幅度太小、太接近 1:1 的比例 */
const MIN_RATIO_DEVIATION = 1.2;

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/**
 * Yahoo 對股票的 `events.splits` 除了真正的股票分割，還會把股利/減資造成的
 * 還原係數也塞進同一個欄位（實測台股尤其嚴重，例如 2330.TW 曾出現
 * "1.005:1"、2408.TW 曾出現 "0.100084:1" 這種幅度不小但完全不是真分割的
 * 「調整比例」）。真正的分割永遠是公司董事會決議的簡單整數比（2:1、3:1、
 * 4:1、1:10…），這裡只接受化簡後分子分母都是小整數、且幅度明顯偏離 1:1 的比例，
 * 其餘一律當雜訊跳過，不套用到任何交易上。
 */
function isGenuineSplitRatio(numerator: number, denominator: number): boolean {
  if (!Number.isInteger(numerator) || !Number.isInteger(denominator)) return false;
  if (numerator <= 0 || denominator <= 0) return false;
  const g = gcd(numerator, denominator);
  const n = numerator / g;
  const d = denominator / g;
  if (n > MAX_RATIO_TERM || d > MAX_RATIO_TERM || n === d) return false;
  const ratio = n / d;
  return ratio >= MIN_RATIO_DEVIATION || ratio <= 1 / MIN_RATIO_DEVIATION;
}

/** 四捨五入到指定小數位，避免分割換算後留下浮點雜訊 */
function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** 只處理真正的股票分割。美股券商本來就接受破碎股（fractional shares），
 *  分割後的零碎股數留著就好，不需要折算現金——台股配股才有畸零股折現的慣例，
 *  而配股已經改成不自動處理、由使用者自行輸入，所以這裡不再有那條路徑。 */
async function applySplit(
  instrumentId: string,
  symbol: string,
  splitDate: Date,
  numerator: number,
  denominator: number,
): Promise<void> {
  let applied = false;
  await prisma.$transaction(async (tx) => {
    const already = await tx.split.findUnique({
      where: { instrumentId_splitDate: { instrumentId, splitDate } },
    });
    if (already) return;
    applied = true;

    const affected = await tx.transaction.findMany({
      where: {
        instrumentId,
        date: { lte: splitDate },
        type: { in: ["BUY", "SELL", "DIVIDEND"] },
      },
      select: { id: true, quantity: true, price: true },
      orderBy: { date: "asc" },
    });

    for (const row of affected) {
      const quantity = round((toNumber(row.quantity) * numerator) / denominator, 6);
      const price = round((toNumber(row.price) * denominator) / numerator, 4);
      await tx.transaction.update({
        where: { id: row.id },
        data: { quantity, price },
      });
    }

    await tx.split.create({
      data: { instrumentId, splitDate, numerator, denominator },
    });

    console.log(
      `[stock-splits] applied ${numerator}:${denominator} split for ${symbol} on ${toLocalDateKey(splitDate)} (${affected.length} transactions adjusted)`,
    );
  });

  // 分割會直接改寫歷史交易的 quantity/price，繞過一般新增/編輯交易的 API，
  // 不會自動觸發那邊的快取清除，這裡要自己補一次，不然分析頁的市值序列
  // 快取會繼續沿用分割前的舊數字。
  if (applied) {
    await invalidatePerformanceCache().catch((e) =>
      console.error("[stock-splits] cache invalidation failed", e),
    );
  }
}

async function checkInstrumentViaYahoo(instrument: { id: string; symbol: string }): Promise<void> {
  try {
    const events = await fetchSplitEvents(instrument.symbol);
    for (const event of events) {
      if (!isGenuineSplitRatio(event.numerator, event.denominator)) continue;
      const splitDate = parseCalendarDate(toLocalDateKey(event.date));
      await applySplit(
        instrument.id,
        instrument.symbol,
        splitDate,
        event.numerator,
        event.denominator,
      );
    }
  } catch (e) {
    console.error(`[stock-splits] sync failed for ${instrument.symbol}`, e);
  } finally {
    await prisma.instrument
      .update({
        where: { id: instrument.id },
        data: { splitsCheckedAt: new Date() },
      })
      .catch(() => {});
  }
}

/**
 * 檢查有交易紀錄的股票是否發生過**股票分割**，偵測到就直接改寫該分割日之前的
 * 歷史交易（quantity ×= numerator/denominator，price ×= denominator/numerator），
 * 讓全站所有直接讀 Transaction 的地方（持股試算、損益、CSV 匯出、MCP 工具…）
 * 不用另外處理調整係數就能拿到正確數字。24 小時冷卻避免每次都打外部 API。
 *
 * 只處理美股／非台股，資料來自 Yahoo 的 `events.splits`，而且只接受化簡後是
 * 小整數、幅度明顯偏離 1:1 的乾淨比例（見 isGenuineSplitRatio）——實測發現
 * Yahoo 對台股這欄位常把股利、減資調整也算進來，且幅度會跟真分割重疊到無法用
 * 比例大小可靠區分，貿然套用會把真實歷史交易改錯，所以台股不走這條路。
 *
 * 配股／配息（盈餘或公積轉增資造成股數變多）一律**不自動處理**，由使用者自己
 * 輸入交易——這是刻意的決定：它跟真正的股票分割不同，券商對帳單本來就會各自
 * 列出，自動改寫舊交易反而容易跟使用者已經記過的那筆重複計算。台股（.TW／
 * .TWO）因此完全不在自動處理範圍內。
 */
export async function syncSplitsForHeldInstruments(): Promise<void> {
  const rawCandidates = await prisma.instrument.findMany({
    where: {
      assetClass: "stock",
      transactions: { some: { type: { in: ["BUY", "SELL"] } } },
      OR: [
        { splitsCheckedAt: null },
        { splitsCheckedAt: { lt: new Date(Date.now() - COOLDOWN_MS) } },
      ],
    },
    select: { id: true, symbol: true },
  });

  const usCandidates = rawCandidates.filter((i) => !isTaiwanStockSymbol(i.symbol));

  // low 優先權：這是開機維護排程觸發的背景工作，真正在等頁面資料的請求
  // 應該優先拿到 dbWriteLimiter 的名額。
  await mapWithConcurrency(usCandidates, dbWriteLimiter, checkInstrumentViaYahoo, {
    priority: "low",
  });
}
