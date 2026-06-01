import { NextRequest, NextResponse } from "next/server";
import { normalizePeriodRange } from "@/lib/date-keys";
import { prisma } from "@/lib/db";
import {
  buildTradesReport,
  type TradesPeriodGranularity,
} from "@/lib/trades-report";

const GRANULARITIES = new Set<TradesPeriodGranularity>([
  "week",
  "month",
  "quarter",
  "year",
]);

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const startParam = searchParams.get("start");
    const endParam = searchParams.get("end");
    const accountsParam = searchParams.get("accounts");
    const granularityParam = searchParams.get("granularity") ?? "month";

    if (!startParam || !endParam) {
      return NextResponse.json(
        { error: "請提供 start 與 end 日期" },
        { status: 400 },
      );
    }

    if (!accountsParam?.trim()) {
      return NextResponse.json(
        { error: "請至少選擇一個帳戶" },
        { status: 400 },
      );
    }

    const granularity = GRANULARITIES.has(
      granularityParam as TradesPeriodGranularity,
    )
      ? (granularityParam as TradesPeriodGranularity)
      : "month";

    const accountIds = accountsParam
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const { start, end } = normalizePeriodRange(startParam, endParam);

    const accountRows = await prisma.account.findMany({
      where: { id: { in: accountIds } },
      select: { name: true },
    });

    const report = await buildTradesReport(
      start,
      end,
      accountIds,
      granularity,
      accountRows.map((a) => a.name),
    );

    return NextResponse.json(report);
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "載入交易檢討失敗" },
      { status: 500 },
    );
  }
}
