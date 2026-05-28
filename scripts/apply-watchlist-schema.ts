/**
 * 就地升級 SQLite：舊版 WatchlistItem → 多清單結構（不刪除其他資料表）。
 * 執行：npx tsx scripts/apply-watchlist-schema.ts
 */
import { PrismaClient } from "@prisma/client";
import {
  DEFAULT_WATCHLIST_NAME,
  INTERNATIONAL_MARKET_WATCHLIST,
} from "../src/lib/watchlist-presets";

const prisma = new PrismaClient();

const DEFAULT_LIST_ID = "wl-default-migrate";
const INTL_LIST_ID = "wl-intl-market-migrate";

type TableInfo = { name: string };

async function columnExists(table: string, column: string): Promise<boolean> {
  const cols = await prisma.$queryRawUnsafe<TableInfo[]>(
    `PRAGMA table_info("${table}");`,
  );
  return cols.some((c) => c.name === column);
}

async function tableExists(name: string): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<{ name: string }[]>(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='${name}';`,
  );
  return rows.length > 0;
}

async function main() {
  const hasWatchlist = await tableExists("Watchlist");
  const itemHasListId = await columnExists("WatchlistItem", "watchlistId");

  if (hasWatchlist && itemHasListId) {
    console.log("資料庫已是多清單結構。");
    return;
  }

  if (!hasWatchlist) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "Watchlist" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "name" TEXT NOT NULL,
        "sortOrder" INTEGER NOT NULL DEFAULT 0,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX "Watchlist_name_key" ON "Watchlist"("name");
    `);
  }

  await prisma.$executeRawUnsafe(`
    INSERT OR IGNORE INTO "Watchlist" ("id", "name", "sortOrder", "createdAt")
    VALUES ('${DEFAULT_LIST_ID}', '${DEFAULT_WATCHLIST_NAME}', 0, CURRENT_TIMESTAMP);
  `);
  await prisma.$executeRawUnsafe(`
    INSERT OR IGNORE INTO "Watchlist" ("id", "name", "sortOrder", "createdAt")
    VALUES ('${INTL_LIST_ID}', '${INTERNATIONAL_MARKET_WATCHLIST.name}', 1, CURRENT_TIMESTAMP);
  `);

  if (!itemHasListId) {
    const hasOld = await tableExists("WatchlistItem");
    if (hasOld) {
      await prisma.$executeRawUnsafe(
        `ALTER TABLE "WatchlistItem" RENAME TO "WatchlistItem_legacy";`,
      );
    }

    await prisma.$executeRawUnsafe(`
      CREATE TABLE "WatchlistItem" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "watchlistId" TEXT NOT NULL,
        "symbol" TEXT NOT NULL,
        "name" TEXT,
        "sortOrder" INTEGER NOT NULL DEFAULT 0,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "WatchlistItem_watchlistId_fkey"
          FOREIGN KEY ("watchlistId") REFERENCES "Watchlist" ("id")
          ON DELETE CASCADE ON UPDATE CASCADE
      );
    `);

    if (await tableExists("WatchlistItem_legacy")) {
      await prisma.$executeRawUnsafe(`
        INSERT INTO "WatchlistItem" ("id", "watchlistId", "symbol", "name", "sortOrder", "createdAt")
        SELECT
          'wli-' || lower(hex(randomblob(8))),
          '${DEFAULT_LIST_ID}',
          "symbol",
          "name",
          CAST((SELECT COUNT(*) FROM WatchlistItem_legacy w2
                WHERE w2.rowid <= WatchlistItem_legacy.rowid) - 1 AS INTEGER),
          COALESCE("createdAt", CURRENT_TIMESTAMP)
        FROM "WatchlistItem_legacy";
      `);
      await prisma.$executeRawUnsafe(`DROP TABLE "WatchlistItem_legacy";`);
      console.log("已將舊追蹤項目移至「我的追蹤」。");
    }

    await prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX "WatchlistItem_watchlistId_symbol_key"
      ON "WatchlistItem"("watchlistId", "symbol");
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX "WatchlistItem_watchlistId_idx" ON "WatchlistItem"("watchlistId");
    `);
  }

  for (let i = 0; i < INTERNATIONAL_MARKET_WATCHLIST.items.length; i++) {
    const item = INTERNATIONAL_MARKET_WATCHLIST.items[i]!;
    const sym = item.symbol.replace(/'/g, "''");
    const nm = item.name.replace(/'/g, "''");
    await prisma.$executeRawUnsafe(`
      INSERT OR IGNORE INTO "WatchlistItem"
        ("id", "watchlistId", "symbol", "name", "sortOrder", "createdAt")
      VALUES (
        'wli-intl-${i}',
        '${INTL_LIST_ID}',
        '${sym}',
        '${nm}',
        ${i},
        CURRENT_TIMESTAMP
      );
    `);
  }

  console.log("多清單結構升級完成。");
  console.log(`  - ${DEFAULT_WATCHLIST_NAME}`);
  console.log(`  - ${INTERNATIONAL_MARKET_WATCHLIST.name}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
