"use client";

import { useEffect, useState } from "react";
import { readChartTheme, type ChartThemeColors } from "@/lib/chart-theme";

export function useChartTheme(): ChartThemeColors {
  const [theme, setTheme] = useState<ChartThemeColors>(() => readChartTheme());

  useEffect(() => {
    const refresh = () => setTheme(readChartTheme());
    refresh();
    const obs = new MutationObserver(refresh);
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "data-color-mode"],
    });
    return () => obs.disconnect();
  }, []);

  return theme;
}
