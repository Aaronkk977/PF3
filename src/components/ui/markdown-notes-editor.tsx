"use client";

import { MarkdownPreview } from "@/components/ui/markdown-preview";
import { cn } from "@/lib/utils";

export function MarkdownNotesEditor({
  value,
  onChange,
  placeholder = "支援 Markdown：標題、清單、連結、程式碼區塊…",
  minHeight = "14rem",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  minHeight?: string;
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div>
        <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-[var(--color-muted)]">
          編輯
        </p>
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          spellCheck
          className={cn(
            "w-full resize-y rounded-md border border-[var(--color-card-border)] bg-[var(--color-background)] px-3 py-2 text-sm text-[var(--color-foreground)]",
            "placeholder:text-[var(--color-muted)] focus:border-[var(--color-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]",
          )}
          style={{ minHeight }}
        />
      </div>
      <div>
        <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-[var(--color-muted)]">
          即時預覽
        </p>
        <div
          className="overflow-auto rounded-md border border-[var(--color-card-border)]/80 bg-[color-mix(in_srgb,var(--color-background)_60%,var(--color-card))] px-3 py-2"
          style={{ minHeight }}
        >
          <MarkdownPreview content={value} />
        </div>
      </div>
    </div>
  );
}
