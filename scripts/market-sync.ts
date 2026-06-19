/**
 * 全市場盤後資料同步（TWSE + TPEx）
 *
 * 用法：
 *   npm run market:sync                        # 今日
 *   npm run market:sync:history -- 12          # 往前 12 個月所有工作日
 *   npm run market:sync -- --date 2026-06-12   # 指定單日
 *
 * 優化：
 *   - 跳過 DB 已有足夠資料的日期（可用 --force 強制重抓）
 *   - 每批 3 個日期並行，加速 3x
 *   - 失敗自動重試一次（延遲 3 秒）
 */

import { config } from "dotenv";
import path from "path";
config({ path: path.resolve(process.cwd(), ".env") });

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// ── helpers ───────────────────────────────────────────────────────────────────

function cleanNum(s: string): number {
  return parseFloat(s.replace(/,/g, "").trim()) || 0;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

type SnapshotRow = {
  symbol: string;
  name: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  volume: number;
  turnover: number | null;
  changePercent: number | null;
};

// ── 查詢 DB 已有哪些日期的資料 ─────────────────────────────────────────────────

async function getExistingDates(): Promise<{ twse: Set<string>; tpex: Set<string> }> {
  // 以 >100 筆為門檻判定「已同步成功」（排除偶發空白返回）
  const rows = await prisma.marketDailySnapshot.groupBy({
    by: ["date", "exchange"],
    _count: { symbol: true },
  });

  const twse = new Set<string>();
  const tpex = new Set<string>();
  for (const r of rows) {
    if (r._count.symbol > 100) {
      if (r.exchange === "TWSE") twse.add(r.date);
      if (r.exchange === "TPEx") tpex.add(r.date);
    }
  }
  return { twse, tpex };
}

// ── TWSE ──────────────────────────────────────────────────────────────────────

async function fetchTwseDay(date: string): Promise<SnapshotRow[]> {
  const d = date.replace(/-/g, "");
  const url = `https://www.twse.com.tw/exchangeReport/STOCK_DAY_ALL?response=json&date=${d}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = (await res.json()) as { stat?: string; data?: string[][] };
  if (json.stat !== "OK" || !json.data?.length) return [];

  const rows: SnapshotRow[] = [];
  for (const r of json.data) {
    if (r.length < 9) continue;
    const symbol = r[0].trim();
    const close = cleanNum(r[7]);
    if (!close) continue;
    const change = cleanNum(r[8]);
    const prev = close - change;
    rows.push({
      symbol,
      name: r[1].trim(),
      volume: cleanNum(r[2]),
      turnover: cleanNum(r[3]) || null,
      open: cleanNum(r[4]) || null,
      high: cleanNum(r[5]) || null,
      low: cleanNum(r[6]) || null,
      close,
      changePercent: prev > 0 ? (change / prev) * 100 : null,
    });
  }
  return rows;
}

// ── TPEx ──────────────────────────────────────────────────────────────────────

async function fetchTpexDay(date: string): Promise<SnapshotRow[]> {
  const [y, m, d] = date.split("-");
  const rocDate = `${parseInt(y) - 1911}/${m}/${d}`;
  const url =
    `https://www.tpex.org.tw/web/stock/aftertrading/otc_quotes_no1430/stk_wn1430_result.php` +
    `?l=zh-tw&d=${encodeURIComponent(rocDate)}&se=AL&s=0,asc,0`;
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = (await res.json()) as { tables?: Array<{ data?: string[][] }> };
  const data = json.tables?.[0]?.data;
  if (!data?.length) return [];

  const rows: SnapshotRow[] = [];
  for (const r of data) {
    if (r.length < 9) continue;
    const symbol = r[0].trim();
    const close = cleanNum(r[2]);
    if (!close) continue;
    const change = cleanNum(r[3]);
    const prev = close - change;
    rows.push({
      symbol,
      name: r[1].trim(),
      close,
      changePercent: prev > 0 ? (change / prev) * 100 : null,
      open: cleanNum(r[4]) || null,
      high: cleanNum(r[5]) || null,
      low: cleanNum(r[6]) || null,
      volume: cleanNum(r[7]),
      turnover: cleanNum(r[8]) || null,
    });
  }
  return rows;
}

// ── DB upsert ─────────────────────────────────────────────────────────────────

async function upsertSnapshots(
  rows: SnapshotRow[],
  date: string,
  exchange: "TWSE" | "TPEx",
): Promise<number> {
  const CHUNK = 200;
  let count = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    await Promise.all(
      chunk.map((r) =>
        prisma.marketDailySnapshot.upsert({
          where: { symbol_date: { symbol: r.symbol, date } },
          update: {
            name: r.name,
            open: r.open,
            high: r.high,
            low: r.low,
            close: r.close,
            volume: r.volume,
            turnover: r.turnover,
            changePercent: r.changePercent,
          },
          create: {
            symbol: r.symbol,
            name: r.name,
            date,
            open: r.open,
            high: r.high,
            low: r.low,
            close: r.close,
            volume: r.volume,
            turnover: r.turnover,
            changePercent: r.changePercent,
            exchange,
          },
        }),
      ),
    );
    count += chunk.length;
  }
  return count;
}

// ── sync one date（帶重試）────────────────────────────────────────────────────

type SyncResult = { date: string; ok: boolean; twse: string; tpex: string };

async function syncDateOnce(
  date: string,
  existing: { twse: Set<string>; tpex: Set<string> },
  force: boolean,
): Promise<SyncResult> {
  const needTwse = force || !existing.twse.has(date);
  const needTpex = force || !existing.tpex.has(date);

  const [twseResult, tpexResult] = await Promise.allSettled([
    needTwse ? fetchTwseDay(date) : Promise.resolve(null),
    needTpex ? fetchTpexDay(date) : Promise.resolve(null),
  ]);

  const twseFresh = twseResult.status === "fulfilled" ? twseResult.value : null;
  const tpexFresh = tpexResult.status === "fulfilled" ? tpexResult.value : null;

  // 交叉驗證：TWSE API 在假日會悄悄返回前一交易日資料，不回傳錯誤。
  // TPEx 行為正確（假日返回空）。如果兩邊都是新抓，且 TWSE 有資料但 TPEx
  // 明確返回空（非錯誤），視為假日，跳過 TWSE 資料。
  const twseHasRows = Array.isArray(twseFresh) && twseFresh.length > 0;
  const tpexEmptyResponse = needTpex && tpexFresh !== null && Array.isArray(tpexFresh) && tpexFresh.length === 0;
  const isHolidayByTpex = needTwse && twseHasRows && tpexEmptyResponse;

  let twseStr = needTwse ? "" : "已存在";
  let tpexStr = needTpex ? "" : "已存在";
  let ok = true;

  if (needTwse) {
    if (twseResult.status === "fulfilled" && twseFresh !== null) {
      if (twseFresh.length === 0) {
        twseStr = "休市";
        existing.twse.add(date);
        existing.tpex.add(date); // 確認假日，兩邊都標記完成
      } else if (isHolidayByTpex) {
        // TWSE 返回資料但 TPEx 確認休市 → TWSE 資料是前日重複，不存
        twseStr = "跳過(假日)";
        existing.twse.add(date);
      } else {
        const n = await upsertSnapshots(twseFresh, date, "TWSE");
        twseStr = `${n}筆`;
      }
    } else if (twseResult.status === "rejected") {
      twseStr = `err(${(twseResult.reason as Error).message.slice(0, 30)})`;
      ok = false;
    }
  }

  if (needTpex) {
    if (tpexResult.status === "fulfilled" && tpexFresh !== null) {
      if (tpexFresh.length) {
        const n = await upsertSnapshots(tpexFresh, date, "TPEx");
        tpexStr = `${n}筆`;
      } else {
        tpexStr = "休市";
        existing.tpex.add(date);
      }
    } else if (tpexResult.status === "rejected") {
      tpexStr = `err(${(tpexResult.reason as Error).message.slice(0, 30)})`;
      ok = false;
    }
  }

  return { date, ok, twse: twseStr, tpex: tpexStr };
}

async function syncDate(
  date: string,
  existing: { twse: Set<string>; tpex: Set<string> },
  force: boolean,
): Promise<SyncResult> {
  // 兩個 exchange 都已存在則直接跳過
  if (!force && existing.twse.has(date) && existing.tpex.has(date)) {
    return { date, ok: true, twse: "已存在", tpex: "已存在" };
  }

  const result = await syncDateOnce(date, existing, force);

  // 有失敗則等 3 秒後重試一次
  if (!result.ok) {
    await sleep(3000);
    const retry = await syncDateOnce(date, existing, force);
    return {
      date,
      ok: retry.ok,
      twse: retry.twse.startsWith("err") ? `retry:${retry.twse}` : retry.twse,
      tpex: retry.tpex.startsWith("err") ? `retry:${retry.tpex}` : retry.tpex,
    };
  }

  return result;
}

// ── date helpers ──────────────────────────────────────────────────────────────

function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function weekdaysInRange(monthsBack: number): string[] {
  const dates: string[] = [];
  const end = new Date();
  end.setHours(0, 0, 0, 0);
  const start = new Date(end);
  start.setMonth(start.getMonth() - monthsBack);

  const cur = new Date(start);
  while (cur <= end) {
    const dow = cur.getDay();
    if (dow !== 0 && dow !== 6) dates.push(toDateStr(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

// ── 平行批次執行 ──────────────────────────────────────────────────────────────

async function runBatch(
  dates: string[],
  existing: { twse: Set<string>; tpex: Set<string> },
  force: boolean,
  batchSize = 3,
  delayMs = 400,
): Promise<{ failed: string[]; skipped: number; synced: number }> {
  let skipped = 0;
  let synced = 0;
  const failed: string[] = [];
  const total = dates.length;

  for (let i = 0; i < dates.length; i += batchSize) {
    const batch = dates.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map((d) => syncDate(d, existing, force)),
    );

    for (const r of results) {
      const isSkip = r.twse === "已存在" && r.tpex === "已存在";
      const pct = String(Math.round(((i + batchSize) / total) * 100)).padStart(3);

      if (isSkip) {
        skipped++;
        // 跳過的不印（太多），每 20 天印一次進度
        if (skipped % 20 === 0) {
          process.stdout.write(`[${pct}%] 已跳過 ${skipped} 天…\n`);
        }
      } else {
        synced++;
        const status = r.ok ? "✓" : "✗";
        console.log(`[${pct}%] ${r.date}  TWSE:${r.twse}  TPEx:${r.tpex}  ${status}`);
        if (!r.ok) failed.push(r.date);
      }
    }

    // 批次間延遲（避免 rate-limit）
    if (i + batchSize < dates.length) await sleep(delayMs);
  }

  return { failed, skipped, synced };
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const historyIdx = args.indexOf("--history");
  const dateIdx = args.indexOf("--date");
  const force = args.includes("--force");

  if (historyIdx !== -1) {
    const months = parseInt(args[historyIdx + 1] ?? "12");
    const dates = weekdaysInRange(months);

    console.log(`補歷史資料：過去 ${months} 個月，共 ${dates.length} 個工作日`);
    if (force) console.log("（--force：強制重抓所有日期）");
    console.log("查詢 DB 已有資料…");

    const existing = force
      ? { twse: new Set<string>(), tpex: new Set<string>() }
      : await getExistingDates();

    const needCount = dates.filter(
      (d) => force || !existing.twse.has(d) || !existing.tpex.has(d),
    ).length;
    const skipCount = dates.length - needCount;
    console.log(`  已有：${skipCount} 天，需抓取：${needCount} 天`);
    const estMin = Math.ceil((needCount * 0.4) / 60);
    console.log(`  預估時間：約 ${estMin} 分鐘（批次 3 日並行）\n`);

    const { failed, skipped, synced } = await runBatch(dates, existing, force);

    console.log(`\n完成：已同步 ${synced} 天，跳過 ${skipped} 天`);
    if (failed.length) {
      console.log(`失敗（重試後仍失敗）：${failed.length} 天`);
      for (const d of failed) console.log(`  ${d}`);
    }
  } else if (dateIdx !== -1) {
    const date = args[dateIdx + 1];
    if (!date) { console.error("--date 需要 YYYY-MM-DD"); process.exit(1); }
    console.log(`同步指定日期 ${date}…`);
    const existing = await getExistingDates();
    const r = await syncDate(date, existing, force);
    console.log(`${r.date}  TWSE:${r.twse}  TPEx:${r.tpex}  ${r.ok ? "✓" : "✗"}`);
  } else {
    const today = toDateStr(new Date());
    console.log(`同步今日 (${today})…`);
    const existing = await getExistingDates();
    const r = await syncDate(today, existing, force);
    console.log(`${r.date}  TWSE:${r.twse}  TPEx:${r.tpex}  ${r.ok ? "✓" : "✗"}`);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  prisma.$disconnect().catch(() => {});
  process.exit(1);
});
