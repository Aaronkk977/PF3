"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { toLocalDateKey } from "@/lib/date-keys";
import { cn } from "@/lib/utils";

const WEEKDAY_LABELS = ["日", "一", "二", "三", "四", "五", "六"];

function toMonthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** 該月份的日曆格：null 代表月初前的留白 */
function buildMonthGrid(viewMonth: Date): (number | null)[] {
  const year = viewMonth.getFullYear();
  const month = viewMonth.getMonth();
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = Array.from({ length: firstWeekday }, () => null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  return cells;
}

export function NotesCalendar({
  selectedDate,
  onSelectDate,
}: {
  selectedDate: string | null;
  onSelectDate: (date: string | null) => void;
}) {
  const [viewMonth, setViewMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [txDates, setTxDates] = useState<Set<string>>(new Set());
  const [noteDates, setNoteDates] = useState<Set<string>>(new Set());

  const todayKey = toLocalDateKey(new Date());

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/notes/activity-days?month=${toMonthKey(viewMonth)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { transactionDates: string[]; noteDates: string[] } | null) => {
        if (cancelled || !d) return;
        setTxDates(new Set(d.transactionDates));
        setNoteDates(new Set(d.noteDates));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [viewMonth]);

  const cells = buildMonthGrid(viewMonth);
  const year = viewMonth.getFullYear();
  const month = viewMonth.getMonth();

  return (
    <div className="rounded-lg border border-[var(--color-card-border)]/60 p-3">
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          onClick={() => setViewMonth(new Date(year, month - 1, 1))}
          aria-label="上個月"
          className="rounded-md p-1 text-[var(--color-muted)] hover:bg-[var(--color-card-border)]/40 hover:text-[var(--color-primary)]"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
        </button>
        <p className="text-sm font-medium text-[var(--color-foreground)]">
          {year} 年 {month + 1} 月
        </p>
        <button
          type="button"
          onClick={() => setViewMonth(new Date(year, month + 1, 1))}
          aria-label="下個月"
          className="rounded-md p-1 text-[var(--color-muted)] hover:bg-[var(--color-card-border)]/40 hover:text-[var(--color-primary)]"
        >
          <ChevronRight className="h-4 w-4" aria-hidden />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center">
        {WEEKDAY_LABELS.map((w) => (
          <div key={w} className="text-[10px] text-[var(--color-muted)]">
            {w}
          </div>
        ))}
        {cells.map((day, idx) => {
          if (day == null) return <div key={`blank-${idx}`} />;
          const dateKey = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          const hasTx = txDates.has(dateKey);
          const hasNote = noteDates.has(dateKey);
          const isToday = dateKey === todayKey;
          const isSelected = dateKey === selectedDate;

          return (
            <button
              key={dateKey}
              type="button"
              onClick={() => onSelectDate(isSelected ? null : dateKey)}
              className={cn(
                "flex flex-col items-center gap-0.5 rounded-md py-1 text-xs transition-colors",
                isSelected
                  ? "bg-[var(--color-primary)]/20 text-[var(--color-primary)] ring-1 ring-[var(--color-primary)]/50"
                  : isToday
                    ? "text-[var(--color-primary)]"
                    : "text-[var(--color-foreground)] hover:bg-[var(--color-card-border)]/30",
              )}
            >
              <span>{day}</span>
              <span className="flex h-1.5 items-center gap-0.5">
                {hasTx && (
                  <span className="h-1 w-1 rounded-full bg-[var(--color-positive)]" aria-hidden />
                )}
                {hasNote && (
                  <span className="h-1 w-1 rounded-full bg-[var(--color-accent)]" aria-hidden />
                )}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-2 flex items-center gap-3 text-[10px] text-[var(--color-muted)]">
        <span className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-positive)]" aria-hidden />
          交易
        </span>
        <span className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-accent)]" aria-hidden />
          筆記
        </span>
      </div>
    </div>
  );
}
