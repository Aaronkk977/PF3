"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLayoutEffect, useRef, useState } from "react";
import { Settings } from "lucide-react";
import { NAV_PREFETCH, prefetchPage } from "@/lib/prefetch-page-data";
import { cn } from "@/lib/utils";

const links = [
  { href: "/", label: "Overview" },
  { href: "/market", label: "Market" },
  { href: "/holdings", label: "Holdings" },
  { href: "/transactions", label: "Transactions" },
  { href: "/analysis", label: "Analysis" },
];

export function Nav() {
  const pathname = usePathname();
  const navRef = useRef<HTMLElement>(null);
  const linkRefs = useRef<Record<string, HTMLAnchorElement | null>>({});
  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(
    null,
  );
  const [gearSpinning, setGearSpinning] = useState(false);

  useLayoutEffect(() => {
    function measure() {
      const container = navRef.current;
      const active = linkRefs.current[pathname];
      if (!container || !active) {
        setIndicator(null);
        return;
      }
      const containerRect = container.getBoundingClientRect();
      const activeRect = active.getBoundingClientRect();
      setIndicator({
        left: activeRect.left - containerRect.left,
        width: activeRect.width,
      });
    }
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [pathname]);

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
        <div className="flex items-center gap-1">
          <nav ref={navRef} className="relative flex flex-wrap gap-1">
            {/* 跟著目前頁面橫向滑動的高亮底色，取代逐項各自切換背景 */}
            {indicator && (
              <span
                aria-hidden
                className="pointer-events-none absolute top-0 z-0 h-full rounded-md border border-[var(--color-primary)]/30 bg-[var(--color-primary)]/15 transition-[left,width] duration-300 ease-out"
                style={{ left: indicator.left, width: indicator.width }}
              />
            )}
            {links.map((link) => (
              <Link
                key={link.href}
                ref={(el) => {
                  linkRefs.current[link.href] = el;
                }}
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
                  "relative z-10 rounded-md px-3 py-2 font-mono text-xs uppercase tracking-wider transition-colors",
                  pathname === link.href
                    ? "text-[var(--color-primary)]"
                    : "text-[var(--color-muted)] hover:bg-[color-mix(in_srgb,var(--color-foreground)_6%,transparent)] hover:text-[var(--color-primary)]",
                )}
              >
                {link.label}
              </Link>
            ))}
          </nav>
          {/* 設定為工具性頁面，不佔分頁位，用齒輪圖示（不參與滑動指示器） */}
          <Link
            href="/settings"
            aria-label="Settings"
            title="Settings"
            onClick={() => setGearSpinning(true)}
            className={cn(
              "flex items-center justify-center rounded-md px-3 py-2 transition-colors",
              pathname === "/settings"
                ? "border border-[var(--color-primary)]/30 bg-[var(--color-primary)]/15 text-[var(--color-primary)]"
                : "text-[var(--color-muted)] hover:bg-[color-mix(in_srgb,var(--color-foreground)_6%,transparent)] hover:text-[var(--color-primary)]",
            )}
          >
            <Settings
              className={cn("h-4 w-4", gearSpinning && "animate-gear-spin-once")}
              aria-hidden
              onAnimationEnd={() => setGearSpinning(false)}
            />
          </Link>
        </div>
      </div>
    </header>
  );
}
