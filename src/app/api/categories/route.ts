import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET() {
  const tags = await prisma.tag.findMany({
    orderBy: { name: "asc" },
    include: {
      instruments: {
        select: { instrument: { select: { id: true, symbol: true, name: true } } },
      },
    },
  });

  return NextResponse.json({
    categories: tags.map((t) => ({
      id: t.id,
      name: t.name,
      instrumentCount: t.instruments.length,
      instruments: t.instruments
        .map((x) => x.instrument)
        .sort((a, b) => a.symbol.localeCompare(b.symbol)),
    })),
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const name = (body.name as string)?.trim();
  if (!name) {
    return NextResponse.json({ error: "類別名稱必填" }, { status: 400 });
  }

  const existing = await prisma.tag.findUnique({ where: { name } });
  if (existing) {
    return NextResponse.json(
      { error: "此類別已存在" },
      { status: 409 },
    );
  }

  const tag = await prisma.tag.create({ data: { name } });
  return NextResponse.json(
    { id: tag.id, name: tag.name, instrumentCount: 0 },
    { status: 201 },
  );
}
