import { NextResponse } from "next/server";
import { getQuote } from "@/lib/yahoo";
import { decodeSymbol } from "@/lib/utils";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ symbol: string }> },
) {
  const { symbol: encoded } = await params;
  const symbol = decodeSymbol(encoded);

  try {
    const quote = await getQuote(symbol);
    return NextResponse.json(quote);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "報價取得失敗" },
      { status: 500 },
    );
  }
}
