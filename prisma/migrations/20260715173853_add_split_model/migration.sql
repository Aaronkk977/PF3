-- AlterTable
ALTER TABLE "Instrument" ADD COLUMN "splitsCheckedAt" DATETIME;

-- CreateTable
CREATE TABLE "Split" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "instrumentId" TEXT NOT NULL,
    "splitDate" DATETIME NOT NULL,
    "numerator" INTEGER NOT NULL,
    "denominator" INTEGER NOT NULL,
    "appliedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Split_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "Instrument" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Split_instrumentId_idx" ON "Split"("instrumentId");

-- CreateIndex
CREATE UNIQUE INDEX "Split_instrumentId_splitDate_key" ON "Split"("instrumentId", "splitDate");
