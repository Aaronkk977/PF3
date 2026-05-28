import { NextRequest, NextResponse } from "next/server";
import { serializeAccount, reconcileAccountCash } from "@/lib/accounts";
import { isValidCurrencyCode } from "@/lib/currencies";
import { prisma } from "@/lib/db";
import { invalidatePerformanceCache } from "@/lib/performance-cache";
function parseOptionalInt(v: unknown): number | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function parseOptionalFloat(v: unknown): number | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await request.json();
  const name = body.name?.trim();
  const currency = body.currency?.trim()?.toUpperCase();

  const existing = await prisma.account.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "帳戶不存在" }, { status: 404 });
  }

  if (name) {
    const dup = await prisma.account.findFirst({
      where: { name, NOT: { id } },
    });
    if (dup) {
      return NextResponse.json({ error: "帳戶名稱已存在" }, { status: 409 });
    }
  }

  if (currency && !isValidCurrencyCode(currency)) {
    return NextResponse.json({ error: "幣別代碼格式無效" }, { status: 400 });
  }

  const data: Record<string, unknown> = {};
  if (name) data.name = name;
  if (currency) data.currency = currency;

  const feeBuy = parseOptionalFloat(body.feeRateBpsBuy);
  const feeSell = parseOptionalFloat(body.feeRateBpsSell);
  const taxBuy = parseOptionalFloat(body.taxRatePctBuy);
  const taxSell = parseOptionalFloat(body.taxRatePctSell);
  if (feeBuy !== undefined) data.feeRateBpsBuy = feeBuy;
  if (feeSell !== undefined) data.feeRateBpsSell = feeSell;
  if (taxBuy !== undefined) data.taxRatePctBuy = taxBuy;
  if (taxSell !== undefined) data.taxRatePctSell = taxSell;
  if (typeof body.feeTaxRoundHalfUp === "boolean") {
    data.feeTaxRoundHalfUp = body.feeTaxRoundHalfUp;
  }

  const account = await prisma.account.update({
    where: { id },
    data,
  });

  const cash = await reconcileAccountCash(id);
  await invalidatePerformanceCache();

  return NextResponse.json(serializeAccount(account, cash));
}
