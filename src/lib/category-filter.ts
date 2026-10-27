export type CategoryInstrument = {
  id: string;
  symbol: string;
  name: string | null;
};

export type CategoryWithInstruments = {
  id: string;
  name: string;
  instruments: CategoryInstrument[];
};

export type CategoryFilterResult<T extends CategoryWithInstruments> = {
  category: T;
  /** 符合搜尋字的標的 id；類別名稱本身符合或沒有搜尋字時為空 */
  matchedInstrumentIds: Set<string>;
};

/**
 * 依搜尋字篩選類別：類別名稱符合就整個保留；
 * 否則只要底下有標的代號或名稱符合，就保留並標出符合的標的（從標的反查類別）。
 */
export function filterCategories<T extends CategoryWithInstruments>(
  categories: T[],
  query: string,
): CategoryFilterResult<T>[] {
  const q = query.trim().toLowerCase();
  if (!q) {
    return categories.map((category) => ({
      category,
      matchedInstrumentIds: new Set(),
    }));
  }
  const results: CategoryFilterResult<T>[] = [];
  for (const category of categories) {
    if (category.name.toLowerCase().includes(q)) {
      results.push({ category, matchedInstrumentIds: new Set() });
      continue;
    }
    const matched = category.instruments.filter(
      (i) =>
        i.symbol.toLowerCase().includes(q) ||
        (i.name ?? "").toLowerCase().includes(q),
    );
    if (matched.length > 0) {
      results.push({
        category,
        matchedInstrumentIds: new Set(matched.map((i) => i.id)),
      });
    }
  }
  return results;
}
