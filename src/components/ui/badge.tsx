import { cn } from "@/lib/utils";
import { type HTMLAttributes } from "react";

export function Badge({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border border-[color-mix(in_srgb,var(--color-primary)_30%,transparent)] bg-[color-mix(in_srgb,var(--color-primary)_10%,transparent)] px-2.5 py-0.5 text-xs font-medium text-[var(--color-primary)]",
        className,
      )}
      {...props}
    />
  );
}
