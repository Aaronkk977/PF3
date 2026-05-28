import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await request.json();
  const tagNames: string[] = body.tags ?? [];

  const instrument = await prisma.instrument.findUnique({ where: { id } });
  if (!instrument) {
    return NextResponse.json({ error: "標的不存在" }, { status: 404 });
  }

  await prisma.tagOnInstrument.deleteMany({ where: { instrumentId: id } });

  for (const name of tagNames) {
    const trimmed = name.trim();
    if (!trimmed) continue;
    const tag = await prisma.tag.upsert({
      where: { name: trimmed },
      create: { name: trimmed },
      update: {},
    });
    await prisma.tagOnInstrument.create({
      data: { instrumentId: id, tagId: tag.id },
    });
  }

  const updated = await prisma.instrument.findUnique({
    where: { id },
    include: { tags: { include: { tag: true } } },
  });

  return NextResponse.json({
    ...updated,
    tags: updated?.tags.map((t) => t.tag.name) ?? [],
  });
}
