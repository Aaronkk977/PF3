/**
 * 將 migrate-watchlists-legacy 備份的項目還原至「我的追蹤」清單。
 */
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { DEFAULT_WATCHLIST_NAME } from "../src/lib/watchlist-presets";

const backupPath = path.join(process.cwd(), "prisma", ".watchlist-legacy-backup.json");
const prisma = new PrismaClient();

async function main() {
  if (!fs.existsSync(backupPath)) {
    console.log("無備份檔，略過。");
    return;
  }

  const legacy = JSON.parse(fs.readFileSync(backupPath, "utf8")) as {
    symbol: string;
    name: string | null;
  }[];

  const list = await prisma.watchlist.upsert({
    where: { name: DEFAULT_WATCHLIST_NAME },
    create: { name: DEFAULT_WATCHLIST_NAME, sortOrder: 0 },
    update: {},
  });

  for (let i = 0; i < legacy.length; i++) {
    const row = legacy[i]!;
    await prisma.watchlistItem.upsert({
      where: {
        watchlistId_symbol: { watchlistId: list.id, symbol: row.symbol },
      },
      create: {
        watchlistId: list.id,
        symbol: row.symbol,
        name: row.name,
        sortOrder: i,
      },
      update: { name: row.name ?? undefined },
    });
  }

  console.log(`已還原 ${legacy.length} 筆至「${DEFAULT_WATCHLIST_NAME}」`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
