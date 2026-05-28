import { cn } from "@/lib/utils";
import { type InputHTMLAttributes, forwardRef } from "react";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "flex h-10 w-full rounded-md border border-[var(--color-card-border)] bg-[var(--color-background)] px-3 py-2 font-sans text-sm text-[var(--color-foreground)] placeholder:text-[var(--color-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--color-primary)_50%,transparent)]",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";
