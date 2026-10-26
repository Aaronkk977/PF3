import { NextRequest, NextResponse } from "next/server";
import { serviceErrorResponse } from "@/lib/api-errors";
import { deleteNoteKind } from "@/lib/notes";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    await deleteNoteKind(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return serviceErrorResponse(err);
  }
}
