const assert = require("node:assert/strict");
const { test } = require("node:test");
const { DatabaseSync } = require("node:sqlite");
const { fork } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { runMigrations } = require("./migrate");

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pf-migrate-"));
}

function writeMigration(dir, name, sql) {
  fs.mkdirSync(path.join(dir, name), { recursive: true });
  fs.writeFileSync(path.join(dir, name, "migration.sql"), sql);
}

function tableNames(dbFile) {
  const db = new DatabaseSync(dbFile);
  try {
    return db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r) => r.name);
  } finally {
    db.close();
  }
}

test("全新資料庫：依名稱順序套用全部 migration，再跑一次不會重複套用", () => {
  const dir = tempDir();
  const migrations = path.join(dir, "migrations");
  writeMigration(migrations, "002_b", 'CREATE TABLE "B" ("id" TEXT);');
  writeMigration(migrations, "001_a", 'CREATE TABLE "A" ("id" TEXT);');
  const dbFile = path.join(dir, "test.db");

  assert.deepEqual(runMigrations(dbFile, migrations), ["001_a", "002_b"]);
  assert.deepEqual(runMigrations(dbFile, migrations), []);
  assert.deepEqual(tableNames(dbFile), ["A", "B", "_prisma_migrations"]);
});

test("db push 時代的舊資料庫：第一個 migration 只標記為已套用，不重跑建表", () => {
  const dir = tempDir();
  const migrations = path.join(dir, "migrations");
  writeMigration(migrations, "001_init", 'CREATE TABLE "A" ("id" TEXT);');
  writeMigration(migrations, "002_add", 'CREATE TABLE "B" ("id" TEXT);');
  const dbFile = path.join(dir, "legacy.db");
  const db = new DatabaseSync(dbFile);
  db.exec('CREATE TABLE "A" ("id" TEXT);');
  db.close();

  assert.deepEqual(runMigrations(dbFile, migrations), ["002_add"]);
});

test("SQL 錯誤時丟錯，失敗的 migration 不會被記成已套用", () => {
  const dir = tempDir();
  const migrations = path.join(dir, "migrations");
  writeMigration(migrations, "001_bad", "THIS IS NOT SQL;");
  const dbFile = path.join(dir, "bad.db");

  assert.throws(() => runMigrations(dbFile, migrations));
  const db = new DatabaseSync(dbFile);
  const n = db.prepare('SELECT COUNT(*) AS n FROM "_prisma_migrations"').get().n;
  db.close();
  assert.equal(n, 0);
});

test("以獨立行程執行時透過 IPC 回報結果（electron/main.js 的用法）", async () => {
  const dir = tempDir();
  const migrations = path.join(dir, "migrations");
  writeMigration(migrations, "001_a", 'CREATE TABLE "A" ("id" TEXT);');
  const dbFile = path.join(dir, "ipc.db");

  const child = fork(path.join(__dirname, "migrate.js"), [dbFile, migrations], {
    stdio: ["ignore", "ignore", "ignore", "ipc"],
  });
  const exited = new Promise((resolve) => child.once("exit", resolve));
  const message = await new Promise((resolve) => child.once("message", resolve));
  assert.deepEqual(message, { ok: true, applied: ["001_a"] });
  assert.equal(await exited, 0);
});
