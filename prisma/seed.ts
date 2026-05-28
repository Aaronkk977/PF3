import { PrismaClient } from "@prisma/client";
import {
  DEFAULT_WATCHLIST_NAME,
  INTERNATIONAL_MARKET_WATCHLIST,
} from "../src/lib/watchlist-presets";

const prisma = new PrismaClient();

async function main() {
  await prisma.priceCache.deleteMany();
  await prisma.watchlistItem.deleteMany();
  await prisma.watchlist.deleteMany();
  await prisma.transaction.deleteMany();
  await prisma.tagOnInstrument.deleteMany();
  await prisma.tag.deleteMany();
  await prisma.instrument.deleteMany();
  await prisma.benchmark.deleteMany();
  await prisma.account.deleteMany();

  const account = await prisma.account.create({
    data: {
      name: "主要投資帳戶",
      currency: "TWD",
      cash: 50000,
    },
  });

  const tsmc = await prisma.instrument.create({
    data: {
      symbol: "2330.TW",
      name: "台積電",
      assetClass: "stock",
      currency: "TWD",
    },
  });

  const etf50 = await prisma.instrument.create({
    data: {
      symbol: "0050.TW",
      name: "元大台灣50",
      assetClass: "etf",
      currency: "TWD",
    },
  });

  const btc = await prisma.instrument.create({
    data: {
      symbol: "BTC-USD",
      name: "Bitcoin",
      assetClass: "crypto",
      currency: "USD",
    },
  });

  const transactions = [
  {
    accountId: account.id,
    instrumentId: tsmc.id,
    type: "BUY",
    date: new Date("2024-06-15"),
    quantity: 100,
    price: 920,
    fee: 20,
    tax: 0,
  },
  {
    accountId: account.id,
    instrumentId: etf50.id,
    type: "BUY",
    date: new Date("2024-08-01"),
    quantity: 500,
    price: 178,
    fee: 15,
    tax: 0,
  },
  {
    accountId: account.id,
    instrumentId: btc.id,
    type: "BUY",
    date: new Date("2024-10-20"),
    quantity: 0.05,
    price: 68000,
    fee: 5,
    tax: 0,
  },
  {
    accountId: account.id,
    instrumentId: tsmc.id,
    type: "DIVIDEND",
    date: new Date("2025-03-15"),
    quantity: 1,
    price: 4500,
    fee: 0,
    tax: 0,
    note: "現金股息",
  },
];

  for (const tx of transactions) {
    await prisma.transaction.create({ data: tx });
  }

  await prisma.benchmark.createMany({
    data: [
      { symbol: "0050.TW", label: "台灣50" },
      { symbol: "^GSPC", label: "S&P 500" },
    ],
  });

  await prisma.watchlist.create({
    data: {
      name: DEFAULT_WATCHLIST_NAME,
      sortOrder: 0,
      items: {
        create: [
          { symbol: "0050.TW", name: "元大台灣50", sortOrder: 0 },
          { symbol: "AAPL", name: "Apple Inc.", sortOrder: 1 },
        ],
      },
    },
  });

  await prisma.watchlist.create({
    data: {
      name: INTERNATIONAL_MARKET_WATCHLIST.name,
      sortOrder: 1,
      items: {
        create: INTERNATIONAL_MARKET_WATCHLIST.items.map((item, i) => ({
          symbol: item.symbol,
          name: item.name,
          sortOrder: i,
        })),
      },
    },
  });

  console.log("Seed completed.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
