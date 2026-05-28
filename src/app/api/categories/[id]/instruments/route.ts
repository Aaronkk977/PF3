import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: tagId } = await params;
  const body = await request.json();
  const instrumentId = body.instrumentId as string | undefined;

  if (!instrumentId) {
    return NextResponse.json({ error: "instrumentId 必填" }, { status: 400 });
  }

  const tag = await prisma.tag.findUnique({ where: { id: tagId } });
  if (!tag) {
    return NextResponse.json({ error: "類別不存在" }, { status: 404 });
  }

  const instrument = await prisma.instrument.findUnique({
    where: { id: instrumentId },
  });
  if (!instrument) {
    return NextResponse.json({ error: "標的不存在" }, { status: 404 });
  }

  await prisma.tagOnInstrument.upsert({
    where: {
      instrumentId_tagId: { instrumentId, tagId },
    },
    create: { instrumentId, tagId },
    update: {},
  });

  const updated = await prisma.instrument.findUnique({
    where: { id: instrumentId },
    include: { tags: { include: { tag: true } } },
  });

  return NextResponse.json({
    instrumentId,
    categories: updated?.tags.map((t) => t.tag.name) ?? [],
  });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: tagId } = await params;
  const instrumentId = request.nextUrl.searchParams.get("instrumentId");
  if (!instrumentId) {
    return NextResponse.json({ error: "instrumentId 必填" }, { status: 400 });
  }

  await prisma.tagOnInstrument.deleteMany({
    where: { tagId, instrumentId },
  });

  return NextResponse.json({ ok: true });
}
