import "server-only";

import { mapWithConcurrency } from "@/lib/async-pool";
import { externalReadLimiter } from "@/lib/concurrency-limiter";
import {
  getDayChangeFromCache,
  getLatestCachedClose,
  getWeekChangeFromCache,
} from "@/lib/market-data/price-cache";
import {
  fetchTaiexOfficialClose,
  isTaiexSymbol,
  persistTaiexGapClose,
} from "@/lib/market-data/taiex";
import { isCustomSeriesSymbol, isTaiwanMarginSymbol } from "@/lib/custom-series-symbols";
import { fetchTaiwanMarginQuote } from "@/lib/market-data/taiwan-margin";
import { fetchTaiwanVixQuote, isTaiwanVixSymbol } from "@/lib/market-data/taiwan-vix";
import {
  computeChangeFromBars,
  extractYahooPrice,
  fetchChart,
  fetchChartSnapshot,
  getDayChangeFromChart,
  getLatestCloseFromChart,
  getWeekChangeViaRangeApi,
  normalizeYahooChangePercent,
  resolveYahooQuoteSymbol,
  TAIWAN_VIX_SYMBOL,
  weekChangeFromBars,
  yahooQuote,
  type QuoteResult,
} from "@/lib/market-data/yahoo-chart";
import {
  isTaiwanStockSymbol,
  reconcileTaiwanQuoteFromPreviousClose,
} from "@/lib/market-utils";

/** 即時報價：整合 Yahoo chart／.quote()、台灣 VIX、加權指數校正與 PriceCache
 *  備援，決定「該用哪個來源」。HTTP 與資料庫細節在 market-data/ 底下。
 *  既有呼叫端都 import 這個檔案，所以把 market-data 的公開 API 一併轉出。 */

export {
  computePeriodChangePercent,
  fetchSplitEvents,
  inferAssetClass,
  normalizeYahooChangePercent,
  resolveYahooQuoteSymbol,
  type OhlcBar,
  type QuoteResult,
  type SplitEvent,
} from "@/lib/market-data/yahoo-chart";
export { getHistoricalPrices } from "@/lib/market-data/price-history";
export { syncVixHistory } from "@/lib/market-data/taiwan-vix";

/**
 * 不需要 crumb 的即時報價：價格／名稱／幣別／漲跌全部來自單一 chart 端點請求
 * （不受 .quote() 的 crumb 限流影響）。當作 getQuote 的主要資料來源，
 * .quote() 只在這條路失敗時當備援用。
 */
async function getLiveQuoteFromChart(symbol: string): Promise<QuoteResult | null> {
  const primary = resolveYahooQuoteSymbol(symbol);
  let snapshot = await fetchChartSnapshot(primary);
  if (
    (!snapshot || snapshot.bars.length === 0) &&
    primary !== symbol.trim() &&
    !symbol.includes("-")
  ) {
    snapshot = await fetchChartSnapshot(symbol.trim());
  }
  if (!snapshot) return null;

  let dayChange = computeChangeFromBars(snapshot.bars);
  let price = dayChange?.price ?? snapshot.meta?.price;
  if (!price || price <= 0) return null;

  // Yahoo 的日線 K 棒收盤值有時會比 meta.regularMarketPrice 慢好幾個小時才
  // 補齊——尤其台股收盤後到隔天凌晨這段時間，常常已經查得到「今天」這根
  // K 棒的時間戳記，但 close 欄位還是 null（latestBarPending），於是
  // computeChangeFromBars 只能拿「前一天 vs 前兩天」這組舊資料算漲跌，等於
  // 把漲跌幅算成整整多一個交易日的落差（實測看過因此把 -1% 左右的正常波動
  // 算成快要漲停的離譜數字）。這種情況才改用 meta 的即時價格當現價、K 棒的
  // 價格當昨收，重新算一次漲跌。
  //
  // 這裡刻意不是「meta 跟 K 棒價格對不上就換」——美股盤中 Yahoo 會把「今天」
  // 這根還沒收盤的 K 棒即時更新到幾乎等於 meta（只差浮點誤差），若用價格差
  // 當判斷依據，會把這點誤差誤判成「K 棒落後」，結果把本來就是今天的 K 棒
  // 錯當成昨天，拿今天的即時價跟自己相減，把真正的當日漲跌洗成 0%。
  // latestBarPending 是 Yahoo 明確告訴我們「最新這格是 null」的訊號，不受
  // 這種盤中即時更新的雜訊影響。
  if (dayChange && snapshot.latestBarPending && snapshot.meta?.price != null && snapshot.meta.price > 0) {
    const metaPrice = snapshot.meta.price;
    const prevClose = dayChange.price;
    const change = metaPrice - prevClose;
    dayChange = {
      price: metaPrice,
      change,
      changePercent: prevClose > 0 ? change / prevClose : 0,
    };
    price = metaPrice;
  }

  if (isTaiexSymbol(symbol) && snapshot.gapDateKey) {
    const officialPrevClose = await fetchTaiexOfficialClose(snapshot.gapDateKey);
    if (officialPrevClose) {
      const change = price - officialPrevClose;
      dayChange = { price, change, changePercent: change / officialPrevClose };
      persistTaiexGapClose(snapshot.gapDateKey, officialPrevClose);
    }
  }

  return {
    symbol,
    name: snapshot.meta?.name,
    currency: snapshot.meta?.currency,
    price,
    change: dayChange?.change,
    changePercent: dayChange?.changePercent,
    previousClose: dayChange ? price - dayChange.change : undefined,
  };
}

async function getWeekChangeFromChart(symbol: string): Promise<number | null> {
  // 自組序列 Yahoo 查不到，直接用 PriceCache
  if (isCustomSeriesSymbol(symbol)) return getWeekChangeFromCache(symbol);
  try {
    const fromRange = await getWeekChangeViaRangeApi(symbol);
    if (fromRange != null) return fromRange;

    const end = new Date();
    const start = new Date(end);
    start.setDate(start.getDate() - 30);
    const bars = await fetchChart(symbol, start, end);
    const fromChart = weekChangeFromBars(bars);
    if (fromChart != null) return fromChart;
    return getWeekChangeFromCache(symbol);
  } catch {
    return getWeekChangeFromCache(symbol);
  }
}

export async function getWeekChangePercents(
  symbols: string[],
): Promise<Map<string, number | null>> {
  const unique = [...new Set(symbols.map((s) => s.trim().toUpperCase()))];
  const entries = await mapWithConcurrency(
    unique,
    externalReadLimiter,
    async (sym) => [sym, await getWeekChangeFromChart(sym)] as const,
  );
  return new Map(entries);
}

export async function validateSymbol(symbol: string): Promise<QuoteResult | null> {
  if (isTaiwanVixSymbol(symbol)) {
    return fetchTaiwanVixQuote();
  }
  if (isTaiwanMarginSymbol(symbol)) {
    return fetchTaiwanMarginQuote(symbol.trim().toUpperCase());
  }
  try {
    const quote = await yahooQuote(resolveYahooQuoteSymbol(symbol));
    const price = quote ? extractYahooPrice(quote) : 0;
    if (quote && price > 0) {
      return {
        symbol: quote.symbol ?? symbol,
        name: quote.shortName ?? quote.longName,
        price,
        currency: quote.currency,
        change: quote.regularMarketChange,
        changePercent: normalizeYahooChangePercent(
          quote.regularMarketChangePercent,
        ),
      };
    }
  } catch {
    // 退回不需要 crumb 的 chart 端點，見下方
  }
  // .quote() 失敗或被限流時，改用不需要 crumb 的 chart 端點驗證，
  // 確保 .quote() 被擋期間仍能正常新增追蹤標的。
  return getLiveQuoteFromChart(symbol).catch(() => null);
}

/** 追蹤清單加入：盤後／週末仍盡力取得可驗證報價 */
export async function resolveQuoteForWatchlist(
  symbol: string,
): Promise<QuoteResult | null> {
  const sym = symbol.trim();
  if (!sym) return null;
  const upper = sym.toUpperCase();

  const validated = await validateSymbol(sym);
  if (validated && validated.price > 0) return validated;

  const quote = await getQuote(sym);
  if (quote.price > 0) return quote;

  const chartClose = await getLatestCloseFromChart(sym);
  if (chartClose != null && chartClose > 0) {
    return { symbol: upper, price: chartClose };
  }

  const cached = await getLatestCachedClose(sym);
  if (cached != null && cached > 0) {
    return { symbol: upper, price: cached };
  }

  return null;
}

/** 搜尋可找到代碼即可加入（不必有即時報價） */
export async function canAddSymbolToWatchlist(
  symbol: string,
): Promise<{ symbol: string; name?: string; price?: number } | null> {
  const sym = symbol.trim().toUpperCase();
  if (!sym) return null;

  const quote = await resolveQuoteForWatchlist(sym);
  if (quote?.price && quote.price > 0) {
    return { symbol: sym, name: quote.name, price: quote.price };
  }

  const { searchInstruments } = await import("@/lib/instrument-search");
  const results = await searchInstruments(sym);
  const hit = results.find((r) => r.symbol.toUpperCase() === sym);
  if (hit) {
    return {
      symbol: hit.symbol.toUpperCase(),
      name: hit.name,
      price: quote?.price,
    };
  }

  return quote ? { symbol: sym, name: quote.name, price: quote.price } : null;
}

function applyTaiwanQuoteClose(
  symbol: string,
  result: QuoteResult,
  prevClose: number | null | undefined,
): QuoteResult {
  if (!isTaiwanStockSymbol(symbol) || prevClose == null || prevClose <= 0) {
    return result;
  }
  const reconciled = reconcileTaiwanQuoteFromPreviousClose(result, prevClose);
  return {
    ...result,
    ...reconciled,
    previousClose: prevClose,
  };
}

/** 即時報價的請求內去重快取。
 *
 *  分析頁一次請求會為「整體」線、「全部帳戶」線、每個帳戶各自的線分別呼叫
 *  resolvePortfolioValueSeries——只要某檔股票被任一帳戶持有，它就必然同時
 *  出現在「整體」跟「該帳戶」兩次呼叫的股票清單裡。當天 K 線還沒收盤時，這些
 *  呼叫會各自落到這支即時報價 fallback，若沒有去重，同一檔股票的「今天」報價
 *  在同一次請求裡會被獨立打好幾次 Yahoo，兩次抓到的不保證是同一個 tick，
 *  導致「整體」線跟「個別帳戶」線用不同報價、數字對不起來。
 *
 *  快取的是「進行中的 promise」而不只是「算完的值」：分析頁裡有些帳戶的計算是
 *  併發的，若只快取已完成的值，兩個幾乎同時發出的查詢會在快取還空的時候一起
 *  衝去打 Yahoo。存 promise 才能讓後到的呼叫直接等同一個結果。
 *
 *  TTL 訂為 10 秒，對齊 Yahoo 這支 chart 端點自己回的
 *  `Cache-Control: public, max-age=10`——同一 10 秒窗口內不管誰打幾次，
 *  Yahoo CDN 回的都是同一份快取資料，我們縮短 TTL 也拿不到更新的價格，純粹
 *  多打幾次 Yahoo 而已。實測也發現即使是台積電這種高流動性股票，回報價格
 *  真正跳動的間隔常常有幾十秒甚至更久，比這個 TTL 長得多。 */
const QUOTE_REQUEST_CACHE_TTL_MS = 10_000;
const quoteRequestCache = new Map<
  string,
  { promise: Promise<QuoteResult>; at: number }
>();

export async function getQuote(symbol: string): Promise<QuoteResult> {
  const now = Date.now();
  const existing = quoteRequestCache.get(symbol);
  if (existing && now - existing.at < QUOTE_REQUEST_CACHE_TTL_MS) {
    return existing.promise;
  }

  const promise = fetchQuoteLive(symbol);
  quoteRequestCache.set(symbol, { promise, at: now });
  // fetchQuoteLive 內部已經把自己的例外都吃掉、一律回傳某種 QuoteResult
  // （必要時 price:0/stale:true），理論上不會走到這裡；留著只是防呆——萬一
  // 真的丟出例外，不要讓失敗的 promise 卡住快取擋住後續重試。
  promise.catch(() => {
    if (quoteRequestCache.get(symbol)?.promise === promise) {
      quoteRequestCache.delete(symbol);
    }
  });
  return promise;
}

async function fetchQuoteLive(symbol: string): Promise<QuoteResult> {
  if (isTaiwanVixSymbol(symbol)) {
    const twVix = await fetchTaiwanVixQuote();
    return twVix ?? { symbol: TAIWAN_VIX_SYMBOL, price: 0 };
  }
  if (isTaiwanMarginSymbol(symbol)) {
    const upper = symbol.trim().toUpperCase();
    return (await fetchTaiwanMarginQuote(upper)) ?? { symbol: upper, price: 0 };
  }

  const quoteSymbol = resolveYahooQuoteSymbol(symbol);
  const cached = await getLatestCachedClose(symbol);

  // fetchChart 打的是不需要 crumb 的 v8/finance/chart 端點，即使 yahoo-finance2
  // 的 .quote()（需要 crumb）被限流，這條路仍可能正常拿到即時資料——因此只有
  // 真的退回資料庫舊快取時才標記 stale，chart 端點成功時不算 stale。
  const fromChartOrCache = async (): Promise<QuoteResult | null> => {
    try {
      const fromChart = await getDayChangeFromChart(symbol);
      if (fromChart) {
        return {
          symbol,
          price: fromChart.price,
          change: fromChart.change,
          changePercent: fromChart.changePercent,
        };
      }
      const fromCache = await getDayChangeFromCache(symbol, Infinity);
      if (fromCache) {
        return {
          symbol,
          price: fromCache.price,
          change: fromCache.change,
          changePercent: fromCache.changePercent,
          stale: true,
        };
      }
      if (cached != null) {
        return { symbol, price: cached, stale: true };
      }
    } catch {
      if (cached != null) {
        return { symbol, price: cached, stale: true };
      }
    }
    return null;
  };

  // 主要資料來源：不需要 crumb 的 chart 端點，price/change/name/currency 都從
  // 這裡拿，平時穩定、也不受 .quote() 被限流影響；只有它失敗時才退回
  // .quote()／資料庫快取的舊邏輯當備援。
  const live = await getLiveQuoteFromChart(symbol);
  if (live) {
    return live;
  }

  try {
    const quote = await yahooQuote(quoteSymbol);
    if (!quote) {
      const fallback = await fromChartOrCache();
      const base = fallback ?? { symbol, price: cached ?? 0, stale: true };
      return applyTaiwanQuoteClose(symbol, base, undefined);
    }
    const price = extractYahooPrice(quote) || cached || 0;
    let change = quote.regularMarketChange ?? undefined;
    const prev = quote.regularMarketPreviousClose ?? null;

    // PriceCache has reliable daily closes written by our own fetcher.
    // Yahoo's regularMarketPreviousClose can lag by a day when a bar is missing
    // in Yahoo's own chart (e.g. ^TWII on public holidays where Yahoo stores null).
    // If our cache has today's close AND a previous close, prefer that for the
    // change/changePercent calculation — it's unambiguous. 這裡的快取要「夠新」
    // 才能拿來覆蓋剛成功拿到的即時報價，避免用陳年舊資料蓋掉新資料。
    const cacheChange = await getDayChangeFromCache(symbol, 2);
    let changePercent: number | undefined;
    if (cacheChange?.changePercent != null) {
      change = cacheChange.change;
      changePercent = cacheChange.changePercent;
    } else if (change != null && prev != null && prev > 0) {
      changePercent = change / prev;
    } else if (change == null && prev != null && price > 0) {
      change = price - prev;
      changePercent = prev > 0 ? change / prev : undefined;
    } else {
      changePercent = normalizeYahooChangePercent(quote.regularMarketChangePercent);
    }

    if (change === undefined || change === null) {
      const fallback = await fromChartOrCache();
      if (fallback?.change != null) {
        return applyTaiwanQuoteClose(
          symbol,
          {
            symbol: quote.symbol ?? symbol,
            name: quote.shortName ?? quote.longName,
            price: price > 0 ? price : fallback.price,
            currency: quote.currency,
            change: fallback.change,
            changePercent: fallback.changePercent,
            stale: fallback.stale,
          },
          prev,
        );
      }
    }

    return applyTaiwanQuoteClose(
      symbol,
      {
        symbol: quote.symbol ?? symbol,
        name: quote.shortName ?? quote.longName,
        price,
        currency: quote.currency,
        change,
        changePercent,
      },
      prev,
    );
  } catch {
    const fallback = await fromChartOrCache();
    if (fallback) {
      return applyTaiwanQuoteClose(symbol, fallback, undefined);
    }
    return { symbol, price: 0, stale: true };
  }
}

export async function getQuotes(symbols: string[]): Promise<Map<string, QuoteResult>> {
  const map = new Map<string, QuoteResult>();
  await Promise.all(
    symbols.map(async (symbol) => {
      try {
        map.set(symbol, await getQuote(symbol));
      } catch {
        const cached = await getLatestCachedClose(symbol);
        map.set(symbol, { symbol, price: cached ?? 0, stale: true });
      }
    }),
  );
  return map;
}
