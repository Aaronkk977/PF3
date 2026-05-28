import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const symbol = body.symbol as string | undefined;

  return NextResponse.json({
    symbol,
    suggestedTags: [],
    note: "LLM 自動打標將於 v2 實作，目前為 mock 建議。",
  });
}
