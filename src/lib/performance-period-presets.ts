import { normalizePeriodRange, toLocalDateKey } from "@/lib/date-keys";

export type PeriodPresetUnit =
  | "days"
  | "weeks"
  | "months"
  | "years"
  | "mtd"
  | "ytd"
  | "all";

export type PerformancePeriodPreset = {
  id: string;
  label: string;
  unit: PeriodPresetUnit;
  /** days / weeks / months / years 時必填 */
  amount?: number;
  /** 內建預設，不可刪除 */
  builtin?: boolean;
};

export const DEFAULT_PERIOD_PRESETS: PerformancePeriodPreset[] = [
  { id: "builtin-1w", label: "1 週", unit: "weeks", amount: 1, builtin: true },
  { id: "builtin-1m", label: "1 月", unit: "months", amount: 1, builtin: true },
  { id: "builtin-3m", label: "3 月", unit: "months", amount: 3, builtin: true },
  { id: "builtin-6m", label: "6 月", unit: "months", amount: 6, builtin: true },
  { id: "builtin-1y", label: "1 年", unit: "years", amount: 1, builtin: true },
  { id: "builtin-ytd", label: "今年", unit: "ytd", builtin: true },
  { id: "builtin-mtd", label: "MTD", unit: "mtd", builtin: true },
  { id: "builtin-all", label: "全部", unit: "all", builtin: true },
];

export const PERIOD_PRESET_UNIT_LABELS: Record<
  Exclude<PeriodPresetUnit, "mtd" | "ytd" | "all">,
  string
> = {
  days: "天",
  weeks: "週",
  months: "月",
  years: "年",
};

export function createCustomPeriodPreset(
  label: string,
  unit: Exclude<PeriodPresetUnit, "mtd" | "ytd" | "all">,
  amount: number,
): PerformancePeriodPreset {
  const id = `custom-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  return { id, label: label.trim() || formatPresetLabel(unit, amount), unit, amount };
}

export function formatPresetLabel(
  unit: Exclude<PeriodPresetUnit, "mtd" | "ytd" | "all">,
  amount: number,
): string {
  return `過去 ${amount} ${PERIOD_PRESET_UNIT_LABELS[unit]}`;
}

export function mergePeriodPresets(
  custom: PerformancePeriodPreset[] | undefined,
): PerformancePeriodPreset[] {
  const builtins = DEFAULT_PERIOD_PRESETS;
  const extra = (custom ?? []).filter((p) => !p.builtin && p.id && p.label);
  return [...builtins, ...extra];
}

export function applyPeriodPreset(
  preset: PerformancePeriodPreset,
  options: {
    end?: Date;
    portfolioEarliest?: string;
  } = {},
): { start: string; end: string } {
  const endDate = options.end ?? new Date();
  const end = toLocalDateKey(endDate);
  let startDate: Date;

  switch (preset.unit) {
    case "mtd":
      startDate = new Date(endDate.getFullYear(), endDate.getMonth(), 1);
      break;
    case "ytd":
      startDate = new Date(endDate.getFullYear(), 0, 1);
      break;
    case "all": {
      const earliest = options.portfolioEarliest;
      startDate = earliest ? new Date(`${earliest}T12:00:00`) : new Date(endDate);
      if (!earliest) {
        startDate.setFullYear(startDate.getFullYear() - 10);
      }
      break;
    }
    case "days":
      startDate = new Date(endDate);
      startDate.setDate(startDate.getDate() - (preset.amount ?? 1));
      break;
    case "weeks":
      startDate = new Date(endDate);
      startDate.setDate(startDate.getDate() - (preset.amount ?? 1) * 7);
      break;
    case "months":
      startDate = new Date(endDate);
      startDate.setMonth(startDate.getMonth() - (preset.amount ?? 1));
      break;
    case "years":
      startDate = new Date(endDate);
      startDate.setFullYear(startDate.getFullYear() - (preset.amount ?? 1));
      break;
    default:
      startDate = new Date(endDate);
      startDate.setFullYear(startDate.getFullYear() - 1);
  }

  return { start: toLocalDateKey(startDate), end };
}

export function presetMatchesRange(
  preset: PerformancePeriodPreset,
  start: string,
  end: string,
  portfolioEarliest?: string,
): boolean {
  const applied = applyPeriodPreset(preset, {
    end: new Date(`${end}T12:00:00`),
    portfolioEarliest,
  });
  return applied.start === start && applied.end === end;
}

/** 存下來的期間若結束日已過：屬於某個預設（或對得上某個預設）就以今天重新
 *  套用該預設，否則只把結束日延到今天。 */
export function syncPeriodEndToToday(
  rangeStart: string,
  rangeEnd: string,
  presetId: string | null,
  customPresets: PerformancePeriodPreset[],
  portfolioEarliest?: string,
): { start: string; end: string; presetId: string | null } {
  const today = toLocalDateKey(new Date());
  if (rangeEnd >= today) {
    return { start: rangeStart, end: rangeEnd, presetId };
  }
  const presets = mergePeriodPresets(customPresets);
  const preset =
    (presetId ? presets.find((p) => p.id === presetId) : null) ??
    presets.find((p) =>
      presetMatchesRange(p, rangeStart, rangeEnd, portfolioEarliest),
    );
  if (preset) {
    const applied = applyPeriodPreset(preset, {
      end: new Date(),
      portfolioEarliest,
    });
    return { start: applied.start, end: applied.end, presetId: preset.id };
  }
  const normalized = normalizePeriodRange(rangeStart, today);
  return { start: normalized.start, end: normalized.end, presetId: null };
}

export function normalizeCustomPresets(
  raw: unknown,
): PerformancePeriodPreset[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (p): p is PerformancePeriodPreset =>
        !!p &&
        typeof p === "object" &&
        typeof (p as PerformancePeriodPreset).id === "string" &&
        typeof (p as PerformancePeriodPreset).label === "string" &&
        typeof (p as PerformancePeriodPreset).unit === "string" &&
        !(p as PerformancePeriodPreset).builtin,
    )
    .map((p) => ({
      id: p.id,
      label: p.label,
      unit: p.unit,
      amount: typeof p.amount === "number" ? p.amount : undefined,
    }));
}
