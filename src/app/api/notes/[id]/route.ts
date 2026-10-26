import { NextRequest, NextResponse } from "next/server";
import { serviceErrorResponse } from "@/lib/api-errors";
import { deleteNote, noteToJson, updateNote, type NotePatch } from "@/lib/notes";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await request.json();

  // 只更新 body 裡有出現的欄位
  const patch: NotePatch = {};
  if ("title" in body) patch.title = body.title;
  if ("content" in body) patch.content = body.content;
  if ("kind" in body) patch.kind = body.kind;
  if ("noteDate" in body) patch.noteDate = body.noteDate;
  if ("instrumentIds" in body) {
    patch.instrumentIds = Array.isArray(body.instrumentIds) ? body.instrumentIds : [];
  }
  if ("tags" in body) patch.tags = Array.isArray(body.tags) ? body.tags : [];

  try {
    return NextResponse.json(noteToJson(await updateNote(id, patch)));
  } catch (err) {
    return serviceErrorResponse(err);
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    await deleteNote(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return serviceErrorResponse(err);
  }
}
