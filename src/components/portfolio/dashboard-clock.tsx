"use client";

import { useEffect, useMemo, useState } from "react";
import { getOpenMarkets } from "@/lib/market-session";

const TIME_ZONE = "Asia/Taipei";

function getClockParts(now: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(now);

  const map = Object.fromEntries(
    parts.filter((p) => p.type !== "literal").map((p) => [p.type, p.value]),
  );

  return {
    hour: map.hour ?? "00",
    minute: map.minute ?? "00",
    second: map.second ?? "00",
  };
}

function formatDateLabel(now: Date) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(now);
}

export function DashboardClock() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const { hour, minute, second } = useMemo(() => getClockParts(now), [now]);
  const dateLabel = useMemo(() => formatDateLabel(now), [now]);
  const openMarkets = useMemo(() => getOpenMarkets(now), [now]);

  return (
    <div className="shrink-0 text-left sm:text-right">
      <p
        className="clock-display text-xl text-[var(--color-primary)] glow-text sm:text-2xl"
        aria-live="polite"
        aria-label={`${hour}:${minute}:${second}`}
      >
        {hour}:{minute}:{second}
      </p>
      <div className="mt-0.5 flex flex-wrap items-center justify-start gap-x-2 gap-y-1 sm:justify-end">
        {openMarkets.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {openMarkets.map((market) => (
              <span
                key={market.id}
                className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-positive)]/10 px-2 py-0.5 text-xs font-medium text-[var(--color-positive)] ring-1 ring-[var(--color-positive)]/30"
              >
                <span
                  className="h-1.5 w-1.5 rounded-full bg-[var(--color-positive)] shadow-[0_0_6px_var(--color-positive)]"
                  aria-hidden
                />
                {market.label}
              </span>
            ))}
          </div>
        )}
        <p className="text-xs text-[var(--color-muted)] sm:text-sm">{dateLabel}</p>
      </div>
    </div>
  );
}
