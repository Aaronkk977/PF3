import { parseJsonSafe } from "@/lib/utils";

export type ThemeId = "cyberpunk" | "monochrome" | "noir";
export type ColorMode = "green-up" | "red-up";

export type AppSettings = {
  theme: ThemeId;
  colorMode: ColorMode;
  /** 系統結算幣別（持倉市值、圖表等） */
  baseCurrency: string;
};

export const DEFAULT_SETTINGS: AppSettings = {
  theme: "cyberpunk",
  colorMode: "green-up",
  baseCurrency: "TWD",
};

const STORAGE_KEY = "portfolio-app-settings";

export function loadSettings(): AppSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = parseJsonSafe<Partial<AppSettings>>(raw);
    if (!parsed) return DEFAULT_SETTINGS;
    const base =
      typeof parsed.baseCurrency === "string" && parsed.baseCurrency.length >= 3
        ? parsed.baseCurrency.toUpperCase()
        : DEFAULT_SETTINGS.baseCurrency;
    return {
      theme:
        parsed.theme === "monochrome"
          ? "monochrome"
          : parsed.theme === "noir"
            ? "noir"
            : "cyberpunk",
      colorMode: parsed.colorMode === "red-up" ? "red-up" : "green-up",
      baseCurrency: base,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: AppSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export function applySettingsToDocument(settings: AppSettings): void {
  document.documentElement.dataset.theme = settings.theme;
  document.documentElement.dataset.colorMode = settings.colorMode;
}
