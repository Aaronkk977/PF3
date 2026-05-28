import { NextResponse } from "next/server";
import { getPortfolioSummary } from "@/lib/portfolio-engine";

export async function GET() {
  try {
    const summary = await getPortfolioSummary();
    return NextResponse.json(summary);
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "計算失敗" },
      { status: 500 },
    );
  }
}
