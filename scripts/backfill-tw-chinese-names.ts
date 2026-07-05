/**
 * 一次性回填：把資料庫中仍是英文（非中文）名稱的台股 Instrument / WatchlistItem
 * 改用 TWSE／TPEx 官方代碼查詢 API 補上正確中文名。
 *
 * 註：獨立於 src/lib/yahoo.ts（其 "server-only" import 只能在 Next.js 內解析），
 * 故在此複製一份同邏輯的查詢函式，與 src/lib/instrument-display-name.ts 保持一致。
 *
 * 用法：npx tsx scripts/backfill-tw-chinese-names.ts
 */
import { config } from "dotenv";
import path from "path";
config({ path: path.resolve(process.cwd(), ".env") });

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function hasCjk(text: string): boolean {
  return /[一-鿿]/.test(text);
}

function isTaiwanSymbol(symbol: string): boolean {
  const s = symbol.toUpperCase();
  return s.endsWith(".TW") || s.endsWith(".TWO");
}

async function twseCodeQuery(code: string): Promise<string | null> {
  const res = await fetch(
    `https://www.twse.com.tw/rwd/zh/api/codeQuery?query=${encodeURIComponent(code)}`,
    { headers: { "User-Agent": "Mozilla/5.0" } },
  ).catch(() => null);
  if (!res?.ok) return null;
  try {
    const data = (await res.json()) as { suggestions?: string[] };
    for (const s of data.suggestions ?? []) {
      const [c, name] = s.split("\t");
      if (c === code && name) return name.trim();
    }
  } catch {}
  return null;
}

async function tpexCodeQuery(code: string): Promise<string | null> {
  const res = await fetch(
    `https://www.tpex.org.tw/www/zh-tw/api/codeQuery?query=${encodeURIComponent(code)}`,
    { headers: { "User-Agent": "Mozilla/5.0" } },
  ).catch(() => null);
  if (!res?.ok) return null;
  try {
    const data = (await res.json()) as {
      suggestions?: { type?: string; data?: string[] }[];
    };
    for (const group of data.suggestions ?? []) {
      for (const entry of group.data ?? []) {
        const [label, c] = entry.split("\t");
        if (c !== code || !label) continue;
        return label.startsWith(code) ? label.slice(code.length).trim() : label.trim();
      }
    }
  } catch {}
  return null;
}

async function fetchTaiwanChineseName(symbol: string): Promise<string | null> {
  const sym = symbol.toUpperCase();
  const code = sym.replace(/\.(TW|TWO)$/i, "");
  if (sym.endsWith(".TWO")) {
    return (await tpexCodeQuery(code)) ?? (await twseCodeQuery(code));
  }
  return (await twseCodeQuery(code)) ?? (await tpexCodeQuery(code));
}

async function main() {
  const instruments = await prisma.instrument.findMany();
  const twInstruments = instruments.filter(
    (i) => isTaiwanSymbol(i.symbol) && (!i.name || !hasCjk(i.name)),
  );
  console.log(`待回填 Instrument：${twInstruments.length} 筆`);
  for (const inst of twInstruments) {
    const cn = await fetchTaiwanChineseName(inst.symbol);
    if (cn) {
      await prisma.instrument.update({ where: { id: inst.id }, data: { name: cn } });
      console.log(`  ${inst.symbol}: ${inst.name ?? "(空)"} -> ${cn}`);
    } else {
      console.log(`  ${inst.symbol}: 查無中文名（保留原值 ${inst.name ?? "(空)"}）`);
    }
  }

  const items = await prisma.watchlistItem.findMany();
  const twItems = items.filter(
    (i): i is typeof i & { symbol: string } =>
      !!i.symbol && isTaiwanSymbol(i.symbol) && (!i.name || !hasCjk(i.name)),
  );
  console.log(`\n待回填 WatchlistItem：${twItems.length} 筆`);
  for (const item of twItems) {
    const cn = await fetchTaiwanChineseName(item.symbol);
    if (cn) {
      await prisma.watchlistItem.update({ where: { id: item.id }, data: { name: cn } });
      console.log(`  ${item.symbol}: ${item.name ?? "(空)"} -> ${cn}`);
    } else {
      console.log(`  ${item.symbol}: 查無中文名（保留原值 ${item.name ?? "(空)"}）`);
    }
  }

  console.log("\n完成。");
  await prisma.$disconnect();
}

main();
