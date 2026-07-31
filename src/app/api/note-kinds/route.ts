import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET() {
  const kinds = await prisma.noteKind.findMany({ orderBy: { sortOrder: "asc" } });
  return NextResponse.json(kinds.map((k) => ({ id: k.id, name: k.name })));
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "名稱必填" }, { status: 400 });
  }

  const existing = await prisma.noteKind.findUnique({ where: { name } });
  if (existing) {
    return NextResponse.json({ id: existing.id, name: existing.name });
  }

  const maxRow = await prisma.noteKind.findFirst({ orderBy: { sortOrder: "desc" } });
  const kind = await prisma.noteKind.create({
    data: { name, sortOrder: (maxRow?.sortOrder ?? -1) + 1 },
  });

  return NextResponse.json({ id: kind.id, name: kind.name }, { status: 201 });
}
