import type { Account, Instrument } from "@prisma/client";
import { findAccountByLabel } from "@/lib/accounts";
import { prisma } from "@/lib/db";
import { parseCalendarDate, toCalendarDateKey } from "@/lib/date-keys";
import { applyAutoFeeTax } from "@/lib/fee-tax";
import { getHeldQuantity } from "@/lib/position-check";
import { ServiceError } from "@/lib/service-error";
import { computeTransactionSettlement } from "@/lib/transaction-settlement";
import { createTransaction, ensureInstrument } from "@/lib/transactions";
import { toNumber } from "@/lib/utils";

/** 一次記多筆交易（例如 AI 讀券商成交截圖後送進來）。分兩步：
 *  1. previewTransactionBatch：不寫入，逐筆檢查並回報給呼叫端（AI／使用者）確認
 *  2. createTransactionBatch：確認後寫入
 *
 *  刻意「不擋重複」：同一批或資料庫裡已有數量、價格完全相同的交易時只列出來
 *  （existingSimilar／identicalInBatch），要不要照記由看過截圖的人判斷——同一天
 *  分兩次成交、數量價格都一樣的情況是真的會發生的。 */

const SECURITY_TYPES = new Set(["BUY", "SELL", "DIVIDEND"]);
const CASH_TYPES = new Set(["DEPOSIT", "WITHDRAWAL"]);
const QTY_EPSILON = 1e-7;

export type BatchTransactionRow = {
  /** YYYY-MM-DD */
  date: string;
  /** 帳戶名稱（部分比對即可，例如「永豐」「Firstrade」）或帳戶 id */
  account: string;
  type: string;
  /** 證券交易必填；台股可只寫數字代號（會自動找 .TW／.TWO） */
  symbol?: string;
  quantity?: number;
  /** 證券交易為單價；入金／出金為金額 */
  price: number;
  /** 未提供時依帳戶費率自動計算 */
  fee?: number;
  tax?: number;
  note?: string;
};

export type BatchPreviewRow = {
  index: number;
  ok: boolean;
  errors: string[];
  warnings: string[];
  date: string;
  account: string | null;
  type: string;
  symbol: string | null;
  instrumentName: string | null;
  /** 系統裡還沒有這個標的，寫入時會新建 */
  newInstrument: boolean;
  quantity: number;
  price: number;
  fee: number;
  tax: number;
  /** given：截圖上的值；computed：依帳戶費率算出 */
  feeTaxSource: "given" | "computed" | "none";
  computedFee: number | null;
  computedTax: number | null;
  /** 帳戶實際收付（負數為付出） */
  net: number | null;
  /** 這筆之後此帳戶此標的的持股（依本批次與既有交易推算） */
  holdingAfter: number | null;
  /** 資料庫裡同帳戶、同標的、同類型、同日期、同數量與價格的既有交易 */
  existingSimilar: {
    id: string;
    fee: number;
    tax: number;
    note: string | null;
    createdAt: string;
  }[];
  /** 本批次裡內容完全相同的其他列（index） */
  identicalInBatch: number[];
};

type ResolvedRow = BatchPreviewRow & {
  accountId: string | null;
  dateValue: Date | null;
  instrumentId: string | null;
};

export async function previewTransactionBatch(
  rows: BatchTransactionRow[],
): Promise<{ rows: BatchPreviewRow[]; errorCount: number; warningCount: number }> {
  const resolved = await resolveBatch(rows);
  const publicRows = resolved.map(stripInternal);
  return {
    rows: publicRows,
    errorCount: publicRows.filter((r) => !r.ok).length,
    warningCount: publicRows.filter((r) => r.warnings.length > 0).length,
  };
}

/** 寫入整批。任何一列有錯誤就整批不寫；新標的會先全部建好，才開始寫交易，
 *  避免寫到一半因為查不到外部報價而只記了一部分。 */
export async function createTransactionBatch(rows: BatchTransactionRow[]): Promise<{
  created: {
    index: number;
    id: string;
    date: string;
    account: string;
    type: string;
    symbol: string | null;
    quantity: number;
    price: number;
    fee: number;
    tax: number;
  }[];
  warnings: { index: number; warnings: string[] }[];
}> {
  const resolved = await resolveBatch(rows);
  const failed = resolved.filter((r) => !r.ok);
  if (failed.length > 0) {
    throw new ServiceError(
      `有 ${failed.length} 筆無法寫入，整批未寫入：\n` +
        failed.map((r) => `#${r.index} ${r.errors.join("；")}`).join("\n"),
    );
  }

  for (const symbol of new Set(resolved.filter((r) => r.newInstrument).map((r) => r.symbol!))) {
    await ensureInstrument(symbol);
  }

  const created = [];
  for (const r of sortForWrite(resolved)) {
    const { transaction } = await createTransaction(
      {
        accountId: r.accountId!,
        type: r.type,
        date: r.date,
        symbol: r.symbol ?? undefined,
        quantity: r.quantity,
        price: r.price,
        fee: r.fee,
        tax: r.tax,
        note: rows[r.index]?.note,
      },
      { allowIdentical: true },
    );
    created.push({
      index: r.index,
      id: transaction.id,
      date: r.date,
      account: r.account!,
      type: r.type,
      symbol: r.symbol,
      quantity: r.quantity,
      price: r.price,
      fee: r.fee,
      tax: r.tax,
    });
  }

  return {
    created,
    warnings: resolved
      .filter((r) => r.warnings.length > 0)
      .map((r) => ({ index: r.index, warnings: r.warnings })),
  };
}

// ── 解析與檢查 ───────────────────────────────────────────────────────────────

async function resolveBatch(rows: BatchTransactionRow[]): Promise<ResolvedRow[]> {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new ServiceError("沒有任何交易");
  }
  const accounts = await prisma.account.findMany();
  const instrumentCache = new Map<string, Instrument | null>();

  const resolved: ResolvedRow[] = [];
  for (let index = 0; index < rows.length; index++) {
    resolved.push(await resolveRow(rows[index]!, index, accounts, instrumentCache));
  }

  markIdenticalRows(resolved);
  await applyHoldingChecks(resolved);
  return resolved;
}

async function resolveRow(
  row: BatchTransactionRow,
  index: number,
  accounts: Account[],
  instrumentCache: Map<string, Instrument | null>,
): Promise<ResolvedRow> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const type = String(row.type ?? "").trim().toUpperCase();
  const isCash = CASH_TYPES.has(type);
  if (!SECURITY_TYPES.has(type) && !isCash) {
    errors.push(`類型「${row.type}」不正確，應為 BUY／SELL／DIVIDEND／DEPOSIT／WITHDRAWAL`);
  }

  let dateValue: Date | null = null;
  try {
    dateValue = parseCalendarDate(String(row.date));
  } catch {
    errors.push(`日期「${row.date}」格式不正確`);
  }

  const account = await matchAccount(String(row.account ?? ""), accounts, errors);

  const price = Number(row.price);
  if (!Number.isFinite(price) || price <= 0) errors.push("價格／金額必須大於 0");
  const quantity = isCash ? 1 : Number(row.quantity);
  if (!isCash && (!Number.isFinite(quantity) || quantity <= 0)) {
    errors.push("數量必須大於 0");
  }

  let symbol: string | null = null;
  let instrument: Instrument | null = null;
  let instrumentName: string | null = null;
  let newInstrument = false;
  if (!isCash && type) {
    if (!row.symbol?.trim()) {
      errors.push("缺少標的代號");
    } else {
      const found = await resolveSymbol(row.symbol, instrumentCache);
      symbol = found.symbol;
      instrument = found.instrument;
      instrumentName = found.name;
      newInstrument = !instrument;
      if (newInstrument && !found.validated) {
        warnings.push(`系統裡沒有 ${symbol}，也查不到報價，請確認代號是否正確（寫入時會新建這個標的）`);
      } else if (newInstrument) {
        warnings.push(`系統裡還沒有 ${symbol}（${instrumentName ?? "名稱未知"}），寫入時會新建`);
      }
    }
  }

  let fee = 0;
  let tax = 0;
  let computedFee: number | null = null;
  let computedTax: number | null = null;
  let feeTaxSource: BatchPreviewRow["feeTaxSource"] = "none";
  if (!isCash && account && symbol && errors.length === 0) {
    const computed = applyAutoFeeTax(
      account,
      instrument ?? { symbol },
      type,
      quantity,
      price,
    );
    computedFee = computed.fee;
    computedTax = computed.tax;
    const givenFee = optionalNumber(row.fee);
    const givenTax = optionalNumber(row.tax);
    fee = givenFee ?? computed.fee;
    tax = givenTax ?? computed.tax;
    feeTaxSource = givenFee != null || givenTax != null ? "given" : "computed";
    // 截圖上的手續費／稅是券商實際收的，跟帳戶費率算出來的對不上，通常代表
    // 單價或數量讀錯了（或帳戶費率設定跟券商不一致），提醒呼叫端再核對一次。
    const tolerance = account.currency === "TWD" ? 1 : 0.01;
    if (givenFee != null && Math.abs(givenFee - computed.fee) >= tolerance) {
      warnings.push(`手續費 ${givenFee} 與帳戶費率算出的 ${computed.fee} 不同，請核對數量／單價`);
    }
    if (givenTax != null && Math.abs(givenTax - computed.tax) >= tolerance) {
      warnings.push(`交易稅 ${givenTax} 與帳戶稅率算出的 ${computed.tax} 不同，請核對數量／單價`);
    }
  }

  const settlement =
    errors.length === 0
      ? computeTransactionSettlement(type, quantity, price, fee, tax)
      : null;

  const existingSimilar =
    errors.length === 0 && account && dateValue
      ? await findExistingSimilar({
          accountId: account.id,
          instrumentId: instrument?.id ?? null,
          isCash,
          type,
          date: dateValue,
          quantity,
          price,
        })
      : [];
  if (existingSimilar.length > 0) {
    warnings.push(
      `資料庫已有 ${existingSimilar.length} 筆同日、同數量、同價格的${isCash ? "出入金" : "交易"}，請確認不是重複記帳`,
    );
  }

  return {
    index,
    ok: errors.length === 0,
    errors,
    warnings,
    date: dateValue ? toCalendarDateKey(dateValue) : String(row.date),
    account: account?.name ?? null,
    type,
    symbol,
    instrumentName: instrumentName ?? instrument?.name ?? null,
    newInstrument,
    quantity,
    price,
    fee,
    tax,
    feeTaxSource,
    computedFee,
    computedTax,
    net: settlement?.net ?? null,
    holdingAfter: null,
    existingSimilar,
    identicalInBatch: [],
    accountId: account?.id ?? null,
    dateValue,
    instrumentId: instrument?.id ?? null,
  };
}

async function matchAccount(
  label: string,
  accounts: Account[],
  errors: string[],
): Promise<Account | null> {
  const q = label.trim();
  const names = accounts.map((a) => a.name).join("、");
  if (!q) {
    errors.push(`缺少帳戶。可用帳戶：${names}`);
    return null;
  }
  const exact =
    accounts.find((a) => a.id === q || a.name === q) ??
    (await findAccountByLabel(q).then((a) =>
      a ? (accounts.find((x) => x.id === a.id) ?? null) : null,
    ));
  if (exact) return exact;

  const lower = q.toLowerCase();
  const partial = accounts.filter((a) => a.name.toLowerCase().includes(lower));
  if (partial.length === 1) return partial[0]!;
  errors.push(
    partial.length > 1
      ? `帳戶「${q}」對到多個：${partial.map((a) => a.name).join("、")}`
      : `找不到帳戶「${q}」。可用帳戶：${names}`,
  );
  return null;
}

/** 代號 → 系統裡的標的。台股只給數字代號時，依序找 .TW、.TWO（上櫃）；
 *  兩個都不在系統裡時，用報價來源判斷是哪一個。 */
async function resolveSymbol(
  raw: string,
  cache: Map<string, Instrument | null>,
): Promise<{
  symbol: string;
  instrument: Instrument | null;
  name: string | null;
  validated: boolean;
}> {
  const upper = raw.trim().toUpperCase();
  const candidates = /^\d{4,6}[A-Z]?$/.test(upper)
    ? [`${upper}.TW`, `${upper}.TWO`]
    : [upper];

  for (const symbol of candidates) {
    if (!cache.has(symbol)) {
      cache.set(symbol, await prisma.instrument.findUnique({ where: { symbol } }));
    }
    const instrument = cache.get(symbol);
    if (instrument) {
      return { symbol, instrument, name: instrument.name, validated: true };
    }
  }

  const { validateSymbol } = await import("@/lib/yahoo");
  for (const symbol of candidates) {
    const quote = await validateSymbol(symbol).catch(() => null);
    if (quote && quote.price > 0) {
      return { symbol, instrument: null, name: quote.name ?? null, validated: true };
    }
  }
  return { symbol: candidates[0]!, instrument: null, name: null, validated: false };
}

async function findExistingSimilar(where: {
  accountId: string;
  instrumentId: string | null;
  isCash: boolean;
  type: string;
  date: Date;
  quantity: number;
  price: number;
}): Promise<BatchPreviewRow["existingSimilar"]> {
  // 新標的不可能已有交易
  if (!where.isCash && !where.instrumentId) return [];
  const rows = await prisma.transaction.findMany({
    where: {
      accountId: where.accountId,
      instrumentId: where.instrumentId,
      type: where.type,
      date: where.date,
      price: where.price,
      ...(where.isCash ? {} : { quantity: where.quantity }),
    },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((t) => ({
    id: t.id,
    fee: toNumber(t.fee),
    tax: toNumber(t.tax),
    note: t.note,
    createdAt: t.createdAt.toISOString(),
  }));
}

function identityKey(r: ResolvedRow): string {
  return [r.accountId, r.type, r.date, r.symbol, r.quantity, r.price, r.fee, r.tax].join("|");
}

function markIdenticalRows(rows: ResolvedRow[]): void {
  const byKey = new Map<string, number[]>();
  for (const r of rows) {
    if (!r.ok) continue;
    const key = identityKey(r);
    byKey.set(key, [...(byKey.get(key) ?? []), r.index]);
  }
  for (const r of rows) {
    if (!r.ok) continue;
    r.identicalInBatch = (byKey.get(identityKey(r)) ?? []).filter((i) => i !== r.index);
    if (r.identicalInBatch.length > 0) {
      r.warnings.push(
        `本批次第 ${r.identicalInBatch.map((i) => `#${i}`).join("、")} 筆與這筆內容完全相同，請確認截圖上確實是分開的成交`,
      );
    }
  }
}

/** 依日期順序推算每筆之後的持股，賣出超過持有時提醒（不擋：可能是更早的
 *  買進還沒記）。 */
async function applyHoldingChecks(rows: ResolvedRow[]): Promise<void> {
  const held = new Map<string, number>();
  for (const r of sortForWrite(rows)) {
    if (!r.ok || !r.symbol || !r.accountId) continue;
    if (r.type !== "BUY" && r.type !== "SELL") continue;
    const key = `${r.accountId}|${r.symbol}`;
    if (!held.has(key)) {
      held.set(
        key,
        r.instrumentId ? await getHeldQuantity(r.accountId, r.instrumentId) : 0,
      );
    }
    const before = held.get(key)!;
    if (r.type === "SELL" && r.quantity > before + QTY_EPSILON) {
      r.warnings.push(
        `賣出 ${r.quantity} 股，但此帳戶到這筆為止只持有 ${before} 股（超賣 ${r.quantity - before} 股）`,
      );
    }
    const after = r.type === "BUY" ? before + r.quantity : before - r.quantity;
    held.set(key, after);
    r.holdingAfter = after;
  }
}

/** 依日期排序，同日保持原本順序 */
function sortForWrite(rows: ResolvedRow[]): ResolvedRow[] {
  return [...rows].sort(
    (a, b) => a.date.localeCompare(b.date) || a.index - b.index,
  );
}

/** 拿掉只在內部用的 id／Date 欄位，回傳給呼叫端的格式 */
function stripInternal(r: ResolvedRow): BatchPreviewRow {
  const publicRow: Partial<ResolvedRow> = { ...r };
  delete publicRow.accountId;
  delete publicRow.dateValue;
  delete publicRow.instrumentId;
  return publicRow as BatchPreviewRow;
}

function optionalNumber(v: unknown): number | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
