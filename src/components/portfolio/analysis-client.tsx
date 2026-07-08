"use client";

import { useEffect, useState } from "react";
import { PerformanceClient } from "@/components/portfolio/performance-client";
import { TradesClient } from "@/components/portfolio/trades-client";
import type { BenchmarkRecord } from "@/lib/benchmarks";

type AccountOption = {
  id: string;
  name: string;
  currency: string;
  color: string;
  cash: number;
};

type AnalysisTab = "performance" | "trades";

const TAB_STORAGE_KEY = "pp-analysis-tab";

const TABS: { id: AnalysisTab; label: string }[] = [
  { id: "performance", label: "績效曲線" },
  { id: "trades", label: "已實現損益" },
];

function loadSavedTab(): AnalysisTab {
  try {
    const saved = sessionStorage.getItem(TAB_STORAGE_KEY);
    return saved === "trades" ? "trades" : "performance";
  } catch {
    return "performance";
  }
}

export function AnalysisClient({
  accounts,
  benchmarks,
  defaultStart,
  defaultEnd,
  portfolioEarliest,
}: {
  accounts: AccountOption[];
  benchmarks: BenchmarkRecord[];
  defaultStart: string;
  defaultEnd: string;
  portfolioEarliest: string;
}) {
  // SSR 一律先渲染預設頁籤，掛載後再讀 sessionStorage 還原（避免 hydration mismatch）
  const [activeTab, setActiveTab] = useState<AnalysisTab>("performance");

  useEffect(() => {
    setActiveTab(loadSavedTab());
  }, []);

  function switchTab(tab: AnalysisTab) {
    setActiveTab(tab);
    try {
      sessionStorage.setItem(TAB_STORAGE_KEY, tab);
    } catch {
      // sessionStorage unavailable — tab just won't persist
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-mono text-2xl font-bold text-[var(--color-primary)] glow-text">
            Analysis
          </h1>
          <p className="mt-1 text-sm text-[var(--color-muted)]">
            期間績效與已實現損益分析
          </p>
        </div>
        <div className="flex items-center gap-2">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => switchTab(tab.id)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                activeTab === tab.id
                  ? "bg-[var(--color-primary)]/15 text-[var(--color-primary)]"
                  : "text-[var(--color-muted)] hover:text-[var(--color-foreground)]"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {activeTab === "performance" ? (
        <PerformanceClient
          accounts={accounts}
          benchmarks={benchmarks}
          defaultStart={defaultStart}
          defaultEnd={defaultEnd}
          portfolioEarliest={portfolioEarliest}
        />
      ) : (
        <TradesClient
          accounts={accounts}
          defaultStart={defaultStart}
          defaultEnd={defaultEnd}
          portfolioEarliest={portfolioEarliest}
        />
      )}
    </div>
  );
}
