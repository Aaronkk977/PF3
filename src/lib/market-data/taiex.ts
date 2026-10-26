import "server-only";

import { persistDailyClose } from "@/lib/market-data/price-cache";
import { fetchWithTimeout } from "@/lib/market-data/yahoo-chart";

/** 加權指數：Yahoo 的日線 chart 偶爾會漏掉某個交易日（close 為 null），
 *  導致算漲跌幅時誤用更早之前的收盤價當「昨收」。缺口出現時改查證交所
 *  官方「大盤統計資訊」報表校正。 */
const TAIEX_SYMBOL = "^TWII";

export function isTaiexSymbol(symbol: string): boolean {
  return symbol.trim().toUpperCase() === TAIEX_SYMBOL;
}

/** 查證交所官方「大盤統計資訊」報表，取得指定日期的加權指數收盤值 */
export async function fetchTaiexOfficialClose(dateKey: string): Promise<number | null> {
  try {
    const url = `https://www.twse.com.tw/exchangeReport/MI_INDEX?response=json&date=${dateKey}&type=IND`;
    const res = await fetchWithTimeout(url, { next: { revalidate: 3600 } });
    if (!res?.ok) return null;
    const data = (await res.json()) as { tables?: Array<{ data?: string[][] }> };
    const rows = data.tables?.[0]?.data;
    const row = rows?.find((r) => r[0] === "發行量加權股價指數");
    const closeStr = row?.[1];
    if (!closeStr) return null;
    const close = Number(closeStr.replace(/,/g, ""));
    return Number.isFinite(close) && close > 0 ? close : null;
  } catch {
    return null;
  }
}

/** 把校正過的加權指數缺口收盤值補進 PriceCache，避免歷史圖表也留著同一個洞 */
export function persistTaiexGapClose(dateKey: string, close: number): void {
  persistDailyClose(TAIEX_SYMBOL, dateKey, close);
}
