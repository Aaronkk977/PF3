import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const existing = await prisma.benchmark.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "基準不存在" }, { status: 404 });
  }

  await prisma.benchmark.delete({ where: { id } });
  return NextResponse.json({ ok: true, symbol: existing.symbol });
}
