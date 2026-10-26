import { NextRequest, NextResponse } from "next/server";
import { serviceErrorResponse } from "@/lib/api-errors";
import { deleteTransaction, updateTransaction } from "@/lib/transactions";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await request.json();
  try {
    const { transaction, warning } = await updateTransaction(id, {
      type: body.type,
      accountId: body.accountId,
      date: body.date,
      symbol: body.symbol,
      quantity: body.quantity,
      price: body.price,
      amount: body.amount,
      fee: body.fee,
      tax: body.tax,
      autoFeeTax: body.autoFeeTax,
      note: body.note,
    });
    return NextResponse.json({ ...transaction, warning });
  } catch (err) {
    return serviceErrorResponse(err);
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    await deleteTransaction(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return serviceErrorResponse(err);
  }
}
