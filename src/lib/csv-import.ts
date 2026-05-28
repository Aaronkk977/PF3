import { adjustAccountCash, getOrCreateAccount } from "@/lib/accounts";
import { prisma } from "@/lib/db";
import { applyAutoFeeTax } from "@/lib/fee-tax";
import { inferInstrumentCurrency } from "@/lib/instrument-currency";
import { invalidatePerformanceCache } from "@/lib/performance-cache";
import { matchLegacyAccountName } from "@/lib/standard-accounts";
import { parseCalendarDate } from "@/lib/date-keys";
import { inferAssetClass, validateSymbol } from "@/lib/yahoo";

export type CsvImportError = {
  row: number;
  message: string;
  raw?: string;
};

export type CsvImportResult = {
  imported: number;
  errors: CsvImportError[];
};

const SECURITY_TYPES = new Set(["BUY", "SELL", "DIVIDEND"]);
const CASH_TYPES = new Set(["DEPOSIT", "WITHDRAWAL"]);

export { parseCsv } from "@/lib/csv-parse";
import { parseCsv } from "@/lib/csv-parse";

export async function importCsv(content: string): Promise<CsvImportResult> {
  const { headers, rows } = parseCsv(content);
  const required = ["date", "type", "quantity", "price"];
  const missing = required.filter((h) => !headers.includes(h));
  const hasSymbol = headers.includes("symbol");

  if (missing.length > 0) {
    return {
      imported: 0,
      errors: [{ row: 0, message: `缺少必要欄位: ${missing.join(", ")}` }],
    };
  }

  const errors: CsvImportError[] = [];
  let imported = 0;

  for (let i = 0; i < rows.length; i++) {
    const rowNum = i + 2;
    const row = rows[i];
    const get = (key: string) => {
      const idx = headers.indexOf(key);
      return idx >= 0 ? row[idx] ?? "" : "";
    };

    try {
      const dateStr = get("date");
      const type = get("type").toUpperCase();
      const quantity = parseFloat(get("quantity"));
      const price = parseFloat(get("price"));
      const feeRaw = get("fee");
      const taxRaw = get("tax");
      const note = get("note") || undefined;
      const accountLabel = get("account");
      const accountName =
        matchLegacyAccountName(accountLabel) ??
        (accountLabel.trim() || undefined);

      if (!dateStr) throw new Error("日期為空");
      if (!SECURITY_TYPES.has(type) && !CASH_TYPES.has(type)) {
        throw new Error(`無效類型: ${type}`);
      }
      if (Number.isNaN(quantity) || Number.isNaN(price)) {
        throw new Error("數量或價格格式錯誤");
      }

      const date = parseCalendarDate(dateStr);

      const account = await getOrCreateAccount(undefined, accountName);

      if (CASH_TYPES.has(type)) {
        const amt = price > 0 ? price : quantity;
        await prisma.transaction.create({
          data: {
            accountId: account.id,
            instrumentId: null,
            type,
            date,
            quantity: 1,
            price: amt,
            fee: 0,
            tax: 0,
            note,
          },
        });
        await adjustAccountCash(account.id);
        imported++;
        continue;
      }

      const symbol = get("symbol").toUpperCase();
      if (!symbol && hasSymbol) throw new Error("代碼為空");

      let instrument = await prisma.instrument.findUnique({ where: { symbol } });
      if (!instrument) {
        const validated = await validateSymbol(symbol);
        instrument = await prisma.instrument.create({
          data: {
            symbol,
            name: validated?.name,
            assetClass: inferAssetClass(symbol),
            currency: inferInstrumentCurrency(
              symbol,
              validated?.currency,
              validated?.currency,
            ),
          },
        });
      }

      const feeParsed = feeRaw === "" ? undefined : parseFloat(feeRaw);
      const taxParsed = taxRaw === "" ? undefined : parseFloat(taxRaw);
      const accountRow = await prisma.account.findUniqueOrThrow({
        where: { id: account.id },
      });
      const { fee, tax } = applyAutoFeeTax(
        accountRow,
        instrument,
        type,
        quantity,
        price,
        feeParsed !== undefined && !Number.isNaN(feeParsed) ? feeParsed : undefined,
        taxParsed !== undefined && !Number.isNaN(taxParsed) ? taxParsed : undefined,
      );

      await prisma.transaction.create({
        data: {
          accountId: account.id,
          instrumentId: instrument.id,
          type,
          date,
          quantity,
          price,
          fee,
          tax,
          note,
        },
      });
      imported++;
    } catch (e) {
      errors.push({
        row: rowNum,
        message: e instanceof Error ? e.message : "未知錯誤",
        raw: row.join(","),
      });
    }
  }

  if (imported > 0) await invalidatePerformanceCache();
  return { imported, errors };
}
