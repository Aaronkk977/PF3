-- CreateTable
CREATE TABLE "Note" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "noteDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "NoteOnInstrument" (
    "noteId" TEXT NOT NULL,
    "instrumentId" TEXT NOT NULL,

    PRIMARY KEY ("noteId", "instrumentId"),
    CONSTRAINT "NoteOnInstrument_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "Note" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "NoteOnInstrument_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "Instrument" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "NoteOnTag" (
    "noteId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    PRIMARY KEY ("noteId", "tagId"),
    CONSTRAINT "NoteOnTag_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "Note" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "NoteOnTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Note_kind_idx" ON "Note"("kind");

-- CreateIndex
CREATE INDEX "Note_noteDate_idx" ON "Note"("noteDate");

-- CreateIndex
CREATE INDEX "NoteOnInstrument_instrumentId_idx" ON "NoteOnInstrument"("instrumentId");

-- CreateIndex
CREATE INDEX "NoteOnTag_tagId_idx" ON "NoteOnTag"("tagId");
