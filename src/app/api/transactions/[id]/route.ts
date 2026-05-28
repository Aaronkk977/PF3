import { NextRequest, NextResponse } from "next/server";
import { reconcileAccountCash } from "@/lib/accounts";
import { prisma } from "@/lib/db";
import { applyAutoFeeTax } from "@/lib/fee-tax";
import { inferInstrumentCurrency } from "@/lib/instrument-currency";
import { parseCalendarDate } from "@/lib/date-keys";
import { invalidatePerformanceCache } from "@/lib/performance-cache";

const CASH_TYPES = new Set(["DEPOSIT", "WITHDRAWAL"]);

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await request.json();

  const existing = await prisma.transaction.findUnique({
    where: { id },
    include: { instrument: true, account: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "交易不存在" }, { status: 404 });
  }

  const txType = (body.type ?? existing.type).toUpperCase();
  const accountId = body.accountId ?? existing.accountId;
  const date = body.date
    ? parseCalendarDate(String(body.date))
    : existing.date;

  if (CASH_TYPES.has(txType)) {
    const amt = Number(body.price ?? body.amount ?? existing.price);
    if (!amt || amt <= 0) {
      return NextResponse.json({ error: "請輸入有效金額" }, { status: 400 });
    }

    const updated = await prisma.transaction.update({
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
        note: body.note !== undefined ? body.note || null : existing.note,
      },
    });

    await reconcileAccountCash(accountId);
    if (existing.accountId !== accountId) {
      await reconcileAccountCash(existing.accountId);
    }
    await invalidatePerformanceCache();
    return NextResponse.json(updated);
  }

  const symbol = (body.symbol ?? existing.instrument?.symbol ?? "")
    .toString()
    .toUpperCase();
  if (!symbol) {
    return NextResponse.json({ error: "缺少標的代碼" }, { status: 400 });
  }

  let instrument = await prisma.instrument.findUnique({ where: { symbol } });
  if (!instrument) {
    const { validateSymbol, inferAssetClass } = await import("@/lib/yahoo");
    const validated = await validateSymbol(symbol);
    instrument = await prisma.instrument.create({
      data: {
        symbol,
        name: validated?.name,
        assetClass: inferAssetClass(symbol),
        currency: inferInstrumentCurrency(
          symbol,
          validated?.currency,
          validated?.currency,
        ),
      },
    });
  }

  const qty = Number(body.quantity ?? existing.quantity);
  const px = Number(body.price ?? existing.price);
  const account = await prisma.account.findUniqueOrThrow({
    where: { id: accountId },
  });

  const autoFeeTax = body.autoFeeTax !== false;
  const { fee, tax } = autoFeeTax
    ? applyAutoFeeTax(
        account,
        instrument,
        txType,
        qty,
        px,
        body.fee !== undefined && body.fee !== ""
          ? Number(body.fee)
          : undefined,
        body.tax !== undefined && body.tax !== ""
          ? Number(body.tax)
          : undefined,
      )
    : {
        fee: Number(body.fee ?? existing.fee) || 0,
        tax: Number(body.tax ?? existing.tax) || 0,
      };

  const updated = await prisma.transaction.update({
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
      note: body.note !== undefined ? body.note || null : existing.note,
    },
    include: { instrument: true, account: true },
  });

  await reconcileAccountCash(accountId);
  if (existing.accountId !== accountId) {
    await reconcileAccountCash(existing.accountId);
  }
  await invalidatePerformanceCache();
  return NextResponse.json(updated);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const existing = await prisma.transaction.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "交易不存在" }, { status: 404 });
  }

  const accountId = existing.accountId;
  await prisma.transaction.delete({ where: { id } });
  await reconcileAccountCash(accountId);
  await invalidatePerformanceCache();

  return NextResponse.json({ ok: true });
}
