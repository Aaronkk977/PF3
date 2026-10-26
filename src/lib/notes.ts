import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  parseCalendarDate,
  toLocalDateKey,
  toTransactionDateKey,
} from "@/lib/date-keys";
import { ServiceError } from "@/lib/service-error";

/** 投資筆記的讀寫，網頁 API（/api/notes、/api/note-kinds）與 MCP server 共用。 */

export const NOTE_INCLUDE = {
  instruments: { include: { instrument: true } },
  tags: { include: { tag: true } },
} satisfies Prisma.NoteInclude;

export type NoteWithRelations = Prisma.NoteGetPayload<{
  include: typeof NOTE_INCLUDE;
}>;

/** 網頁 API 回傳的筆記格式 */
export function noteToJson(n: NoteWithRelations) {
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

export type NoteSearch = {
  kind?: string;
  /** exact：類型名稱完全相同（網頁的類型下拉選單）；contains：部分比對（MCP） */
  kindMatch?: "exact" | "contains";
  /** 比對標題或內文 */
  keyword?: string;
  tag?: string;
  symbol?: string;
  /** YYYY-MM-DD，依筆記日期，含頭含尾 */
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
};

/** 標的可以給 id（網頁表單）或代號（MCP），擇一 */
type InstrumentRefs = { instrumentIds?: string[]; symbols?: string[] };

export type NoteInput = InstrumentRefs & {
  title: unknown;
  content: unknown;
  kind: unknown;
  /** YYYY-MM-DD；未提供時為今天 */
  noteDate?: unknown;
  tags?: string[];
};

export type NotePatch = InstrumentRefs & {
  title?: unknown;
  content?: unknown;
  /** 附加在既有內容後面（MCP 協作追蹤用），不可與 content 同時使用 */
  appendContent?: string;
  kind?: unknown;
  noteDate?: unknown;
  tags?: string[];
};

export async function searchNotes(filter: NoteSearch): Promise<NoteWithRelations[]> {
  const where: Prisma.NoteWhereInput = {};

  if (filter.kind) {
    where.kind =
      filter.kindMatch === "contains" ? { contains: filter.kind } : filter.kind;
  }
  if (filter.keyword) {
    where.OR = [
      { title: { contains: filter.keyword } },
      { content: { contains: filter.keyword } },
    ];
  }
  if (filter.tag) {
    where.tags = { some: { tag: { name: { contains: filter.tag } } } };
  }
  if (filter.symbol) {
    where.instruments = {
      some: { instrument: { symbol: { contains: filter.symbol.toUpperCase() } } },
    };
  }
  if (filter.dateFrom || filter.dateTo) {
    where.noteDate = {
      ...(filter.dateFrom ? { gte: parseNoteDate(filter.dateFrom) } : {}),
      ...(filter.dateTo ? { lte: parseNoteDate(filter.dateTo) } : {}),
    };
  }

  return prisma.note.findMany({
    where,
    include: NOTE_INCLUDE,
    orderBy: [{ noteDate: "desc" }, { createdAt: "desc" }],
    take: filter.limit,
  });
}

export async function getNote(id: string): Promise<NoteWithRelations> {
  const note = await prisma.note.findUnique({ where: { id }, include: NOTE_INCLUDE });
  if (!note) throw new ServiceError("筆記不存在", 404);
  return note;
}

export async function createNote(input: NoteInput): Promise<NoteWithRelations> {
  const title = requireText(input.title, "標題必填");
  const content = requireText(input.content, "內容必填");
  const kind = await requireNoteKind(input.kind);
  const noteDate = input.noteDate
    ? parseNoteDate(input.noteDate)
    : parseCalendarDate(toLocalDateKey(new Date()));
  const instrumentIds = await resolveInstrumentRefs(input);

  const note = await prisma.$transaction(async (tx) => {
    const created = await tx.note.create({ data: { title, content, kind, noteDate } });
    await linkInstruments(tx, created.id, instrumentIds);
    await linkTags(tx, created.id, input.tags ?? []);
    return created;
  });
  return getNote(note.id);
}

export async function updateNote(id: string, patch: NotePatch): Promise<NoteWithRelations> {
  const existing = await prisma.note.findUnique({ where: { id } });
  if (!existing) throw new ServiceError("筆記不存在", 404);

  if (patch.content !== undefined && patch.appendContent !== undefined) {
    throw new ServiceError("content 與 append_content 不可同時使用（一個是整段取代，一個是附加）");
  }

  const data: Prisma.NoteUpdateInput = {};
  if (patch.title !== undefined) data.title = requireText(patch.title, "標題必填");
  if (patch.content !== undefined) {
    data.content = requireText(patch.content, "內容必填");
  } else if (patch.appendContent !== undefined) {
    const addition = requireText(patch.appendContent, "append_content 不可為空");
    data.content = `${existing.content}\n\n---\n[${toLocalDateKey(new Date())} 補充]\n${addition}`;
  }
  if (patch.kind !== undefined) data.kind = await requireNoteKind(patch.kind);
  if (patch.noteDate !== undefined) data.noteDate = parseNoteDate(patch.noteDate);

  const relinkInstruments =
    patch.instrumentIds !== undefined || patch.symbols !== undefined;
  const instrumentIds = relinkInstruments ? await resolveInstrumentRefs(patch) : [];

  await prisma.$transaction(async (tx) => {
    if (Object.keys(data).length > 0) {
      await tx.note.update({ where: { id }, data });
    }
    if (relinkInstruments) {
      await tx.noteOnInstrument.deleteMany({ where: { noteId: id } });
      await linkInstruments(tx, id, instrumentIds);
    }
    if (patch.tags !== undefined) {
      await tx.noteOnTag.deleteMany({ where: { noteId: id } });
      await linkTags(tx, id, patch.tags);
    }
  });
  return getNote(id);
}

export async function deleteNote(id: string): Promise<void> {
  const note = await prisma.note.findUnique({ where: { id } });
  if (!note) throw new ServiceError("筆記不存在", 404);
  await prisma.note.delete({ where: { id } });
}

// ── 筆記類型 ────────────────────────────────────────────────────────────────

export async function listNoteKinds(): Promise<{ id: string; name: string }[]> {
  const kinds = await prisma.noteKind.findMany({ orderBy: { sortOrder: "asc" } });
  return kinds.map((k) => ({ id: k.id, name: k.name }));
}

/** 已存在同名類型時直接回傳那一筆（created: false） */
export async function createNoteKind(
  rawName: unknown,
): Promise<{ kind: { id: string; name: string }; created: boolean }> {
  const name = requireText(rawName, "名稱必填");
  const existing = await prisma.noteKind.findUnique({ where: { name } });
  if (existing) return { kind: { id: existing.id, name: existing.name }, created: false };

  const maxRow = await prisma.noteKind.findFirst({ orderBy: { sortOrder: "desc" } });
  const kind = await prisma.noteKind.create({
    data: { name, sortOrder: (maxRow?.sortOrder ?? -1) + 1 },
  });
  return { kind: { id: kind.id, name: kind.name }, created: true };
}

export async function deleteNoteKind(id: string): Promise<void> {
  const kind = await prisma.noteKind.findUnique({ where: { id } });
  if (!kind) throw new ServiceError("類型不存在", 404);
  // Note.kind 只存名稱字串（非外鍵），刪除類型不影響已使用該類型的舊筆記。
  await prisma.noteKind.delete({ where: { id } });
}

// ── helpers ─────────────────────────────────────────────────────────────────

function requireText(value: unknown, message: string): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) throw new ServiceError(message);
  return trimmed;
}

function parseNoteDate(value: unknown): Date {
  try {
    return parseCalendarDate(String(value));
  } catch {
    throw new ServiceError("日期格式無效");
  }
}

async function requireNoteKind(value: unknown): Promise<string> {
  const kind = requireText(value, "類型必填");
  const exists = await prisma.noteKind.findUnique({ where: { name: kind } });
  if (exists) return kind;
  const kinds = await listNoteKinds();
  throw new ServiceError(
    `找不到筆記類型「${kind}」。目前可用類型：${kinds.map((k) => k.name).join("、") || "（無，請先在網頁上新增類型）"}`,
  );
}

/** 標的 id 或代號 → instrumentIds；有任何一個找不到就丟錯，避免筆記悄悄連錯
 *  （或連不到）標的。 */
async function resolveInstrumentRefs(refs: InstrumentRefs): Promise<string[]> {
  if (refs.symbols !== undefined) {
    const wanted = [...new Set(refs.symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))];
    if (wanted.length === 0) return [];
    const found = await prisma.instrument.findMany({
      where: { symbol: { in: wanted } },
      select: { id: true, symbol: true },
    });
    const foundSymbols = new Set(found.map((f) => f.symbol));
    const missing = wanted.filter((s) => !foundSymbols.has(s));
    if (missing.length > 0) {
      throw new ServiceError(`找不到標的代號：${missing.join("、")}（請確認代號是否存在於系統中）`);
    }
    return found.map((f) => f.id);
  }

  const ids = [...new Set(refs.instrumentIds ?? [])];
  if (ids.length === 0) return [];
  const found = await prisma.instrument.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  });
  if (found.length !== ids.length) throw new ServiceError("找不到標的");
  return ids;
}

async function linkInstruments(
  tx: Prisma.TransactionClient,
  noteId: string,
  instrumentIds: string[],
): Promise<void> {
  for (const instrumentId of instrumentIds) {
    await tx.noteOnInstrument.create({ data: { noteId, instrumentId } });
  }
}

async function linkTags(
  tx: Prisma.TransactionClient,
  noteId: string,
  tagNames: string[],
): Promise<void> {
  const names = [...new Set(tagNames.map((t) => t.trim()).filter(Boolean))];
  for (const name of names) {
    const tag = await tx.tag.upsert({ where: { name }, create: { name }, update: {} });
    await tx.noteOnTag.create({ data: { noteId, tagId: tag.id } });
  }
}
