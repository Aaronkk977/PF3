"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type SymbolSuggestion = { symbol: string; name: string };

type Props = {
  value: string;
  suggestions: SymbolSuggestion[];
  onQueryChange: (query: string) => void;
  onSelect: (item: SymbolSuggestion) => void;
  placeholder?: string;
  required?: boolean;
};

export function SymbolSearchInput({
  value,
  suggestions,
  onQueryChange,
  onSelect,
  placeholder,
  required,
}: Props) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  useEffect(() => {
    setActiveIndex(suggestions.length > 0 ? 0 : -1);
  }, [suggestions]);

  function pick(item: SymbolSuggestion) {
    onSelect(item);
    setOpen(false);
  }

  return (
    <div ref={rootRef} className="relative">
      <Input
        value={value}
        onChange={(e) => {
          onQueryChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (!open || suggestions.length === 0) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActiveIndex((i) => (i + 1) % suggestions.length);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActiveIndex(
              (i) => (i - 1 + suggestions.length) % suggestions.length,
            );
          } else if (e.key === "Enter" && activeIndex >= 0) {
            e.preventDefault();
            pick(suggestions[activeIndex]!);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        placeholder={placeholder}
        required={required}
        autoComplete="off"
        aria-autocomplete="list"
        aria-controls={listId}
        aria-expanded={open && suggestions.length > 0}
      />
      {open && suggestions.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-50 mt-1 max-h-56 w-full overflow-auto rounded-md border border-[var(--color-card-border)] bg-[var(--color-background)] py-1 font-sans shadow-lg"
        >
          {suggestions.map((item, i) => (
            <li
              key={item.symbol}
              role="option"
              aria-selected={i === activeIndex}
              className={cn(
                "cursor-pointer px-3 py-2 font-sans text-sm",
                i === activeIndex
                  ? "bg-[var(--color-card-border)] text-[var(--color-primary)]"
                  : "text-[var(--color-foreground)] hover:bg-[var(--color-card-border)]/60",
              )}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(item);
              }}
              onMouseEnter={() => setActiveIndex(i)}
            >
              <span className="font-mono text-[var(--color-primary)]">
                {item.symbol}
              </span>
              <span className="ml-2 text-[var(--color-muted)]">{item.name}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
