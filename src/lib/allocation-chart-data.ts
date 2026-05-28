import type { HoldingPosition } from "@/lib/holding-types";

/** 彙總依帳戶（系統類別） */
export const ACCOUNT_GROUPING_KEY = "__account__";

export type AllocationSlice = {
  name: string;
  displayName?: string;
  value: number;
  pct: number;
  key?: string;
};

type AccountOption = { id: string; name: string };

function scaleHolding(h: HoldingPosition, qty: number): HoldingPosition {
  if (qty >= h.quantity) return h;
  const ratio = h.quantity > 0 ? qty / h.quantity : 0;
  return {
    ...h,
    quantity: qty,
    costBasis: h.costBasis * ratio,
    marketValue: h.marketValue * ratio,
    marketValueBase: h.marketValueBase * ratio,
    unrealizedPnl: h.unrealizedPnl * ratio,
    dayChange: h.dayChange * ratio,
  };
}

export function filterHoldingsForAllocation(
  holdings: HoldingPosition[],
  categoryFilters: string[],
  accountFilters: string[],
): HoldingPosition[] {
  let list = holdings
    .map((h) => {
      if (accountFilters.length === 0) return h;
      const selected = h.accounts.filter((a) =>
        accountFilters.includes(a.id),
      );
      if (selected.length === 0) return null;
      const qty = selected.reduce((s, a) => s + a.quantity, 0);
      return scaleHolding(h, qty);
    })
    .filter((h): h is HoldingPosition => h !== null);

  if (categoryFilters.length > 0) {
    list = list.filter((h) => {
      if (categoryFilters.includes("__uncategorized__") && h.tags.length === 0) {
        return true;
      }
      return categoryFilters.some(
        (c) => c !== "__uncategorized__" && h.tags.includes(c),
      );
    });
  }

  return list;
}

/** 依帳戶篩選加總現金（基準幣）；未篩選帳戶時為全組合現金。 */
export function cashForFilters(
  accountFilters: string[],
  totalCashBase: number,
  cashByAccount: Record<string, number>,
): number {
  if (accountFilters.length === 0) return totalCashBase;
  return accountFilters.reduce((s, id) => s + (cashByAccount[id] ?? 0), 0);
}

function withPct(slices: AllocationSlice[]): AllocationSlice[] {
  const total = slices.reduce((s, x) => s + x.value, 0);
  return slices.map((s) => ({
    ...s,
    pct: total > 0 ? s.value / total : 0,
  }));
}

function appendCash(
  slices: AllocationSlice[],
  cash: number,
): AllocationSlice[] {
  if (cash <= 0) return slices;
  const total = slices.reduce((s, x) => s + x.value, 0) + cash;
  return [
    ...slices,
    {
      name: "現金",
      displayName: "現金",
      value: cash,
      pct: total > 0 ? cash / total : 0,
      key: "__cash__",
    },
  ];
}

export function userCategoryKeys(aggregateBy: string[]): string[] {
  return aggregateBy.filter((k) => k !== ACCOUNT_GROUPING_KEY);
}

export function isUserCategoryKey(key: string): boolean {
  return key !== ACCOUNT_GROUPING_KEY && key !== "__cash__";
}

/** 預設：每檔標的一塊扇形 */
function slicesBySymbol(holdings: HoldingPosition[]): AllocationSlice[] {
  return holdings
    .filter((h) => h.marketValueBase > 0)
    .map((h) => ({
      name: h.symbol,
      displayName: h.name?.trim() || h.symbol,
      value: h.marketValueBase,
      pct: 0,
      key: h.symbol,
    }))
    .sort((a, b) => b.value - a.value);
}

function slicesByAccount(
  holdings: HoldingPosition[],
  accounts: AccountOption[],
  accountFilters: string[],
  cashByAccount: Record<string, number>,
): AllocationSlice[] {
  const accountIds =
    accountFilters.length > 0
      ? accountFilters
      : accounts.map((a) => a.id);

  const slices: AllocationSlice[] = [];
  for (const id of accountIds) {
    const acc = accounts.find((a) => a.id === id);
    if (!acc) continue;
    let value = 0;
    for (const h of holdings) {
      const row = h.accounts.find((a) => a.id === id);
      if (row) {
        const ratio = h.quantity > 0 ? row.quantity / h.quantity : 0;
        value += h.marketValueBase * ratio;
      }
    }
    value += cashByAccount[id] ?? 0;
    if (value <= 0) continue;
    slices.push({
      name: acc.name,
      displayName: acc.name,
      value,
      pct: 0,
      key: id,
    });
  }
  return slices;
}

/**
 * 多類別彙總：每個所選類別一塊合併扇形；不屬於任何所選類別者逐檔顯示
 */
function slicesBySelectedCategories(
  holdings: HoldingPosition[],
  selectedCategories: string[],
): AllocationSlice[] {
  if (selectedCategories.length === 0) {
    return slicesBySymbol(holdings);
  }

  const buckets = new Map<string, number>();
  const symbolSlices: AllocationSlice[] = [];

  for (const h of holdings) {
    const matched = h.tags.filter((t) => selectedCategories.includes(t));
    if (matched.length === 0) {
      if (h.marketValueBase > 0) {
        symbolSlices.push({
          name: h.symbol,
          displayName: h.name?.trim() || h.symbol,
          value: h.marketValueBase,
          pct: 0,
          key: h.symbol,
        });
      }
      continue;
    }
    const share = h.marketValueBase / matched.length;
    for (const cat of matched) {
      buckets.set(cat, (buckets.get(cat) ?? 0) + share);
    }
  }

  const merged: AllocationSlice[] = [...buckets.entries()]
    .filter(([, v]) => v > 0)
    .map(([name, value]) => ({
      name,
      displayName: name,
      value,
      pct: 0,
      key: name,
    }))
    .sort((a, b) => b.value - a.value);

  return [...merged, ...symbolSlices].sort((a, b) => b.value - a.value);
}

export function slicesCategoryDrillByAccount(
  holdings: HoldingPosition[],
  accounts: AccountOption[],
  categoryKey: string,
  accountFilters: string[],
): AllocationSlice[] {
  const inCategory = holdings.filter((h) => h.tags.includes(categoryKey));

  const accountIds =
    accountFilters.length > 0
      ? accountFilters
      : accounts.map((a) => a.id);

  const slices: AllocationSlice[] = [];
  for (const id of accountIds) {
    const acc = accounts.find((a) => a.id === id);
    if (!acc) continue;
    let value = 0;
    for (const h of inCategory) {
      const row = h.accounts.find((a) => a.id === id);
      if (!row) continue;
      const ratio = h.quantity > 0 ? row.quantity / h.quantity : 0;
      value += h.marketValueBase * ratio;
    }
    if (value <= 0) continue;
    slices.push({
      name: acc.name,
      displayName: acc.name,
      value,
      pct: 0,
      key: id,
    });
  }
  return slices;
}

export function buildAllocationChartData({
  holdings,
  accounts,
  accountFilters,
  categoryFilters,
  aggregateBy,
  cashByAccount,
  totalCashBase,
  drillDownCategory,
}: {
  holdings: HoldingPosition[];
  accounts: AccountOption[];
  accountFilters: string[];
  categoryFilters: string[];
  aggregateBy: string[];
  cashByAccount: Record<string, number>;
  totalCashBase: number;
  drillDownCategory?: string | null;
}): AllocationSlice[] {
  const filtered = filterHoldingsForAllocation(
    holdings,
    categoryFilters,
    accountFilters,
  );
  const cash = cashForFilters(accountFilters, totalCashBase, cashByAccount);
  const userCats = userCategoryKeys(aggregateBy);
  const hasAccount = aggregateBy.includes(ACCOUNT_GROUPING_KEY);

  if (
    drillDownCategory &&
    isUserCategoryKey(drillDownCategory) &&
    userCats.includes(drillDownCategory)
  ) {
    return withPct(
      slicesCategoryDrillByAccount(
        filtered,
        accounts,
        drillDownCategory,
        accountFilters,
      ),
    );
  }

  if (aggregateBy.length === 0) {
    return withPct(appendCash(slicesBySymbol(filtered), cash));
  }

  const slices: AllocationSlice[] = [];

  if (hasAccount) {
    slices.push(
      ...slicesByAccount(
        filtered,
        accounts,
        accountFilters,
        cashByAccount,
      ),
    );
  }

  if (userCats.length > 0) {
    slices.push(...slicesBySelectedCategories(filtered, userCats));
  }

  if (!hasAccount && userCats.length === 0) {
    slices.push(...slicesBySymbol(filtered));
  }

  const deduped = dedupeSlicesByKey(slices);
  const withCashSlice = hasAccount ? deduped : appendCash(deduped, cash);
  return withPct(withCashSlice);
}

/** 同名 key 合併數值（帳戶與類別重疊時） */
function dedupeSlicesByKey(slices: AllocationSlice[]): AllocationSlice[] {
  const map = new Map<string, AllocationSlice>();
  for (const s of slices) {
    const k = s.key ?? s.name;
    const prev = map.get(k);
    if (prev) {
      map.set(k, { ...prev, value: prev.value + s.value });
    } else {
      map.set(k, { ...s });
    }
  }
  return [...map.values()].sort((a, b) => b.value - a.value);
}
