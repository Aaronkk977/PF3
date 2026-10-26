import { NextRequest, NextResponse } from "next/server";
import { serviceErrorResponse } from "@/lib/api-errors";
import { createNoteKind, listNoteKinds } from "@/lib/notes";

export async function GET() {
  return NextResponse.json(await listNoteKinds());
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  try {
    const { kind, created } = await createNoteKind(body.name);
    return NextResponse.json(kind, { status: created ? 201 : 200 });
  } catch (err) {
    return serviceErrorResponse(err);
  }
}
