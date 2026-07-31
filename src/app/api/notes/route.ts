import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { parseCalendarDate, toLocalDateKey, toTransactionDateKey } from "@/lib/date-keys";

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

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const where: Prisma.NoteWhereInput = {};

  const kind = sp.get("kind");
  if (kind) where.kind = kind;

  const tag = sp.get("tag");
  if (tag) where.tags = { some: { tag: { name: { contains: tag } } } };

  const symbol = sp.get("symbol");
  if (symbol) {
    where.instruments = {
      some: { instrument: { symbol: { contains: symbol.toUpperCase() } } },
    };
  }

  const q = sp.get("q");
  if (q) {
    where.OR = [{ title: { contains: q } }, { content: { contains: q } }];
  }

  const dateFrom = sp.get("date_from");
  const dateTo = sp.get("date_to");
  if (dateFrom || dateTo) {
    where.noteDate = {};
    if (dateFrom) {
      (where.noteDate as Prisma.DateTimeFilter).gte = parseCalendarDate(dateFrom);
    }
    if (dateTo) {
      (where.noteDate as Prisma.DateTimeFilter).lte = parseCalendarDate(dateTo);
    }
  }

  const notes = await prisma.note.findMany({
    where,
    include: NOTE_INCLUDE,
    orderBy: [{ noteDate: "desc" }, { createdAt: "desc" }],
  });

  return NextResponse.json(notes.map(toNoteJson));
}

export async function POST(request: NextRequest) {
  const body = await request.json();

  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) {
    return NextResponse.json({ error: "標題必填" }, { status: 400 });
  }

  const content = typeof body.content === "string" ? body.content.trim() : "";
  if (!content) {
    return NextResponse.json({ error: "內容必填" }, { status: 400 });
  }

  const kind = typeof body.kind === "string" ? body.kind.trim() : "";
  if (!kind) {
    return NextResponse.json({ error: "類型必填" }, { status: 400 });
  }
  const kindExists = await prisma.noteKind.findUnique({ where: { name: kind } });
  if (!kindExists) {
    return NextResponse.json({ error: "找不到此筆記類型" }, { status: 400 });
  }

  let noteDate: Date;
  try {
    noteDate = body.noteDate
      ? parseCalendarDate(String(body.noteDate))
      : parseCalendarDate(toLocalDateKey(new Date()));
  } catch {
    return NextResponse.json({ error: "日期格式無效" }, { status: 400 });
  }

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

  const tagNames: string[] = Array.isArray(body.tags) ? body.tags : [];

  const note = await prisma.note.create({
    data: { title, content, kind, noteDate },
  });

  for (const instrumentId of instrumentIds) {
    await prisma.noteOnInstrument.create({
      data: { noteId: note.id, instrumentId },
    });
  }

  for (const name of tagNames) {
    const trimmed = name.trim();
    if (!trimmed) continue;
    const tag = await prisma.tag.upsert({
      where: { name: trimmed },
      create: { name: trimmed },
      update: {},
    });
    await prisma.noteOnTag.create({ data: { noteId: note.id, tagId: tag.id } });
  }

  const created = await prisma.note.findUniqueOrThrow({
    where: { id: note.id },
    include: NOTE_INCLUDE,
  });

  return NextResponse.json(toNoteJson(created), { status: 201 });
}
