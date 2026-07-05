"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  applySettingsToDocument,
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
  type AppSettings,
  type ColorMode,
  type ThemeId,
} from "@/lib/settings";

type SettingsContextValue = {
  settings: AppSettings;
  setTheme: (theme: ThemeId) => void;
  setColorMode: (mode: ColorMode) => void;
  setBaseCurrency: (currency: string) => void;
  updateSettings: (patch: Partial<AppSettings>) => void;
};

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  // 伺服器端用預設值（避免 hydration mismatch）；客戶端第一次 effect 後立即同步
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);

  useEffect(() => {
    const loaded = loadSettings();
    setSettings(loaded);
    // inline script 已套主題，這裡確保使用者切換設定後仍能即時更新
    applySettingsToDocument(loaded);
  }, []);

  const persist = useCallback((next: AppSettings) => {
    setSettings(next);
    saveSettings(next);
    applySettingsToDocument(next);
  }, []);

  const updateSettings = useCallback(
    (patch: Partial<AppSettings>) => {
      persist({ ...settings, ...patch });
    },
    [persist, settings],
  );

  const setTheme = useCallback(
    (theme: ThemeId) => updateSettings({ theme }),
    [updateSettings],
  );

  const setColorMode = useCallback(
    (colorMode: ColorMode) => updateSettings({ colorMode }),
    [updateSettings],
  );

  const setBaseCurrency = useCallback(
    (baseCurrency: string) => updateSettings({ baseCurrency }),
    [updateSettings],
  );

  return (
    <SettingsContext.Provider
      value={{ settings, setTheme, setColorMode, setBaseCurrency, updateSettings }}
    >
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used within SettingsProvider");
  return ctx;
}
