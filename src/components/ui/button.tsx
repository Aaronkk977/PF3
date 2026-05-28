import { cn } from "@/lib/utils";
import { type ButtonHTMLAttributes, forwardRef } from "react";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "outline" | "ghost" | "accent";
  size?: "sm" | "md" | "lg";
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "md", ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center rounded-md font-sans font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] disabled:opacity-50",
          variant === "default" &&
            "border border-[color-mix(in_srgb,var(--color-primary)_40%,transparent)] bg-[color-mix(in_srgb,var(--color-primary)_15%,transparent)] text-[var(--color-primary)] hover:bg-[color-mix(in_srgb,var(--color-primary)_25%,transparent)]",
          variant === "outline" &&
            "border border-[var(--color-card-border)] bg-transparent text-[var(--color-foreground)] hover:border-[color-mix(in_srgb,var(--color-primary)_50%,transparent)] hover:text-[var(--color-primary)]",
          variant === "ghost" &&
            "bg-transparent text-[var(--color-foreground)] hover:bg-[color-mix(in_srgb,var(--color-foreground)_6%,transparent)]",
          variant === "accent" &&
            "border border-[color-mix(in_srgb,var(--color-accent)_40%,transparent)] bg-[color-mix(in_srgb,var(--color-accent)_15%,transparent)] text-[var(--color-accent)] hover:bg-[color-mix(in_srgb,var(--color-accent)_25%,transparent)]",
          size === "sm" && "h-8 px-3 text-xs",
          size === "md" && "h-10 px-4 text-sm",
          size === "lg" && "h-12 px-6 text-base",
          className,
        )}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";
