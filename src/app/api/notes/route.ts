import { NextRequest, NextResponse } from "next/server";
import { serviceErrorResponse } from "@/lib/api-errors";
import { createNote, noteToJson, searchNotes } from "@/lib/notes";

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  try {
    const notes = await searchNotes({
      kind: sp.get("kind") ?? undefined,
      kindMatch: "exact",
      tag: sp.get("tag") ?? undefined,
      symbol: sp.get("symbol") ?? undefined,
      keyword: sp.get("q") ?? undefined,
      dateFrom: sp.get("date_from") ?? undefined,
      dateTo: sp.get("date_to") ?? undefined,
    });
    return NextResponse.json(notes.map(noteToJson));
  } catch (err) {
    return serviceErrorResponse(err);
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  try {
    const note = await createNote({
      title: body.title,
      content: body.content,
      kind: body.kind,
      noteDate: body.noteDate,
      instrumentIds: Array.isArray(body.instrumentIds) ? body.instrumentIds : [],
      tags: Array.isArray(body.tags) ? body.tags : [],
    });
    return NextResponse.json(noteToJson(note), { status: 201 });
  } catch (err) {
    return serviceErrorResponse(err);
  }
}
