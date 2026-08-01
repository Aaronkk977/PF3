import { NextResponse } from "next/server";
import { computeAllAccountsCash } from "@/lib/accounts";
import { toBaseCurrency } from "@/lib/fx";
import { getHoldings, getPortfolioSummary } from "@/lib/portfolio-engine";
import { prisma } from "@/lib/db";
import {
  DEPRECATED_TAG_NAMES,
  withoutDeprecatedTags,
} from "@/lib/deprecated-tags";
import { ensureStartupMaintenanceStarted } from "@/lib/startup-maintenance";
import { withRequestScope } from "@/lib/request-priority";

export async function GET(request: Request) {
  return withRequestScope(request, loadHoldingsPage);
}

async function loadHoldingsPage() {
  try {
    ensureStartupMaintenanceStarted();

    await prisma.tag.deleteMany({
      where: { name: { in: [...DEPRECATED_TAG_NAMES] } },
    });

    const holdings = await getHoldings();
    const [accounts, tags, summary, cashMap, txCount, latestTx] =
      await Promise.all([
        prisma.account.findMany({ orderBy: { name: "asc" } }),
        prisma.tag.findMany({ orderBy: { name: "asc" } }),
        getPortfolioSummary(holdings),
        computeAllAccountsCash(),
        prisma.transaction.count(),
        prisma.transaction.findFirst({
          orderBy: { updatedAt: "desc" },
          select: { updatedAt: true },
        }),
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
      // 交易資料的指紋：筆數 + 最後一次寫入時間。市值走勢的 client 端快取把它
      // 放進快取鍵，任何交易異動（新增／編輯／刪除／匯入／分割改寫）都會自動
      // 讓舊快取查不到，不必在每個異動點記得手動清——實測交易頁新增交易時
      // 就完全沒有清這份快取，走勢圖會停在異動前的數字直到隔天。
      dataVersion: `${txCount}:${latestTx?.updatedAt.getTime() ?? 0}`,
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "載入持倉失敗" },
      { status: 500 },
    );
  }
}
