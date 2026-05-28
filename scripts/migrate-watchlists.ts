/**
 * 將舊版單一 WatchlistItem（無 listId）遷移至多清單結構。
 * 若已遷移或為新資料庫，執行後無副作用。
 */
import { PrismaClient } from "@prisma/client";
import {
  DEFAULT_WATCHLIST_NAME,
  INTERNATIONAL_MARKET_WATCHLIST,
} from "../src/lib/watchlist-presets";

const prisma = new PrismaClient();

async function main() {
  const defaultList = await prisma.watchlist.upsert({
    where: { name: DEFAULT_WATCHLIST_NAME },
    create: { name: DEFAULT_WATCHLIST_NAME, sortOrder: 0 },
    update: {},
  });

  const intlList = await prisma.watchlist.upsert({
    where: { name: INTERNATIONAL_MARKET_WATCHLIST.name },
    create: {
      name: INTERNATIONAL_MARKET_WATCHLIST.name,
      sortOrder: 1,
    },
    update: { sortOrder: 1 },
  });

  for (let i = 0; i < INTERNATIONAL_MARKET_WATCHLIST.items.length; i++) {
    const item = INTERNATIONAL_MARKET_WATCHLIST.items[i]!;
    await prisma.watchlistItem.upsert({
      where: {
        watchlistId_symbol: {
          watchlistId: intlList.id,
          symbol: item.symbol,
        },
      },
      create: {
        watchlistId: intlList.id,
        symbol: item.symbol,
        name: item.name,
        sortOrder: i,
      },
      update: { name: item.name, sortOrder: i },
    });
  }

  console.log("Watchlist presets ensured.");
  console.log(`  - ${DEFAULT_WATCHLIST_NAME}: ${defaultList.id}`);
  console.log(`  - ${INTERNATIONAL_MARKET_WATCHLIST.name}: ${intlList.id}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
