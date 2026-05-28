"use client";

import { PageSection } from "@/components/layout/page-sections";
import { AccountsSettings } from "@/components/settings/accounts-settings";
import { CurrencySettingsCard } from "@/components/settings/currency-settings-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useSettings } from "@/components/settings/settings-provider";
import type { SerializedAccount } from "@/lib/accounts";
import { cn } from "@/lib/utils";
import type { ColorMode, ThemeId } from "@/lib/settings";

const themes: { id: ThemeId; label: string; desc: string }[] = [
  { id: "cyberpunk", label: "Cyberpunk", desc: "深色霓虹、網格背景" },
  { id: "monochrome", label: "Black & White", desc: "米色底、深字高對比" },
  { id: "noir", label: "White & Black", desc: "黑底白字、與上列相反色調" },
];

const colorModes: { id: ColorMode; label: string; desc: string }[] = [
  { id: "green-up", label: "綠漲紅跌", desc: "國際慣例（預設）" },
  { id: "red-up", label: "紅漲綠跌", desc: "台股慣例" },
];

export function SettingsClient({
  initialAccounts,
}: {
  initialAccounts: SerializedAccount[];
}) {
  const { settings, setTheme, setColorMode } = useSettings();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-mono text-2xl font-bold text-[var(--color-primary)] glow-text">
          Settings
        </h1>
        <p className="mt-1 text-sm text-[var(--color-muted)]">
          帳戶、幣別、手續費規則與外觀
        </p>
      </div>

      <PageSection id="settings-currency" title="幣別設定" navOrder={10}>
      <CurrencySettingsCard />
      </PageSection>

      <PageSection id="settings-accounts" title="帳戶管理" className="mt-8" navOrder={20}>
      <AccountsSettings initialAccounts={initialAccounts} />
      </PageSection>

      <PageSection id="settings-theme" title="主題" className="mt-8" navOrder={30}>
      <Card>
        <CardHeader>
          <CardTitle>主題 Theme</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {themes.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTheme(t.id)}
              className={cn(
                "rounded-lg border p-4 text-left transition-all",
                settings.theme === t.id
                  ? "border-[var(--color-primary)] bg-[var(--color-primary)]/10"
                  : "border-[var(--color-card-border)] hover:border-[var(--color-primary)]/40",
              )}
            >
              <p className="text-sm font-semibold text-[var(--color-primary)]">
                {t.label}
              </p>
              <p className="mt-1 text-xs text-[var(--color-muted)]">{t.desc}</p>
            </button>
          ))}
        </CardContent>
      </Card>
      </PageSection>

      <PageSection id="settings-colors" title="漲跌顏色" className="mt-8" navOrder={40}>
      <Card>
        <CardHeader>
          <CardTitle>漲跌顏色</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          {colorModes.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setColorMode(m.id)}
              className={cn(
                "rounded-lg border p-4 text-left transition-all",
                settings.colorMode === m.id
                  ? "border-[var(--color-primary)] bg-[var(--color-primary)]/10"
                  : "border-[var(--color-card-border)] hover:border-[var(--color-primary)]/40",
              )}
            >
              <p className="text-sm font-semibold">{m.label}</p>
              <p className="mt-1 text-xs text-[var(--color-muted)]">{m.desc}</p>
              <div
                className="mt-3 flex gap-3 text-sm tabular-nums"
                data-color-mode={m.id}
              >
                <span className="positive">+1.25%</span>
                <span className="negative">-0.80%</span>
              </div>
            </button>
          ))}
        </CardContent>
      </Card>
      </PageSection>
    </div>
  );
}
