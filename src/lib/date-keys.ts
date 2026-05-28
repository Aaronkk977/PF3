/** 確保 start ≤ end（YYYY-MM-DD） */
export function normalizePeriodRange(start: string, end: string): {
  start: string;
  end: string;
  swapped: boolean;
} {
  if (!start || !end || start <= end) {
    return { start, end, swapped: false };
  }
  return { start: end, end: start, swapped: true };
}

export function normalizePeriodDates(
  periodStart: Date,
  periodEnd: Date,
): { periodStart: Date; periodEnd: Date; swapped: boolean } {
  if (periodStart.getTime() <= periodEnd.getTime()) {
    return { periodStart, periodEnd, swapped: false };
  }
  return { periodStart: periodEnd, periodEnd: periodStart, swapped: true };
}

/** 以本地日曆比較，避免 API 用 T12:00 導致期初當天交易被排除 */
export function isTransactionInPeriod(
  txDate: Date,
  periodStartKey: string,
  periodEndKey: string,
): boolean {
  const key = toLocalDateKey(txDate);
  return key >= periodStartKey && key <= periodEndKey;
}

/**
 * 將 CSV／表單的日曆日期存成 UTC 正午，避免「本地 0 點 → DB UTC → 顯示少一天」。
 * 支援 `2026-05-04`、`2026-05-04 00:00:00` 等格式。
 */
export function parseCalendarDate(value: string): Date {
  const trimmed = value.trim();
  const m = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) {
    const d = new Date(trimmed);
    if (Number.isNaN(d.getTime())) {
      throw new Error(`無效日期: ${value}`);
    }
    return new Date(
      Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12, 0, 0, 0),
    );
  }
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const day = Number(m[3]);
  return new Date(Date.UTC(y, mo, day, 12, 0, 0, 0));
}

/** 自 DB 讀出的 Date 還原為日曆 YYYY-MM-DD（與 parseCalendarDate 配對） */
export function toCalendarDateKey(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** 舊匯入：台灣本地 0 點被存成前一日 16:00 UTC */
export function isLegacyLocalMidnightUtc(d: Date): boolean {
  return (
    d.getUTCHours() === 16 &&
    d.getUTCMinutes() === 0 &&
    d.getUTCSeconds() === 0 &&
    d.getUTCMilliseconds() === 0
  );
}

/** 將舊的本地午夜 UTC 瞬間修正為日曆日 UTC 正午 */
export function normalizeStoredTransactionDate(d: Date): Date {
  if (isLegacyLocalMidnightUtc(d)) {
    return new Date(
      Date.UTC(
        d.getUTCFullYear(),
        d.getUTCMonth(),
        d.getUTCDate() + 1,
        12,
        0,
        0,
        0,
      ),
    );
  }
  return parseCalendarDate(toCalendarDateKey(d));
}

/** 交易列表／篩選用：統一為 YYYY-MM-DD（避免 ISO 字串比較把當日交易濾掉） */
export function toTransactionDateKey(date: string | Date): string {
  if (date instanceof Date) return toCalendarDateKey(normalizeStoredTransactionDate(date));
  const s = date.trim();
  if (s.length >= 10 && /^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return toCalendarDateKey(parseCalendarDate(s));
}

/** 本地日曆 YYYY-MM-DD */
export function toLocalDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** 本地日曆 YYYY-MM */
export function toLocalMonthKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/** 抓歷史收盤價時往前多取的曆日數，供月初／假日前向填充 */
export const PRICE_HISTORY_LOOKBACK_DAYS = 21;

/** 績效區間起日再往前推若干天，以便假日與 MTD 期初能沿用最近交易日收盤價 */
export function periodStartWithPriceLookback(periodStart: Date): Date {
  const d = new Date(periodStart);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - PRICE_HISTORY_LOOKBACK_DAYS);
  return d;
}
