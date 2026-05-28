import { NextResponse } from "next/server";
import { listAccountsWithComputedCash } from "@/lib/accounts";
import { buildPriorityInstrumentSuggestions } from "@/lib/instrument-suggestions.server";
import { toTransactionDateKey } from "@/lib/date-keys";
import { prisma } from "@/lib/db";
import { toNumber } from "@/lib/utils";

export async function GET() {
  try {
    const [transactions, instruments, accounts, priorityInstruments] =
      await Promise.all([
        prisma.transaction.findMany({
          include: { instrument: true, account: true },
          orderBy: { date: "desc" },
        }),
        prisma.instrument.findMany({ orderBy: { symbol: "asc" } }),
        listAccountsWithComputedCash(),
        buildPriorityInstrumentSuggestions([]),
      ]);

    return NextResponse.json({
      initialTransactions: transactions.map((t) => ({
        id: t.id,
        date: toTransactionDateKey(t.date),
        type: t.type,
        accountId: t.accountId,
        accountName: t.account.name,
        symbol: t.instrument?.symbol ?? null,
        instrumentName: t.instrument?.name ?? null,
        quantity: toNumber(t.quantity),
        price: toNumber(t.price),
        fee: toNumber(t.fee),
        tax: toNumber(t.tax),
        note: t.note,
      })),
      initialAccounts: accounts,
      instruments: instruments.map((i) => ({
        id: i.id,
        symbol: i.symbol,
        name: i.name,
      })),
      priorityInstruments,
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "載入交易失敗" },
      { status: 500 },
    );
  }
}
