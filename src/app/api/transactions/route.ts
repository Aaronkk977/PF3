import { NextRequest, NextResponse } from "next/server";
import { serviceErrorResponse } from "@/lib/api-errors";
import { createTransaction, listTransactions } from "@/lib/transactions";

export async function GET() {
  return NextResponse.json(await listTransactions());
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  try {
    const { transaction, warning, created } = await createTransaction({
      symbol: body.symbol,
      type: body.type,
      date: body.date,
      quantity: body.quantity,
      price: body.price,
      fee: body.fee,
      tax: body.tax,
      note: body.note,
      accountId: body.accountId,
      accountName: body.accountName,
    });
    return NextResponse.json(
      { ...transaction, warning },
      { status: created ? 201 : 200 },
    );
  } catch (err) {
    return serviceErrorResponse(err);
  }
}
