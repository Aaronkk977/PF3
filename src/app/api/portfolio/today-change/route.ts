import { NextResponse } from "next/server";
import { getTodayChangeBreakdown } from "@/lib/portfolio-engine";

export async function GET() {
  try {
    const data = await getTodayChangeBreakdown();
    return NextResponse.json(data);
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "取得今日漲跌失敗" },
      { status: 500 },
    );
  }
}
