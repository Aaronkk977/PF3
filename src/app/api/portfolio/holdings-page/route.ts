import { NextResponse } from "next/server";
import { computeAllAccountsCash } from "@/lib/accounts";
import { toBaseCurrency } from "@/lib/fx";
import { getHoldings, getPortfolioSummary } from "@/lib/portfolio-engine";
import { prisma } from "@/lib/db";
import {
  DEPRECATED_TAG_NAMES,
  withoutDeprecatedTags,
} from "@/lib/deprecated-tags";

export async function GET() {
  try {
    await prisma.tag.deleteMany({
      where: { name: { in: [...DEPRECATED_TAG_NAMES] } },
    });

    const holdings = await getHoldings();
    const [accounts, tags, summary, cashMap] = await Promise.all([
      prisma.account.findMany({ orderBy: { name: "asc" } }),
      prisma.tag.findMany({ orderBy: { name: "asc" } }),
      getPortfolioSummary(holdings),
      computeAllAccountsCash(),
    ]);

    const cashByAccount: Record<string, number> = {};
    for (const acc of accounts) {
      const raw = cashMap.get(acc.id) ?? 0;
      cashByAccount[acc.id] = await toBaseCurrency(raw, acc.currency);
    }

    return NextResponse.json({
      holdings,
      accounts: accounts.map((a) => ({
        id: a.id,
        name: a.name,
        currency: a.currency,
      })),
      allTags: withoutDeprecatedTags(tags.map((t) => t.name)),
      totalCashBase: summary.cash,
      cashByAccount,
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "載入持倉失敗" },
      { status: 500 },
    );
  }
}
