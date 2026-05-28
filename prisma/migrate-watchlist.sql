-- 多清單追蹤：由舊版 WatchlistItem 遷移（SQLite）
CREATE TABLE IF NOT EXISTS "Watchlist" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "Watchlist_name_key" ON "Watchlist"("name");

INSERT OR IGNORE INTO "Watchlist" ("id", "name", "sortOrder", "createdAt")
VALUES (
    'default-watchlist',
    '我的追蹤',
    0,
    CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO "Watchlist" ("id", "name", "sortOrder", "createdAt")
VALUES (
    'intl-market-watchlist',
    'International Market',
    1,
    CURRENT_TIMESTAMP
);

-- 若尚無 watchlistId 欄位則新增
-- SQLite 不支援 IF NOT EXISTS for columns; Prisma 會在空庫時直接建表
