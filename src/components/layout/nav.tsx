"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_PREFETCH, prefetchPage } from "@/lib/prefetch-page-data";
import { cn } from "@/lib/utils";

const links = [
  { href: "/", label: "Dashboard" },
  { href: "/holdings", label: "Holdings" },
  { href: "/transactions", label: "Transactions" },
  { href: "/performance", label: "Performance" },
  { href: "/settings", label: "Settings" },
];

export function Nav() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-50 border-b border-[var(--color-card-border)]/60 bg-[var(--color-background)]/95 backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
        <Link href="/" className="group flex items-center gap-3">
          <span className="font-mono text-lg font-bold text-[var(--color-primary)] glow-text">
            PORTFOLIO PERFORMANCE
          </span>
          <span className="hidden text-xs text-[var(--color-muted)] sm:inline">
            Trading & Investment Assistant
          </span>
        </Link>
        <nav className="flex flex-wrap gap-1">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              prefetch={link.href === "/transactions" ? false : undefined}
              onMouseEnter={() => {
                const target = NAV_PREFETCH[link.href];
                if (target) prefetchPage(target.cacheKey, target.url);
              }}
              onFocus={() => {
                const target = NAV_PREFETCH[link.href];
                if (target) prefetchPage(target.cacheKey, target.url);
              }}
              className={cn(
                "rounded-md px-3 py-2 font-mono text-xs uppercase tracking-wider transition-colors",
                pathname === link.href
                  ? "border border-[var(--color-primary)]/30 bg-[var(--color-primary)]/15 text-[var(--color-primary)]"
                  : "text-[var(--color-muted)] hover:bg-[color-mix(in_srgb,var(--color-foreground)_6%,transparent)] hover:text-[var(--color-primary)]",
              )}
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
