"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { pageRequestHeaders } from "@/lib/page-request-headers";
import { PAGE_CACHE_KEYS } from "@/lib/client-data-cache";

export type PickableInstrument = { id: string; symbol: string; name: string | null };

export function NoteInstrumentPicker({
  selected,
  onChange,
}: {
  selected: PickableInstrument[];
  onChange: (next: PickableInstrument[]) => void;
}) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [all, setAll] = useState<PickableInstrument[]>([]);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  useEffect(() => {
    void fetch("/api/instruments", {
      headers: pageRequestHeaders(PAGE_CACHE_KEYS.notes),
    })
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: { id: string; symbol: string; name: string | null }[]) => {
        setAll(rows.map((r) => ({ id: r.id, symbol: r.symbol, name: r.name })));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const suggestions = useMemo(() => {
    const selectedIds = new Set(selected.map((s) => s.id));
    const q = query.trim().toUpperCase();
    return all
      .filter((i) => !selectedIds.has(i.id))
      .filter(
        (i) =>
          !q ||
          i.symbol.toUpperCase().includes(q) ||
          (i.name ?? "").toUpperCase().includes(q),
      )
      .slice(0, 20);
  }, [all, query, selected]);

  useEffect(() => {
    setActiveIndex(suggestions.length > 0 ? 0 : -1);
  }, [suggestions]);

  function pick(item: PickableInstrument) {
    onChange([...selected, item]);
    setQuery("");
    setOpen(false);
  }

  function remove(id: string) {
    onChange(selected.filter((s) => s.id !== id));
  }

  return (
    <div ref={rootRef} className="relative">
      {selected.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {selected.map((item) => (
            <Badge key={item.id} className="gap-1 pr-1">
              {item.symbol}
              <button
                type="button"
                onClick={() => remove(item.id)}
                aria-label={`移除 ${item.symbol}`}
                className="rounded-full p-0.5 hover:bg-[var(--color-primary)]/20"
              >
                <X className="h-3 w-3" aria-hidden />
              </button>
            </Badge>
          ))}
        </div>
      )}
      <Input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
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
            setActiveIndex((i) => (i - 1 + suggestions.length) % suggestions.length);
          } else if (e.key === "Enter" && activeIndex >= 0) {
            e.preventDefault();
            pick(suggestions[activeIndex]!);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        placeholder="搜尋已追蹤的標的加入關聯…"
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
              key={item.id}
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
              <span className="font-mono text-[var(--color-primary)]">{item.symbol}</span>
              {item.name && (
                <span className="ml-2 text-[var(--color-muted)]">{item.name}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
