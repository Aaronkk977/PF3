/**
 * 從舊版單表 WatchlistItem 遷移至多清單結構。
 * 執行：npx tsx scripts/migrate-watchlists-legacy.ts
 * 完成後：npx prisma db push && npx tsx scripts/migrate-watchlists.ts
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const dbPath = path.join(process.cwd(), "prisma", "dev.db");
const backupPath = path.join(process.cwd(), "prisma", ".watchlist-legacy-backup.json");

type LegacyRow = { symbol: string; name: string | null };

function sqliteQuery(sql: string): string {
  const escaped = sql.replace(/"/g, '""');
  return execSync(`sqlite3 "${dbPath}" "${escaped}"`, {
    encoding: "utf8",
  }).trim();
}

function tableExists(name: string): boolean {
  try {
    const row = sqliteQuery(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='${name}';`,
    );
    return row === name;
  } catch {
    return false;
  }
}

function readLegacyItems(): LegacyRow[] {
  if (!tableExists("WatchlistItem")) return [];
  const cols = sqliteQuery("PRAGMA table_info(WatchlistItem);");
  if (cols.includes("watchlistId")) {
    console.log("WatchlistItem 已是新結構，跳過備份。");
    return [];
  }
  const raw = sqliteQuery(
    "SELECT symbol, name FROM WatchlistItem ORDER BY createdAt;",
  );
  if (!raw) return [];
  return raw.split("\n").map((line) => {
    const [symbol, name] = line.split("|");
    return { symbol, name: name || null };
  });
}

function main() {
  if (!fs.existsSync(dbPath)) {
    console.log("找不到資料庫，略過遷移。");
    return;
  }

  const legacy = readLegacyItems();
  fs.writeFileSync(backupPath, JSON.stringify(legacy, null, 2), "utf8");
  console.log(`已備份 ${legacy.length} 筆舊追蹤項目 → ${backupPath}`);

  if (tableExists("WatchlistItem") && legacy.length > 0) {
    sqliteQuery("ALTER TABLE WatchlistItem RENAME TO WatchlistItem_legacy;");
    console.log("已將舊表重新命名為 WatchlistItem_legacy");
  }

  console.log("\n請接著執行：");
  console.log("  npx prisma db push");
  console.log("  npx tsx scripts/migrate-watchlists.ts");
  console.log("  npx tsx scripts/restore-watchlist-legacy.ts  （若有備份）");
}

main();
