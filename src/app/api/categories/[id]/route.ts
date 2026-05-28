import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await request.json();
  const name = (body.name as string)?.trim();
  if (!name) {
    return NextResponse.json({ error: "類別名稱必填" }, { status: 400 });
  }

  const tag = await prisma.tag.findUnique({ where: { id } });
  if (!tag) {
    return NextResponse.json({ error: "類別不存在" }, { status: 404 });
  }

  const conflict = await prisma.tag.findFirst({
    where: { name, NOT: { id } },
  });
  if (conflict) {
    return NextResponse.json({ error: "此類別名稱已被使用" }, { status: 409 });
  }

  const updated = await prisma.tag.update({
    where: { id },
    data: { name },
    include: { _count: { select: { instruments: true } } },
  });

  return NextResponse.json({
    id: updated.id,
    name: updated.name,
    instrumentCount: updated._count.instruments,
  });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const tag = await prisma.tag.findUnique({ where: { id } });
  if (!tag) {
    return NextResponse.json({ error: "類別不存在" }, { status: 404 });
  }

  await prisma.tag.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
