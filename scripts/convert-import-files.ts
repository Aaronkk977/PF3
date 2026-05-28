import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { convertLegacyCsvToStandard } from "../src/lib/legacy-csv-convert";

const root = process.cwd();
const importDir = resolve(root, "data", "import");
const legacyDir = resolve(importDir, "legacy");

const sources = [
  resolve(root, "All_transactions.csv"),
  resolve(importDir, "All_transactions.csv"),
];

function main() {
  mkdirSync(legacyDir, { recursive: true });

  let legacyContent: string | null = null;
  let sourcePath = "";

  for (const p of sources) {
    if (existsSync(p)) {
      legacyContent = readFileSync(p, "utf-8");
      sourcePath = p;
      break;
    }
  }

  if (!legacyContent) {
    console.error("找不到 All_transactions.csv（請放在專案根目錄或 data/import/）");
    process.exit(1);
  }

  const legacyDest = resolve(legacyDir, "All_transactions.csv");
  copyFileSync(sourcePath, legacyDest);
  console.log(`已複製舊版匯出檔 → ${legacyDest}`);

  const standard = convertLegacyCsvToStandard(legacyContent);
  const standardPath = resolve(importDir, "transactions.csv");
  writeFileSync(standardPath, standard, "utf-8");
  const lines = standard.split("\n").length - 1;
  console.log(`已轉換標準格式 → ${standardPath}（${lines} 筆資料列）`);

  const publicSample = resolve(root, "public", "sample-import.csv");
  writeFileSync(
    publicSample,
    "date,symbol,type,quantity,price,fee,tax,account,note\n2025-01-10,2330.TW,BUY,100,580,20,0,台股（永豐）,\n",
    "utf-8",
  );
  console.log(`已更新範例 → ${publicSample}`);
}

main();
