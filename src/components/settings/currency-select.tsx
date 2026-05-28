"use client";

import { useEffect, useState } from "react";
import { Select } from "@/components/ui/select";
import { loadCurrencyList } from "@/lib/currencies";

export function CurrencySelect({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (code: string) => void;
  className?: string;
}) {
  const [currencies, setCurrencies] = useState<string[]>(["TWD", "USD"]);

  useEffect(() => {
    setCurrencies(loadCurrencyList());
  }, []);

  useEffect(() => {
    const refresh = () => setCurrencies(loadCurrencyList());
    window.addEventListener("portfolio-currencies-updated", refresh);
    return () => window.removeEventListener("portfolio-currencies-updated", refresh);
  }, []);

  return (
    <Select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={className}
    >
      {currencies.map((c) => (
        <option key={c} value={c}>
          {c}
        </option>
      ))}
    </Select>
  );
}
