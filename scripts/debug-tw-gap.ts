import { PrismaClient } from "@prisma/client";
import { toLocalDateKey } from "../src/lib/date-keys";
import { toNumber } from "../src/lib/utils";

const prisma = new PrismaClient();
const START_KEY = "2026-04-27";
const END_KEY = "2026-05-18";

function inPeriodKey(d: Date) {
  const k = toLocalDateKey(d);
  return k >= START_KEY && k <= END_KEY;
}

async function main() {
  const tw = await prisma.account.findFirst({ where: { currency: "TWD" } });
  if (!tw) return;

  const txs = await prisma.transaction.findMany({
    where: { accountId: tw!.id, date: { lte: new Date(`${END_KEY}T23:59:59`) } },
    include: { instrument: true },
    orderBy: { date: "asc" },
  });

  type Lot = { qty: number; costGross: number; costNet: number; buyFee: number; buyTax: number };
  const lots = new Map<string, Lot[]>();
  let realizedGross = 0;
  let matchedBuyFeesOnSells = 0;
  let matchedBuyTaxOnSells = 0;
  let sellFees = 0;
  let sellTax = 0;

  for (const raw of txs) {
    if (!raw.instrumentId) continue;
    const qty = toNumber(raw.quantity);
    const price = toNumber(raw.price);
    const fee = toNumber(raw.fee);
    const tax = toNumber(raw.tax);
    const arr = lots.get(raw.instrumentId) ?? [];

    if (raw.type === "BUY" && qty > 0) {
      const gross = qty * price;
      arr.push({
        qty,
        costGross: gross,
        costNet: gross + fee + tax,
        buyFee: fee,
        buyTax: tax,
      });
    } else if (raw.type === "SELL" && qty > 0) {
      let rem = qty;
      let matchedGross = 0;
      let matchedNet = 0;
      let allocBuyFee = 0;
      let allocBuyTax = 0;
      while (rem > 0 && arr.length > 0) {
        const lot = arr[0]!;
        const used = Math.min(rem, lot.qty);
        const ratio = used / lot.qty;
        matchedGross += lot.costGross * ratio;
        matchedNet += lot.costNet * ratio;
        allocBuyFee += lot.buyFee * ratio;
        allocBuyTax += lot.buyTax * ratio;
        lot.qty -= used;
        lot.costGross -= lot.costGross * ratio;
        lot.costNet -= lot.costNet * ratio;
        lot.buyFee -= lot.buyFee * ratio;
        lot.buyTax -= lot.buyTax * ratio;
        rem -= used;
        if (lot.qty <= 0.0000001) arr.shift();
      }
      if (inPeriodKey(raw.date)) {
        const proceeds = qty * price;
        realizedGross += proceeds - matchedGross;
        sellFees += fee;
        sellTax += tax;
        matchedBuyFeesOnSells += allocBuyFee;
        matchedBuyTaxOnSells += allocBuyTax;
      }
    } else if (raw.type === "DIVIDEND" && qty > 0) {
      let rem = qty * price;
      for (const lot of arr) {
        if (rem <= 0) break;
        const cut = Math.min(lot.costGross, rem);
        lot.costGross -= cut;
        lot.costNet -= cut;
        rem -= cut;
      }
    }
    lots.set(raw.instrumentId, arr);
  }

  const r = Math.round(realizedGross);
  console.log("FIFO gross (date keys), realized:", r);
  console.log("sell fees", sellFees, "sell tax", sellTax);
  console.log("buy fees on sold lots", Math.round(matchedBuyFeesOnSells));
  console.log("buy tax on sold lots", Math.round(matchedBuyTaxOnSells));
  console.log("+ sell fees", r + Math.round(sellFees));
  console.log("+ sell fees + sell tax", r + Math.round(sellFees + sellTax));
  console.log("+ buy fees on sold", r + Math.round(matchedBuyFeesOnSells));
  console.log("+ buy fees + buy tax on sold", r + Math.round(matchedBuyFeesOnSells + matchedBuyTaxOnSells));
  console.log("+ all charges", r + Math.round(sellFees + sellTax + matchedBuyFeesOnSells + matchedBuyTaxOnSells));
  console.log("broker target", 49192, "delta", 49192 - r);

  // period txs fees totals
  let pBuyFee = 0, pBuyTax = 0, pSellFee = 0, pSellTax = 0;
  for (const raw of txs) {
    if (!inPeriodKey(raw.date)) continue;
    const fee = toNumber(raw.fee);
    const tax = toNumber(raw.tax);
    if (raw.type === "BUY") { pBuyFee += fee; pBuyTax += tax; }
    if (raw.type === "SELL") { pSellFee += fee; pSellTax += tax; }
  }
  console.log("\nperiod totals buyFee", pBuyFee, "buyTax", pBuyTax, "sellFee", pSellFee, "sellTax", pSellTax);

  // DateTime inPeriod (API style T12:00) vs date-key
  const startDt = new Date(`${START_KEY}T12:00:00`);
  const endDt = new Date(`${END_KEY}T23:59:59`);
  let dtRealized = 0;
  const lots2 = new Map<string, { qty: number; cost: number }[]>();
  for (const raw of txs) {
    if (!raw.instrumentId) continue;
    const qty = toNumber(raw.quantity);
    const price = toNumber(raw.price);
    const arr = lots2.get(raw.instrumentId) ?? [];
    if (raw.type === "BUY" && qty > 0) {
      arr.push({ qty, cost: qty * price });
    } else if (raw.type === "SELL" && qty > 0) {
      let rem = qty;
      let matched = 0;
      while (rem > 0 && arr.length) {
        const lot = arr[0]!;
        const used = Math.min(rem, lot.qty);
        const slice = (lot.cost / lot.qty) * used;
        matched += slice;
        lot.cost -= slice;
        lot.qty -= used;
        rem -= used;
        if (lot.qty <= 0.0000001) arr.shift();
      }
      if (raw.date >= startDt && raw.date <= endDt) {
        dtRealized += qty * price - matched;
      }
    }
    lots2.set(raw.instrumentId, arr);
  }
  console.log("\nFIFO with DateTime >= start T12:00:", Math.round(dtRealized));

  const sells = await prisma.transaction.findMany({
    where: {
      accountId: tw!.id,
      type: "SELL",
      date: { gte: new Date(`${START_KEY}T00:00:00`) },
    },
    include: { instrument: true },
    orderBy: { date: "asc" },
  });
  console.log("\nAll TW sells from 4/27:", sells.length);
  for (const s of sells) {
    console.log(toLocalDateKey(s.date), s.instrument?.symbol);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
