import type { ChartThemeColors } from "@/lib/chart-theme";

/** 淺色／深色黑白主題（非 Cyberpunk） */
export function isGrayscaleChartTheme(theme: ChartThemeColors): boolean {
  const primary = theme.primary.toLowerCase();
  return (
    primary === "#111111" ||
    primary === "#1c1917" ||
    primary === "#f5f5f5"
  );
}

/** 米色白底黑白主題 */
export function isLightGrayscaleTheme(theme: ChartThemeColors): boolean {
  return isGrayscaleChartTheme(theme) && theme.primary.toLowerCase() !== "#f5f5f5";
}
