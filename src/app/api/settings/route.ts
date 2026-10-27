import { NextRequest, NextResponse } from "next/server";
import { serviceErrorResponse } from "@/lib/api-errors";
import { getAllAppSettings, setAppSetting } from "@/lib/app-settings";

export async function GET() {
  return NextResponse.json(await getAllAppSettings());
}

export async function PUT(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body.key !== "string") {
    return NextResponse.json({ error: "缺少設定名稱" }, { status: 400 });
  }
  try {
    await setAppSetting(body.key, body.value);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return serviceErrorResponse(err);
  }
}
