-- CreateTable
CREATE TABLE "NoteKind" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "NoteKind_name_key" ON "NoteKind"("name");

-- SeedData: 三個系統預設筆記類型（使用者之後可自行新增／刪除）
INSERT INTO "NoteKind" ("id", "name", "sortOrder") VALUES
    ('cnotekind0001industry00001', '產業研究', 0),
    ('cnotekind0002strategy00002', '操作策略', 1),
    ('cnotekind0003market000003', '市場觀察', 2);
