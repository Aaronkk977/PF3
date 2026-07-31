import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { parseCalendarDate, toTransactionDateKey } from "@/lib/date-keys";

type NoteWithRelations = Prisma.NoteGetPayload<{
  include: {
    instruments: { include: { instrument: true } };
    tags: { include: { tag: true } };
  };
}>;

function toNoteJson(n: NoteWithRelations) {
  return {
    id: n.id,
    title: n.title,
    content: n.content,
    kind: n.kind,
    noteDate: toTransactionDateKey(n.noteDate),
    instruments: n.instruments.map((link) => ({
      id: link.instrument.id,
      symbol: link.instrument.symbol,
      name: link.instrument.name,
    })),
    tags: n.tags.map((link) => link.tag.name),
    createdAt: n.createdAt.toISOString(),
    updatedAt: n.updatedAt.toISOString(),
  };
}

const NOTE_INCLUDE = {
  instruments: { include: { instrument: true } },
  tags: { include: { tag: true } },
} satisfies Prisma.NoteInclude;

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await request.json();

  const note = await prisma.note.findUnique({ where: { id } });
  if (!note) {
    return NextResponse.json({ error: "筆記不存在" }, { status: 404 });
  }

  const data: Prisma.NoteUpdateInput = {};

  if ("title" in body) {
    const trimmed = typeof body.title === "string" ? body.title.trim() : "";
    if (!trimmed) {
      return NextResponse.json({ error: "標題必填" }, { status: 400 });
    }
    data.title = trimmed;
  }

  if ("content" in body) {
    const trimmed = typeof body.content === "string" ? body.content.trim() : "";
    if (!trimmed) {
      return NextResponse.json({ error: "內容必填" }, { status: 400 });
    }
    data.content = trimmed;
  }

  if ("kind" in body) {
    const kind = typeof body.kind === "string" ? body.kind.trim() : "";
    if (!kind) {
      return NextResponse.json({ error: "類型必填" }, { status: 400 });
    }
    const kindExists = await prisma.noteKind.findUnique({ where: { name: kind } });
    if (!kindExists) {
      return NextResponse.json({ error: "找不到此筆記類型" }, { status: 400 });
    }
    data.kind = kind;
  }

  if ("noteDate" in body) {
    try {
      data.noteDate = parseCalendarDate(String(body.noteDate));
    } catch {
      return NextResponse.json({ error: "日期格式無效" }, { status: 400 });
    }
  }

  if (Object.keys(data).length > 0) {
    await prisma.note.update({ where: { id }, data });
  }

  if ("instrumentIds" in body) {
    const instrumentIds: string[] = Array.isArray(body.instrumentIds)
      ? body.instrumentIds
      : [];
    if (instrumentIds.length > 0) {
      const found = await prisma.instrument.findMany({
        where: { id: { in: instrumentIds } },
        select: { id: true },
      });
      if (found.length !== instrumentIds.length) {
        return NextResponse.json({ error: "找不到標的" }, { status: 400 });
      }
    }
    await prisma.noteOnInstrument.deleteMany({ where: { noteId: id } });
    for (const instrumentId of instrumentIds) {
      await prisma.noteOnInstrument.create({ data: { noteId: id, instrumentId } });
    }
  }

  if ("tags" in body) {
    const tagNames: string[] = Array.isArray(body.tags) ? body.tags : [];
    await prisma.noteOnTag.deleteMany({ where: { noteId: id } });
    for (const name of tagNames) {
      const trimmed = name.trim();
      if (!trimmed) continue;
      const tag = await prisma.tag.upsert({
        where: { name: trimmed },
        create: { name: trimmed },
        update: {},
      });
      await prisma.noteOnTag.create({ data: { noteId: id, tagId: tag.id } });
    }
  }

  const updated = await prisma.note.findUniqueOrThrow({
    where: { id },
    include: NOTE_INCLUDE,
  });

  return NextResponse.json(toNoteJson(updated));
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const note = await prisma.note.findUnique({ where: { id } });
  if (!note) {
    return NextResponse.json({ error: "筆記不存在" }, { status: 404 });
  }
  await prisma.note.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
