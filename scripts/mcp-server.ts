/**
 * Portfolio MCP Server
 *
 * Tools:
 *   get_holdings          — 目前持倉列表（net qty > 0）
 *   search_transactions   — 搜尋交易紀錄（可篩代號、類型、日期範圍）
 *   get_portfolio_summary — 組合整體概況（總市值、未實現損益、帳戶拆解）
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
