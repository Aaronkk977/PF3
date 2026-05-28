import type { ReactNode } from "react";

export function FilterCheckboxGroup({
  label,
  children,
  compact,
}: {
  label: string;
  children: ReactNode;
  compact?: boolean;
}) {
  return (
    <div>
      <p
        className={`mb-2 font-medium uppercase tracking-wide text-[var(--color-muted)] ${
          compact ? "text-[10px]" : "text-xs"
        }`}
      >
        {label}
      </p>
      <div className={`flex flex-wrap ${compact ? "gap-2" : "gap-3"}`}>
        {children}
      </div>
    </div>
  );
}

export function FilterCheckbox({
  checked,
  onChange,
  label,
  className,
  compact,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
  className?: string;
  compact?: boolean;
}) {
  return (
    <label
      className={`flex cursor-pointer items-center gap-1.5 ${
        compact ? "text-xs" : "text-sm"
      } ${className ?? ""}`}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className={`rounded border-[var(--color-card-border)] accent-[var(--color-primary)] ${
          compact ? "h-3 w-3" : ""
        }`}
      />
      <span>{label}</span>
    </label>
  );
}
