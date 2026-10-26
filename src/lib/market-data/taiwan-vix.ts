import "server-only";

import { mapWithConcurrency } from "@/lib/async-pool";
import { externalReadLimiter } from "@/lib/concurrency-limiter";
import { toLocalDateKey } from "@/lib/date-keys";
import { prisma } from "@/lib/db";
import {
  getCachedBars,
  persistDailyClose,
  startOfLocalDay,
} from "@/lib/market-data/price-cache";
import {
  fetchWithTimeout,
  TAIWAN_VIX_SYMBOL,
  type OhlcBar,
  type QuoteResult,
} from "@/lib/market-data/yahoo-chart";

/** 台灣 VIX（VIXTWN）：Yahoo 沒有，即時值抓期交所 MIS，歷史日收盤抓 bq888。 */

const TAIWAN_VIX_QUOTE_LIST_URL =
  "https://mis.taifex.com.tw/futures/api/getQuoteListVIX";
const TAIWAN_VIX_LIST_URL = "https://www.bq888.taifex.com.tw/cht/7/vixMinNew";

export function isTaiwanVixSymbol(symbol: string): boolean {
  return symbol.trim().toUpperCase() === TAIWAN_VIX_SYMBOL;
}

function parseLatestVixValue(rawText: string): number | null {
  const lines = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const match = lines[i]?.match(/(\d+(?:\.\d+)?)\s*$/);
    if (!match) continue;
    const value = Number(match[1]);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return null;
}

async function fetchTaiwanVixDailyClose(dateKey: string): Promise<number | null> {
  const url = `https://www.bq888.taifex.com.tw/cht/7/getVixData?filesname=${encodeURIComponent(dateKey)}`;
  const res = await fetchWithTimeout(url, { next: { revalidate: 30 } });
  if (!res?.ok) return null;
  const text = await res.text();
  return parseLatestVixValue(text);
}

/** 取得 bq888 上所有可用的 VIXTWN 日期清單（YYYYMMDD 格式，降冪排列） */
async function fetchTaiwanVixAvailableDates(): Promise<string[]> {
  const listRes = await fetchWithTimeout(TAIWAN_VIX_LIST_URL, {
    next: { revalidate: 3600 },
  });
  if (!listRes?.ok) return [];
  const html = await listRes.text();
  return Array.from(
    new Set(
      Array.from(html.matchAll(/getVixData\?filesname=(\d{8})/g)).map(
        (m) => m[1]!,
      ),
    ),
  );
}

/**
 * 抓取 VIXTWN 歷史日收盤並寫入 PriceCache。
 * 只抓 DB 中尚缺少的日期，並行數限制為 8。
 */
export async function syncVixHistory(
  periodStart: Date,
  periodEnd: Date,
): Promise<OhlcBar[]> {
  const startKey = toLocalDateKey(periodStart).replace(/-/g, "");
  const endKey = toLocalDateKey(periodEnd).replace(/-/g, "");

  // 先從 DB 取已有的資料
  const existing = await prisma.priceCache.findMany({
    where: {
      symbol: TAIWAN_VIX_SYMBOL,
      date: { gte: startOfLocalDay(periodStart), lte: startOfLocalDay(periodEnd) },
    },
    orderBy: { date: "asc" },
  });

  const existingKeys = new Set(
    existing.map((r) => toLocalDateKey(r.date).replace(/-/g, "")),
  );

  // 取 bq888 可用日期，篩出範圍內且 DB 缺少的
  const allDates = await fetchTaiwanVixAvailableDates();
  const missing = allDates.filter(
    (d) => d >= startKey && d <= endKey && !existingKeys.has(d),
  );

  // 並行抓取，共用全域對外讀取上限
  await mapWithConcurrency(missing, externalReadLimiter, async (dateKey) => {
    const value = await fetchTaiwanVixDailyClose(dateKey);
    if (value != null && value > 0) {
      persistDailyClose(TAIWAN_VIX_SYMBOL, dateKey, value);
    }
  });

  // 重新從 DB 讀取（含剛寫入的）
  return getCachedBars(TAIWAN_VIX_SYMBOL, periodStart, periodEnd);
}

export async function fetchTaiwanVixQuote(): Promise<QuoteResult | null> {
  const liveRes = await fetchWithTimeout(TAIWAN_VIX_QUOTE_LIST_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ SortColumn: "", AscDesc: "A" }),
    next: { revalidate: 15 },
  });
  if (liveRes?.ok) {
    type TaifexVixItem = {
      SymbolID?: string;
      DispEName?: string;
      CLastPrice?: string;
      CRefPrice?: string;
      CDiff?: string;
      CDiffRate?: string;
    };
    type TaifexVixResponse = {
      RtCode?: string;
      RtData?: { QuoteList?: TaifexVixItem[] };
    };
    try {
      const payload = (await liveRes.json()) as TaifexVixResponse;
      const list = payload.RtData?.QuoteList ?? [];
      const item = list.find((row) => row.SymbolID?.toUpperCase() === "TAIWANVIX");
      if (item?.CLastPrice) {
        const price = Number(item.CLastPrice.replace(/,/g, ""));
        if (Number.isFinite(price) && price > 0) {
          const parseOptionalNumber = (value: string | undefined): number | undefined => {
            if (!value || !value.trim()) return undefined;
            const n = Number(value.replace("%", "").replace(/,/g, ""));
            return Number.isFinite(n) ? n : undefined;
          };
          const ref = parseOptionalNumber(item.CRefPrice);
          const diffRaw = parseOptionalNumber(item.CDiff);
          const diffRateRaw = parseOptionalNumber(item.CDiffRate);
          const change =
            diffRaw !== undefined && Number.isFinite(diffRaw)
              ? diffRaw
              : undefined;
          const changePercent =
            diffRateRaw !== undefined && Number.isFinite(diffRateRaw)
              ? diffRateRaw / 100
              : ref !== undefined && Number.isFinite(ref) && ref > 0
                ? (price - ref) / ref
                : undefined;

          const todayKey = toLocalDateKey(new Date()).replace(/-/g, "");
          persistDailyClose(TAIWAN_VIX_SYMBOL, todayKey, price);
          return {
            symbol: TAIWAN_VIX_SYMBOL,
            name: item.DispEName ?? "TAIWAN VIX",
            price,
            currency: "TWD",
            change,
            changePercent,
          };
        }
      }
    } catch {
      // Fall through to historical file fallback.
    }
  }

  // Fallback source: daily download pages (not realtime).
  const listRes = await fetchWithTimeout(TAIWAN_VIX_LIST_URL, {
    next: { revalidate: 30 },
  });
  if (!listRes?.ok) return null;
  const html = await listRes.text();

  const dates = Array.from(
    new Set(
      Array.from(html.matchAll(/getVixData\?filesname=(\d{8})/g)).map(
        (m) => m[1],
      ),
    ),
  );
  if (dates.length === 0) return null;

  const latest = await fetchTaiwanVixDailyClose(dates[0]!);
  if (latest == null || latest <= 0) return null;

  let change: number | undefined;
  let changePercent: number | undefined;
  if (dates[1]) {
    const previous = await fetchTaiwanVixDailyClose(dates[1]);
    if (previous != null && previous > 0) {
      change = latest - previous;
      changePercent = change / previous;
    }
  }

  return {
    symbol: TAIWAN_VIX_SYMBOL,
    name: "TAIWAN VIX",
    price: latest,
    currency: "TWD",
    change,
    changePercent,
  };
}
