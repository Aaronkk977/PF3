import { NextRequest, NextResponse } from "next/server";
import { buildHoldingsValueTrend } from "@/lib/holdings-value-trend";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const startParam = params.get("start");
  const months = Number(params.get("months") ?? "12");
  const accountIdsParam = params.get("accountIds") ?? "all";
  const showEntire = params.get("entire") === "1";
  const includeCashFlows = params.get("includeCashFlows") !== "0";

  const periodEnd = new Date();
  let periodStart: Date;

  if (startParam) {
    periodStart = new Date(startParam);
    if (Number.isNaN(periodStart.getTime())) {
      return NextResponse.json({ error: "無效的起算日期" }, { status: 400 });
    }
    periodStart.setHours(0, 0, 0, 0);
  } else {
    periodStart = new Date(periodEnd);
    periodStart.setMonth(periodStart.getMonth() - Math.max(1, months));
  }

  if (periodStart > periodEnd) {
    return NextResponse.json(
      { error: "起算日期不可晚於今天" },
      { status: 400 },
    );
  }

  const accountIds =
    accountIdsParam === "all"
      ? undefined
      : accountIdsParam
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);

  try {
    const result = await buildHoldingsValueTrend(periodStart, periodEnd, {
      accountIds,
      showEntirePortfolioLine: showEntire,
      includeCashFlows,
    });
    return NextResponse.json({
      ...result,
      periodStart: periodStart.toISOString().slice(0, 10),
      periodEnd: periodEnd.toISOString().slice(0, 10),
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "取得市值趨勢失敗" },
      { status: 500 },
    );
  }
}
