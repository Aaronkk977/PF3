/** 從目前 document 主題讀取圖表用色（隨 data-theme 切換） */
export type ChartThemeColors = {
  primary: string;
  accent: string;
  muted: string;
  background: string;
  foreground: string;
  cardBorder: string;
  positive: string;
  negative: string;
};

const FALLBACK: ChartThemeColors = {
  primary: "#00f0ff",
  accent: "#ff00aa",
  muted: "#6b8aab",
  background: "#111827",
  foreground: "#e8f4ff",
  cardBorder: "#1e3a5f",
  positive: "#00ff88",
  negative: "#ff4466",
};

function readVar(style: CSSStyleDeclaration, name: string, fallback: string): string {
  const v = style.getPropertyValue(name).trim();
  return v || fallback;
}

export function readChartTheme(): ChartThemeColors {
  if (typeof document === "undefined") return FALLBACK;
  const style = getComputedStyle(document.documentElement);
  return {
    primary: readVar(style, "--color-primary", FALLBACK.primary),
    accent: readVar(style, "--color-accent", FALLBACK.accent),
    muted: readVar(style, "--color-muted", FALLBACK.muted),
    background: readVar(style, "--color-card", FALLBACK.background),
    foreground: readVar(style, "--color-foreground", FALLBACK.foreground),
    cardBorder: readVar(style, "--color-card-border", FALLBACK.cardBorder),
    positive: readVar(style, "--color-positive", FALLBACK.positive),
    negative: readVar(style, "--color-negative", FALLBACK.negative),
  };
}

/** 邊框色加上 alpha（#rrggbb → 8 位 hex） */
export function withAlpha(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  if (h.length !== 6) return hex;
  const a = Math.round(Math.min(1, Math.max(0, alpha)) * 255)
    .toString(16)
    .padStart(2, "0");
  return `#${h}${a}`;
}
