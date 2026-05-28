import { NextRequest, NextResponse } from "next/server";
import {
  isValidBenchmarkSymbol,
  normalizeBenchmarkSymbol,
  serializeBenchmark,
} from "@/lib/benchmarks";
import { prisma } from "@/lib/db";

export async function GET() {
  const rows = await prisma.benchmark.findMany({
    orderBy: { symbol: "asc" },
  });
  return NextResponse.json(rows.map(serializeBenchmark));
}

export async function POST(request: NextRequest) {
  let body: { symbol?: string; label?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "請求格式無效" }, { status: 400 });
  }

  const symbol = normalizeBenchmarkSymbol(body.symbol ?? "");
  const label = (body.label?.trim() || symbol).slice(0, 80);

  if (!isValidBenchmarkSymbol(symbol)) {
    return NextResponse.json(
      { error: "請輸入有效的 Yahoo 代碼（例：0050、0050.TW、^GSPC、AAPL）" },
      { status: 400 },
    );
  }

  const existing = await prisma.benchmark.findUnique({ where: { symbol } });
  if (existing) {
    return NextResponse.json({ error: "此代碼已存在" }, { status: 409 });
  }

  const row = await prisma.benchmark.create({
    data: { symbol, label },
  });

  return NextResponse.json(serializeBenchmark(row), { status: 201 });
}
