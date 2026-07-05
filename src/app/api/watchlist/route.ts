import { NextRequest, NextResponse } from "next/server";
import {
  addToWatchlist,
  addWatchlistSeparator,
  clearWatchlist,
  createWatchlist,
  deleteWatchlist,
  getWatchlists,
  removeFromWatchlist,
  removeWatchlistItemById,
  renameWatchlist,
  reorderWatchlistItems,
  reorderWatchlists,
  updateWatchlistSeparator,
} from "@/lib/watchlist";
import { normalizeSymbolInput } from "@/lib/instrument-search";
import { canAddSymbolToWatchlist } from "@/lib/yahoo";

export async function GET() {
  const lists = await getWatchlists();
  return NextResponse.json({ lists });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const action = body.action as string | undefined;

  if (action === "createList") {
    const name = (body.name as string)?.trim();
    if (!name) {
      return NextResponse.json({ error: "清單名稱必填" }, { status: 400 });
    }
    try {
      const list = await createWatchlist(name);
      return NextResponse.json(list, { status: 201 });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "建立失敗";
      return NextResponse.json({ error: msg }, { status: 400 });
    }
  }

  if (action === "renameList") {
    const listId = body.listId as string | undefined;
    const name = (body.name as string)?.trim();
    if (!listId || !name) {
      return NextResponse.json(
        { error: "listId 與 name 必填" },
        { status: 400 },
      );
    }
    try {
      const list = await renameWatchlist(listId, name);
      return NextResponse.json(list);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "重新命名失敗";
      return NextResponse.json({ error: msg }, { status: 400 });
    }
  }

  if (action === "clearList") {
    const listId = body.listId as string | undefined;
    if (!listId) {
      return NextResponse.json({ error: "listId 必填" }, { status: 400 });
    }
    try {
      await clearWatchlist(listId);
      return NextResponse.json({ ok: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "清空失敗";
      return NextResponse.json({ error: msg }, { status: 400 });
    }
  }

  if (action === "reorderItems") {
    const listId = body.listId as string | undefined;
    const itemIds = body.itemIds as string[] | undefined;
    if (!listId || !itemIds?.length) {
      return NextResponse.json(
        { error: "listId 與 itemIds 必填" },
        { status: 400 },
      );
    }
    try {
      await reorderWatchlistItems(listId, itemIds);
      return NextResponse.json({ ok: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "排序失敗";
      return NextResponse.json({ error: msg }, { status: 400 });
    }
  }

  if (action === "reorderLists") {
    const listIds = body.listIds as string[] | undefined;
    if (!listIds?.length) {
      return NextResponse.json({ error: "listIds 必填" }, { status: 400 });
    }
    try {
      await reorderWatchlists(listIds);
      return NextResponse.json({ ok: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "排序失敗";
      return NextResponse.json({ error: msg }, { status: 400 });
    }
  }

  if (action === "addSeparator") {
    const listId = body.listId as string | undefined;
    const label = (body.label as string)?.trim();
    if (!listId || !label) {
      return NextResponse.json(
        { error: "listId 與 label 必填" },
        { status: 400 },
      );
    }
    try {
      const item = await addWatchlistSeparator(listId, label);
      return NextResponse.json(item, { status: 201 });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "新增失敗";
      return NextResponse.json({ error: msg }, { status: 400 });
    }
  }

  if (action === "updateSeparator") {
    const itemId = body.itemId as string | undefined;
    const label = (body.label as string)?.trim();
    if (!itemId || !label) {
      return NextResponse.json(
        { error: "itemId 與 label 必填" },
        { status: 400 },
      );
    }
    try {
      const item = await updateWatchlistSeparator(itemId, label);
      return NextResponse.json(item);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "更新失敗";
      return NextResponse.json({ error: msg }, { status: 400 });
    }
  }

  if (action === "removeItem") {
    const itemId = body.itemId as string | undefined;
    if (!itemId) {
      return NextResponse.json({ error: "itemId 必填" }, { status: 400 });
    }
    try {
      await removeWatchlistItemById(itemId);
      return NextResponse.json({ ok: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "刪除失敗";
      return NextResponse.json({ error: msg }, { status: 400 });
    }
  }

  const listId = body.listId as string | undefined;
  const rawSymbol = (body.symbol as string)?.trim();
  if (!listId || !rawSymbol) {
    return NextResponse.json(
      { error: "listId 與 symbol 必填" },
      { status: 400 },
    );
  }

  const symbol = normalizeSymbolInput(
    rawSymbol.replace(/\s+[—–-]\s+.+$/u, "").trim() || rawSymbol,
  );
  const resolved = await canAddSymbolToWatchlist(symbol);
  if (!resolved) {
    return NextResponse.json(
      { error: "找不到此代碼，請從搜尋結果選擇或確認代碼" },
      { status: 400 },
    );
  }

  try {
    const item = await addToWatchlist(
      listId,
      resolved.symbol,
      (body.name as string | undefined)?.trim() || resolved.name,
    );
    return NextResponse.json(item, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "加入失敗";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest) {
  const listId = request.nextUrl.searchParams.get("listId");
  const symbol = request.nextUrl.searchParams.get("symbol");
  const deleteList = request.nextUrl.searchParams.get("list");

  if (deleteList === "1" && listId) {
    try {
      await deleteWatchlist(listId);
      return NextResponse.json({ ok: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "刪除失敗";
      return NextResponse.json({ error: msg }, { status: 400 });
    }
  }

  if (!listId || !symbol) {
    return NextResponse.json(
      { error: "listId 與 symbol 必填" },
      { status: 400 },
    );
  }

  await removeFromWatchlist(listId, symbol);
  return NextResponse.json({ ok: true });
}
