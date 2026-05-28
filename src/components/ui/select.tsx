import { cn } from "@/lib/utils";
import { type SelectHTMLAttributes, forwardRef } from "react";

export const Select = forwardRef<
  HTMLSelectElement,
  SelectHTMLAttributes<HTMLSelectElement>
>(({ className, children, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(
      "flex h-10 w-full rounded-md border border-[var(--color-card-border)] bg-[var(--color-background)] px-3 py-2 font-sans text-sm text-[var(--color-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--color-primary)_50%,transparent)]",
      className,
    )}
    {...props}
  >
    {children}
  </select>
));
Select.displayName = "Select";
