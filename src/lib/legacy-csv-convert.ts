import { matchLegacyAccountName } from "@/lib/standard-accounts";
import { parseCsv } from "@/lib/csv-parse";

function parseMoney(value: string): number {
  if (!value?.trim()) return 0;
  const cleaned = value.replace(/,/g, "").replace(/USD\s*/gi, "").trim();
  const n = parseFloat(cleaned);
  return Number.isNaN(n) ? 0 : n;
}

function mapType(raw: string): string | null {
  const t = raw.trim().toLowerCase();
  if (t === "buy") return "BUY";
  if (t === "sell") return "SELL";
  if (t === "dividend") return "DIVIDEND";
  if (t === "deposit") return "DEPOSIT";
  if (t === "withdrawal") return "WITHDRAWAL";
  return null;
}

function escapeCsv(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function rowFromLegacy(headers: string[], row: string[]) {
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

/** 將舊軟體 All_transactions 格式轉為本系統標準 CSV */
export function convertLegacyCsvToStandard(content: string): string {
  const { headers, rows } = parseCsv(content);
  const isLegacy =
    headers.includes("security") ||
    headers.includes("shares") ||
    headers.includes("quote");

  if (!isLegacy) {
    return content;
  }

  const out: string[] = [
    "date,symbol,type,quantity,price,fee,tax,account,note",
  ];

  for (const row of rows) {
    const legacy = rowFromLegacy(headers, row);
    const type = mapType(legacy.type);
    if (!type) continue;

    const account =
      matchLegacyAccountName(legacy.account) ?? legacy.account.trim();
    const date = legacy.date.trim().slice(0, 10);

    if (type === "DEPOSIT" || type === "WITHDRAWAL") {
      const amt = Math.abs(parseMoney(legacy.net || legacy.amount));
      if (amt <= 0) continue;
      out.push(
        [
          date,
          "",
          type,
          "1",
          String(amt),
          "0",
          "0",
          escapeCsv(account),
          escapeCsv(legacy.note),
        ].join(","),
      );
      continue;
    }

    const symbol = legacy.symbol.trim().toUpperCase();
    if (!symbol) continue;

    let quantity = parseMoney(legacy.shares);
    let price = parseMoney(legacy.quote);
    if (type === "DIVIDEND") {
      const net = parseMoney(legacy.net);
      const gross = parseMoney(legacy.amount);
      const total = net > 0 ? net : gross;
      if (quantity <= 0) quantity = 1;
      price = total / quantity;
    } else {
      if (quantity <= 0) continue;
      if (price <= 0) {
        const amount = parseMoney(legacy.amount);
        if (amount > 0) price = amount / quantity;
        else continue;
      }
    }

    const fee = parseMoney(legacy.fees);
    const tax = parseMoney(legacy.taxes);

    out.push(
      [
        date,
        symbol,
        type,
        String(quantity),
        String(price),
        String(fee),
        String(tax),
        escapeCsv(account),
        escapeCsv(legacy.note),
      ].join(","),
    );
  }

  return out.join("\n");
}
