"use client";

import { useCallback, useEffect, useState } from "react";
import { PageSection } from "@/components/layout/page-sections";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { EditableTransaction } from "@/components/portfolio/transaction-row";
import { TransactionsTable } from "@/components/portfolio/transactions-table";
import { TransactionForm } from "@/components/portfolio/transactions/transaction-form";
import { TransactionListFilterPanel } from "@/components/portfolio/transactions/transaction-list-filters";
import {
  TransactionListPager,
  TransactionListTotals,
} from "@/components/portfolio/transactions/transaction-list-footer";
import {
  normalizeTransactionRow,
  parseTransactionList,
  type Account,
  type Instrument,
  type Transaction,
} from "@/components/portfolio/transactions/transaction-utils";
import { useTransactionList } from "@/components/portfolio/transactions/use-transaction-list";
import type { InstrumentSuggestion } from "@/lib/instrument-suggestions";
import {
  PAGE_CACHE_KEYS,
  readClientCache,
  writeClientCache,
} from "@/lib/client-data-cache";
import { parseResponseJson } from "@/lib/utils";
import { pageRequestHeaders } from "@/lib/page-request-headers";

export function TransactionsClient({
  initialTransactions,
  initialAccounts,
  instruments: initialInstruments,
  priorityInstruments,
}: {
  initialTransactions: Transaction[];
  initialAccounts: Account[];
  instruments: Instrument[];
  priorityInstruments: InstrumentSuggestion[];
}) {
  const [instrumentCatalog, setInstrumentCatalog] =
    useState<Instrument[]>(initialInstruments);

  useEffect(() => {
    setInstrumentCatalog(initialInstruments);
  }, [initialInstruments]);

  const refreshInstrumentCatalog = useCallback(async (): Promise<Instrument[]> => {
    try {
      const res = await fetch("/api/instruments", {
        headers: pageRequestHeaders(PAGE_CACHE_KEYS.transactions),
      });
      if (!res.ok) return [];
      const list = (await res.json()) as {
        id: string;
        symbol: string;
        name: string | null;
      }[];
      if (!Array.isArray(list)) return [];
      const next = list.map((i) => ({
        id: i.id,
        symbol: i.symbol,
        name: i.name,
      }));
      setInstrumentCatalog(next);
      return next;
    } catch {
      return [];
    }
  }, []);

  useEffect(() => {
    void refreshInstrumentCatalog();
  }, [refreshInstrumentCatalog]);

  const [transactions, setTransactions] = useState(() =>
    initialTransactions.map(normalizeTransactionRow),
  );
  const [accounts, setAccounts] = useState(initialAccounts);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);

  const list = useTransactionList(transactions, accounts, initialAccounts);

  const reloadTransactions = useCallback(async () => {
    const [txRes, accRes] = await Promise.all([
      fetch("/api/transactions", { cache: "no-store" }),
      fetch("/api/accounts", { cache: "no-store" }),
    ]);

    let txList: Transaction[] | null = null;
    if (txRes.ok) {
      txList = parseTransactionList(await parseResponseJson(txRes));
      setTransactions(txList);
    }

    let accList: Account[] | null = null;
    if (accRes.ok) {
      accList = await parseResponseJson<Account[]>(accRes);
      if (accList) setAccounts(accList);
    }

    const cached = readClientCache<{
      initialTransactions: Transaction[];
      initialAccounts: Account[];
      instruments?: unknown;
      priorityInstruments?: unknown;
    }>(PAGE_CACHE_KEYS.transactions);
    if (cached && txList) {
      writeClientCache(PAGE_CACHE_KEYS.transactions, {
        ...cached,
        initialTransactions: txList,
        ...(accList ? { initialAccounts: accList } : {}),
      });
    }
  }, []);

  async function handleCsvImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setImportResult(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/transactions/import", {
        method: "POST",
        body: formData,
      });
      const result = await res.json();
      if (result.imported > 0) {
        setImportResult(`成功匯入 ${result.imported} 筆`);
        await reloadTransactions();
      }
      if (result.errors?.length > 0) {
        setImportResult(
          (prev) =>
            `${prev ?? ""} ${result.errors.length} 筆錯誤: ${result.errors.map((err: { row: number; message: string }) => `列${err.row} ${err.message}`).join("; ")}`,
        );
      }
    } finally {
      setImporting(false);
      e.target.value = "";
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-mono text-2xl font-bold text-[var(--color-primary)] glow-text">
          Transactions
        </h1>
        <p className="mt-1 text-sm text-[var(--color-muted)]">
          記錄買賣與出入金
        </p>
      </div>

      <PageSection id="transactions-add" title="新增交易" navOrder={10}>
        <TransactionForm
          accounts={accounts}
          initialAccounts={initialAccounts}
          transactions={transactions}
          instrumentCatalog={instrumentCatalog}
          priorityInstruments={priorityInstruments}
          refreshInstrumentCatalog={refreshInstrumentCatalog}
          onCreated={reloadTransactions}
        />
      </PageSection>

      <PageSection id="transactions-list" title="交易列表" className="mt-8" navOrder={20}>
      <Card>
        <CardHeader>
          <CardTitle>交易列表</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <TransactionListFilterPanel filters={list.filters} accounts={accounts} />

          <TransactionsTable
            columnOrder={list.columnOrder}
            onColumnOrderChange={list.setColumnOrder}
            transactions={list.pageTransactions as EditableTransaction[]}
            accounts={accounts}
            onSaved={reloadTransactions}
            onDeleted={reloadTransactions}
          />

          <TransactionListTotals totals={list.filteredTradeTotals} />

          <TransactionListPager
            pagination={list.pagination}
            filteredCount={list.filteredTransactions.length}
            totalCount={transactions.length}
          />
        </CardContent>
      </Card>
      </PageSection>

      <PageSection id="transactions-import" title="CSV 匯入" className="mt-8" navOrder={30}>
      <Card>
        <CardHeader>
          <CardTitle>CSV 匯入</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-[var(--color-muted)]">
            可上傳 <code className="text-[var(--color-primary)]">data/import/transactions.csv</code>{" "}
            標準格式，或舊版{" "}
            <code className="text-[var(--color-primary)]">data/import/legacy/All_transactions.csv</code>
          </p>
          <Input type="file" accept=".csv" onChange={handleCsvImport} disabled={importing} />
          {importResult && (
            <p className="text-sm text-[var(--color-primary)]">{importResult}</p>
          )}
        </CardContent>
      </Card>
      </PageSection>
    </div>
  );
}
