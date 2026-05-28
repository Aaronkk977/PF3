import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn, formatCurrency, formatPercent } from "@/lib/utils";

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
}) {
  const display = isPercent
    ? formatPercent(value)
    : isCurrency
      ? formatCurrency(value, currency)
      : value.toLocaleString("zh-TW");

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
