"use client";

import { useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn, formatCurrency, formatPercent } from "@/lib/utils";

function useAnimatedNumber(target: number, duration = 500): number {
  const [displayed, setDisplayed] = useState(target);
  const prevRef = useRef(target);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const start = prevRef.current;
    if (start === target) return;

    const startTime = performance.now();
    const tick = (now: number) => {
      const t = Math.min((now - startTime) / duration, 1);
      // easeOutCubic
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplayed(start + (target - start) * eased);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        setDisplayed(target);
        prevRef.current = target;
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [target, duration]);

  return displayed;
}

export function StatCard({
  title,
  value,
  subtitle,
  isPercent,
  isCurrency,
  currency = "TWD",
  positive,
  invertDisplay,
  neutral,
  animated = false,
}: {
  title: string;
  value: number;
  subtitle?: string;
  isPercent?: boolean;
  isCurrency?: boolean;
  currency?: string;
  positive?: boolean;
  /** 主標大字顯示 subtitle（如 %），副標小字顯示 value（如金額） */
  invertDisplay?: boolean;
  /** 數值一律用前景色，不顯示紅綠 */
  neutral?: boolean;
  /** 數值變化時動畫過渡 */
  animated?: boolean;
}) {
  const animatedValue = useAnimatedNumber(value);
  const displayValue = animated ? animatedValue : value;

  const display = isPercent
    ? formatPercent(displayValue)
    : isCurrency
      ? formatCurrency(displayValue, currency)
      : displayValue.toLocaleString("zh-TW");

  const primaryText = invertDisplay ? subtitle : display;
  const secondaryText = invertDisplay ? display : subtitle;

  const toneClass = neutral
    ? null
    : positive === true
      ? "positive"
      : positive === false
        ? "negative"
        : null;

  return (
    <Card className="h-full min-w-0">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p
          className={cn(
            "tabular-nums text-left break-all text-xl font-semibold sm:text-2xl",
            toneClass ?? "text-[var(--color-foreground)]",
          )}
        >
          {primaryText ?? display}
        </p>
        {secondaryText && (
          <p
            className={cn(
              "mt-1 tabular-nums text-xs",
              toneClass ?? "text-[var(--color-muted)]",
            )}
          >
            {secondaryText}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
