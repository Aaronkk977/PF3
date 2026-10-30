/** 期交所 VIX 檔案與證交所／櫃買中心融資資料的純解析函式（不碰網路、資料庫），
 *  抓取與快取在 market-data/taiwan-vix.ts、market-data/taiwan-margin.ts。 */

function toNumber(raw: string | undefined): number | null {
  if (raw == null) return null;
  const n = Number(raw.replace(/,/g, "").trim());
  return raw.trim() !== "" && Number.isFinite(n) ? n : null;
}

/** 期交所 VIX 月檔（log2data/YYYYMMnew.txt）：每列一個交易日，
 *  欄位為「交易日期、時間、13:45 指數、收盤前 1 分鐘平均指數」。
 *  官方收盤值是最後一欄（收盤前 1 分鐘平均）。回傳 YYYYMMDD → 收盤值。 */
export function parseVixMonthlyFile(text: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const line of text.split(/\r?\n/)) {
    const cols = line.split("\t").map((c) => c.trim()).filter(Boolean);
    if (!/^\d{8}$/.test(cols[0] ?? "")) continue;
    const value = toNumber(cols[cols.length - 1]);
    if (value != null && value > 0) out.set(cols[0]!, value);
  }
  return out;
}

/** 期交所 VIX 單日分鐘檔（getVixData?filesname=YYYYMMDD）：取最後一列
 *  「Last 1 min AVG」當收盤值。整天每分鐘都是同一個值的檔案是資料源凍結
 *  （bq888 在 2026-07-27～07-31 就是這樣），視為無效。 */
export function parseVixDailyFile(text: string): number | null {
  const values: number[] = [];
  let closing: number | null = null;
  for (const line of text.split(/\r?\n/)) {
    const cols = line.split("\t").map((c) => c.trim()).filter(Boolean);
    if (!/^\d{8}$/.test(cols[0] ?? "")) continue;
    const value = toNumber(cols[cols.length - 1]);
    if (value == null || value <= 0) continue;
    if (/AVG/i.test(cols[1] ?? "")) closing = value;
    else values.push(value);
  }
  if (values.length > 10 && values.every((v) => v === values[0])) return null;
  return closing ?? values[values.length - 1] ?? null;
}

/** 某市場某日的融資資料：融資金額餘額與融資部位市值（皆為元） */
export type MarginMarketDay = {
  /** 融資金額今日餘額（元） */
  loanAmount: number;
  /** Σ 各股融資餘額股數 × 收盤價（元） */
  collateralValue: number;
};

type TwseTable = { title?: string; fields?: string[]; data?: string[][] };
type TwseResponse = { stat?: string; tables?: TwseTable[] };

/** 各股融資餘額（股數）× 收盤價加總；沒有收盤價（當日無成交）的個股略過 */
function sumCollateral(
  balances: Map<string, number>,
  closes: Map<string, number>,
): number {
  let total = 0;
  for (const [code, shares] of balances) {
    const close = closes.get(code);
    if (close != null && close > 0) total += shares * close;
  }
  return total;
}

/** 期交所指數專區（indes/index.aspx/GetStockDayPrices）：回應的 d 是 JSON 字串，
 *  TrendData 每筆 { Time: "YYYYMMDD", Price }。這裡的值是 13:45 指數，
 *  不是月檔的收盤前 1 分鐘平均（通常差 0.1 點內）。回傳 YYYYMMDD → 值。 */
export function parseVixIndexHistory(json: { d?: string }): Map<string, number> {
  const out = new Map<string, number>();
  if (!json.d) return out;
  let payload: { TrendData?: { Time?: string; Price?: number }[] };
  try {
    payload = JSON.parse(json.d);
  } catch {
    return out;
  }
  for (const row of payload.TrendData ?? []) {
    if (!/^\d{8}$/.test(row.Time ?? "")) continue;
    if (typeof row.Price === "number" && Number.isFinite(row.Price) && row.Price > 0) {
      out.set(row.Time!, row.Price);
    }
  }
  return out;
}

/** 證交所 MI_MARGN?selectType=ALL：第一張表是「信用交易統計」（融資金額），
 *  第二張是各股「融資融券彙總」（融資今日餘額，單位：交易單位＝1000 股）。 */
export function parseTwseMarginAll(
  json: TwseResponse,
): { loanAmount: number; balances: Map<string, number> } | null {
  if (json.stat !== "OK" || !json.tables) return null;
  const summary = json.tables.find((t) => t.title?.includes("信用交易統計"));
  const loanRow = summary?.data?.find((r) => r[0]?.includes("融資金額"));
  const loanThousands = toNumber(loanRow?.[5]);
  const detail = json.tables.find((t) => t.title?.includes("融資融券彙總"));
  if (loanThousands == null || !detail?.data?.length) return null;

  const balances = new Map<string, number>();
  for (const row of detail.data) {
    const lots = toNumber(row[6]);
    if (row[0] && lots != null && lots > 0) balances.set(row[0].trim(), lots * 1000);
  }
  return { loanAmount: loanThousands * 1000, balances };
}

/** 證交所 MI_INDEX?type=ALLBUT0999：「每日收盤行情」表，證券代號 → 收盤價 */
export function parseTwseCloses(json: TwseResponse): Map<string, number> | null {
  if (json.stat !== "OK" || !json.tables) return null;
  const table = json.tables.find((t) => t.title?.includes("每日收盤行情"));
  if (!table?.data?.length || !table.fields) return null;
  const closeIdx = table.fields.indexOf("收盤價");
  if (closeIdx < 0) return null;
  const out = new Map<string, number>();
  for (const row of table.data) {
    const close = toNumber(row[closeIdx]);
    if (row[0] && close != null) out.set(row[0].trim(), close);
  }
  return out;
}

type TpexResponse = {
  tables?: {
    totalCount?: number;
    fields?: string[];
    data?: string[][];
    summary?: string[][];
  }[];
};

/** 櫃買中心 margin/balance：data 為各股（資餘額，單位：張），
 *  summary 的「融資金(仟元)」列第 7 欄為今日餘額。 */
export function parseTpexMargin(
  json: TpexResponse,
): { loanAmount: number; balances: Map<string, number> } | null {
  const table = json.tables?.[0];
  if (!table?.data?.length || !table.fields) return null;
  const balanceIdx = table.fields.indexOf("資餘額");
  const loanRow = table.summary?.find((r) => r[1]?.includes("融資金"));
  const loanThousands = toNumber(loanRow?.[6]);
  if (balanceIdx < 0 || loanThousands == null) return null;

  const balances = new Map<string, number>();
  for (const row of table.data) {
    const lots = toNumber(row[balanceIdx]);
    if (row[0] && lots != null && lots > 0) balances.set(row[0].trim(), lots * 1000);
  }
  return { loanAmount: loanThousands * 1000, balances };
}

/** 櫃買中心 afterTrading/otc：代號 → 收盤價（欄名帶空白，用 trim 比對） */
export function parseTpexCloses(json: TpexResponse): Map<string, number> | null {
  const table = json.tables?.[0];
  if (!table?.data?.length || !table.fields) return null;
  const closeIdx = table.fields.findIndex((f) => f.trim() === "收盤");
  if (closeIdx < 0) return null;
  const out = new Map<string, number>();
  for (const row of table.data) {
    const close = toNumber(row[closeIdx]);
    if (row[0] && close != null) out.set(row[0].trim(), close);
  }
  return out;
}

export function combineMarginMarket(
  margin: { loanAmount: number; balances: Map<string, number> },
  closes: Map<string, number>,
): MarginMarketDay {
  return {
    loanAmount: margin.loanAmount,
    collateralValue: sumCollateral(margin.balances, closes),
  };
}

/** 大盤融資維持率（%）＝ Σ 融資部位市值 ÷ Σ 融資金額 × 100 */
export function maintenanceRatioPercent(markets: MarginMarketDay[]): number | null {
  const loan = markets.reduce((s, m) => s + m.loanAmount, 0);
  const value = markets.reduce((s, m) => s + m.collateralValue, 0);
  return loan > 0 ? (value / loan) * 100 : null;
}
