/**
 * 一次性遷移：把 Instrument.notes（舊版標的頁「投資筆記」自由文字欄位）
 * 搬進新版筆記系統（Note + NoteOnInstrument），這樣合併掉舊欄位的 UI
 * 之後，這些內容還是查得到，不會憑空消失。
 *
 *   node scripts/migrate-instrument-notes.mjs
 *
 * 冪等：只處理 Instrument.notes 非空的資料列，跑完後不清空原欄位
 * （保留原始資料以備查，新版 UI 不會再讀它）。
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const DEFAULT_KIND = "產業研究";

async function main() {
  const instruments = await prisma.instrument.findMany({
    where: { notes: { not: null } },
    select: { id: true, symbol: true, name: true, notes: true },
  });
  const targets = instruments.filter((i) => i.notes && i.notes.trim().length > 0);

  if (targets.length === 0) {
    console.log("沒有需要遷移的舊筆記。");
    return;
  }

  const today = new Date();
  for (const inst of targets) {
    const title = `${inst.name ?? inst.symbol} 筆記`;
    await prisma.note.create({
      data: {
        title,
        content: inst.notes.trim(),
        kind: DEFAULT_KIND,
        noteDate: today,
        instruments: { create: [{ instrumentId: inst.id }] },
      },
    });
    console.log(`已建立：${title}（${inst.symbol}）`);
  }

  console.log(`完成，共遷移 ${targets.length} 筆。`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
