"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function CollapsibleCard({
  title,
  expanded,
  onToggle,
  children,
}: {
  title: string;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader
        className={cn(
          expanded ? "pb-2" : "px-6 pb-6 pt-5",
        )}
      >
        <button
          type="button"
          onClick={onToggle}
          className="flex min-h-10 w-full items-center justify-between text-left"
        >
          <CardTitle className="leading-none">{title}</CardTitle>
          <span className="shrink-0 text-xs text-[var(--color-muted)]" aria-hidden>
            {expanded ? "收起 ▲" : "展開 ▼"}
          </span>
        </button>
      </CardHeader>
      {expanded && <CardContent>{children}</CardContent>}
    </Card>
  );
}
