import { readFileSync } from "fs";
import { adjustAccountCash } from "@/lib/accounts";
import { prisma } from "@/lib/db";
import { applyAutoFeeTax } from "@/lib/fee-tax";
import { invalidatePerformanceCache } from "@/lib/performance-cache";
import { inferInstrumentCurrency } from "@/lib/instrument-currency";
import { findAccountByLabel } from "@/lib/accounts";
import {
  matchLegacyAccountName,
  standardAccountCurrency,
  STANDARD_ACCOUNTS,
} from "@/lib/standard-accounts";
function inferAssetClass(symbol: string): string {
  if (symbol.includes("-USD") || symbol.includes("-USDT")) return "crypto";
  if (symbol.startsWith("^")) return "index";
  if (symbol.endsWith(".TW") || symbol.endsWith(".TWO")) return "stock";
  return "stock";
}
import type { CsvImportError, CsvImportResult } from "@/lib/csv-import";
import { parseCsv } from "@/lib/csv-parse";
import { parseCalendarDate } from "@/lib/date-keys";

function parseMoney(value: string): number {
  if (!value?.trim()) return 0;
  const cleaned = value.replace(/,/g, "").replace(/USD\s*/gi, "").trim();
  const n = parseFloat(cleaned);
  return Number.isNaN(n) ? 0 : n;
}

function normalizeSymbol(raw: string): string {
  const s = raw.trim().toUpperCase();
  if (!s) return "";
  return s;
}

function mapType(raw: string): string | null {
  const t = raw.trim().toLowerCase();
  if (t === "buy") return "BUY";
  if (t === "sell") return "SELL";
  if (t === "dividend") return "DIVIDEND";
  if (t === "deposit" || t === "withdrawal") return t.toUpperCase();
  return null;
}

type LegacyRow = {
  date: string;
  type: string;
  symbol: string;
  security: string;
  shares: string;
  quote: string;
  amount: string;
  fees: string;
  taxes: string;
  net: string;
  account: string;
  note: string;
};

function rowFromLegacy(
  headers: string[],
  row: string[],
): LegacyRow {
  const idx = (names: string[]) => {
    for (const n of names) {
      const i = headers.indexOf(n);
      if (i >= 0) return row[i] ?? "";
    }
    return "";
  };

  return {
    date: idx(["date"]),
    type: idx(["type"]),
    symbol: idx(["symbol"]),
    security: idx(["security"]),
    shares: idx(["shares"]),
    quote: idx(["quote"]),
    amount: idx(["amount"]),
    fees: idx(["fees", "fee"]),
    taxes: idx(["taxes", "tax"]),
    net: idx(["net transaction value", "net"]),
    account: idx(["account"]),
    note: idx(["note"]),
  };
}

export async function importLegacyCsv(content: string): Promise<
  CsvImportResult & { deposits: number; withdrawals: number; skipped: number }
> {
  const { headers, rows } = parseCsv(content);

  const isLegacy =
    headers.includes("security") ||
    headers.includes("shares") ||
    headers.includes("quote");

  if (!isLegacy) {
    throw new Error("請使用標準格式 CSV 或 All_transactions 匯出檔");
  }

  const accountCache = new Map<string, { id: string; currency: string }>();

  async function resolveAccount(accountLabel: string) {
    const raw = accountLabel.trim();
    const canonicalKey =
      matchLegacyAccountName(raw) ??
      (raw || STANDARD_ACCOUNTS[0].name);
    const cached = accountCache.get(canonicalKey);
    if (cached) return cached;

    let account = await findAccountByLabel(raw || canonicalKey);
    if (!account) {
      account = await prisma.account.create({
        data: {
          name: canonicalKey,
          currency: standardAccountCurrency(canonicalKey),
          cash: 0,
        },
      });
    }

    const entry = { id: account.id, currency: account.currency };
    accountCache.set(canonicalKey, entry);
    return entry;
  }

  const instrumentCache = new Map<string, string>();
  const existing = await prisma.instrument.findMany();
  for (const i of existing) {
    instrumentCache.set(i.symbol, i.id);
  }

  const errors: CsvImportError[] = [];
  let imported = 0;
  let skipped = 0;
  let deposits = 0;
  let withdrawals = 0;

  for (let i = 0; i < rows.length; i++) {
    const rowNum = i + 2;
    const legacy = rowFromLegacy(headers, rows[i]);

    try {
      const mappedType = mapType(legacy.type);
      if (!mappedType) {
        skipped++;
        continue;
      }

      if (mappedType === "DEPOSIT" || mappedType === "WITHDRAWAL") {
        const amt = Math.abs(parseMoney(legacy.net || legacy.amount));
        if (amt <= 0) {
          skipped++;
          continue;
        }
        const account = await resolveAccount(legacy.account);
        const date = parseCalendarDate(legacy.date);
        const noteParts = [legacy.note].filter(Boolean);

        await prisma.transaction.create({
          data: {
            accountId: account.id,
            instrumentId: null,
            type: mappedType,
            date,
            quantity: 1,
            price: amt,
            fee: 0,
            tax: 0,
            note: noteParts.length > 0 ? noteParts.join(" · ") : undefined,
          },
        });
        await adjustAccountCash(account.id);
        if (mappedType === "DEPOSIT") deposits++;
        else withdrawals++;
        imported++;
        continue;
      }

      const symbol = normalizeSymbol(legacy.symbol);
      if (!symbol) {
        skipped++;
        continue;
      }

      const date = parseCalendarDate(legacy.date);
      let quantity = parseMoney(legacy.shares);
      let price = parseMoney(legacy.quote);

      if (mappedType === "DIVIDEND") {
        const net = parseMoney(legacy.net);
        const gross = parseMoney(legacy.amount);
        const total = net > 0 ? net : gross;
        if (quantity <= 0) quantity = 1;
        price = total / quantity;
      } else {
        if (quantity <= 0) throw new Error("股數為 0");
        if (price <= 0) {
          const amount = parseMoney(legacy.amount);
          if (amount > 0) price = amount / quantity;
          else throw new Error("無法解析價格");
        }
      }

      let instrumentId = instrumentCache.get(symbol);
      if (!instrumentId) {
        const inst = await prisma.instrument.create({
          data: {
            symbol,
            name: legacy.security || symbol,
            assetClass: inferAssetClass(symbol),
            currency: inferInstrumentCurrency(
              symbol,
              symbol.includes("-USD") || legacy.amount.includes("USD")
                ? "USD"
                : symbol.endsWith(".TW") || symbol.endsWith(".TWO")
                  ? "TWD"
                  : null,
            ),
          },
        });
        instrumentId = inst.id;
        instrumentCache.set(symbol, instrumentId);
      }

      const instrument = await prisma.instrument.findUniqueOrThrow({
        where: { id: instrumentId },
      });

      const feeParsed = legacy.fees ? parseMoney(legacy.fees) : undefined;
      const taxParsed = legacy.taxes ? parseMoney(legacy.taxes) : undefined;
      const hasFee = feeParsed !== undefined && !Number.isNaN(feeParsed);
      const hasTax = taxParsed !== undefined && !Number.isNaN(taxParsed);

      const account = await resolveAccount(legacy.account);
      const accountRow = await prisma.account.findUniqueOrThrow({
        where: { id: account.id },
      });

      const { fee, tax } = applyAutoFeeTax(
        accountRow,
        instrument,
        mappedType,
        quantity,
        price,
        hasFee ? feeParsed : undefined,
        hasTax ? taxParsed : undefined,
      );

      const noteParts = [legacy.note].filter(Boolean);

      await prisma.transaction.create({
        data: {
          accountId: account.id,
          instrumentId,
          type: mappedType,
          date,
          quantity,
          price,
          fee,
          tax,
          note: noteParts.length > 0 ? noteParts.join(" · ") : undefined,
        },
      });
      imported++;
    } catch (e) {
      errors.push({
        row: rowNum,
        message: e instanceof Error ? e.message : "未知錯誤",
        raw: rows[i].join(","),
      });
    }
  }

  await invalidatePerformanceCache();
  return { imported, errors, deposits, withdrawals, skipped };
}

export async function importLegacyCsvFile(filePath: string) {
  const content = readFileSync(filePath, "utf-8");
  return importLegacyCsv(content);
}
