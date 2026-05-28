"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

export function MarkdownPreview({
  content,
  className,
  emptyHint = "預覽將顯示於此",
}: {
  content: string;
  className?: string;
  emptyHint?: string;
}) {
  const trimmed = content.trim();
  if (!trimmed) {
    return (
      <p className={cn("text-sm text-[var(--color-muted)]", className)}>
        {emptyHint}
      </p>
    );
  }

  return (
    <div className={cn("markdown-body", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}
