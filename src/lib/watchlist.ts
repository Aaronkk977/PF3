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

  const nameUpdates: { id: string; name: string }[] = [];

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
          if (
            displayName &&
            displayName !== symbol &&
            displayName !== item.name
          ) {
            nameUpdates.push({ id: item.id, name: displayName });
          }
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

  if (nameUpdates.length > 0) {
    await Promise.all(
      nameUpdates.map(({ id, name }) =>
        prisma.watchlistItem.update({ where: { id }, data: { name } }),
      ),
    );
  }

  return mappedLists;
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
