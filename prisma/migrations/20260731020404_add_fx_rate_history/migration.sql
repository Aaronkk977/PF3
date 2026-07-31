-- CreateTable
CREATE TABLE "FxRateHistory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "pair" TEXT NOT NULL,
    "dateKey" TEXT NOT NULL,
    "rate" REAL NOT NULL
);

-- CreateIndex
CREATE INDEX "FxRateHistory_pair_idx" ON "FxRateHistory"("pair");

-- CreateIndex
CREATE UNIQUE INDEX "FxRateHistory_pair_dateKey_key" ON "FxRateHistory"("pair", "dateKey");
