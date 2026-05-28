import { NextResponse } from "next/server";
import { getHoldings } from "@/lib/portfolio-engine";

export async function GET() {
  try {
    const holdings = await getHoldings();
    return NextResponse.json(holdings);
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "計算失敗" },
      { status: 500 },
    );
  }
}
