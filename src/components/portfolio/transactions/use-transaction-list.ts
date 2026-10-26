"use client";

import { useEffect, useMemo, useState } from "react";
import {
  matchesSymbolOrNameFilter,
  type Account,
  type Transaction,
} from "@/components/portfolio/transactions/transaction-utils";
import { toLocalDateKey, toTransactionDateKey } from "@/lib/date-keys";
import {
  DEFAULT_TX_COLUMN_ORDER,
  normalizeTxColumnOrder,
  type TxColumnId,
} from "@/lib/transaction-table-columns";
import { computeTransactionSettlement } from "@/lib/transaction-settlement";
import { loadTransactionsPrefs, updateTransactionsPrefs } from "@/lib/ui-prefs";

/** 交易列表的篩選、分頁、欄位順序與合計，連同使用者偏好的讀寫。 */
export function useTransactionList(
  transactions: Transaction[],
  accounts: Account[],
  initialAccounts: Account[],
) {
  const [prefsReady, setPrefsReady] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [filterTypes, setFilterTypes] = useState<string[]>([]);
  const [filterAccountIds, setFilterAccountIds] = useState<string[]>([]);
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");
  // When true, filterDate always tracks "today" and auto-refreshes at midnight
  const [todayMode, setTodayMode] = useState(false);
  const [filterSymbol, setFilterSymbol] = useState("");
  const [filtersExpanded, setFiltersExpanded] = useState(true);
  const [columnOrder, setColumnOrder] = useState<TxColumnId[]>(
    DEFAULT_TX_COLUMN_ORDER,
  );

  const todayKey = toLocalDateKey(new Date());
  const isTodayFilter =
    filterDateFrom === todayKey && filterDateTo === todayKey;
  const hasDateFilter = Boolean(filterDateFrom || filterDateTo);
  const hasSymbolFilter = Boolean(filterSymbol.trim());
  const activeFilterCount =
    filterTypes.length +
    filterAccountIds.length +
    (hasDateFilter ? 1 : 0) +
    (hasSymbolFilter ? 1 : 0);

  useEffect(() => {
    const prefs = loadTransactionsPrefs();
    if (prefs) {
      if (prefs.listPageSize) setPageSize(prefs.listPageSize);
      if (prefs.listFilterTypes) setFilterTypes(prefs.listFilterTypes);
      if (prefs.listFilterAccountIds) {
        setFilterAccountIds(
          prefs.listFilterAccountIds.filter((id) =>
            initialAccounts.some((a) => a.id === id),
          ),
        );
      }
      if (typeof prefs.listFiltersExpanded === "boolean") {
        setFiltersExpanded(prefs.listFiltersExpanded);
      }
      if (prefs.listFilterTodayMode) {
        // "Today mode" — always snap to the current date, regardless of what
        // date was saved (handles waking up the next day).
        setTodayMode(true);
        setFilterDateFrom(toLocalDateKey(new Date()));
        setFilterDateTo(toLocalDateKey(new Date()));
      } else {
        if (prefs.listFilterDateFrom) setFilterDateFrom(prefs.listFilterDateFrom);
        if (prefs.listFilterDateTo) setFilterDateTo(prefs.listFilterDateTo);
      }
      if (prefs.listFilterSymbol) setFilterSymbol(prefs.listFilterSymbol);
      if (prefs.listColumnOrder) {
        setColumnOrder(normalizeTxColumnOrder(prefs.listColumnOrder));
      }
    }
    setPrefsReady(true);
  }, [initialAccounts]);

  useEffect(() => {
    if (!prefsReady) return;
    updateTransactionsPrefs({
      listPageSize: pageSize,
      listFilterTypes: filterTypes,
      listFilterAccountIds: filterAccountIds,
      listFilterDateFrom: filterDateFrom,
      listFilterDateTo: filterDateTo,
      listFilterTodayMode: todayMode,
      listFilterSymbol: filterSymbol,
      listFiltersExpanded: filtersExpanded,
      listColumnOrder: columnOrder,
    });
  }, [
    pageSize,
    filterTypes,
    filterAccountIds,
    filterDateFrom,
    filterDateTo,
    todayMode,
    filterSymbol,
    filtersExpanded,
    columnOrder,
    prefsReady,
  ]);

  const filteredTransactions = useMemo(() => {
    return transactions.filter((t) => {
      if (filterTypes.length > 0 && !filterTypes.includes(t.type)) {
        return false;
      }
      if (
        filterAccountIds.length > 0 &&
        !filterAccountIds.includes(t.accountId)
      ) {
        return false;
      }
      const dateKey = toTransactionDateKey(t.date);
      if (filterDateFrom && dateKey < filterDateFrom) return false;
      if (filterDateTo && dateKey > filterDateTo) return false;
      if (!matchesSymbolOrNameFilter(t, filterSymbol)) return false;
      return true;
    });
  }, [
    transactions,
    filterTypes,
    filterAccountIds,
    filterDateFrom,
    filterDateTo,
    filterSymbol,
  ]);

  const totalPages = Math.max(
    1,
    Math.ceil(filteredTransactions.length / pageSize),
  );
  const safePage = Math.min(page, totalPages);

  useEffect(() => {
    setPage(1);
  }, [
    filterTypes,
    filterAccountIds,
    filterDateFrom,
    filterDateTo,
    filterSymbol,
    pageSize,
  ]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const pageTransactions = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return filteredTransactions.slice(start, start + pageSize);
  }, [filteredTransactions, safePage, pageSize]);

  const pageStart =
    filteredTransactions.length === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const pageEnd = Math.min(safePage * pageSize, filteredTransactions.length);

  const filteredTradeTotals = useMemo(() => {
    const accountCurrency = new Map(
      accounts.map((a) => [a.id, a.currency] as const),
    );
    const byCurrency = new Map<string, { buy: number; sell: number }>();
    for (const tx of filteredTransactions) {
      const type = tx.type.toUpperCase();
      if (type !== "BUY" && type !== "SELL") continue;
      const ccy = accountCurrency.get(tx.accountId) ?? "TWD";
      const settlement = computeTransactionSettlement(
        tx.type,
        tx.quantity,
        tx.price,
        tx.fee,
        tx.tax,
      );
      if (!settlement) continue;
      const bucket = byCurrency.get(ccy) ?? { buy: 0, sell: 0 };
      const netAbs = Math.abs(settlement.net);
      if (type === "BUY") bucket.buy += netAbs;
      else bucket.sell += netAbs;
      byCurrency.set(ccy, bucket);
    }
    return [...byCurrency.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [filteredTransactions, accounts]);

  return {
    filters: {
      filterTypes,
      setFilterTypes,
      filterAccountIds,
      setFilterAccountIds,
      filterDateFrom,
      setFilterDateFrom,
      filterDateTo,
      setFilterDateTo,
      setTodayMode,
      filterSymbol,
      setFilterSymbol,
      filtersExpanded,
      setFiltersExpanded,
      todayKey,
      isTodayFilter,
      hasDateFilter,
      activeFilterCount,
    },
    pagination: {
      page: safePage,
      setPage,
      pageSize,
      setPageSize,
      totalPages,
      pageStart,
      pageEnd,
    },
    columnOrder,
    setColumnOrder,
    filteredTransactions,
    pageTransactions,
    filteredTradeTotals,
  };
}

export type TransactionListFilters = ReturnType<typeof useTransactionList>["filters"];
export type TransactionListPagination = ReturnType<
  typeof useTransactionList
>["pagination"];
