"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** 標籤 chip + 文字比對推薦下拉：輸入時比對既有標籤，Enter 新增（沒有比對到就直接
 *  建立新標籤），點 chip 上的 X 移除。跟 note-instrument-picker 手感一致，
 *  但標籤是自由建立（不像關聯標的必須是已追蹤的），所以不會預設 highlight
 *  第一筆建議，避免「明明打的是新標籤卻被 Enter 成別的既有標籤」。 */
export function NoteTagPicker({
  selected,
  onChange,
  suggestions,
}: {
  selected: string[];
  onChange: (next: string[]) => void;
  suggestions: string[];
}) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const matches = useMemo(() => {
    const selectedLower = new Set(selected.map((t) => t.toLowerCase()));
    const q = query.trim().toLowerCase();
    return suggestions
      .filter((t) => !selectedLower.has(t.toLowerCase()))
      .filter((t) => !q || t.toLowerCase().includes(q))
      .slice(0, 20);
  }, [suggestions, query, selected]);

  useEffect(() => {
    setActiveIndex(-1);
  }, [query, matches.length]);

  function add(tag: string) {
    const trimmed = tag.trim();
    if (!trimmed) return;
    const existing = suggestions.find((t) => t.toLowerCase() === trimmed.toLowerCase());
    const canonical = existing ?? trimmed;
    if (!selected.some((t) => t.toLowerCase() === canonical.toLowerCase())) {
      onChange([...selected, canonical]);
    }
    setQuery("");
    setOpen(false);
  }

  function remove(tag: string) {
    onChange(selected.filter((t) => t !== tag));
  }

  return (
    <div ref={rootRef} className="relative">
      {selected.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {selected.map((tag) => (
            <Badge key={tag} className="gap-1 pr-1">
              {tag}
              <button
                type="button"
                onClick={() => remove(tag)}
                aria-label={`移除 ${tag}`}
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
          if (e.key === "Enter") {
            e.preventDefault();
            if (activeIndex >= 0 && matches[activeIndex]) {
              add(matches[activeIndex]);
            } else if (query.trim()) {
              add(query);
            }
          } else if (
            e.key === "Backspace" &&
            query === "" &&
            selected.length > 0
          ) {
            remove(selected[selected.length - 1]!);
          } else if (!open || matches.length === 0) {
            return;
          } else if (e.key === "ArrowDown") {
            e.preventDefault();
            setActiveIndex((i) => (i + 1) % matches.length);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActiveIndex((i) => (i - 1 + matches.length) % matches.length);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        placeholder="搜尋或輸入新標籤，按 Enter 新增…"
        autoComplete="off"
        aria-autocomplete="list"
        aria-controls={listId}
        aria-expanded={open && matches.length > 0}
      />
      {open && matches.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-50 mt-1 max-h-56 w-full overflow-auto rounded-md border border-[var(--color-card-border)] bg-[var(--color-background)] py-1 font-sans shadow-lg"
        >
          {matches.map((tag, i) => (
            <li
              key={tag}
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
                add(tag);
              }}
              onMouseEnter={() => setActiveIndex(i)}
            >
              {tag}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
