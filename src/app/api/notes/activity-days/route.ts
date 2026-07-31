import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { parseCalendarDate, toTransactionDateKey } from "@/lib/date-keys";

export async function GET(request: NextRequest) {
  const month = request.nextUrl.searchParams.get("month"); // YYYY-MM
  const m = month?.match(/^(\d{4})-(\d{2})$/);
  if (!m) {
    return NextResponse.json({ error: "month 格式須為 YYYY-MM" }, { status: 400 });
  }
  const year = Number(m[1]);
  const monthIndex = Number(m[2]) - 1;
  const start = parseCalendarDate(
    `${m[1]}-${m[2]}-01`,
  );
  const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const end = parseCalendarDate(`${m[1]}-${m[2]}-${String(lastDay).padStart(2, "0")}`);

  const [txRows, noteRows] = await Promise.all([
    prisma.transaction.findMany({
      where: { date: { gte: start, lte: end } },
      select: { date: true },
      distinct: ["date"],
    }),
    prisma.note.findMany({
      where: { noteDate: { gte: start, lte: end } },
      select: { noteDate: true },
      distinct: ["noteDate"],
    }),
  ]);

  return NextResponse.json({
    transactionDates: txRows.map((r) => toTransactionDateKey(r.date)),
    noteDates: noteRows.map((r) => toTransactionDateKey(r.noteDate)),
  });
}
