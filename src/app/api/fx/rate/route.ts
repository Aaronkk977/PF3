import { NextResponse } from "next/server";
import { getUsdToTwdRate } from "@/lib/fx";

export async function GET() {
  const usdToTwd = await getUsdToTwdRate();
  return NextResponse.json({ usdToTwd });
}
