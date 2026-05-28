"use client";

import { useCallback, useEffect, useState } from "react";
import { CurrencySelect } from "@/components/settings/currency-select";
import { useSettings } from "@/components/settings/settings-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  addCustomCurrency,
  isDefaultCurrency,
  loadCurrencyList,
  removeCustomCurrency,
} from "@/lib/currencies";
import { parseResponseJson } from "@/lib/utils";

function notifyCurrenciesUpdated() {
  window.dispatchEvent(new Event("portfolio-currencies-updated"));
}

type RateRow = { code: string; label: string | null };
type AccountRow = { id: string; name: string; currency: string };

export function CurrencySettingsCard() {
  const { settings, setBaseCurrency } = useSettings();
  const [currencies, setCurrencies] = useState<string[]>(["TWD", "USD"]);
  const [newCurrencyCode, setNewCurrencyCode] = useState("");
  const [rates, setRates] = useState<RateRow[]>([]);
  const [accounts, setAccounts] = useState<AccountRow[]>([]);

  const refreshList = useCallback(() => {
    setCurrencies(loadCurrencyList());
  }, []);

  useEffect(() => {
    refreshList();
    window.addEventListener("portfolio-currencies-updated", refreshList);
    return () =>
      window.removeEventListener("portfolio-currencies-updated", refreshList);
  }, [refreshList]);

  useEffect(() => {
    void fetch("/api/accounts")
      .then(async (r) => {
        if (!r.ok) return [] as AccountRow[];
        return (await parseResponseJson<AccountRow[]>(r)) ?? [];
      })
      .then((data) => setAccounts(data))
      .catch(() => setAccounts([]));
  }, []);

  useEffect(() => {
    const loadRates = () => {
      const codes = loadCurrencyList().join(",");
      void fetch(
        `/api/fx/rates?base=${encodeURIComponent(settings.baseCurrency)}&codes=${encodeURIComponent(codes)}`,
      )
        .then(async (r) => {
          if (!r.ok) return { rates: [] as RateRow[] };
          return (
            (await parseResponseJson<{ rates?: RateRow[] }>(r)) ?? {
              rates: [],
            }
          );
        })
        .then((json) => {
          setRates(json.rates ?? []);
        })
        .catch(() => setRates([]));
    };
    loadRates();
    window.addEventListener("portfolio-currencies-updated", loadRates);
    return () =>
      window.removeEventListener("portfolio-currencies-updated", loadRates);
  }, [settings.baseCurrency]);

  async function handleAddCurrency(e: React.FormEvent) {
    e.preventDefault();
    try {
      const list = addCustomCurrency(newCurrencyCode);
      setCurrencies(list);
      setNewCurrencyCode("");
      notifyCurrenciesUpdated();
    } catch (err) {
      alert(err instanceof Error ? err.message : "新增幣別失敗");
    }
  }

  function accountsUsing(code: string): AccountRow[] {
    return accounts.filter((a) => a.currency.toUpperCase() === code);
  }

  function canRemove(code: string): boolean {
    if (isDefaultCurrency(code)) return false;
    if (settings.baseCurrency.toUpperCase() === code) return false;
    if (accountsUsing(code).length > 0) return false;
    return true;
  }

  function handleRemove(code: string) {
    const used = accountsUsing(code);
    if (used.length > 0) {
      alert(
        `無法刪除 ${code}：帳戶「${used.map((a) => a.name).join("、")}」仍在使用`,
      );
      return;
    }
    if (settings.baseCurrency.toUpperCase() === code) {
      alert(`無法刪除：${code} 為目前系統結算幣別`);
      return;
    }
    if (!confirm(`確定從清單移除幣別 ${code}？`)) return;
    try {
      const list = removeCustomCurrency(code);
      setCurrencies(list);
      notifyCurrenciesUpdated();
    } catch (err) {
      alert(err instanceof Error ? err.message : "刪除失敗");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>幣別與結算</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="max-w-xs space-y-2">
          <p className="text-xs text-[var(--color-muted)]">
            持倉市值、圓餅圖與走勢圖均以結算幣別顯示。
          </p>
          <label className="block text-xs text-[var(--color-muted)]">
            系統結算幣別
          </label>
          <CurrencySelect
            value={settings.baseCurrency}
            onChange={setBaseCurrency}
          />
        </div>

        <div className="border-t border-[var(--color-card-border)] pt-4">
          <p className="mb-2 text-xs text-[var(--color-muted)]">
            可用幣別（以結算幣別為基準的匯率，資料來源 Yahoo Finance）
          </p>
          <ul className="space-y-2">
            {currencies.map((code) => {
              const rate = rates.find((r) => r.code === code);
              const inUse = accountsUsing(code);
              const removable = canRemove(code);
              return (
                <li
                  key={code}
                  className="flex flex-wrap items-center justify-between gap-2 rounded border border-[var(--color-card-border)] px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="font-mono text-sm text-[var(--color-primary)]">
                        {code}
                      </span>
                      {isDefaultCurrency(code) && (
                        <span className="text-[10px] uppercase text-[var(--color-muted)]">
                          內建
                        </span>
                      )}
                      {inUse.length > 0 && (
                        <span className="text-[10px] text-[var(--color-muted)]">
                          使用中 · {inUse.map((a) => a.name).join("、")}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs tabular-nums text-[var(--color-muted)]">
                      {rate?.label ?? "匯率取得中…"}
                    </p>
                  </div>
                  {removable ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 shrink-0 text-xs text-[var(--color-negative)] hover:border-[var(--color-negative)]/40"
                      onClick={() => handleRemove(code)}
                    >
                      刪除
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>

        <form
          onSubmit={handleAddCurrency}
          className="flex flex-wrap items-end gap-2 border-t border-[var(--color-card-border)] pt-4"
        >
          <div className="min-w-[140px] flex-1">
            <label className="mb-1 block text-xs text-[var(--color-muted)]">
              新增幣別代碼
            </label>
            <Input
              value={newCurrencyCode}
              onChange={(e) => setNewCurrencyCode(e.target.value.toUpperCase())}
              placeholder="例如 EUR、JPY、CNY"
              maxLength={8}
            />
          </div>
          <Button type="submit" variant="outline" className="h-10">
            加入清單
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
