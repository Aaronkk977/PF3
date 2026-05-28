"use client";

import { Nav } from "@/components/layout/nav";
import { PageSectionsProvider } from "@/components/layout/page-sections";
import { SettingsProvider } from "@/components/settings/settings-provider";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <SettingsProvider>
      <Nav />
      <main className="relative z-10 mx-auto max-w-7xl px-6 py-8">
        <PageSectionsProvider>{children}</PageSectionsProvider>
      </main>
    </SettingsProvider>
  );
}
