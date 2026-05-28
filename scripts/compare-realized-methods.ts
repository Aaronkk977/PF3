import { PrismaClient } from "@prisma/client";
import { toLocalDateKey } from "../src/lib/date-keys";
import { inferInstrumentCurrency } from "../src/lib/instrument-currency";
import { getExchangeRateOnDate } from "../src/lib/fx-rates";
import { toNumber } from "../src/lib/utils";

const prisma = new PrismaClient();

async function run(
  label: string,
  periodStart: Date,
  periodEnd: Date,
  accountIds: string[],
  mode: "gross" | "net",
) {
  const txs = await prisma.transaction.findMany({
    where: { date: { lte: periodEnd }, accountId: { in: accountIds } },
    include: { instrument: true, account: true },
    orderBy: { date: "asc" },
  });
  const lots = new Map<string, { qty: number; cost: number }[]>();
  const rateCache = new Map<string, number>();
  let realized = 0;
  const inPeriod = (d: Date) => d >= periodStart && d <= periodEnd;

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

  for (const raw of txs) {
    if (!raw.instrumentId || !raw.instrument) continue;
    const instCcy = inferInstrumentCurrency(
      raw.instrument.symbol,
      raw.instrument.currency,
    );
    const acctCcy = raw.account.currency;
    const qty = toNumber(raw.quantity);
    const price = toNumber(raw.price);
    const fee = toNumber(raw.fee);
    const tax = toNumber(raw.tax);
    const lotsArr = lots.get(raw.instrumentId) ?? [];

    if (raw.type === "BUY" && qty > 0) {
      const gross = qty * price;
      const costNative =
        mode === "net"
          ? gross + fee + tax
          : gross;
      const cost = await toTwd(costNative, instCcy, raw.date);
      const feeTwd =
        mode === "gross"
          ? await toTwd(fee, acctCcy, raw.date) + await toTwd(tax, acctCcy, raw.date)
          : 0;
      if (mode === "gross" && inPeriod(raw.date)) {
        /* fees tracked separately in main module */
      }
      lotsArr.push({ qty, cost: cost + (mode === "gross" ? 0 : await toTwd(fee + tax, acctCcy, raw.date) - await toTwd(fee + tax, acctCcy, raw.date)) });
      lotsArr[lotsArr.length - 1]!.cost = await toTwd(
        mode === "net" ? gross + fee + tax : gross,
        instCcy,
        raw.date,
      );
    } else if (raw.type === "SELL" && qty > 0) {
      let remaining = qty;
      let matched = 0;
      while (remaining > 0 && lotsArr.length > 0) {
        const lot = lotsArr[0]!;
        const used = Math.min(remaining, lot.qty);
        const slice = (lot.cost / lot.qty) * used;
        matched += slice;
        lot.cost -= slice;
        lot.qty -= used;
        remaining -= used;
        if (lot.qty <= 0.0000001) lotsArr.shift();
      }
      if (inPeriod(raw.date)) {
        const gross = qty * price;
        const proceedsNative = mode === "net" ? gross - fee - tax : gross;
        const proceeds = await toTwd(proceedsNative, instCcy, raw.date);
        realized += proceeds - matched;
      }
    }
    lots.set(raw.instrumentId, lotsArr);
  }
  console.log(`${label} [${mode}]:`, Math.round(realized));
}

async function main() {
  const accounts = await prisma.account.findMany();
  const tw = accounts.filter((a) => a.currency === "TWD").map((a) => a.id);
  const start = new Date("2026-01-01");
  const end = new Date("2026-12-31T23:59:59");
  await run("2026 TW", start, end, tw, "gross");
  await run("2026 TW", start, end, tw, "net");
  await run("2026 all", start, end, accounts.map((a) => a.id), "net");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
