import {
  BENCHMARK_COLORS,
  ENTIRE_PORTFOLIO_DATA_KEY,
} from "@/lib/chart-constants";
import type { ChartThemeColors } from "@/lib/chart-theme";
import { isGrayscaleChartTheme, isLightGrayscaleTheme } from "@/lib/theme-utils";
import { STANDARD_ACCOUNTS } from "@/lib/standard-accounts";

const CYBER_ACCOUNT_FALLBACKS = [
  "#00f0ff",
  "#00c4e0",
  "#4de8f5",
  "#7dd3fc",
  "#38bdf8",
  "#22d3ee",
];

const LIGHT_ACCOUNT_COLORS = [
  "#1c1917",
  "#44403c",
  "#57534e",
  "#292524",
  "#0c0a09",
  "#78716c",
];

const DARK_ACCOUNT_COLORS = [
  "#f5f5f5",
  "#e5e5e5",
  "#d4d4d4",
  "#fafafa",
  "#a3a3a3",
  "#d6d6d6",
];

const LIGHT_BENCHMARK_COLORS = [
  "#1c1917",
  "#57534e",
  "#78716c",
  "#44403c",
  "#292524",
  "#a8a29e",
];

const DARK_BENCHMARK_COLORS = [
  "#f5f5f5",
  "#d4d4d4",
  "#a3a3a3",
  "#e5e5e5",
  "#fafafa",
  "#d6d6d6",
];

type LineLike = {
  dataKey: string;
  color: string;
  kind?: "account" | "entire" | "portfolio" | "benchmark";
};

function lineKind(line: LineLike): "entire" | "account" | "benchmark" {
  if (line.kind === "entire") return "entire";
  if (line.kind === "benchmark") return "benchmark";
  if (line.dataKey === ENTIRE_PORTFOLIO_DATA_KEY) return "entire";
  if (line.dataKey.startsWith("benchmark_")) return "benchmark";
  return "account";
}

function accountPalette(theme: ChartThemeColors): string[] {
  return isLightGrayscaleTheme(theme) ? LIGHT_ACCOUNT_COLORS : DARK_ACCOUNT_COLORS;
}

function benchmarkPalette(theme: ChartThemeColors): string[] {
  return isLightGrayscaleTheme(theme)
    ? LIGHT_BENCHMARK_COLORS
    : DARK_BENCHMARK_COLORS;
}

/** 依目前主題重算圖表折線色（修正黑白主題下淺藍線條看不見） */
export function applyThemeToChartLines<T extends LineLike>(
  lines: T[],
  theme: ChartThemeColors,
): T[] {
  if (!isGrayscaleChartTheme(theme)) return lines;

  let accountIdx = 0;
  let benchIdx = 0;
  const accounts = accountPalette(theme);
  const benchmarks = benchmarkPalette(theme);
  const entireColor = theme.foreground;

  return lines.map((line) => {
    const kind = lineKind(line);
    let color: string;
    if (kind === "entire") {
      color = entireColor;
    } else if (kind === "benchmark") {
      color = benchmarks[benchIdx % benchmarks.length]!;
      benchIdx += 1;
    } else {
      color = accounts[accountIdx % accounts.length]!;
      accountIdx += 1;
    }
    return { ...line, color };
  });
}

export function resolveAccountSwatchColor(
  accountName: string,
  index: number,
  theme: ChartThemeColors,
): string {
  if (!isGrayscaleChartTheme(theme)) {
    const std = STANDARD_ACCOUNTS.find((s) => s.name === accountName);
    return std?.color ?? CYBER_ACCOUNT_FALLBACKS[index % CYBER_ACCOUNT_FALLBACKS.length]!;
  }
  return accountPalette(theme)[index % accountPalette(theme).length]!;
}

export function resolveEntirePortfolioColor(theme: ChartThemeColors): string {
  if (!isGrayscaleChartTheme(theme)) {
    return "#e8f4ff";
  }
  return theme.foreground;
}

export function resolveBenchmarkColor(
  index: number,
  theme: ChartThemeColors,
): string {
  if (!isGrayscaleChartTheme(theme)) {
    return BENCHMARK_COLORS[index % BENCHMARK_COLORS.length]!;
  }
  return benchmarkPalette(theme)[index % benchmarkPalette(theme).length]!;
}
