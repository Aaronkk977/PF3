import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { resolveInstrumentDisplayName } from "@/lib/instrument-display-name";
import { inferAssetClass, validateSymbol } from "@/lib/yahoo";

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q");

  if (q) {
    const validated = await validateSymbol(q.toUpperCase());
    if (!validated) {
      return NextResponse.json({ error: "找不到此代碼" }, { status: 404 });
    }
    return NextResponse.json(validated);
  }

  const instruments = await prisma.instrument.findMany({
    include: { tags: { include: { tag: true } } },
    orderBy: { symbol: "asc" },
  });

  return NextResponse.json(
    instruments.map((i) => ({
      ...i,
      tags: i.tags.map((t) => t.tag.name),
    })),
  );
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const symbol = (body.symbol as string)?.toUpperCase();
  if (!symbol) {
    return NextResponse.json({ error: "symbol 必填" }, { status: 400 });
  }

  const existing = await prisma.instrument.findUnique({ where: { symbol } });
  if (existing) {
    return NextResponse.json(existing);
  }

  const validated = await validateSymbol(symbol);
  if (!validated) {
    return NextResponse.json({ error: "Yahoo 無法驗證此代碼" }, { status: 400 });
  }

  const resolvedName =
    (body.name as string | undefined)?.trim() ||
    (await resolveInstrumentDisplayName(symbol, [validated.name]));

  const instrument = await prisma.instrument.create({
    data: {
      symbol,
      name: resolvedName || null,
      assetClass: body.assetClass ?? inferAssetClass(symbol),
      currency: body.currency ?? validated.currency,
    },
  });

  return NextResponse.json(instrument, { status: 201 });
}
