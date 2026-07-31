/**
 * Portfolio MCP Server
 *
 * Tools:
 *   get_holdings          — 目前持倉列表（net qty > 0）
 *   search_transactions   — 搜尋交易紀錄（可篩代號、類型、日期範圍）
 *   get_portfolio_summary — 組合整體概況（總市值、未實現損益、帳戶拆解）
 *   get_trading_review    — 期間操作複盤（逐檔/逐筆損益、進場品質、止損排行）
 *   search_notes          — 搜尋使用者的投資筆記（產業研究／操作策略／市場觀察）
 *   get_performance       — 讀取分析頁的績效快取（回檔／最大回撤／夏普／波動率／基準比較）
 *   create_note           — 新增一則投資筆記
 *   update_note           — 編輯既有筆記（標題／內容／類型／日期／關聯標的／標籤，或用 append_content 在既有內容後補充，用於協作式追蹤同一則筆記的後續想法）
 *
 * Run:
 *   npx tsx scripts/mcp-server.ts
 *
 * Register in Claude Desktop (~/.claude/claude_desktop_config.json):
 *   {
 *     "mcpServers": {
 *       "portfolio": {
 *         "command": "npx",
 *         "args": ["tsx", "C:/Users/User/Desktop/Porfolio Performance/scripts/mcp-server.ts"]
 *       }
 *     }
 *   }
 */

import { config } from "dotenv";
import path from "path";
import { createHash } from "crypto";

// Load .env from project root before PrismaClient initialises
config({ path: path.resolve(process.cwd(), ".env") });

import { PrismaClient, type Prisma } from "@prisma/client";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const prisma = new PrismaClient();

// ── helpers ──────────────────────────────────────────────────────────────────

function toNum(v: Prisma.Decimal | null | undefined): number {
  if (v == null) return 0;
  return typeof v === "object" && "toNumber" in v ? v.toNumber() : Number(v);
}

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** 將日曆日期存成 UTC 正午，與網頁版 src/lib/date-keys.ts 的 parseCalendarDate 一致，
 *  避免 MCP 寫入的 noteDate 跟網頁顯示的日期對不上（差一天）。 */
function parseCalendarDate(value: string): Date {
  const trimmed = value.trim();
  const m = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) {
    const d = new Date(trimmed);
    if (Number.isNaN(d.getTime())) throw new Error(`無效日期: ${value}`);
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12, 0, 0, 0));
  }
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const day = Number(m[3]);
  return new Date(Date.UTC(y, mo, day, 12, 0, 0, 0));
}

// ── tool: get_holdings ───────────────────────────────────────────────────────

async function getHoldings() {
  const txs = await prisma.transaction.findMany({
    where: { type: { in: ["BUY", "SELL", "DIVIDEND"] }, instrumentId: { not: null } },
    include: { instrument: true },
    orderBy: { date: "asc" },
  });

  type Pos = { symbol: string; name: string | null; currency: string | null; assetClass: string; qty: number; costBasis: number };
  const map = new Map<string, Pos>();

  for (const tx of txs) {
    if (!tx.instrument) continue;
    const sym = tx.instrument.symbol;
    if (!map.has(sym)) {
      map.set(sym, { symbol: sym, name: tx.instrument.name, currency: tx.instrument.currency, assetClass: tx.instrument.assetClass, qty: 0, costBasis: 0 });
    }
    const pos = map.get(sym)!;
    const qty = toNum(tx.quantity);
    const px = toNum(tx.price);
    const fees = toNum(tx.fee) + toNum(tx.tax);

    if (tx.type === "BUY") {
      pos.costBasis += qty * px + fees;
      pos.qty += qty;
    } else if (tx.type === "SELL") {
      if (pos.qty > 0) {
        const avgCost = pos.costBasis / pos.qty;
        pos.costBasis -= avgCost * qty;
        pos.qty -= qty;
      }
    } else if (tx.type === "DIVIDEND") {
      pos.costBasis -= qty * px;
    }
  }

  const holdings = [...map.values()].filter((p) => p.qty > 0.0001);

  // Fetch latest price from PriceCache for display
  const priceRows = await prisma.priceCache.findMany({
    where: { symbol: { in: holdings.map((h) => h.symbol) } },
    orderBy: { date: "desc" },
  });
  const latestPrice = new Map<string, number>();
  for (const row of priceRows) {
    if (!latestPrice.has(row.symbol)) latestPrice.set(row.symbol, row.close);
  }

  return holdings.map((h) => {
    const avgCost = h.qty > 0 ? h.costBasis / h.qty : 0;
    const lastPx = latestPrice.get(h.symbol) ?? 0;
    const marketValue = lastPx > 0 ? h.qty * lastPx : null;
    const unrealizedPnl = marketValue != null ? marketValue - h.costBasis : null;
    return {
      symbol: h.symbol,
      name: h.name ?? h.symbol,
      assetClass: h.assetClass,
      currency: h.currency,
      quantity: Math.round(h.qty * 1000) / 1000,
      avgCost: Math.round(avgCost * 100) / 100,
      lastPrice: lastPx > 0 ? lastPx : null,
      marketValue: marketValue != null ? Math.round(marketValue) : null,
      unrealizedPnl: unrealizedPnl != null ? Math.round(unrealizedPnl) : null,
    };
  });
}

// ── tool: search_transactions ────────────────────────────────────────────────

async function searchTransactions(args: {
  symbol?: string;
  type?: string;
  date_from?: string;
  date_to?: string;
  limit?: number;
}) {
  const where: Prisma.TransactionWhereInput = {};

  if (args.symbol) {
    where.instrument = { symbol: { contains: args.symbol.toUpperCase() } };
  }
  if (args.type) {
    where.type = args.type.toUpperCase();
  }
  if (args.date_from || args.date_to) {
    where.date = {};
    if (args.date_from) (where.date as Prisma.DateTimeFilter).gte = new Date(args.date_from);
    if (args.date_to) (where.date as Prisma.DateTimeFilter).lte = new Date(args.date_to + "T23:59:59Z");
  }

  const rows = await prisma.transaction.findMany({
    where,
    include: { instrument: true, account: true },
    orderBy: { date: "desc" },
    take: args.limit ?? 50,
  });

  return rows.map((t) => ({
    id: t.id,
    date: fmtDate(t.date),
    type: t.type,
    account: t.account.name,
    symbol: t.instrument?.symbol ?? null,
    instrumentName: t.instrument?.name ?? null,
    quantity: toNum(t.quantity),
    price: toNum(t.price),
    fee: toNum(t.fee),
    tax: toNum(t.tax),
    note: t.note ?? null,
    total: toNum(t.quantity) * toNum(t.price) + toNum(t.fee) + toNum(t.tax),
  }));
}

// ── tool: get_performance ────────────────────────────────────────────────────

/** 與 src/lib/performance-cache.ts 的 getDataFingerprint 相同演算法，
 *  用來判斷快取是否仍對應目前的交易資料（新增交易後快取就過期）。 */
async function computeDataFingerprint(): Promise<string> {
  const [txCount, txMaxDate, accountAgg] = await Promise.all([
    prisma.transaction.count(),
    prisma.transaction.aggregate({ _max: { date: true } }),
    prisma.account.aggregate({ _count: true, _sum: { cash: true } }),
  ]);
  const raw = [
    txCount,
    txMaxDate._max.date?.toISOString() ?? "",
    accountAgg._count,
    accountAgg._sum.cash?.toString() ?? "0",
  ].join(":");
  return createHash("sha256").update(raw).digest("hex").slice(0, 16);
}

async function getPerformance(args: { series_days?: number }) {
  const rows = await prisma.performanceSnapshot.findMany({ orderBy: { computedAt: "desc" } });
  if (rows.length === 0) {
    throw new Error("尚無績效快取。請先在網頁的分析頁載入一次，系統會計算並快取績效資料");
  }

  const [fingerprint, accounts] = await Promise.all([
    computeDataFingerprint(),
    prisma.account.findMany({ select: { id: true, name: true } }),
  ]);
  const accountNameById = new Map(accounts.map((a) => [a.id, a.name]));

  const seriesDays = Math.min(Math.max(args.series_days ?? 14, 0), 400);

  return rows.map((r) => {
    // cacheKey 形如 v19|2026-01-01|2026-07-19|p:<accountId,...|all>|b:0050.TW,...
    const pMatch = r.cacheKey.match(/\|p:([^|]*)\|/);
    const scopeRaw = pMatch?.[1] ?? "";
    const scope =
      scopeRaw === "all"
        ? "全部帳戶"
        : scopeRaw
            .split(",")
            .map((id) => accountNameById.get(id) ?? id)
            .join("、") || "（未知）";

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(r.payload) as Record<string, unknown>;
    } catch {
      return { scope, period: { from: r.periodStart, to: r.periodEnd }, error: "快取內容無法解析" };
    }

    const dd = Array.isArray(payload.drawdownSeries)
      ? (payload.drawdownSeries as { date: string; drawdownPct: number }[])
      : [];
    const last = dd[dd.length - 1] ?? null;

    return {
      scope,
      period: { from: r.periodStart, to: r.periodEnd },
      computedAt: r.computedAt.toISOString(),
      /** false 表示計算後又有新交易／現金變動，數字僅供參考，建議回網頁分析頁重新載入 */
      isFresh: r.dataFingerprint === fingerprint,
      currentDrawdownPct: last ? Math.round(last.drawdownPct * 100) / 100 : null,
      currentDrawdownDate: last?.date ?? null,
      riskIndicators: payload.riskIndicators ?? null,
      keyIndicators: payload.keyIndicators ?? null,
      todayChange: payload.todayChange ?? null,
      todayChangePct: payload.todayChangePct ?? null,
      calculation: payload.calculation ?? null,
      benchmarks: payload.benchmarks ?? null,
      recentDrawdownSeries: seriesDays > 0 ? dd.slice(-seriesDays) : [],
    };
  });
}

// ── notes: shared helpers ────────────────────────────────────────────────────

const NOTE_INCLUDE = {
  instruments: { include: { instrument: true } },
  tags: { include: { tag: true } },
} satisfies Prisma.NoteInclude;

type NoteWithRelations = Prisma.NoteGetPayload<{ include: typeof NOTE_INCLUDE }>;

function formatNote(n: NoteWithRelations) {
  return {
    id: n.id,
    title: n.title,
    kind: n.kind,
    noteDate: fmtDate(n.noteDate),
    content: n.content,
    symbols: n.instruments.map((i) => i.instrument.symbol),
    tags: n.tags.map((t) => t.tag.name),
    createdAt: fmtDate(n.createdAt),
    updatedAt: fmtDate(n.updatedAt),
  };
}

async function getNoteById(id: string) {
  const row = await prisma.note.findUniqueOrThrow({ where: { id }, include: NOTE_INCLUDE });
  return formatNote(row);
}

async function assertNoteKindExists(kind: string) {
  const exists = await prisma.noteKind.findUnique({ where: { name: kind } });
  if (exists) return;
  const kinds = await prisma.noteKind.findMany({ orderBy: { sortOrder: "asc" }, select: { name: true } });
  throw new Error(`找不到筆記類型「${kind}」。目前可用類型：${kinds.map((k) => k.name).join("、") || "（無，請先在網頁上新增類型）"}`);
}

/** symbols -> instrumentIds，找不到的代號會直接丟錯，避免筆記悄悄連錯（或連不到）標的 */
async function resolveInstrumentIds(symbols: string[]): Promise<string[]> {
  const wanted = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))];
  if (wanted.length === 0) return [];
  const found = await prisma.instrument.findMany({ where: { symbol: { in: wanted } }, select: { id: true, symbol: true } });
  const foundSymbols = new Set(found.map((f) => f.symbol));
  const missing = wanted.filter((s) => !foundSymbols.has(s));
  if (missing.length > 0) {
    throw new Error(`找不到標的代號：${missing.join("、")}（請確認代號是否存在於系統中）`);
  }
  return found.map((f) => f.id);
}

async function resolveTagIds(tagNames: string[]): Promise<string[]> {
  const names = [...new Set(tagNames.map((t) => t.trim()).filter(Boolean))];
  const ids: string[] = [];
  for (const name of names) {
    const tag = await prisma.tag.upsert({ where: { name }, create: { name }, update: {} });
    ids.push(tag.id);
  }
  return ids;
}

// ── tool: create_note ────────────────────────────────────────────────────────

async function createNote(args: {
  title: string;
  content: string;
  kind: string;
  note_date?: string;
  symbols?: string[];
  tags?: string[];
}) {
  const title = typeof args.title === "string" ? args.title.trim() : "";
  if (!title) throw new Error("標題必填");

  const content = typeof args.content === "string" ? args.content.trim() : "";
  if (!content) throw new Error("內容必填");

  const kind = typeof args.kind === "string" ? args.kind.trim() : "";
  if (!kind) throw new Error("類型必填");
  await assertNoteKindExists(kind);

  const noteDate = args.note_date ? parseCalendarDate(args.note_date) : parseCalendarDate(fmtDate(new Date()));

  const instrumentIds = await resolveInstrumentIds(args.symbols ?? []);
  const tagIds = await resolveTagIds(args.tags ?? []);

  const note = await prisma.note.create({ data: { title, content, kind, noteDate } });

  for (const instrumentId of instrumentIds) {
    await prisma.noteOnInstrument.create({ data: { noteId: note.id, instrumentId } });
  }
  for (const tagId of tagIds) {
    await prisma.noteOnTag.create({ data: { noteId: note.id, tagId } });
  }

  return getNoteById(note.id);
}

// ── tool: update_note ────────────────────────────────────────────────────────

async function updateNote(args: {
  id: string;
  title?: string;
  content?: string;
  append_content?: string;
  kind?: string;
  note_date?: string;
  symbols?: string[];
  tags?: string[];
}) {
  if (!args.id) throw new Error("id 必填");
  const existing = await prisma.note.findUnique({ where: { id: args.id } });
  if (!existing) throw new Error("筆記不存在");

  if (args.content !== undefined && args.append_content !== undefined) {
    throw new Error("content 與 append_content 不可同時使用（一個是整段取代，一個是附加）");
  }

  const data: Prisma.NoteUpdateInput = {};

  if (args.title !== undefined) {
    const trimmed = args.title.trim();
    if (!trimmed) throw new Error("標題必填");
    data.title = trimmed;
  }

  if (args.content !== undefined) {
    const trimmed = args.content.trim();
    if (!trimmed) throw new Error("內容必填");
    data.content = trimmed;
  } else if (args.append_content !== undefined) {
    const addition = args.append_content.trim();
    if (!addition) throw new Error("append_content 不可為空");
    data.content = `${existing.content}\n\n---\n[${fmtDate(new Date())} 補充]\n${addition}`;
  }

  if (args.kind !== undefined) {
    const kind = args.kind.trim();
    if (!kind) throw new Error("類型必填");
    await assertNoteKindExists(kind);
    data.kind = kind;
  }

  if (args.note_date !== undefined) {
    data.noteDate = parseCalendarDate(args.note_date);
  }

  if (Object.keys(data).length > 0) {
    await prisma.note.update({ where: { id: args.id }, data });
  }

  if (args.symbols !== undefined) {
    const instrumentIds = await resolveInstrumentIds(args.symbols);
    await prisma.noteOnInstrument.deleteMany({ where: { noteId: args.id } });
    for (const instrumentId of instrumentIds) {
      await prisma.noteOnInstrument.create({ data: { noteId: args.id, instrumentId } });
    }
  }

  if (args.tags !== undefined) {
    const tagIds = await resolveTagIds(args.tags);
    await prisma.noteOnTag.deleteMany({ where: { noteId: args.id } });
    for (const tagId of tagIds) {
      await prisma.noteOnTag.create({ data: { noteId: args.id, tagId } });
    }
  }

  return getNoteById(args.id);
}

// ── tool: search_notes ──────────────────────────────────────────────────────

async function searchNotes(args: {
  kind?: string;
  keyword?: string;
  tag?: string;
  symbol?: string;
  date_from?: string;
  date_to?: string;
  limit?: number;
}) {
  const where: Prisma.NoteWhereInput = {};

  if (args.kind) {
    where.kind = { contains: args.kind };
  }
  if (args.keyword) {
    where.OR = [
      { title: { contains: args.keyword } },
      { content: { contains: args.keyword } },
    ];
  }
  if (args.tag) {
    where.tags = { some: { tag: { name: { contains: args.tag } } } };
  }
  if (args.symbol) {
    where.instruments = {
      some: { instrument: { symbol: { contains: args.symbol.toUpperCase() } } },
    };
  }
  if (args.date_from || args.date_to) {
    where.noteDate = {};
    if (args.date_from) (where.noteDate as Prisma.DateTimeFilter).gte = new Date(args.date_from);
    if (args.date_to) (where.noteDate as Prisma.DateTimeFilter).lte = new Date(args.date_to + "T23:59:59Z");
  }

  const rows = await prisma.note.findMany({
    where,
    include: NOTE_INCLUDE,
    orderBy: { noteDate: "desc" },
    take: args.limit ?? 50,
  });

  return rows.map(formatNote);
}

// ── tool: get_trading_review ─────────────────────────────────────────────────

function periodToDates(period: string): { from: Date; to: Date } {
  const to = new Date();
  to.setHours(23, 59, 59, 999);
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  if (period === "1w") from.setDate(from.getDate() - 7);
  else if (period === "2w") from.setDate(from.getDate() - 14);
  else if (period === "1m") from.setMonth(from.getMonth() - 1);
  else if (period === "3m") from.setMonth(from.getMonth() - 3);
  else if (period === "ytd") { from.setMonth(0); from.setDate(1); }
  else from.setDate(from.getDate() - 7);
  return { from, to };
}

async function getTradingReview(args: {
  period?: string;
  date_from?: string;
  date_to?: string;
  pnl_filter?: "loss" | "profit" | "realized" | "all";
  symbol?: string;
  account?: string;
  tag?: string;
  sort_by?: "buyAmt" | "sellAmt" | "realizedPnl" | "lossAmt" | "buyPnl" | "buyLossAmt" | "buyLossPct";
  top_n?: number;
  include_transactions?: boolean;
}) {
  let from: Date, to: Date;
  if (args.date_from || args.date_to) {
    from = args.date_from ? new Date(args.date_from) : new Date(0);
    to = args.date_to ? new Date(args.date_to + "T23:59:59Z") : new Date();
  } else {
    ({ from, to } = periodToDates(args.period ?? "1w"));
  }

  // 1. Transactions in the review period
  const periodWhere: Prisma.TransactionWhereInput = { date: { gte: from, lte: to }, type: { in: ["BUY", "SELL"] } };
  if (args.account) periodWhere.account = { name: { contains: args.account } };

  const periodTxs = await prisma.transaction.findMany({
    where: periodWhere,
    include: {
      instrument: { include: { tags: { include: { tag: true } } } },
      account: { select: { name: true } },
    },
    orderBy: { date: "asc" },
  });

  // symbol -> tag names, used for tag filtering and the byTag rollup below
  const symbolTags = new Map<string, string[]>();
  for (const t of periodTxs) {
    if (t.instrument && !symbolTags.has(t.instrument.symbol)) {
      symbolTags.set(t.instrument.symbol, t.instrument.tags.map((x) => x.tag.name));
    }
  }

  // 2. For realized P&L: need full history per symbol that had SELLs in period
  const sellSymbols = [
    ...new Set(
      periodTxs
        .filter((t) => t.type === "SELL" && t.instrument)
        .map((t) => t.instrument!.symbol),
    ),
  ];

  const historicalWhere: Prisma.TransactionWhereInput = {
    instrument: { symbol: { in: sellSymbols } },
    type: { in: ["BUY", "SELL"] },
    date: { lt: from },
  };
  if (args.account) historicalWhere.account = { name: { contains: args.account } };

  const historicalTxs = sellSymbols.length
    ? await prisma.transaction.findMany({
        where: historicalWhere,
        include: { instrument: true },
        orderBy: { date: "asc" },
      })
    : [];

  // 2b. Current prices — used for the "if these buys were still held, what would they be worth today" metric
  const allSymbols = [...new Set(periodTxs.filter((t) => t.instrument).map((t) => t.instrument!.symbol))];
  const priceRows = allSymbols.length
    ? await prisma.priceCache.findMany({ where: { symbol: { in: allSymbols } }, orderBy: { date: "desc" } })
    : [];
  const latestPrice = new Map<string, number>();
  for (const row of priceRows) {
    if (!latestPrice.has(row.symbol)) latestPrice.set(row.symbol, row.close);
  }

  // Compute avg cost (and weighted-average entry date, for holding-period calc) per symbol from history before the period
  type Pos = { qty: number; costBasis: number; avgDate: number };
  const avgCostMap = new Map<string, Pos>();
  function applyBuy(pos: Pos, qty: number, amount: number, dateMs: number) {
    const newQty = pos.qty + qty;
    pos.avgDate = pos.qty > 0 ? (pos.avgDate * pos.qty + dateMs * qty) / newQty : dateMs;
    pos.costBasis += amount;
    pos.qty = newQty;
  }
  for (const tx of historicalTxs) {
    if (!tx.instrument) continue;
    const sym = tx.instrument.symbol;
    if (!avgCostMap.has(sym)) avgCostMap.set(sym, { qty: 0, costBasis: 0, avgDate: tx.date.getTime() });
    const pos = avgCostMap.get(sym)!;
    const qty = toNum(tx.quantity);
    const px = toNum(tx.price);
    const fees = toNum(tx.fee) + toNum(tx.tax);
    if (tx.type === "BUY") applyBuy(pos, qty, qty * px + fees, tx.date.getTime());
    else if (tx.type === "SELL" && pos.qty > 0) {
      pos.costBasis -= (pos.costBasis / pos.qty) * qty;
      pos.qty -= qty;
    }
  }

  // 3. Aggregate per-symbol activity during the period, and record every individual sell trade
  type SymActivity = {
    symbol: string; name: string | null;
    buyQty: number; buyAmt: number; buyCount: number;
    sellQty: number; sellAmt: number; sellCount: number;
    realizedPnl: number | null;
    buyPnlIfStillHeld: number | null;
    notes: string[];
  };
  const symMap = new Map<string, SymActivity>();

  // Per-tag rollup (a symbol can carry multiple tags, e.g. 被動元件/光/TGV — so tag totals can overlap and won't sum to the grand total)
  type TagActivity = {
    tag: string; symbols: Set<string>;
    buyQty: number; buyAmt: number; buyCount: number;
    sellQty: number; sellAmt: number; sellCount: number;
    realizedPnl: number | null;
    buyPnlIfStillHeld: number | null;
  };
  const tagMap = new Map<string, TagActivity>();
  function getTagActivity(tagName: string): TagActivity {
    if (!tagMap.has(tagName)) {
      tagMap.set(tagName, {
        tag: tagName, symbols: new Set(),
        buyQty: 0, buyAmt: 0, buyCount: 0,
        sellQty: 0, sellAmt: 0, sellCount: 0,
        realizedPnl: null, buyPnlIfStillHeld: null,
      });
    }
    return tagMap.get(tagName)!;
  }

  type TxOut = {
    date: string; type: string; account: string;
    symbol: string | null; name: string | null;
    qty: number; price: number; fee: number; tax: number; note: string | null;
    avgCost?: number; holdingDays?: number | null; realizedPnl?: number; realizedPnlPct?: number | null;
  };
  const allTransactionsOut: TxOut[] = [];

  type SellTrade = {
    date: string; symbol: string; name: string | null; account: string;
    qty: number; price: number; fee: number; tax: number;
    avgCost: number; holdingDays: number | null;
    realizedPnl: number; realizedPnlPct: number | null;
    note: string | null;
  };
  const sellTrades: SellTrade[] = [];

  for (const tx of periodTxs) {
    if (!tx.instrument) continue;
    const sym = tx.instrument.symbol;
    if (!symMap.has(sym)) {
      symMap.set(sym, {
        symbol: sym, name: tx.instrument.name,
        buyQty: 0, buyAmt: 0, buyCount: 0,
        sellQty: 0, sellAmt: 0, sellCount: 0,
        realizedPnl: null, buyPnlIfStillHeld: null, notes: [],
      });
    }
    const act = symMap.get(sym)!;
    const qty = toNum(tx.quantity);
    const px = toNum(tx.price);
    const fee = toNum(tx.fee);
    const tax = toNum(tx.tax);
    const fees = fee + tax;

    const txOut: TxOut = {
      date: fmtDate(tx.date), type: tx.type, account: tx.account.name,
      symbol: sym, name: tx.instrument.name,
      qty, price: px, fee, tax, note: tx.note ?? null,
    };

    const tags = symbolTags.get(sym) ?? [];

    if (tx.type === "BUY") {
      act.buyQty += qty; act.buyAmt += qty * px + fees; act.buyCount++;
      const currentPrice = latestPrice.get(sym);
      let entryPnl: number | null = null;
      if (currentPrice != null) {
        entryPnl = qty * (currentPrice - px) - fees;
        act.buyPnlIfStillHeld = (act.buyPnlIfStillHeld ?? 0) + entryPnl;
      }
      for (const tagName of tags) {
        const ta = getTagActivity(tagName);
        ta.symbols.add(sym); ta.buyQty += qty; ta.buyAmt += qty * px + fees; ta.buyCount++;
        if (entryPnl != null) ta.buyPnlIfStillHeld = (ta.buyPnlIfStillHeld ?? 0) + entryPnl;
      }
      if (!avgCostMap.has(sym)) avgCostMap.set(sym, { qty: 0, costBasis: 0, avgDate: tx.date.getTime() });
      applyBuy(avgCostMap.get(sym)!, qty, qty * px + fees, tx.date.getTime());
    } else if (tx.type === "SELL") {
      act.sellQty += qty; act.sellAmt += qty * px - fees; act.sellCount++;
      for (const tagName of tags) {
        const ta = getTagActivity(tagName);
        ta.symbols.add(sym); ta.sellQty += qty; ta.sellAmt += qty * px - fees; ta.sellCount++;
      }
      if (avgCostMap.has(sym)) {
        const pos = avgCostMap.get(sym)!;
        if (pos.qty > 0) {
          const avgCost = pos.costBasis / pos.qty;
          const pnl = (px - avgCost) * qty - fees;
          const pnlPct = avgCost > 0 ? Math.round((pnl / (avgCost * qty)) * 10000) / 100 : null;
          const holdingDays = Math.round((tx.date.getTime() - pos.avgDate) / 86400000);

          act.realizedPnl = (act.realizedPnl ?? 0) + pnl;
          for (const tagName of tags) {
            const ta = getTagActivity(tagName);
            ta.realizedPnl = (ta.realizedPnl ?? 0) + pnl;
          }

          txOut.avgCost = Math.round(avgCost * 100) / 100;
          txOut.holdingDays = holdingDays;
          txOut.realizedPnl = Math.round(pnl);
          txOut.realizedPnlPct = pnlPct;

          sellTrades.push({
            date: fmtDate(tx.date), symbol: sym, name: tx.instrument.name, account: tx.account.name,
            qty, price: px, fee, tax,
            avgCost: Math.round(avgCost * 100) / 100,
            holdingDays,
            realizedPnl: Math.round(pnl),
            realizedPnlPct: pnlPct,
            note: tx.note ?? null,
          });

          pos.costBasis -= avgCost * qty;
          pos.qty -= qty;
        }
      }
    }
    allTransactionsOut.push(txOut);
    if (tx.note) act.notes.push(`[${fmtDate(tx.date)}] ${tx.note}`);
  }

  // 4. Filter + sort bySymbol
  let activities = [...symMap.values()];
  const matchesSymbol = (sym: string) => !args.symbol || sym.toUpperCase().includes(args.symbol.toUpperCase());
  const matchesTag = (sym: string) =>
    !args.tag || (symbolTags.get(sym) ?? []).some((t) => t.toUpperCase().includes(args.tag!.toUpperCase()));

  // symbol / tag filters — also applied to sellTrades below so the two views stay consistent
  activities = activities.filter((a) => matchesSymbol(a.symbol) && matchesTag(a.symbol));

  // pnl filter
  const pnlFilter = args.pnl_filter ?? "all";
  if (pnlFilter === "loss") {
    activities = activities.filter((a) => a.realizedPnl != null && a.realizedPnl < 0);
    activities.sort((a, b) => (a.realizedPnl ?? 0) - (b.realizedPnl ?? 0)); // worst first
  } else if (pnlFilter === "profit") {
    activities = activities.filter((a) => a.realizedPnl != null && a.realizedPnl > 0);
    activities.sort((a, b) => (b.realizedPnl ?? 0) - (a.realizedPnl ?? 0)); // best first
  } else if (pnlFilter === "realized") {
    activities = activities.filter((a) => a.realizedPnl != null);
    activities.sort((a, b) => (b.realizedPnl ?? 0) - (a.realizedPnl ?? 0));
  } else {
    activities.sort((a, b) => (b.buyAmt + b.sellAmt) - (a.buyAmt + a.sellAmt));
  }

  // explicit sort_by overrides the default/pnl_filter ordering above
  if (args.sort_by === "buyAmt") {
    activities.sort((a, b) => b.buyAmt - a.buyAmt);
  } else if (args.sort_by === "sellAmt") {
    activities.sort((a, b) => b.sellAmt - a.sellAmt);
  } else if (args.sort_by === "realizedPnl") {
    activities.sort((a, b) => (b.realizedPnl ?? -Infinity) - (a.realizedPnl ?? -Infinity)); // best first
  } else if (args.sort_by === "lossAmt") {
    activities.sort((a, b) => (a.realizedPnl ?? Infinity) - (b.realizedPnl ?? Infinity)); // worst first
  } else if (args.sort_by === "buyPnl") {
    activities.sort((a, b) => (b.buyPnlIfStillHeld ?? -Infinity) - (a.buyPnlIfStillHeld ?? -Infinity)); // best entries first
  } else if (args.sort_by === "buyLossAmt") {
    activities.sort((a, b) => (a.buyPnlIfStillHeld ?? Infinity) - (b.buyPnlIfStillHeld ?? Infinity)); // worst entries first
  } else if (args.sort_by === "buyLossPct") {
    activities.sort((a, b) => {
      const pa = a.buyAmt > 0 && a.buyPnlIfStillHeld != null ? a.buyPnlIfStillHeld / a.buyAmt : Infinity;
      const pb = b.buyAmt > 0 && b.buyPnlIfStillHeld != null ? b.buyPnlIfStillHeld / b.buyAmt : Infinity;
      return pa - pb; // worst entry % first
    });
  }

  const totalBuyAmt = [...symMap.values()].reduce((s, a) => s + a.buyAmt, 0);
  const totalSellAmt = [...symMap.values()].reduce((s, a) => s + a.sellAmt, 0);
  const totalRealizedPnl = [...symMap.values()].reduce((s, a) => s + (a.realizedPnl ?? 0), 0);
  const matchedCount = activities.length;

  let bySymbolOut = activities.map((a) => ({
    symbol: a.symbol,
    name: a.name,
    bought: a.buyCount > 0
      ? { times: a.buyCount, qty: Math.round(a.buyQty), amount: Math.round(a.buyAmt) }
      : null,
    sold: a.sellCount > 0
      ? { times: a.sellCount, qty: Math.round(a.sellQty), amount: Math.round(a.sellAmt) }
      : null,
    realizedPnl: a.realizedPnl != null ? Math.round(a.realizedPnl) : null,
    buyPnlIfStillHeld: a.buyPnlIfStillHeld != null ? Math.round(a.buyPnlIfStillHeld) : null,
    buyPnlIfStillHeldPct: a.buyPnlIfStillHeld != null && a.buyAmt > 0
      ? Math.round((a.buyPnlIfStillHeld / a.buyAmt) * 10000) / 100
      : null,
    notes: a.notes,
  }));

  // sellTrades: apply the same symbol/tag filters as bySymbol, chronological by default;
  // when sort_by targets P&L, reorder the same way
  let sellTradesOut = sellTrades.filter((t) => matchesSymbol(t.symbol) && matchesTag(t.symbol));
  if (args.sort_by === "realizedPnl") {
    sellTradesOut.sort((a, b) => b.realizedPnl - a.realizedPnl); // best first
  } else if (args.sort_by === "lossAmt") {
    sellTradesOut.sort((a, b) => a.realizedPnl - b.realizedPnl); // worst first
  }

  if (args.top_n && args.top_n > 0) {
    bySymbolOut = bySymbolOut.slice(0, args.top_n);
    sellTradesOut = sellTradesOut.slice(0, args.top_n);
  }

  // byTag: sector/theme rollup. A symbol can carry multiple tags, so a single trade may land in
  // several buckets — tag totals will not sum to `summary` and that's expected, not a bug.
  const byTag = [...tagMap.values()]
    .sort((a, b) => (b.buyAmt + b.sellAmt) - (a.buyAmt + a.sellAmt))
    .map((t) => ({
      tag: t.tag,
      symbolCount: t.symbols.size,
      bought: t.buyCount > 0
        ? { times: t.buyCount, qty: Math.round(t.buyQty), amount: Math.round(t.buyAmt) }
        : null,
      sold: t.sellCount > 0
        ? { times: t.sellCount, qty: Math.round(t.sellQty), amount: Math.round(t.sellAmt) }
        : null,
      realizedPnl: t.realizedPnl != null ? Math.round(t.realizedPnl) : null,
      buyPnlIfStillHeld: t.buyPnlIfStillHeld != null ? Math.round(t.buyPnlIfStillHeld) : null,
      buyPnlIfStillHeldPct: t.buyPnlIfStillHeld != null && t.buyAmt > 0
        ? Math.round((t.buyPnlIfStillHeld / t.buyAmt) * 10000) / 100
        : null,
    }));

  return {
    period: { from: fmtDate(from), to: fmtDate(to) },
    filters: {
      pnl_filter: pnlFilter, symbol: args.symbol ?? null, account: args.account ?? null, tag: args.tag ?? null,
      sort_by: args.sort_by ?? null, top_n: args.top_n ?? null,
    },
    summary: {
      totalTransactions: periodTxs.length,
      totalBuyAmt: Math.round(totalBuyAmt),
      totalSellAmt: Math.round(totalSellAmt),
      totalRealizedPnl: Math.round(totalRealizedPnl),
      symbolsTraded: [...symMap.values()].length,
      matchedSymbols: matchedCount,
    },
    bySymbol: bySymbolOut,
    sellTrades: sellTradesOut,
    byTag,
    ...(args.include_transactions ? { allTransactions: allTransactionsOut } : {}),
  };
}

// ── tool: get_portfolio_summary ──────────────────────────────────────────────

async function getPortfolioSummary() {
  const [accounts, txs, instruments] = await Promise.all([
    prisma.account.findMany({ select: { id: true, name: true, currency: true, cash: true } }),
    prisma.transaction.findMany({
      where: { type: { in: ["BUY", "SELL", "DIVIDEND"] }, instrumentId: { not: null } },
      include: { instrument: true, account: { select: { name: true } } },
      orderBy: { date: "asc" },
    }),
    prisma.instrument.findMany({ select: { symbol: true, name: true, assetClass: true } }),
  ]);

  // Compute holdings per instrument
  type Pos = { qty: number; costBasis: number; assetClass: string; name: string };
  const map = new Map<string, Pos>();
  for (const tx of txs) {
    if (!tx.instrument) continue;
    const sym = tx.instrument.symbol;
    if (!map.has(sym)) map.set(sym, { qty: 0, costBasis: 0, assetClass: tx.instrument.assetClass, name: tx.instrument.name ?? sym });
    const pos = map.get(sym)!;
    const qty = toNum(tx.quantity);
    const px = toNum(tx.price);
    const fees = toNum(tx.fee) + toNum(tx.tax);
    if (tx.type === "BUY") { pos.costBasis += qty * px + fees; pos.qty += qty; }
    else if (tx.type === "SELL" && pos.qty > 0) { pos.costBasis -= (pos.costBasis / pos.qty) * qty; pos.qty -= qty; }
    else if (tx.type === "DIVIDEND") { pos.costBasis -= qty * px; }
  }
  const active = [...map.entries()].filter(([, p]) => p.qty > 0.0001);

  // Latest price from PriceCache
  const priceRows = await prisma.priceCache.findMany({
    where: { symbol: { in: active.map(([sym]) => sym) } },
    orderBy: { date: "desc" },
  });
  const latestPrice = new Map<string, number>();
  for (const row of priceRows) {
    if (!latestPrice.has(row.symbol)) latestPrice.set(row.symbol, row.close);
  }

  let totalCostBasis = 0;
  let totalMarketValue = 0;
  const byAssetClass = new Map<string, { costBasis: number; marketValue: number }>();

  for (const [sym, pos] of active) {
    const px = latestPrice.get(sym) ?? 0;
    const mv = px > 0 ? pos.qty * px : pos.costBasis;
    totalCostBasis += pos.costBasis;
    totalMarketValue += mv;
    const ac = pos.assetClass;
    if (!byAssetClass.has(ac)) byAssetClass.set(ac, { costBasis: 0, marketValue: 0 });
    const b = byAssetClass.get(ac)!;
    b.costBasis += pos.costBasis;
    b.marketValue += mv;
  }

  const totalCash = accounts.reduce((s, a) => s + toNum(a.cash), 0);
  const totalAssets = totalMarketValue + totalCash;
  const unrealizedPnl = totalMarketValue - totalCostBasis;
  const unrealizedPnlPct = totalCostBasis > 0 ? unrealizedPnl / totalCostBasis : 0;

  return {
    holdingsCount: active.length,
    totalCostBasis: Math.round(totalCostBasis),
    totalMarketValue: Math.round(totalMarketValue),
    totalCash: Math.round(totalCash),
    totalAssets: Math.round(totalAssets),
    unrealizedPnl: Math.round(unrealizedPnl),
    unrealizedPnlPct: Math.round(unrealizedPnlPct * 10000) / 100,
    accounts: accounts.map((a) => ({ name: a.name, currency: a.currency, cash: toNum(a.cash) })),
    byAssetClass: [...byAssetClass.entries()].map(([name, v]) => ({
      assetClass: name,
      costBasis: Math.round(v.costBasis),
      marketValue: Math.round(v.marketValue),
    })),
  };
}

// ── MCP Server ───────────────────────────────────────────────────────────────

const server = new Server(
  { name: "portfolio", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "get_holdings",
      description:
        "查詢目前持有的標的列表，包含數量、平均成本、最新價格（若有快取）、市值與未實現損益",
      inputSchema: { type: "object", properties: {}, required: [] },
    },
    {
      name: "search_transactions",
      description:
        "搜尋交易紀錄。可依代號（symbol）、交易類型（BUY/SELL/DIVIDEND/DEPOSIT/WITHDRAWAL）、日期區間篩選",
      inputSchema: {
        type: "object",
        properties: {
          symbol: { type: "string", description: "股票代號（部分比對），例如 '2330' 或 'AAPL'" },
          type: { type: "string", description: "交易類型：BUY / SELL / DIVIDEND / DEPOSIT / WITHDRAWAL" },
          date_from: { type: "string", description: "起始日期 YYYY-MM-DD" },
          date_to: { type: "string", description: "結束日期 YYYY-MM-DD" },
          limit: { type: "number", description: "最多回傳筆數（預設 50，最大 200）" },
        },
      },
    },
    {
      name: "get_portfolio_summary",
      description:
        "回傳整體組合概況：總市值、總成本、未實現損益、現金、帳戶列表、依資產類別拆解",
      inputSchema: { type: "object", properties: {}, required: [] },
    },
    {
      name: "get_trading_review",
      description:
        "回顧指定期間的交易活動，包含每個標的的買賣次數與金額、已實現損益、進場品質（該標的在此期間買進的部分，假設到現在都沒賣掉會是賺是賠）、每一筆賣出交易的逐筆損益與持有天數、依帳戶或族群（tag）分類的統計，以及交易備註。適合用於週/月操作複盤，例如找出買最多的標的、賣最多的標的、進場點最差的標的、虧損最大的止損交易，或看某個帳戶/某個族群的操作表現。預設不含完整逐筆交易明細（allTransactions）以避免輸出過大，需要時用 include_transactions 開啟。",
      inputSchema: {
        type: "object",
        properties: {
          period: {
            type: "string",
            description: "快速選擇：1w（近一週）、2w（近兩週）、1m（近一個月）、3m（近三個月）、ytd（今年以來）。與 date_from/date_to 二擇一",
          },
          date_from: { type: "string", description: "起始日期 YYYY-MM-DD" },
          date_to: { type: "string", description: "結束日期 YYYY-MM-DD" },
          pnl_filter: {
            type: "string",
            description: "已實現損益篩選（依標的加總）：loss（只看虧損，由大到小）、profit（只看獲利，由高到低）、realized（所有有實現損益的標的）、all（全部，預設）",
          },
          symbol: { type: "string", description: "只看特定代號（部分比對），例如 '2330'" },
          account: { type: "string", description: "只看特定帳戶（部分比對），例如 '永豐'、'Firstrade'、'Binance'。會連同期初成本的計算範圍一起限縮在該帳戶" },
          tag: { type: "string", description: "只看特定族群/類別標籤（部分比對），例如 '被動元件'、'光'、'TGV'。同一標的可能有多個標籤" },
          sort_by: {
            type: "string",
            description: "排序依據：buyAmt（買進金額由高到低）、sellAmt（賣出金額由高到低）、realizedPnl（已實現獲利由高到低）、lossAmt（已實現虧損由大到小，即止損排行）、buyPnl（進場品質金額由高到低，即該標的這期間買的部分假設沒賣現在賺最多排前面）、buyLossAmt（進場品質虧損金額由大到小，即進場點最差排行，用金額）、buyLossPct（進場品質報酬率由低到高，即進場點最差排行，用百分比）。同時套用在 bySymbol 與 sellTrades 兩份清單上（buyPnl/buyLossAmt/buyLossPct 只影響 bySymbol）。不指定則維持預設排序",
          },
          top_n: { type: "number", description: "只回傳排序後前 N 筆（同時套用在 bySymbol 與 sellTrades），例如 10 代表只看前10名" },
          include_transactions: { type: "boolean", description: "是否回傳完整逐筆交易明細 allTransactions（預設 false，避免長區間查詢時輸出過大超出限制）" },
        },
      },
    },
    {
      name: "search_notes",
      description:
        "搜尋使用者的投資筆記（產業研究／操作策略／市場觀察），可依類型、關鍵字（標題或內文）、標籤、關聯標的代號、日期區間篩選。適合在複盤時參考使用者自己記錄的論點與策略",
      inputSchema: {
        type: "object",
        properties: {
          kind: { type: "string", description: "筆記類型名稱（部分比對），例如「產業研究」「操作策略」「市場觀察」，或使用者自訂的其他類型" },
          keyword: { type: "string", description: "關鍵字，比對標題或內文（部分比對）" },
          tag: { type: "string", description: "標籤名稱（部分比對）" },
          symbol: { type: "string", description: "關聯標的代號（部分比對），例如 '2330' 或 'AAPL'" },
          date_from: { type: "string", description: "起始日期 YYYY-MM-DD（依筆記日期 noteDate）" },
          date_to: { type: "string", description: "結束日期 YYYY-MM-DD（依筆記日期 noteDate）" },
          limit: { type: "number", description: "最多回傳筆數（預設 50，最大 200）" },
        },
      },
    },
    {
      name: "get_performance",
      description:
        "讀取網頁分析頁已計算的績效快取，回傳每個快取範圍（全部帳戶或單一帳戶）的：目前回檔幅度（距離高點 %）、最大回撤與高點/低點/回復日期、夏普值、波動率、期間報酬、當日損益、基準比較（如 0050、S&P 500），以及近期逐日回檔序列。適合用來判斷『組合從高點回檔多少了』這類風控問題。注意：資料來自快取，isFresh=false 表示之後又有新交易，需在網頁分析頁重新載入才會更新",
      inputSchema: {
        type: "object",
        properties: {
          series_days: { type: "number", description: "回傳最近 N 天的逐日回檔序列（預設 14，0 表示不要序列，最大 400）" },
        },
      },
    },
    {
      name: "create_note",
      description:
        "新增一則投資筆記（產業研究／操作策略／市場觀察等）。kind 必須是既有的筆記類型（可先用 search_notes 看看目前有哪些 kind），若不存在會回傳目前可用類型清單。symbols 用代號關聯標的，若代號不存在會報錯；tags 若不存在會自動建立",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string", description: "筆記標題" },
          content: { type: "string", description: "筆記內容（Markdown）" },
          kind: { type: "string", description: "筆記類型名稱，需為既有類型，例如「產業研究」「操作策略」「市場觀察」" },
          note_date: { type: "string", description: "筆記日期 YYYY-MM-DD，預設今天" },
          symbols: { type: "array", items: { type: "string" }, description: "關聯的標的代號列表，例如 ['2330', 'AAPL']" },
          tags: { type: "array", items: { type: "string" }, description: "標籤名稱列表，不存在會自動建立" },
        },
        required: ["title", "content", "kind"],
      },
    },
    {
      name: "update_note",
      description:
        "編輯既有筆記，用於跟使用者協作同一則筆記（例如追蹤一檔股票的研究隨時間演進）。只需帶想修改的欄位，其餘保持不變。content 會整段取代，若只想在既有內容後面補充想法，改用 append_content（會自動加上日期分隔線，避免蓋掉使用者原本寫的東西）。symbols/tags 帶入時會整組取代成新的清單",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "筆記 id（可用 search_notes 取得）" },
          title: { type: "string", description: "新標題" },
          content: { type: "string", description: "新內容（整段取代，Markdown）。與 append_content 擇一使用" },
          append_content: { type: "string", description: "要附加在既有內容後面的文字（會自動加上日期分隔線），適合用於協作式追加想法而不覆蓋原內容" },
          kind: { type: "string", description: "新的筆記類型，需為既有類型" },
          note_date: { type: "string", description: "新的筆記日期 YYYY-MM-DD" },
          symbols: { type: "array", items: { type: "string" }, description: "新的關聯標的代號列表（整組取代原本的關聯）" },
          tags: { type: "array", items: { type: "string" }, description: "新的標籤名稱列表（整組取代原本的標籤）" },
        },
        required: ["id"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args = {} } = req.params;

  try {
    let result: unknown;

    if (name === "get_holdings") {
      result = await getHoldings();
    } else if (name === "search_transactions") {
      const a = args as { symbol?: string; type?: string; date_from?: string; date_to?: string; limit?: number };
      if (a.limit) a.limit = Math.min(a.limit, 200);
      result = await searchTransactions(a);
    } else if (name === "get_portfolio_summary") {
      result = await getPortfolioSummary();
    } else if (name === "get_trading_review") {
      result = await getTradingReview(args as {
        period?: string; date_from?: string; date_to?: string;
        pnl_filter?: "loss" | "profit" | "realized" | "all"; symbol?: string;
        account?: string; tag?: string;
        sort_by?: "buyAmt" | "sellAmt" | "realizedPnl" | "lossAmt" | "buyPnl" | "buyLossAmt" | "buyLossPct";
        top_n?: number; include_transactions?: boolean;
      });
    } else if (name === "search_notes") {
      const a = args as {
        kind?: string; keyword?: string; tag?: string; symbol?: string;
        date_from?: string; date_to?: string; limit?: number;
      };
      if (a.limit) a.limit = Math.min(a.limit, 200);
      result = await searchNotes(a);
    } else if (name === "get_performance") {
      result = await getPerformance(args as { series_days?: number });
    } else if (name === "create_note") {
      result = await createNote(args as {
        title: string; content: string; kind: string;
        note_date?: string; symbols?: string[]; tags?: string[];
      });
    } else if (name === "update_note") {
      result = await updateNote(args as {
        id: string; title?: string; content?: string; append_content?: string;
        kind?: string; note_date?: string; symbols?: string[]; tags?: string[];
      });
    } else {
      return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
    }

    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true };
  }
});

void (async () => {
  const transport = new StdioServerTransport();
  await server.connect(transport);
})();
