"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

function Chevron({ expanded }: { expanded: boolean }) {
  return (
    <svg
      className={cn(
        "h-3.5 w-3.5 shrink-0 transition-transform duration-300 ease-in-out",
        expanded ? "rotate-180" : "rotate-0",
      )}
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden
    >
      <path
        fillRule="evenodd"
        d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
        clipRule="evenodd"
      />
    </svg>
  );
}

/**
 * variant="default"  — standard card with collapse toggle (existing look)
 * variant="settings" — settings-panel look: left accent border, toolbar header,
 *                      gear icon, subtly distinct background
 */
export function CollapsibleCard({
  title,
  expanded,
  onToggle,
  children,
  variant = "default",
}: {
  title: string;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  variant?: "default" | "settings";
}) {
  if (variant === "settings") {
    return (
      <div
        className={cn(
          "rounded-lg border border-[var(--color-card-border)] bg-[var(--color-card)]/95 backdrop-blur-sm glow-border",
          "border-l-[3px] border-l-[var(--color-primary)]",
        )}
      >
        {/* ── Settings toolbar header ── */}
        <button
          type="button"
          onClick={onToggle}
          className={cn(
            "flex w-full items-center justify-between gap-3 px-5 text-left transition-colors",
            "hover:bg-[var(--color-primary)]/5",
            expanded ? "py-3 border-b border-[var(--color-card-border)]/60" : "py-4",
          )}
        >
          <span className="flex items-center gap-2.5">
            {/* Gear icon */}
            <svg
              className="h-4 w-4 shrink-0 text-[var(--color-primary)]"
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden
            >
              <path
                fillRule="evenodd"
                d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z"
                clipRule="evenodd"
              />
            </svg>
            <span className="font-mono text-xs font-semibold uppercase tracking-widest text-[var(--color-primary)]">
              {title}
            </span>
          </span>
          <Chevron expanded={expanded} />
        </button>

        {/* ── Animated body ── */}
        <div
          className={cn(
            "grid transition-[grid-template-rows] duration-300 ease-in-out",
            expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
          )}
        >
          <div className="overflow-hidden">
            <div className="px-5 py-4">{children}</div>
          </div>
        </div>
      </div>
    );
  }

  // ── Default variant ──────────────────────────────────────────────────────
  return (
    <Card>
      <CardHeader className={cn(expanded ? "pb-2" : "px-6 pb-6 pt-5")}>
        <button
          type="button"
          onClick={onToggle}
          className="flex min-h-10 w-full items-center justify-between text-left"
        >
          <CardTitle className="leading-none">{title}</CardTitle>
          <Chevron expanded={expanded} />
        </button>
      </CardHeader>
      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-300 ease-in-out",
          expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div className="overflow-hidden">
          <CardContent>{children}</CardContent>
        </div>
      </div>
    </Card>
  );
}
