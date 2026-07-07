// 輕量 migration runner，取代原本打包進安裝檔的完整 Prisma CLI（~160MB）。
// 行為對齊 `prisma migrate deploy`：
//   - 依名稱排序 prisma/migrations/<name>/migration.sql，只執行還沒記錄過的
//   - 記錄寫入 Prisma 官方的 _prisma_migrations 表（含 sha256 checksum），
//     未來若改回官方 CLI，兩邊的紀錄完全相容
//   - 資料庫已有資料表但沒有 migration 紀錄時（舊版 db push 時代的資料庫），
//     把第一個 baseline migration 標記為已套用而不執行，避免對既有資料重跑 CREATE TABLE
// 使用 Electron 內建 Node 的 node:sqlite，不需任何額外依賴。
const { DatabaseSync } = require("node:sqlite");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const MIGRATIONS_TABLE_DDL = `
CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
    "id"                    TEXT PRIMARY KEY NOT NULL,
    "checksum"              TEXT NOT NULL,
    "finished_at"           DATETIME,
    "migration_name"        TEXT NOT NULL,
    "logs"                  TEXT,
    "rolled_back_at"        DATETIME,
    "started_at"            DATETIME NOT NULL DEFAULT current_timestamp,
    "applied_steps_count"   INTEGER UNSIGNED NOT NULL DEFAULT 0
);`;

function listMigrations(migrationsDir) {
  return fs
    .readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => fs.existsSync(path.join(migrationsDir, name, "migration.sql")))
    .sort();
}

function recordApplied(db, name, checksum) {
  db.prepare(
    `INSERT INTO "_prisma_migrations" ("id", "checksum", "finished_at", "migration_name", "applied_steps_count")
     VALUES (?, ?, ?, ?, 1)`,
  ).run(crypto.randomUUID(), checksum, new Date().toISOString(), name);
}

function runMigrations(dbFilePath, migrationsDir) {
  if (!fs.existsSync(migrationsDir)) {
    throw new Error(`找不到 migrations 資料夾：${migrationsDir}`);
  }
  const names = listMigrations(migrationsDir);
  if (names.length === 0) {
    throw new Error(`migrations 資料夾是空的：${migrationsDir}`);
  }

  const db = new DatabaseSync(dbFilePath);
  try {
    db.exec(MIGRATIONS_TABLE_DDL);

    const applied = new Set(
      db
        .prepare(`SELECT "migration_name" FROM "_prisma_migrations" WHERE "rolled_back_at" IS NULL`)
        .all()
        .map((row) => row.migration_name),
    );

    // Baseline：資料庫已有資料表、卻完全沒有 migration 紀錄 → 這是 migrate 導入前
    // （db push 時代）建立的資料庫，第一個 migration 的建表語句已經等效存在，
    // 直接標記為已套用，絕不能重跑。
    if (applied.size === 0) {
      const tableCount = db
        .prepare(
          `SELECT COUNT(*) AS n FROM sqlite_master
           WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> '_prisma_migrations'`,
        )
        .get().n;
      if (tableCount > 0) {
        const baseline = names[0];
        const sql = fs.readFileSync(path.join(migrationsDir, baseline, "migration.sql"));
        recordApplied(db, baseline, crypto.createHash("sha256").update(sql).digest("hex"));
        applied.add(baseline);
      }
    }

    const appliedNow = [];
    for (const name of names) {
      if (applied.has(name)) continue;
      const sqlBuffer = fs.readFileSync(path.join(migrationsDir, name, "migration.sql"));
      // 不額外包 transaction：migration.sql 內含的 PRAGMA（如 foreign_keys=OFF）
      // 在 transaction 內會失效，直接整份執行才與 Prisma 引擎的行為一致。
      db.exec(sqlBuffer.toString("utf-8"));
      recordApplied(db, name, crypto.createHash("sha256").update(sqlBuffer).digest("hex"));
      appliedNow.push(name);
    }
    return appliedNow;
  } finally {
    db.close();
  }
}

module.exports = { runMigrations };
