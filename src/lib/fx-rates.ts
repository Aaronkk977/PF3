import { toLocalDateKey } from "@/lib/date-keys";
import { prisma } from "@/lib/db";
import { fetchWithShortTimeout } from "@/lib/http-fetch";

const CACHE_TTL_MS = 60 * 60 * 1000;

const CURRENCY_ALIASES: Record<string, string> = {
  RMB: "CNY",
  CNH: "CNY",
};

export function normalizeCurrencyCode(
  currency: string | null | undefined,
): string {
  const code = (currency ?? "").trim().toUpperCase();
  if (!code) return "TWD";
  return CURRENCY_ALIASES[code] ?? code;
}

function cachePairKey(from: string, to: string): string {
  return `${from}_${to}`;
}

async function readCachedRate(
  from: string,
  to: string,
): Promise<number | null> {
  const cached = await prisma.fxRateCache.findUnique({
    where: { pair: cachePairKey(from, to) },
  });
  if (
    cached &&
    Date.now() - cached.cachedAt.getTime() < CACHE_TTL_MS &&
    cached.rate > 0
  ) {
    return cached.rate;
  }
  return null;
}

async function writeCachedRate(
  from: string,
  to: string,
  rate: number,
): Promise<void> {
  const pair = cachePairKey(from, to);
  await prisma.fxRateCache.upsert({
    where: { pair },
    create: { pair, rate },
    update: { rate, cachedAt: new Date() },
  });
}

/** Yahoo：{from}{to}=X 的 regularMarketPrice = 每 1 from 可換多少 to */
const exchangeRateInFlight = new Map<string, Promise<number | null>>();

async function fetchYahooCrossRate(
  from: string,
  to: string,
): Promise<number | null> {
  const tryPair = async (base: string, quote: string) => {
    const symbol = `${base}${quote}=X`;
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
    const res = await fetchWithShortTimeout(url, { next: { revalidate: 3600 } });
    if (!res?.ok) return null;
    try {
      const data = await res.json();
      const price =
        data?.chart?.result?.[0]?.meta?.regularMarketPrice ??
        data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close?.slice(-1)?.[0];
      return typeof price === "number" && price > 0 ? price : null;
    } catch {
      return null;
    }
  };

  const direct = await tryPair(from, to);
  if (direct) return direct;

  const inverse = await tryPair(to, from);
  if (inverse) return 1 / inverse;

  return null;
}

/**
 * 回傳：每 1 單位 `from` 可換得多少 `to`
 */
export async function getExchangeRate(
  from: string,
  to: string,
): Promise<number | null> {
  const f = normalizeCurrencyCode(from);
  const t = normalizeCurrencyCode(to);
  if (f === t) return 1;

  const cached = await readCachedRate(f, t);
  if (cached) return cached;

  const inFlightKey = `${f}_${t}`;
  const pending = exchangeRateInFlight.get(inFlightKey);
  if (pending) return pending;

  const work = (async () => {
    let rate = await fetchYahooCrossRate(f, t);

    if (rate == null && f !== "USD" && t !== "USD") {
      const toUsd = await getExchangeRate(f, "USD");
      const usdToTarget = await getExchangeRate("USD", t);
      if (toUsd != null && usdToTarget != null) {
        rate = toUsd * usdToTarget;
      }
    }

    if (rate != null && rate > 0) {
      await writeCachedRate(f, t, rate);
      return rate;
    }

    const stale = await prisma.fxRateCache.findUnique({
      where: { pair: cachePairKey(f, t) },
    });
    return stale?.rate ?? null;
  })();

  exchangeRateInFlight.set(inFlightKey, work);
  try {
    return await work;
  } finally {
    exchangeRateInFlight.delete(inFlightKey);
  }
}

/** 從 Yahoo 日線取最接近指定日期的收盤匯率 */
async function fetchYahooHistoricalRate(
  from: string,
  to: string,
  targetDateKey: string,
  periodStartSec: number,
  periodEndSec: number,
): Promise<number | null> {
  const pairs =
    from === "USD" && to === "TWD"
      ? ["USDTWD=X", "TWDUSD=X"]
      : [`${from}${to}=X`, `${to}${from}=X`];

  for (const symbol of pairs) {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&period1=${periodStartSec}&period2=${periodEndSec}`;
    const res = await fetchWithShortTimeout(url, { next: { revalidate: 3600 } }, 6_000);
    if (!res?.ok) continue;
    try {
      const data = await res.json();
      const result = data?.chart?.result?.[0];
      const timestamps: number[] = result?.timestamp ?? [];
      const closes: number[] =
        result?.indicators?.quote?.[0]?.close ?? [];
      if (!timestamps.length || !closes.length) continue;

      let bestRate: number | null = null;
      let bestDist = Infinity;
      const targetMs = new Date(`${targetDateKey}T12:00:00`).getTime();

      for (let i = 0; i < timestamps.length; i++) {
        const close = closes[i];
        if (typeof close !== "number" || close <= 0) continue;
        const dateKey = toLocalDateKey(new Date(timestamps[i]! * 1000));
        const dist = Math.abs(
          new Date(`${dateKey}T12:00:00`).getTime() - targetMs,
        );
        const rate =
          symbol.startsWith("TWD") && symbol.includes("USD")
            ? 1 / close
            : close;
        if (dist < bestDist) {
          bestDist = dist;
          bestRate = rate;
        }
      }
      if (bestRate != null && bestRate > 0) return bestRate;
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * 指定日期的交叉匯率（每 1 from = ? to）
 * 若無歷史資料則退回即期匯率
 */
export async function getExchangeRateOnDate(
  from: string,
  to: string,
  date: Date,
): Promise<number | null> {
  const f = normalizeCurrencyCode(from);
  const t = normalizeCurrencyCode(to);
  if (f === t) return 1;

  const stale = await prisma.fxRateCache.findUnique({
    where: { pair: cachePairKey(f, t) },
  });
  if (stale?.rate && stale.rate > 0) {
    // 先備用快取，避免歷史 API 連線逾時時整頁卡住
    const targetKey = toLocalDateKey(date);
    const period1 = Math.floor(date.getTime() / 1000) - 21 * 86400;
    const period2 = Math.floor(date.getTime() / 1000) + 86400;

    const historical = await fetchYahooHistoricalRate(
      f,
      t,
      targetKey,
      period1,
      period2,
    );
    if (historical != null && historical > 0) return historical;
    return stale.rate;
  }

  const targetKey = toLocalDateKey(date);
  const period1 = Math.floor(date.getTime() / 1000) - 21 * 86400;
  const period2 = Math.floor(date.getTime() / 1000) + 86400;

  const historical = await fetchYahooHistoricalRate(
    f,
    t,
    targetKey,
    period1,
    period2,
  );
  if (historical != null && historical > 0) return historical;

  return getExchangeRate(f, t);
}
