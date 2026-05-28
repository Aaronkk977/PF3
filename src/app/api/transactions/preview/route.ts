import { NextRequest, NextResponse } from "next/server";
import { calculateFeeTax } from "@/lib/fee-tax";
import { normalizeSymbolInput } from "@/lib/instrument-search";
import { prisma } from "@/lib/db";
import { findCloseOnOrBefore } from "@/lib/price-on-date";
import { getHistoricalPrices, validateSymbol } from "@/lib/yahoo";

export async function GET(request: NextRequest) {
  const p = request.nextUrl.searchParams;
  const rawSymbol = p.get("symbol")?.trim() ?? "";
  const dateStr = p.get("date")?.slice(0, 10);
  const type = (p.get("type") ?? "BUY").toUpperCase();
  const accountId = p.get("accountId");
  const quantity = Number(p.get("quantity"));
  const priceParam = p.get("price");

  if (!rawSymbol || !dateStr || !accountId) {
    return NextResponse.json({ error: "缺少必要參數" }, { status: 400 });
  }

  const normalized = normalizeSymbolInput(rawSymbol);
  let symbol = normalized;
  let name = normalized;

  let instrument = await prisma.instrument.findUnique({
    where: { symbol: normalized },
  });

  if (instrument) {
    symbol = instrument.symbol;
    name = instrument.name ?? symbol;
  } else {
    const validated = await validateSymbol(normalized);
    if (validated) {
      symbol = validated.symbol;
      name = validated.name ?? symbol;
      instrument = await prisma.instrument.findUnique({
        where: { symbol },
      });
    }
  }

  let price: number | null =
    priceParam != null && priceParam !== ""
      ? Number(priceParam)
      : null;
  if (price == null || Number.isNaN(price)) {
    const end = new Date(`${dateStr}T12:00:00`);
    const start = new Date(end);
    start.setDate(start.getDate() - 21);
    try {
      const bars = await getHistoricalPrices(symbol, start, end);
      const bar = findCloseOnOrBefore(bars, dateStr);
      price = bar?.close ?? null;
    } catch {
      price = null;
    }
  }

  let fee = 0;
  let tax = 0;
  const qty = Number.isFinite(quantity) && quantity > 0 ? quantity : 0;

  if (qty > 0 && price != null && price > 0 && !Number.isNaN(price)) {
    const account = await prisma.account.findUniqueOrThrow({
      where: { id: accountId },
    });
    const inst = instrument ?? { symbol };
    const roundHalfUp = p.get("roundHalfUp") === "1";
    ({ fee, tax } = calculateFeeTax(
      type,
      qty,
      price,
      {
        account: { ...account, name: account.name },
        instrument: inst,
      },
      { roundHalfUp },
    ));
  }

  return NextResponse.json({
    symbol,
    name,
    price,
    fee,
    tax,
  });
}
