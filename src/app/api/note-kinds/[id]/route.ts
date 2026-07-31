import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const kind = await prisma.noteKind.findUnique({ where: { id } });
  if (!kind) {
    return NextResponse.json({ error: "類型不存在" }, { status: 404 });
  }
  // Note.kind 只存名稱字串（非外鍵），刪除類型不影響已使用該類型的舊筆記。
  await prisma.noteKind.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
