import type { Instrument, Prisma } from "@prisma/client";
import { getOrCreateAccount, reconcileAccountCash } from "@/lib/accounts";
import { prisma } from "@/lib/db";
import { parseCalendarDate, toTransactionDateKey } from "@/lib/date-keys";
import { applyAutoFeeTax } from "@/lib/fee-tax";
import { inferInstrumentCurrency } from "@/lib/instrument-currency";
import { invalidatePerformanceCache } from "@/lib/performance-cache";
import { checkSellExceedsHolding, getHeldQuantity } from "@/lib/position-check";
import { ServiceError } from "@/lib/service-error";
import { toNumber } from "@/lib/utils";

/** 交易的新增／編輯／刪除，連同寫入後一定要做的帳戶現金重算與績效快取失效。 */

const CASH_TYPES = new Set(["DEPOSIT", "WITHDRAWAL"]);

/** 表單沒有任何機制擋「同一筆資料被送出兩次」（例如備註是最後一個欄位，打完
 *  習慣性按 Enter 會直接觸發表單送出；新標的還要查外部 API 可能要等好幾秒，
 *  使用者以為沒反應而再按一次 Enter 或點擊按鈕）——這裡在真正寫入前，查一下
 *  近幾秒內有沒有帳戶／標的／類型／日期／數量／單價／手續費／稅／備註都完全
 *  一樣的交易，有的話直接回傳那一筆，不要真的建立第二筆重複的交易。 */
const DUPLICATE_SUBMIT_WINDOW_MS = 10_000;

/** 光靠「查一下最近有沒有一樣的交易再寫入」擋不住真正同時送出的兩個請求——
 *  兩個請求都在對方寫入完成「之前」查詢，都查不到對方，於是都真的建立了一筆
 *  （這是先查後寫的經典 race condition，用真實併發請求測試過確實會重複）。
 *  這裡在完全同樣的欄位組合還在處理中的時候，記住這個「指紋」對應的處理結果，
 *  後來的相同請求直接等同一個結果、不要另外真的寫入，等處理完（不論成功失敗）
 *  才把指紋清掉。這個 app 是單一 Electron 行程、單一 Next.js server，記憶體內的
 *  Map 就足夠擋住這個 race，不需要額外的資料庫層鎖。 */
const inFlightCreates = new Map<string, Promise<CreateTransactionResult>>();

const TX_INCLUDE = { instrument: true, account: true } as const;

export type TransactionWithRelations = Prisma.TransactionGetPayload<{
  include: typeof TX_INCLUDE;
}>;

export type CreateTransactionInput = {
  symbol?: string;
  type: string;
  date: string;
  quantity?: number | string;
  price?: number | string;
  fee?: number | string;
  tax?: number | string;
  note?: string;
  accountId?: string;
  accountName?: string;
};

export type CreateTransactionResult = {
  transaction: Prisma.TransactionGetPayload<object> | TransactionWithRelations;
  /** 賣出超過持有數量時的提醒文字（仍會寫入） */
  warning: string | null;
  /** false 表示判定為重複送出，回傳的是既有那一筆 */
  created: boolean;
};

export async function listTransactions() {
  const transactions = await prisma.transaction.findMany({
    include: TX_INCLUDE,
    orderBy: { date: "desc" },
  });
  return transactions.map((t) => ({
    id: t.id,
    date: toTransactionDateKey(t.date),
    type: t.type,
    accountId: t.accountId,
    accountName: t.account.name,
    symbol: t.instrument?.symbol ?? null,
    instrumentName: t.instrument?.name ?? null,
    quantity: toNumber(t.quantity),
    price: toNumber(t.price),
    fee: toNumber(t.fee),
    tax: toNumber(t.tax),
    note: t.note,
    total:
      toNumber(t.quantity) * toNumber(t.price) + toNumber(t.fee) + toNumber(t.tax),
  }));
}

/** 新增交易；完全相同的內容同時送出多次只會寫入一筆（見 inFlightCreates）。 */
export async function createTransaction(
  input: CreateTransactionInput,
): Promise<CreateTransactionResult> {
  if (!input.type || !input.date) throw new ServiceError("缺少必要欄位");

  const fingerprint = JSON.stringify({
    symbol: input.symbol ?? null,
    type: String(input.type).toUpperCase(),
    date: input.date,
    quantity: input.quantity ?? null,
    price: input.price ?? null,
    fee: input.fee ?? null,
    tax: input.tax ?? null,
    note: input.note ?? null,
    accountId: input.accountId ?? null,
    accountName: input.accountName ?? null,
  });

  const existing = inFlightCreates.get(fingerprint);
  if (existing) return existing;

  const work = doCreateTransaction(input).finally(() =>
    inFlightCreates.delete(fingerprint),
  );
  inFlightCreates.set(fingerprint, work);
  return work;
}

async function doCreateTransaction(
  input: CreateTransactionInput,
): Promise<CreateTransactionResult> {
  const txType = input.type.toUpperCase();
  const date = parseTxDate(input.date);
  const note = input.note;
  const account = await getOrCreateAccount(input.accountId, input.accountName);
  const recentSince = new Date(Date.now() - DUPLICATE_SUBMIT_WINDOW_MS);

  if (CASH_TYPES.has(txType)) {
    const amt = Number(input.price ?? input.quantity);
    if (!amt || amt <= 0) throw new ServiceError("請輸入有效金額");

    const recentDuplicate = await prisma.transaction.findFirst({
      where: {
        accountId: account.id,
        instrumentId: null,
        type: txType,
        date,
        price: amt,
        note: note ?? null,
        createdAt: { gte: recentSince },
      },
    });
    if (recentDuplicate) {
      return { transaction: recentDuplicate, warning: null, created: false };
    }

    const transaction = await prisma.transaction.create({
      data: {
        accountId: account.id,
        instrumentId: null,
        type: txType,
        date,
        quantity: 1,
        price: amt,
        fee: 0,
        tax: 0,
        note,
      },
    });
    await afterWrite([account.id]);
    return { transaction, warning: null, created: true };
  }

  if (!input.symbol || input.quantity === undefined || input.price === undefined) {
    throw new ServiceError("缺少必要欄位");
  }

  const instrument = await ensureInstrument(input.symbol);
  const qty = Number(input.quantity);
  const px = Number(input.price);
  const fee = Number(input.fee) || 0;
  const tax = Number(input.tax) || 0;

  let warning: string | null = null;
  if (txType === "SELL") {
    const held = await getHeldQuantity(account.id, instrument.id);
    warning = checkSellExceedsHolding(txType, qty, held);
  }

  const recentDuplicate = await prisma.transaction.findFirst({
    where: {
      accountId: account.id,
      instrumentId: instrument.id,
      type: txType,
      date,
      quantity: qty,
      price: px,
      fee,
      tax,
      note: note ?? null,
      createdAt: { gte: recentSince },
    },
    include: TX_INCLUDE,
  });
  if (recentDuplicate) {
    return { transaction: recentDuplicate, warning, created: false };
  }

  const transaction = await prisma.transaction.create({
    data: {
      accountId: account.id,
      instrumentId: instrument.id,
      type: txType,
      date,
      quantity: qty,
      price: px,
      fee,
      tax,
      note,
    },
    include: TX_INCLUDE,
  });
  await afterWrite([account.id]);
  return { transaction, warning, created: true };
}

export type UpdateTransactionPatch = {
  type?: string;
  accountId?: string;
  date?: string;
  symbol?: string;
  quantity?: number | string;
  price?: number | string;
  /** 出入金的金額，等同 price */
  amount?: number | string;
  fee?: number | string;
  tax?: number | string;
  /** 預設 true：沒填手續費／稅時依帳戶費率自動計算 */
  autoFeeTax?: boolean;
  /** 空字串表示清除備註；undefined 表示不變 */
  note?: string | null;
};

export async function updateTransaction(
  id: string,
  patch: UpdateTransactionPatch,
): Promise<{ transaction: Prisma.TransactionGetPayload<object>; warning: string | null }> {
  const existing = await prisma.transaction.findUnique({
    where: { id },
    include: TX_INCLUDE,
  });
  if (!existing) throw new ServiceError("交易不存在", 404);

  const txType = (patch.type ?? existing.type).toUpperCase();
  const accountId = patch.accountId ?? existing.accountId;
  const date = patch.date ? parseTxDate(patch.date) : existing.date;
  const note = patch.note !== undefined ? patch.note || null : existing.note;
  const touchedAccounts = [accountId, existing.accountId];

  if (CASH_TYPES.has(txType)) {
    const amt = Number(patch.price ?? patch.amount ?? existing.price);
    if (!amt || amt <= 0) throw new ServiceError("請輸入有效金額");

    const transaction = await prisma.transaction.update({
      where: { id },
      data: {
        accountId,
        instrumentId: null,
        type: txType,
        date,
        quantity: 1,
        price: amt,
        fee: 0,
        tax: 0,
        note,
      },
    });
    await afterWrite(touchedAccounts);
    return { transaction, warning: null };
  }

  const symbol = (patch.symbol ?? existing.instrument?.symbol ?? "")
    .toString()
    .toUpperCase();
  if (!symbol) throw new ServiceError("缺少標的代碼");

  const instrument = await ensureInstrument(symbol);
  const qty = Number(patch.quantity ?? existing.quantity);
  const px = Number(patch.price ?? existing.price);
  const account = await prisma.account.findUniqueOrThrow({
    where: { id: accountId },
  });

  const optionalNumber = (v: number | string | undefined) =>
    v !== undefined && v !== "" ? Number(v) : undefined;
  const { fee, tax } =
    patch.autoFeeTax !== false
      ? applyAutoFeeTax(
          account,
          instrument,
          txType,
          qty,
          px,
          optionalNumber(patch.fee),
          optionalNumber(patch.tax),
        )
      : {
          fee: Number(patch.fee ?? existing.fee) || 0,
          tax: Number(patch.tax ?? existing.tax) || 0,
        };

  let warning: string | null = null;
  if (txType === "SELL") {
    const held = await getHeldQuantity(accountId, instrument.id, id);
    warning = checkSellExceedsHolding(txType, qty, held);
  }

  const transaction = await prisma.transaction.update({
    where: { id },
    data: {
      accountId,
      instrumentId: instrument.id,
      type: txType,
      date,
      quantity: qty,
      price: px,
      fee,
      tax,
      note,
    },
    include: TX_INCLUDE,
  });
  await afterWrite(touchedAccounts);
  return { transaction, warning };
}

export async function deleteTransaction(id: string): Promise<void> {
  const existing = await prisma.transaction.findUnique({ where: { id } });
  if (!existing) throw new ServiceError("交易不存在", 404);
  await prisma.transaction.delete({ where: { id } });
  await afterWrite([existing.accountId]);
}

/** 找既有標的；沒有就向報價來源驗證後建立（名稱、幣別、資產類別）。台股名稱
 *  優先用中文名。 */
export async function ensureInstrument(rawSymbol: string): Promise<Instrument> {
  const symbol = rawSymbol.toUpperCase();
  const existing = await prisma.instrument.findUnique({ where: { symbol } });
  if (existing) return existing;

  const { validateSymbol, inferAssetClass } = await import("@/lib/yahoo");
  const { isTaiwanSymbol, fetchTaiwanChineseName, hasCjk } = await import(
    "@/lib/instrument-display-name"
  );
  const validated = await validateSymbol(symbol);
  let name: string | null = validated?.name ?? null;
  if (isTaiwanSymbol(symbol) && (!name || !hasCjk(name))) {
    const chineseName = await fetchTaiwanChineseName(symbol).catch(() => null);
    if (chineseName) name = chineseName;
  }
  return prisma.instrument.create({
    data: {
      symbol,
      name,
      assetClass: inferAssetClass(symbol),
      currency: inferInstrumentCurrency(symbol, validated?.currency, validated?.currency),
    },
  });
}

function parseTxDate(value: string): Date {
  try {
    return parseCalendarDate(String(value));
  } catch {
    throw new ServiceError("日期格式無效");
  }
}

/** 交易寫入後：重算受影響帳戶的現金，並讓績效快取失效 */
async function afterWrite(accountIds: string[]): Promise<void> {
  for (const accountId of new Set(accountIds)) {
    await reconcileAccountCash(accountId);
  }
  await invalidatePerformanceCache();
}
