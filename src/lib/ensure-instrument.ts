import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { normalizeSymbolInput } from "@/lib/instrument-search";
import { inferInstrumentCurrency } from "@/lib/instrument-currency";
import { inferAssetClass, getQuote, validateSymbol } from "@/lib/yahoo";

type InstrumentWithTags = Awaited<ReturnType<typeof findInstrument>>;

const instrumentInclude = { tags: { include: { tag: true } } } as const;

async function findInstrument(symbol: string) {
  return prisma.instrument.findUnique({
    where: { symbol },
    include: instrumentInclude,
  });
}

async function createInstrumentOnce(
  symbol: string,
  data: {
    name: string | null;
    assetClass: string;
    currency: string | null;
  },
): Promise<NonNullable<InstrumentWithTags>> {
  try {
    return await prisma.instrument.create({
      data: { symbol, ...data },
      include: instrumentInclude,
    });
  } catch (e) {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2002"
    ) {
      const existing = await findInstrument(symbol);
      if (existing) return existing;
    }
    throw e;
  }
}

/** 確保 Instrument 存在（追蹤清單／連結進入時自動建立） */
export async function ensureInstrument(
  rawSymbol: string,
  hints?: { name?: string | null },
): Promise<NonNullable<InstrumentWithTags>> {
  const symbol = normalizeSymbolInput(rawSymbol);
  const existing = await findInstrument(symbol);
  if (existing) return existing;

  const hintName = hints?.name?.trim() || null;
  const validated = await validateSymbol(symbol);
  if (validated) {
    return createInstrumentOnce(symbol, {
      name: hintName || validated.name || null,
      assetClass: inferAssetClass(symbol),
      currency:
        validated.currency ??
        inferInstrumentCurrency(symbol, null, validated.currency),
    });
  }

  const quote = await getQuote(symbol);
  return createInstrumentOnce(symbol, {
    name: hintName || quote.name || null,
    assetClass: inferAssetClass(symbol),
    currency: inferInstrumentCurrency(symbol, null, quote.currency),
  });
}
export async function watchlistNameForSymbol(
  symbol: string,
): Promise<string | null> {
  const item = await prisma.watchlistItem.findFirst({
    where: { symbol: symbol.trim().toUpperCase() },
    orderBy: { createdAt: "desc" },
    select: { name: true },
  });
  return item?.name?.trim() || null;
}
