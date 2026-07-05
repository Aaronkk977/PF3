-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'TWD',
    "cash" DECIMAL NOT NULL DEFAULT 0,
    "feeRateBps" REAL NOT NULL DEFAULT 4,
    "taxRatePct" REAL NOT NULL DEFAULT 0.003,
    "feeRateBpsBuy" REAL,
    "feeRateBpsSell" REAL,
    "taxRatePctBuy" REAL,
    "taxRatePctSell" REAL,
    "feeTaxRoundHalfUp" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Instrument" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "symbol" TEXT NOT NULL,
    "name" TEXT,
    "notes" TEXT,
    "assetClass" TEXT NOT NULL DEFAULT 'stock',
    "currency" TEXT,
    "feeRateBps" INTEGER,
    "taxRatePct" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Watchlist" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "WatchlistItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "watchlistId" TEXT NOT NULL,
    "symbol" TEXT,
    "name" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'SYMBOL',
    "label" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WatchlistItem_watchlistId_fkey" FOREIGN KEY ("watchlistId") REFERENCES "Watchlist" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Tag" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "TagOnInstrument" (
    "instrumentId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    PRIMARY KEY ("instrumentId", "tagId"),
    CONSTRAINT "TagOnInstrument_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "Instrument" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TagOnInstrument_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "instrumentId" TEXT,
    "type" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "quantity" DECIMAL NOT NULL,
    "price" DECIMAL NOT NULL,
    "fee" DECIMAL NOT NULL DEFAULT 0,
    "tax" DECIMAL NOT NULL DEFAULT 0,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Transaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Transaction_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "Instrument" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FxRateCache" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "pair" TEXT NOT NULL,
    "rate" REAL NOT NULL,
    "cachedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "PerformanceSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "cacheKey" TEXT NOT NULL,
    "periodStart" TEXT NOT NULL,
    "periodEnd" TEXT NOT NULL,
    "benchmarkSymbol" TEXT NOT NULL,
    "dataFingerprint" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "computedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "PortfolioValueSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "cacheKey" TEXT NOT NULL,
    "periodStart" TEXT NOT NULL,
    "periodEnd" TEXT NOT NULL,
    "txCount" INTEGER NOT NULL,
    "maxTxDate" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "computedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Benchmark" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "symbol" TEXT NOT NULL,
    "label" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "PriceCache" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "symbol" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "open" REAL,
    "high" REAL,
    "low" REAL,
    "close" REAL NOT NULL,
    "volume" REAL,
    "cachedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "MarketDailySnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "symbol" TEXT NOT NULL,
    "name" TEXT,
    "date" TEXT NOT NULL,
    "open" REAL,
    "high" REAL,
    "low" REAL,
    "close" REAL NOT NULL,
    "volume" REAL NOT NULL,
    "turnover" REAL,
    "changePercent" REAL,
    "exchange" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "Instrument_symbol_key" ON "Instrument"("symbol");

-- CreateIndex
CREATE UNIQUE INDEX "Watchlist_name_key" ON "Watchlist"("name");

-- CreateIndex
CREATE INDEX "WatchlistItem_watchlistId_idx" ON "WatchlistItem"("watchlistId");

-- CreateIndex
CREATE UNIQUE INDEX "WatchlistItem_watchlistId_symbol_key" ON "WatchlistItem"("watchlistId", "symbol");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_name_key" ON "Tag"("name");

-- CreateIndex
CREATE INDEX "Transaction_accountId_idx" ON "Transaction"("accountId");

-- CreateIndex
CREATE INDEX "Transaction_instrumentId_idx" ON "Transaction"("instrumentId");

-- CreateIndex
CREATE INDEX "Transaction_date_idx" ON "Transaction"("date");

-- CreateIndex
CREATE UNIQUE INDEX "FxRateCache_pair_key" ON "FxRateCache"("pair");

-- CreateIndex
CREATE UNIQUE INDEX "PerformanceSnapshot_cacheKey_key" ON "PerformanceSnapshot"("cacheKey");

-- CreateIndex
CREATE UNIQUE INDEX "PortfolioValueSnapshot_cacheKey_key" ON "PortfolioValueSnapshot"("cacheKey");

-- CreateIndex
CREATE UNIQUE INDEX "Benchmark_symbol_key" ON "Benchmark"("symbol");

-- CreateIndex
CREATE INDEX "PriceCache_symbol_idx" ON "PriceCache"("symbol");

-- CreateIndex
CREATE UNIQUE INDEX "PriceCache_symbol_date_key" ON "PriceCache"("symbol", "date");

-- CreateIndex
CREATE INDEX "MarketDailySnapshot_symbol_idx" ON "MarketDailySnapshot"("symbol");

-- CreateIndex
CREATE INDEX "MarketDailySnapshot_date_idx" ON "MarketDailySnapshot"("date");

-- CreateIndex
CREATE INDEX "MarketDailySnapshot_exchange_date_idx" ON "MarketDailySnapshot"("exchange", "date");

-- CreateIndex
CREATE UNIQUE INDEX "MarketDailySnapshot_symbol_date_key" ON "MarketDailySnapshot"("symbol", "date");

