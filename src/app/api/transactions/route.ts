import { NextRequest, NextResponse } from "next/server";
import { getOrCreateAccount, reconcileAccountCash } from "@/lib/accounts";
import { prisma } from "@/lib/db";
import { invalidatePerformanceCache } from "@/lib/performance-cache";
import { parseCalendarDate, toTransactionDateKey } from "@/lib/date-keys";
import { checkSellExceedsHolding, getHeldQuantity } from "@/lib/position-check";
import { toNumber } from "@/lib/utils";

const CASH_TYPES = new Set(["DEPOSIT", "WITHDRAWAL"]);

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

  const txType = type.toUpperCase();
  const account = await getOrCreateAccount(accountId, accountName);

  if (CASH_TYPES.has(txType)) {
    const amt = Number(price ?? quantity);
    if (!amt || amt <= 0) {
      return NextResponse.json({ error: "請輸入有效金額" }, { status: 400 });
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

    return NextResponse.json(transaction, { status: 201 });
  }

  if (!symbol || quantity === undefined || price === undefined) {
    return NextResponse.json({ error: "缺少必要欄位" }, { status: 400 });
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
  return NextResponse.json({ ...transaction, warning }, { status: 201 });
}
