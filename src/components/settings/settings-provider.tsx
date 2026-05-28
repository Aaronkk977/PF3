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
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const loaded = loadSettings();
    setSettings(loaded);
    applySettingsToDocument(loaded);
    setReady(true);
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

  if (!ready) {
    return <div className="min-h-screen bg-[var(--color-background)]" />;
  }

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
