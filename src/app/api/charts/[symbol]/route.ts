import { NextRequest, NextResponse } from "next/server";
import { getHistoricalPrices } from "@/lib/yahoo";
import { decodeSymbol } from "@/lib/utils";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ symbol: string }> },
) {
  const { symbol: encoded } = await params;
  const symbol = decodeSymbol(encoded);
  const searchParams = request.nextUrl.searchParams;

  const periodEnd = searchParams.get("end")
    ? new Date(searchParams.get("end")!)
    : new Date();
  const periodStart = searchParams.get("start")
    ? new Date(searchParams.get("start")!)
    : new Date(periodEnd.getFullYear() - 1, periodEnd.getMonth(), periodEnd.getDate());

  try {
    const bars = await getHistoricalPrices(symbol, periodStart, periodEnd);
    return NextResponse.json(bars);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "圖表資料取得失敗" },
      { status: 500 },
    );
  }
}
