import "server-only";

import type { InstrumentSuggestion } from "@/lib/instrument-suggestions";
import { getHoldings, type HoldingPosition } from "@/lib/portfolio-engine";
import { prisma } from "@/lib/db";

export async function buildPriorityInstrumentSuggestions(
  existingHoldings?: HoldingPosition[],
): Promise<InstrumentSuggestion[]> {
  const [holdings, watchlistItems, recentTxs] = await Promise.all([
    existingHoldings ?? getHoldings(),
    prisma.watchlistItem.findMany({
      where: { symbol: { not: null } },
      select: { symbol: true, name: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    }),
    prisma.transaction.findMany({
      where: { instrumentId: { not: null } },
      orderBy: { createdAt: "desc" },
      take: 24,
      include: { instrument: { select: { symbol: true, name: true } } },
    }),
  ]);

  const seen = new Set<string>();
  const result: InstrumentSuggestion[] = [];

  const push = (symbol: string, name: string | null, priority: number) => {
    const key = symbol.toUpperCase();
    if (seen.has(key)) return;
    seen.add(key);
    result.push({ symbol, name: name ?? symbol, priority });
  };

  for (const tx of recentTxs) {
    const inst = tx.instrument;
    if (!inst?.symbol) continue;
    const key = inst.symbol.toUpperCase();
    if (seen.has(key)) continue;
    push(inst.symbol, inst.name, -20 + result.length);
  }

  for (const h of holdings) {
    if (h.quantity > 0) push(h.symbol, h.name, 0);
  }
  for (const w of watchlistItems) {
    if (!w.symbol) continue;
    push(w.symbol, w.name, 1);
  }

  return result;
}
