import { ENTIRE_PORTFOLIO_FILTER_ID } from "@/lib/chart-constants";
import type { MarketFilter } from "@/lib/market-session";
import { parseJsonSafe } from "@/lib/utils";

export const HOLDINGS_PREFS_KEY = "portfolio-holdings-prefs";
export const DASHBOARD_PREFS_KEY = "portfolio-dashboard-prefs";
export const TRANSACTIONS_PREFS_KEY = "portfolio-transactions-prefs";
export const RECENT_INSTRUMENTS_KEY = "portfolio-recent-instruments";

const MAX_RECENT_INSTRUMENTS = 8;

export type RecentInstrument = { symbol: string; name: string };

export type DayChangeSortKey =
  | "symbol"
  | "marketPrice"
  | "marketValue"
  | "dayChangePct";

export type DashboardPrefs = {
  dayChangeSortKey: DayChangeSortKey;
  dayChangeSortDir: "asc" | "desc";
  /** 使用者手動切換的本日持倉市場篩選；未設定則依開市時間自動切換 */
  dayChangeMarketFilter?: MarketFilter;
  activeWatchlistId?: string;
};

const DEFAULT_DASHBOARD: DashboardPrefs = {
  dayChangeSortKey: "dayChangePct",
  dayChangeSortDir: "desc",
};

export type HoldingsPrefs = {
  allocationTagFilters: string[];
  allocationAccountFilters: string[];
  /** 持倉配置彙總分類（可多選）：__account__=帳戶；其他=類別名；空陣列=依標的 */
  allocationAggregateBy?: string[];
  /** @deprecated 改用 allocationAggregateBy */
  allocationGroupBy?: "account" | "category";
  tableTagFilters: string[];
  tableAccountFilters: string[];
  trendAccountFilters: string[];
  /** 資產市值走勢起算日 YYYY-MM-DD */
  trendStartDate: string;
  allocationExpanded?: boolean;
  valueTrendExpanded?: boolean;
  /** @deprecated migrated into section-specific filters */
  tagFilters?: string[];
  accountFilters?: string[];
  showEntirePortfolioTrend?: boolean;
  trendIncludeEntirePortfolio?: boolean;
  filtersExpanded?: boolean;
  sortKey:
    | "symbol"
    | "quantity"
    | "avgCost"
    | "costBasisBase"
    | "marketValue"
    | "marketValueBase"
    | "unrealizedPnl"
    | "unrealizedPnlPct"
    | "dayChangePct"
    | "weight"
    | null;
  sortDir: "asc" | "desc" | null;
};

/** @deprecated legacy single-select fields */
type LegacyHoldingsPrefs = Partial<HoldingsPrefs> & {
  tagFilter?: string;
  accountFilter?: string;
  marketFilter?: "all" | "tw" | "us";
};

export type TransactionsPrefs = {
  accountId: string;
  type: string;
  listPageSize?: number;
  listFilterTypes?: string[];
  listFilterAccountIds?: string[];
  listFilterDateFrom?: string;
  listFilterDateTo?: string;
  /** When true, the date filter always resolves to "today" on load. */
  listFilterTodayMode?: boolean;
  listFilterSymbol?: string;
  listFiltersExpanded?: boolean;
  listColumnOrder?: string[];
};

const DEFAULT_TRANSACTIONS_LIST = {
  listPageSize: 50,
  listFilterTypes: [] as string[],
  listFilterAccountIds: [] as string[],
  listFilterDateFrom: "",
  listFilterDateTo: "",
  listFilterSymbol: "",
  listFiltersExpanded: true,
};

const DEFAULT_HOLDINGS: HoldingsPrefs = {
  allocationTagFilters: [],
  allocationAccountFilters: [],
  allocationAggregateBy: [],
  tableTagFilters: [],
  tableAccountFilters: [],
  trendAccountFilters: [],
  trendStartDate: "",
  allocationExpanded: true,
  valueTrendExpanded: true,
  sortKey: null,
  sortDir: null,
};

function readJson<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(key);
    return parseJsonSafe<T>(raw);
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(key, JSON.stringify(value));
}

function migrateLegacyFilters(parsed: LegacyHoldingsPrefs): HoldingsPrefs {
  let legacyTags = parsed.tagFilters ?? [];
  if (!legacyTags.length && parsed.tagFilter && parsed.tagFilter !== "all") {
    legacyTags = [parsed.tagFilter];
  }

  let legacyAccounts = parsed.accountFilters ?? [];
  if (
    !legacyAccounts.length &&
    parsed.accountFilter &&
    parsed.accountFilter !== "all"
  ) {
    legacyAccounts = [parsed.accountFilter];
  }

  const allocationTagFilters =
    parsed.allocationTagFilters ?? legacyTags;
  const allocationAccountFilters =
    parsed.allocationAccountFilters ?? legacyAccounts;
  const tableTagFilters = parsed.tableTagFilters ?? legacyTags;
  const tableAccountFilters = parsed.tableAccountFilters ?? legacyAccounts;
  let trendAccountFilters = parsed.trendAccountFilters ?? legacyAccounts;
  const hadEntirePref =
    parsed.trendIncludeEntirePortfolio ??
    parsed.showEntirePortfolioTrend ??
    false;
  if (
    hadEntirePref &&
    !trendAccountFilters.includes(ENTIRE_PORTFOLIO_FILTER_ID)
  ) {
    trendAccountFilters = [...trendAccountFilters, ENTIRE_PORTFOLIO_FILTER_ID];
  }

  return {
    allocationTagFilters,
    allocationAccountFilters,
    tableTagFilters,
    tableAccountFilters,
    trendAccountFilters,
    trendStartDate:
      typeof parsed.trendStartDate === "string" ? parsed.trendStartDate : "",
    allocationExpanded: parsed.allocationExpanded ?? true,
    valueTrendExpanded: parsed.valueTrendExpanded ?? true,
    sortKey: parsed.sortKey ?? null,
    sortDir:
      parsed.sortDir === "asc" || parsed.sortDir === "desc"
        ? parsed.sortDir
        : null,
    allocationAggregateBy: migrateAllocationAggregate(parsed),
  };
}

function migrateAllocationAggregate(parsed: LegacyHoldingsPrefs): string[] {
  const v = parsed.allocationAggregateBy as string | string[] | null | undefined;
  if (Array.isArray(v)) return v;
  if (typeof v === "string" && v.length > 0) return [v];
  if (parsed.allocationGroupBy === "account") {
    return ["__account__"];
  }
  return [];
}

export function loadHoldingsPrefs(): HoldingsPrefs {
  const parsed = readJson<LegacyHoldingsPrefs>(HOLDINGS_PREFS_KEY);
  if (!parsed) return DEFAULT_HOLDINGS;
  return migrateLegacyFilters(parsed);
}

export function saveHoldingsPrefs(prefs: HoldingsPrefs): void {
  writeJson(HOLDINGS_PREFS_KEY, prefs);
}

export function loadTransactionsPrefs(): TransactionsPrefs | null {
  const parsed = readJson<TransactionsPrefs>(TRANSACTIONS_PREFS_KEY);
  if (!parsed) return null;
  return {
    ...DEFAULT_TRANSACTIONS_LIST,
    ...parsed,
    listPageSize: parsed.listPageSize ?? DEFAULT_TRANSACTIONS_LIST.listPageSize,
    listFilterTypes: parsed.listFilterTypes ?? [],
    listFilterAccountIds: parsed.listFilterAccountIds ?? [],
    listFiltersExpanded:
      parsed.listFiltersExpanded ??
      DEFAULT_TRANSACTIONS_LIST.listFiltersExpanded,
  };
}

export function saveTransactionsPrefs(prefs: TransactionsPrefs): void {
  writeJson(TRANSACTIONS_PREFS_KEY, prefs);
}

export function loadRecentInstruments(): RecentInstrument[] {
  const parsed = readJson<RecentInstrument[]>(RECENT_INSTRUMENTS_KEY);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter(
      (x) =>
        x &&
        typeof x.symbol === "string" &&
        x.symbol.trim() &&
        typeof x.name === "string",
    )
    .slice(0, MAX_RECENT_INSTRUMENTS);
}

export function recordRecentInstrument(symbol: string, name: string): void {
  if (typeof window === "undefined") return;
  const sym = symbol.trim().toUpperCase();
  const displayName = name.trim() || sym;
  const prev = loadRecentInstruments().filter(
    (x) => x.symbol.toUpperCase() !== sym,
  );
  writeJson(RECENT_INSTRUMENTS_KEY, [
    { symbol: sym, name: displayName },
    ...prev,
  ].slice(0, MAX_RECENT_INSTRUMENTS));
}

function isDayChangeSortKey(v: unknown): v is DayChangeSortKey {
  return (
    v === "symbol" ||
    v === "marketPrice" ||
    v === "marketValue" ||
    v === "dayChangePct"
  );
}

function normalizeDayChangeSortKey(v: unknown): DayChangeSortKey {
  if (v === "dayChange") return "marketPrice";
  if (isDayChangeSortKey(v)) return v;
  return DEFAULT_DASHBOARD.dayChangeSortKey;
}

export function loadDashboardPrefs(): DashboardPrefs {
  const parsed = readJson<Partial<DashboardPrefs> & { dayChangeSortKey?: string }>(
    DASHBOARD_PREFS_KEY,
  );
  if (!parsed) return DEFAULT_DASHBOARD;
  return {
    ...DEFAULT_DASHBOARD,
    dayChangeSortKey: normalizeDayChangeSortKey(parsed.dayChangeSortKey),
    dayChangeSortDir:
      parsed.dayChangeSortDir === "asc" || parsed.dayChangeSortDir === "desc"
        ? parsed.dayChangeSortDir
        : DEFAULT_DASHBOARD.dayChangeSortDir,
    activeWatchlistId:
      typeof parsed.activeWatchlistId === "string"
        ? parsed.activeWatchlistId
        : undefined,
    dayChangeMarketFilter:
      parsed.dayChangeMarketFilter === "all" ||
      parsed.dayChangeMarketFilter === "tw" ||
      parsed.dayChangeMarketFilter === "us" ||
      parsed.dayChangeMarketFilter === "crypto"
        ? parsed.dayChangeMarketFilter
        : undefined,
  };
}

export function saveDashboardPrefs(prefs: Partial<DashboardPrefs>): void {
  const current = loadDashboardPrefs();
  writeJson(DASHBOARD_PREFS_KEY, { ...current, ...prefs });
}
