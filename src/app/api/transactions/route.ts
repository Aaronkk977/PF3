import { NextRequest, NextResponse } from "next/server";
import { getOrCreateAccount, reconcileAccountCash } from "@/lib/accounts";
import { prisma } from "@/lib/db";
import { invalidatePerformanceCache } from "@/lib/performance-cache";
import { parseCalendarDate, toTransactionDateKey } from "@/lib/date-keys";
import { checkSellExceedsHolding, getHeldQuantity } from "@/lib/position-check";
import { toNumber } from "@/lib/utils";

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
 *  這裡在完全同樣的欄位組合（帳戶＋標的＋類型＋日期＋數量＋單價＋手續費＋
 *  稅＋備註）還在處理中的時候，記住這個「指紋」對應的處理結果，後來的相同
 *  請求直接等同一個結果、不要另外真的寫入，等處理完（不論成功失敗）才把指紋
 *  清掉。這個 app 是單一 Electron 行程、單一 Next.js server，記憶體內的
 *  Map 就足夠擋住這個 race，不需要额外的資料庫層鎖。 */
const inFlightSubmissions = new Map<
  string,
  Promise<{ body: unknown; status: number }>
>();

export async function GET() {
  const transactions = await prisma.transaction.findMany({
    include: { instrument: true, account: true },
    orderBy: { date: "desc" },
  });

  return NextResponse.json(
    transactions.map((t) => ({
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
    })),
  );
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const {
    symbol,
    type,
    date,
    quantity,
    price,
    fee,
    tax,
    note,
    accountId,
    accountName,
  } = body;

  if (!type || !date) {
    return NextResponse.json({ error: "缺少必要欄位" }, { status: 400 });
  }

  const fingerprint = JSON.stringify({
    symbol: symbol ?? null,
    type: String(type).toUpperCase(),
    date,
    quantity: quantity ?? null,
    price: price ?? null,
    fee: fee ?? null,
    tax: tax ?? null,
    note: note ?? null,
    accountId: accountId ?? null,
    accountName: accountName ?? null,
  });

  const existing = inFlightSubmissions.get(fingerprint);
  if (existing) {
    const { body: dupBody, status } = await existing;
    return NextResponse.json(dupBody, { status });
  }

  const work = createTransaction({
    symbol,
    type,
    date,
    quantity,
    price,
    fee,
    tax,
    note,
    accountId,
    accountName,
  }).finally(() => inFlightSubmissions.delete(fingerprint));
  inFlightSubmissions.set(fingerprint, work);

  const { body: resultBody, status } = await work;
  return NextResponse.json(resultBody, { status });
}

async function createTransaction({
  symbol,
  type,
  date,
  quantity,
  price,
  fee,
  tax,
  note,
  accountId,
  accountName,
}: {
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
}): Promise<{ body: unknown; status: number }> {
  const txType = type.toUpperCase();
  const account = await getOrCreateAccount(accountId, accountName);

  if (CASH_TYPES.has(txType)) {
    const amt = Number(price ?? quantity);
    if (!amt || amt <= 0) {
      return { body: { error: "請輸入有效金額" }, status: 400 };
    }

    const recentDuplicate = await prisma.transaction.findFirst({
      where: {
        accountId: account.id,
        instrumentId: null,
        type: txType,
        date: parseCalendarDate(String(date)),
        price: amt,
        note: note ?? null,
        createdAt: { gte: new Date(Date.now() - DUPLICATE_SUBMIT_WINDOW_MS) },
      },
    });
    if (recentDuplicate) {
      return { body: recentDuplicate, status: 200 };
    }

    const transaction = await prisma.transaction.create({
      data: {
        accountId: account.id,
        instrumentId: null,
        type: txType,
        date: parseCalendarDate(String(date)),
        quantity: 1,
        price: amt,
        fee: 0,
        tax: 0,
        note,
      },
    });

    await reconcileAccountCash(account.id);
    await invalidatePerformanceCache();

    return { body: transaction, status: 201 };
  }

  if (!symbol || quantity === undefined || price === undefined) {
    return { body: { error: "缺少必要欄位" }, status: 400 };
  }

  let instrument = await prisma.instrument.findUnique({
    where: { symbol: symbol.toUpperCase() },
  });

  if (!instrument) {
    const { validateSymbol, inferAssetClass } = await import("@/lib/yahoo");
    const { isTaiwanSymbol, fetchTaiwanChineseName, hasCjk } = await import(
      "@/lib/instrument-display-name"
    );
    const validated = await validateSymbol(symbol.toUpperCase());
    let instrumentName: string | null = validated?.name ?? null;
    if (isTaiwanSymbol(symbol) && (!instrumentName || !hasCjk(instrumentName))) {
      const cn = await fetchTaiwanChineseName(symbol.toUpperCase()).catch(() => null);
      if (cn) instrumentName = cn;
    }
    instrument = await prisma.instrument.create({
      data: {
        symbol: symbol.toUpperCase(),
        name: instrumentName,
        assetClass: inferAssetClass(symbol.toUpperCase()),
        currency: validated?.currency,
      },
    });
  }

  const qty = Number(quantity);
  const px = Number(price);

  const finalFee = Number(fee) || 0;
  const finalTax = Number(tax) || 0;

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
      date: parseCalendarDate(String(date)),
      quantity: qty,
      price: px,
      fee: finalFee,
      tax: finalTax,
      note: note ?? null,
      createdAt: { gte: new Date(Date.now() - DUPLICATE_SUBMIT_WINDOW_MS) },
    },
    include: { instrument: true, account: true },
  });
  if (recentDuplicate) {
    return { body: { ...recentDuplicate, warning }, status: 200 };
  }

  const transaction = await prisma.transaction.create({
    data: {
      accountId: account.id,
      instrumentId: instrument.id,
      type: txType,
      date: parseCalendarDate(String(date)),
      quantity: qty,
      price: px,
      fee: finalFee,
      tax: finalTax,
      note,
    },
    include: { instrument: true, account: true },
  });

  await reconcileAccountCash(account.id);
  await invalidatePerformanceCache();
  return { body: { ...transaction, warning }, status: 201 };
}
