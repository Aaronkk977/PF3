import { PrismaClient } from "@prisma/client";
import { aggregatePeriodRealizedPnl } from "../src/lib/performance-realized-pnl";
import { toNumber } from "../src/lib/utils";
import { inferInstrumentCurrency } from "../src/lib/instrument-currency";
import { getExchangeRateOnDate } from "../src/lib/fx-rates";
import { toLocalDateKey } from "../src/lib/date-keys";

const prisma = new PrismaClient();

async function main() {
  const accounts = await prisma.account.findMany();
  const ids = accounts.map((a) => a.id);
  const minDate = await prisma.transaction.aggregate({ _min: { date: true } });
  const maxDate = await prisma.transaction.aggregate({ _max: { date: true } });
  console.log(
    "accounts:",
    accounts.map((a) => `${a.name} (${a.currency})`).join(", "),
  );
  console.log("date range:", minDate._min.date, "->", maxDate._max.date);

  const periods = [
    { label: "2025", start: new Date("2025-01-01"), end: new Date("2025-12-31T23:59:59") },
    { label: "2026 YTD", start: new Date("2026-01-01"), end: new Date("2026-12-31T23:59:59") },
    { label: "all", start: new Date("2000-01-01"), end: new Date("2030-12-31T23:59:59") },
  ];

  for (const p of periods) {
    const r = await aggregatePeriodRealizedPnl(p.start, p.end, ids);
    console.log(`\n${p.label} (all accounts):`, r);
  }

  for (const acc of accounts) {
    const r = await aggregatePeriodRealizedPnl(
      new Date("2026-01-01"),
      new Date("2026-12-31T23:59:59"),
      [acc.id],
    );
    console.log(`2026 YTD [${acc.name}]:`, Math.round(r.realizedPnl));
  }

  // Top negative sells in 2026
  const start = new Date("2026-01-01");
  const end = new Date("2026-12-31T23:59:59");
  const txs = await prisma.transaction.findMany({
    where: { date: { lte: end } },
    include: { instrument: true, account: true },
    orderBy: { date: "asc" },
  });

  const lotsByKey = new Map<string, { qty: number; cost: number }[]>();
  const rateCache = new Map<string, number>();

  async function toTwd(amount: number, ccy: string, date: Date) {
    if (ccy === "TWD") return amount;
    const key = toLocalDateKey(date);
    let rate = rateCache.get(key);
    if (!rate) {
      rate = (await getExchangeRateOnDate("USD", "TWD", date)) ?? 32;
      rateCache.set(key, rate);
    }
    return amount * rate;
  }

  const sellDetails: {
    date: string;
    symbol: string;
    pnl: number;
    proceeds: number;
    cost: number;
    unmatched: number;
  }[] = [];

  for (const raw of txs) {
    if (!raw.instrumentId || !raw.instrument) continue;
    const key = raw.instrumentId;
    const instCcy = inferInstrumentCurrency(
      raw.instrument.symbol,
      raw.instrument.currency,
    );
    const qty = toNumber(raw.quantity);
    const price = toNumber(raw.price);
    const lots = lotsByKey.get(key) ?? [];

    if (raw.type === "BUY" && qty > 0) {
      const cost = await toTwd(qty * price, instCcy, raw.date);
      lots.push({ qty, cost });
    } else if (raw.type === "SELL" && qty > 0) {
      let remaining = qty;
      let matched = 0;
      while (remaining > 0 && lots.length > 0) {
        const lot = lots[0]!;
        const used = Math.min(remaining, lot.qty);
        const slice = (lot.cost / lot.qty) * used;
        matched += slice;
        lot.cost -= slice;
        lot.qty -= used;
        remaining -= used;
        if (lot.qty <= 0.0000001) lots.shift();
      }
      if (raw.date >= start && raw.date <= end) {
        const proceeds = await toTwd(qty * price, instCcy, raw.date);
        sellDetails.push({
          date: toLocalDateKey(raw.date),
          symbol: raw.instrument.symbol,
          pnl: proceeds - matched,
          proceeds,
          cost: matched,
          unmatched: remaining,
        });
      }
    } else if (raw.type === "DIVIDEND" && qty > 0) {
      const div = await toTwd(qty * price, instCcy, raw.date);
      let rem = div;
      for (const lot of lots) {
        if (rem <= 0) break;
        const cut = Math.min(lot.cost, rem);
        lot.cost -= cut;
        rem -= cut;
      }
    }
    lotsByKey.set(key, lots);
  }

  sellDetails.sort((a, b) => a.pnl - b.pnl);
  console.log("\nWorst 2026 sells:");
  for (const s of sellDetails.slice(0, 15)) {
    console.log(
      `${s.date} ${s.symbol} pnl=${Math.round(s.pnl)} proceeds=${Math.round(s.proceeds)} cost=${Math.round(s.cost)} unmatched=${s.unmatched}`,
    );
  }
  console.log(
    "2026 total from details:",
    Math.round(sellDetails.reduce((s, x) => s + x.pnl, 0)),
  );
  console.log(
    "2026 sells with unmatched qty:",
    sellDetails.filter((x) => x.unmatched > 0.0001).length,
  );
}

async function checkDuplicateInstruments() {
  const insts = await prisma.instrument.findMany({
    select: { id: true, symbol: true, currency: true },
    orderBy: { symbol: "asc" },
  });
  const bySym = new Map<string, number>();
  for (const i of insts) {
    bySym.set(i.symbol, (bySym.get(i.symbol) ?? 0) + 1);
  }
  const dups = [...bySym.entries()].filter(([, n]) => n > 1);
  console.log("\nDuplicate symbols:", dups);
}

async function shyTxs() {
  const txs = await prisma.transaction.findMany({
    where: { instrument: { symbol: "SHY" } },
    include: { instrument: true, account: true },
    orderBy: { date: "asc" },
  });
  console.log("\nSHY transactions:");
  for (const t of txs) {
    console.log(
      toLocalDateKey(t.date),
      t.type,
      "qty",
      toNumber(t.quantity),
      "px",
      toNumber(t.price),
      "inst",
      t.instrument?.currency,
      "acct",
      t.account.currency,
    );
  }
}

main()
  .then(() => checkDuplicateInstruments())
  .then(() => shyTxs())
  .catch(console.error)
  .finally(() => prisma.$disconnect());
