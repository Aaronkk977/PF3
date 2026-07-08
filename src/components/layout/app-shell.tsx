"use client";

import { Nav } from "@/components/layout/nav";
import { PageSectionsProvider } from "@/components/layout/page-sections";
import { ScrollRestoration } from "@/components/layout/scroll-restoration";
import { SettingsProvider } from "@/components/settings/settings-provider";
import { ConnectivityBanner } from "@/components/ui/connectivity-banner";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <SettingsProvider>
      <ScrollRestoration />
      <ConnectivityBanner />
      <Nav />
      <main className="relative z-10 mx-auto max-w-7xl px-6 py-8">
        <PageSectionsProvider>{children}</PageSectionsProvider>
      </main>
    </SettingsProvider>
  );
}
