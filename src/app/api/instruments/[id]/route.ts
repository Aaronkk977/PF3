import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const instrument = await prisma.instrument.findUnique({
    where: { id },
    include: { tags: { include: { tag: true } } },
  });
  if (!instrument) {
    return NextResponse.json({ error: "標的不存在" }, { status: 404 });
  }
  return NextResponse.json({
    id: instrument.id,
    symbol: instrument.symbol,
    name: instrument.name,
    notes: instrument.notes,
    assetClass: instrument.assetClass,
    currency: instrument.currency,
    tags: instrument.tags.map((t) => t.tag.name),
  });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await request.json();

  const instrument = await prisma.instrument.findUnique({ where: { id } });
  if (!instrument) {
    return NextResponse.json({ error: "標的不存在" }, { status: 404 });
  }

  const data: { name?: string | null; notes?: string | null } = {};

  if ("name" in body) {
    const raw = body.name;
    if (raw === null || raw === "") {
      data.name = null;
    } else if (typeof raw === "string") {
      const trimmed = raw.trim();
      data.name = trimmed || null;
    } else {
      return NextResponse.json({ error: "名稱格式無效" }, { status: 400 });
    }
  }

  if ("notes" in body) {
    const raw = body.notes;
    if (raw === null || raw === "") {
      data.notes = null;
    } else if (typeof raw === "string") {
      data.notes = raw;
    } else {
      return NextResponse.json({ error: "筆記格式無效" }, { status: 400 });
    }
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "無可更新欄位" }, { status: 400 });
  }

  const updated = await prisma.instrument.update({
    where: { id },
    data,
    include: { tags: { include: { tag: true } } },
  });

  return NextResponse.json({
    id: updated.id,
    symbol: updated.symbol,
    name: updated.name,
    notes: updated.notes,
    assetClass: updated.assetClass,
    currency: updated.currency,
    tags: updated.tags.map((t) => t.tag.name),
  });
}
