/**
 * 回補自組市場序列的歷史：台灣 VIX（VIXTWN）、融資餘額（TWMARGIN）、
 * 大盤融資維持率（TWMARGINRATIO）。
 *
 * 用法：
 *   npm run market:backfill-series            # 往前 12 個月
 *   npm run market:backfill-series -- 24      # 往前 24 個月
 *
 * VIX 用期交所官方月檔蓋掉盤中快照／存錯日期的值（期交所只保留約 3 個月），
 * 更早的缺口從期交所指數專區補（最多最近 3 年，例如 `-- 36`）。
 * 融資每個交易日 4 個請求，證交所請求刻意間隔 2.5 秒，一年約 20 分鐘；
 * 已經有資料的日期會跳過，中斷後重跑會接著補。
 */

import "dotenv/config";

import { prisma } from "@/lib/db";
import { findMissingMarginDays, syncMarginDay } from "@/lib/market-data/taiwan-margin";
import { syncVixHistory } from "@/lib/market-data/taiwan-vix";

async function main() {
  const months = Number(process.argv[2] ?? 12);
  const end = new Date();
  const start = new Date(end);
  start.setMonth(start.getMonth() - months);

  console.log(`VIXTWN：同步官方收盤…`);
  const vixBars = await syncVixHistory(start, end);
  console.log(`VIXTWN：完成，區間內 ${vixBars.length} 筆`);

  const missing = await findMissingMarginDays(start, end);
  console.log(`融資：${missing.length} 個工作日待補（含假日）`);
  let ok = 0;
  let skipped = 0;
  for (const [i, key] of missing.entries()) {
    const done = await syncMarginDay(key).catch((e) => {
      console.error(`  ${key} 失敗`, e);
      return false;
    });
    if (done) ok++;
    else skipped++;
    if ((i + 1) % 10 === 0 || i === missing.length - 1) {
      console.log(`  ${i + 1}/${missing.length}（最新處理 ${key}，成功 ${ok}、無資料 ${skipped}）`);
    }
  }
  console.log("完成");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
