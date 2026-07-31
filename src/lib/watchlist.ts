import { mapWithConcurrency } from "@/lib/async-pool";
import { dbWriteLimiter } from "@/lib/concurrency-limiter";
import { prisma } from "@/lib/db";
import {
  DEFAULT_WATCHLIST_NAME,
  INTERNATIONAL_MARKET_WATCHLIST,
  isBuiltinWatchlistName,
} from "@/lib/watchlist-presets";
import { ensureInstrument } from "@/lib/ensure-instrument";
import { resolveInstrumentDisplayName } from "@/lib/instrument-display-name";
import { getQuotes, getWeekChangePercents, type QuoteResult } from "@/lib/yahoo";

export type WatchlistEntry =
  | {
      id: string;
      kind: "SYMBOL";
      symbol: string;
      name: string | null;
      price: number;
      change: number;
      changePercent: number | null;
      previousClose?: number;
      weekChangePercent: number | null;
    }
  | {
      id: string;
      kind: "SEPARATOR";
      label: string;
    };

export type WatchlistWithEntries = {
  id: string;
  name: string;
  items: WatchlistEntry[];
};

/** 確保預設清單與 International Market 存在 */
export async function ensureWatchlistPresets(): Promise<void> {
  const presets = [
    { name: DEFAULT_WATCHLIST_NAME, items: [] as { symbol: string; name: string }[] },
    INTERNATIONAL_MARKET_WATCHLIST,
  ];

  for (let p = 0; p < presets.length; p++) {
    const preset = presets[p]!;
    // update 留空：清單已存在時不覆寫 sortOrder，避免蓋掉使用者拖曳排序的結果
    const list = await prisma.watchlist.upsert({
      where: { name: preset.name },
      create: { name: preset.name, sortOrder: p },
      update: {},
    });

    for (let i = 0; i < preset.items.length; i++) {
      const item = preset.items[i]!;
      await prisma.watchlistItem.upsert({
        where: {
          watchlistId_symbol: {
            watchlistId: list.id,
            symbol: item.symbol,
          },
        },
        create: {
          watchlistId: list.id,
          symbol: item.symbol,
          name: item.name,
          sortOrder: i,
        },
        update: { name: item.name, sortOrder: i },
      });
    }
  }
}

export async function getWatchlists(): Promise<WatchlistWithEntries[]> {
  await ensureWatchlistPresets();

  const lists = await prisma.watchlist.findMany({
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    include: {
      items: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
    },
  });

  const allSymbols = [
    ...new Set(
      lists.flatMap((l) =>
        l.items.filter((i) => i.kind !== "SEPARATOR" && i.symbol).map((i) => i.symbol!),
      ),
    ),
  ];
  const [quotes, weekChanges] = await Promise.all([
    allSymbols.length > 0 ? getQuotes(allSymbols) : Promise.resolve(new Map<string, QuoteResult>()),
    allSymbols.length > 0 ? getWeekChangePercents(allSymbols) : Promise.resolve(new Map<string, number | null>()),
  ]);

  const instruments = await prisma.instrument.findMany({
    where: { symbol: { in: allSymbols } },
    select: { symbol: true, name: true },
  });
  const instrumentNames = new Map(
    instruments.map((i) => [i.symbol.toUpperCase(), i.name]),
  );

  // 這裡只用來「顯示」正確名稱，不在這裡把校正結果寫回資料庫——寫入交給
  // startup-maintenance.ts 的 correctWatchlistItemNames()，跟頁面查詢脫鉤，
  // 才不會每次載入頁面都多等一次寫入。
  const mappedLists = await Promise.all(
    lists.map(async (list) => ({
      id: list.id,
      name: list.name,
      items: await Promise.all(
        list.items.map(async (item): Promise<WatchlistEntry> => {
          if (item.kind === "SEPARATOR" || !item.symbol) {
            return { id: item.id, kind: "SEPARATOR", label: item.label ?? "" };
          }
          const symbol = item.symbol;
          const quote = quotes.get(symbol);
          const displayName = await resolveInstrumentDisplayName(symbol, [
            item.name,
            instrumentNames.get(symbol.toUpperCase()),
            quote?.name,
          ]);
          return {
            id: item.id,
            kind: "SYMBOL",
            symbol,
            name: displayName,
            price: quote?.price ?? 0,
            change: quote?.change ?? 0,
            changePercent: quote?.changePercent ?? null,
            previousClose: quote?.previousClose,
            weekChangePercent:
              weekChanges.get(symbol.toUpperCase()) ?? null,
          };
        }),
      ),
    })),
  );

  return mappedLists;
}

/** 校正追蹤清單項目的顯示名稱（跟解析出來的正確名稱對不上就修正）。獨立於
 *  getWatchlists() 之外，由 startup-maintenance.ts 的開機維護排程呼叫，不在
 *  一般頁面查詢的路徑上，避免每次載入頁面都多等一次寫入。 */
export async function correctWatchlistItemNames(): Promise<void> {
  const items = await prisma.watchlistItem.findMany({
    where: { kind: "SYMBOL", symbol: { not: null } },
    select: { id: true, symbol: true, name: true },
  });
  if (items.length === 0) return;

  const allSymbols = [...new Set(items.map((i) => i.symbol!))];
  const [quotes, instruments] = await Promise.all([
    getQuotes(allSymbols),
    prisma.instrument.findMany({
      where: { symbol: { in: allSymbols } },
      select: { symbol: true, name: true },
    }),
  ]);
  const instrumentNames = new Map(
    instruments.map((i) => [i.symbol.toUpperCase(), i.name]),
  );

  const updates: { id: string; name: string }[] = [];
  for (const item of items) {
    const symbol = item.symbol!;
    const quote = quotes.get(symbol);
    const displayName = await resolveInstrumentDisplayName(symbol, [
      item.name,
      instrumentNames.get(symbol.toUpperCase()),
      quote?.name,
    ]);
    if (displayName && displayName !== symbol && displayName !== item.name) {
      updates.push({ id: item.id, name: displayName });
    }
  }

  // low 優先權：這是開機維護排程觸發的背景工作，真正在等頁面資料的請求
  // 應該優先拿到 dbWriteLimiter 的名額。
  await mapWithConcurrency(
    updates,
    dbWriteLimiter,
    ({ id, name }) => prisma.watchlistItem.update({ where: { id }, data: { name } }),
    { priority: "low" },
  );
}

/** @deprecated 使用 getWatchlists */
export async function getWatchlist(): Promise<WatchlistEntry[]> {
  const lists = await getWatchlists();
  return lists[0]?.items ?? [];
}

export async function createWatchlist(name: string) {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("清單名稱必填");

  const maxOrder = await prisma.watchlist.aggregate({ _max: { sortOrder: true } });
  return prisma.watchlist.create({
    data: {
      name: trimmed,
      sortOrder: (maxOrder._max.sortOrder ?? -1) + 1,
    },
  });
}

export async function deleteWatchlist(listId: string) {
  const list = await prisma.watchlist.findUnique({ where: { id: listId } });
  if (!list) throw new Error("找不到清單");
  if (isBuiltinWatchlistName(list.name)) {
    throw new Error("無法刪除內建清單");
  }
  return prisma.watchlist.delete({ where: { id: listId } });
}

export async function renameWatchlist(listId: string, name: string) {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("清單名稱必填");

  const list = await prisma.watchlist.findUnique({ where: { id: listId } });
  if (!list) throw new Error("找不到清單");
  if (isBuiltinWatchlistName(list.name)) {
    throw new Error("無法重新命名內建清單");
  }
  if (isBuiltinWatchlistName(trimmed)) {
    throw new Error("此名稱保留給內建清單");
  }

  return prisma.watchlist.update({
    where: { id: listId },
    data: { name: trimmed },
  });
}

export async function clearWatchlist(listId: string) {
  const list = await prisma.watchlist.findUnique({ where: { id: listId } });
  if (!list) throw new Error("找不到清單");
  await prisma.watchlistItem.deleteMany({ where: { watchlistId: listId } });
}

export async function addToWatchlist(
  listId: string,
  symbol: string,
  name?: string,
) {
  const list = await prisma.watchlist.findUnique({ where: { id: listId } });
  if (!list) throw new Error("找不到清單");

  const sym = symbol.toUpperCase();
  const displayName = await resolveInstrumentDisplayName(sym, [name]);
  await ensureInstrument(sym, { name: displayName });
  const maxOrder = await prisma.watchlistItem.aggregate({
    where: { watchlistId: listId },
    _max: { sortOrder: true },
  });

  return prisma.watchlistItem.upsert({
    where: {
      watchlistId_symbol: { watchlistId: listId, symbol: sym },
    },
    create: {
      watchlistId: listId,
      symbol: sym,
      name: displayName,
      sortOrder: (maxOrder._max.sortOrder ?? -1) + 1,
    },
    update: { name: displayName },
  });
}

export async function removeFromWatchlist(listId: string, symbol: string) {
  return prisma.watchlistItem.delete({
    where: {
      watchlistId_symbol: {
        watchlistId: listId,
        symbol: symbol.toUpperCase(),
      },
    },
  });
}

/**
 * 新增分隔線／小標項目（無代號，symbol 為 null）。
 * label 可為空字串（純分隔線，不顯示文字）。
 * afterItemId 指定時，插入到該項目正下方；不指定則加到清單最後。
 */
export async function addWatchlistSeparator(
  listId: string,
  label: string,
  afterItemId?: string | null,
) {
  const list = await prisma.watchlist.findUnique({ where: { id: listId } });
  if (!list) throw new Error("找不到清單");

  const trimmed = label.trim();

  const maxOrder = await prisma.watchlistItem.aggregate({
    where: { watchlistId: listId },
    _max: { sortOrder: true },
  });

  const created = await prisma.watchlistItem.create({
    data: {
      watchlistId: listId,
      symbol: null,
      kind: "SEPARATOR",
      label: trimmed,
      sortOrder: (maxOrder._max.sortOrder ?? -1) + 1,
    },
  });

  if (afterItemId) {
    const existing = await prisma.watchlistItem.findMany({
      where: { watchlistId: listId },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: { id: true },
    });
    const ids = existing.map((i) => i.id).filter((id) => id !== created.id);
    const insertAt = ids.indexOf(afterItemId) + 1;
    ids.splice(insertAt, 0, created.id);
    await reorderWatchlistItems(listId, ids);
  }

  return created;
}

/** 編輯分隔線／小標文字（可清空成純分隔線） */
export async function updateWatchlistSeparator(itemId: string, label: string) {
  const trimmed = label.trim();

  const item = await prisma.watchlistItem.findUnique({ where: { id: itemId } });
  if (!item || item.kind !== "SEPARATOR") throw new Error("找不到分隔線項目");

  return prisma.watchlistItem.update({
    where: { id: itemId },
    data: { label: trimmed },
  });
}

/** 依 id 移除項目（用於分隔線；一般標的也可用此代替 removeFromWatchlist） */
export async function removeWatchlistItemById(itemId: string) {
  return prisma.watchlistItem.delete({ where: { id: itemId } });
}

export async function reorderWatchlistItems(
  listId: string,
  itemIds: string[],
): Promise<void> {
  const list = await prisma.watchlist.findUnique({ where: { id: listId } });
  if (!list) throw new Error("找不到清單");

  const uniqueIds = [...new Set(itemIds)];
  if (uniqueIds.length !== itemIds.length) {
    throw new Error("排序項目重複");
  }

  const existing = await prisma.watchlistItem.findMany({
    where: { watchlistId: listId },
    select: { id: true },
  });
  if (existing.length !== itemIds.length) {
    throw new Error("排序項目數量不符");
  }
  const existingSet = new Set(existing.map((i) => i.id));
  if (!itemIds.every((id) => existingSet.has(id))) {
    throw new Error("排序項目無效");
  }

  await prisma.$transaction(
    itemIds.map((id, sortOrder) =>
      prisma.watchlistItem.update({
        where: { id },
        data: { sortOrder },
      }),
    ),
  );
}

/** 重新排序追蹤清單本身（清單與清單間的順序） */
export async function reorderWatchlists(listIds: string[]): Promise<void> {
  const uniqueIds = [...new Set(listIds)];
  if (uniqueIds.length !== listIds.length) {
    throw new Error("排序項目重複");
  }

  const existing = await prisma.watchlist.findMany({ select: { id: true } });
  if (existing.length !== listIds.length) {
    throw new Error("排序項目數量不符");
  }
  const existingSet = new Set(existing.map((l) => l.id));
  if (!listIds.every((id) => existingSet.has(id))) {
    throw new Error("排序項目無效");
  }

  await prisma.$transaction(
    listIds.map((id, sortOrder) =>
      prisma.watchlist.update({
        where: { id },
        data: { sortOrder },
      }),
    ),
  );
}
