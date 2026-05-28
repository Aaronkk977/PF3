import { NextRequest, NextResponse } from "next/server";
import {
  listAccountsWithComputedCash,
  serializeAccount,
} from "@/lib/accounts";
import { isValidCurrencyCode } from "@/lib/currencies";
import { prisma } from "@/lib/db";

export async function GET() {
  const accounts = await listAccountsWithComputedCash();
  return NextResponse.json(accounts);
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const name = body.name?.trim();
  const currency = (body.currency?.trim() || "TWD").toUpperCase();

  if (!name) {
    return NextResponse.json({ error: "請輸入帳戶名稱" }, { status: 400 });
  }
  if (!isValidCurrencyCode(currency)) {
    return NextResponse.json({ error: "幣別代碼格式無效" }, { status: 400 });
  }

  const existing = await prisma.account.findFirst({ where: { name } });
  if (existing) {
    return NextResponse.json({ error: "帳戶名稱已存在" }, { status: 409 });
  }

  const account = await prisma.account.create({
    data: {
      name,
      currency,
      cash: 0,
      feeRateBpsBuy: body.feeRateBpsBuy != null ? Number(body.feeRateBpsBuy) : undefined,
      feeRateBpsSell:
        body.feeRateBpsSell != null ? Number(body.feeRateBpsSell) : undefined,
      taxRatePctBuy:
        body.taxRatePctBuy != null ? Number(body.taxRatePctBuy) : undefined,
      taxRatePctSell:
        body.taxRatePctSell != null ? Number(body.taxRatePctSell) : undefined,
    },
  });

  return NextResponse.json(serializeAccount(account, 0), { status: 201 });
}
