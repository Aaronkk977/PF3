import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ensureInstrument } from "@/lib/ensure-instrument";

/** 把追蹤清單裡的所有標的（排除分隔線）一次套用成某個類別 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: tagId } = await params;
  const body = await request.json();
  const watchlistId = body.watchlistId as string | undefined;

  if (!watchlistId) {
    return NextResponse.json({ error: "watchlistId 必填" }, { status: 400 });
  }

  const tag = await prisma.tag.findUnique({ where: { id: tagId } });
  if (!tag) {
    return NextResponse.json({ error: "類別不存在" }, { status: 404 });
  }

  const watchlist = await prisma.watchlist.findUnique({
    where: { id: watchlistId },
    include: {
      items: { where: { kind: "SYMBOL" }, select: { symbol: true, name: true } },
    },
  });
  if (!watchlist) {
    return NextResponse.json({ error: "追蹤清單不存在" }, { status: 404 });
  }

  const symbols = watchlist.items
    .map((i) => i.symbol)
    .filter((s): s is string => !!s);

  let added = 0;
  for (const item of watchlist.items) {
    if (!item.symbol) continue;
    const instrument = await ensureInstrument(item.symbol, {
      name: item.name,
    });
    await prisma.tagOnInstrument.upsert({
      where: { instrumentId_tagId: { instrumentId: instrument.id, tagId } },
      create: { instrumentId: instrument.id, tagId },
      update: {},
    });
    added += 1;
  }

  const updatedTag = await prisma.tag.findUnique({
    where: { id: tagId },
    include: { _count: { select: { instruments: true } } },
  });

  return NextResponse.json({
    id: updatedTag!.id,
    name: updatedTag!.name,
    instrumentCount: updatedTag!._count.instruments,
    appliedCount: added,
    symbolCount: symbols.length,
  });
}
