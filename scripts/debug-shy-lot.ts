import { PrismaClient } from "@prisma/client";
import { toLocalDateKey } from "../src/lib/date-keys";
import { inferInstrumentCurrency } from "../src/lib/instrument-currency";
import { getExchangeRateOnDate } from "../src/lib/fx-rates";
import { toNumber } from "../src/lib/utils";

const prisma = new PrismaClient();

async function toTwd(
  amount: number,
  ccy: string,
  date: Date,
  cache: Map<string, number>,
) {
  if (ccy === "TWD") return amount;
  const key = toLocalDateKey(date);
  let rate = cache.get(key);
  if (!rate) {
    rate = (await getExchangeRateOnDate("USD", "TWD", date)) ?? 32;
    cache.set(key, rate);
  }
  return amount * rate;
}

async function main() {
  const inst = await prisma.instrument.findUnique({ where: { symbol: "SHY" } });
  if (!inst) throw new Error("no SHY");

  const txs = await prisma.transaction.findMany({
    where: { instrumentId: inst.id },
    orderBy: { date: "asc" },
    include: { account: true },
  });

  const lots: { date: string; qty: number; cost: number; perShare: number }[] =
    [];
  const cache = new Map<string, number>();
  const instCcy = inferInstrumentCurrency(inst.symbol, inst.currency);

  for (const raw of txs) {
    const qty = toNumber(raw.quantity);
    const price = toNumber(raw.price);
    const dateKey = toLocalDateKey(raw.date);

    if (raw.type === "BUY" && qty > 0) {
      const cost = await toTwd(qty * price, instCcy, raw.date, cache);
      lots.push({
        date: dateKey,
        qty,
        cost,
        perShare: cost / qty,
      });
      console.log(`BUY ${dateKey} qty=${qty} px=${price} cost=${cost.toFixed(0)} per=${(cost / qty).toFixed(0)}`);
    } else if (raw.type === "DIVIDEND" && qty > 0) {
      const div = await toTwd(qty * price, instCcy, raw.date, cache);
      let rem = div;
      for (const lot of lots) {
        if (rem <= 0) break;
        const cut = Math.min(lot.cost, rem);
        lot.cost -= cut;
        rem -= cut;
      }
      console.log(`DIV ${dateKey} cut=${div.toFixed(0)} lots=${lots.length}`);
    } else if (raw.type === "SELL" && qty > 0) {
      let remaining = qty;
      let matched = 0;
      const usedLots: string[] = [];
      while (remaining > 0 && lots.length > 0) {
        const lot = lots[0]!;
        const used = Math.min(remaining, lot.qty);
        const part = (lot.cost / lot.qty) * used;
        matched += part;
        usedLots.push(
          `${lot.date} used=${used} part=${part.toFixed(0)} lotPer=${(lot.cost / lot.qty).toFixed(0)}`,
        );
        lot.qty -= used;
        lot.cost -= part;
        remaining -= used;
        if (lot.qty <= 0.0000001) lots.shift();
      }
      const proceeds = await toTwd(qty * price, instCcy, raw.date, cache);
      if (dateKey >= "2026-01-01") {
        console.log(
          `SELL ${dateKey} qty=${qty} px=${price} proceeds=${proceeds.toFixed(0)} matched=${matched.toFixed(0)} pnl=${(proceeds - matched).toFixed(0)}`,
        );
        for (const u of usedLots) console.log("  ", u);
        console.log("  remaining open lots:", lots.length);
      }
    }
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
