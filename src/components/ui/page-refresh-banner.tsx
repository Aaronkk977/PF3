/** 頁面右下角的更新狀態：更新中顯示轉圈；有給 updatedAt 時，平常顯示一行
 *  淡淡的「更新於 HH:MM:SS」，讓放著自動更新的頁面看得出還在更新。 */
export function PageRefreshBanner({
  refreshing,
  updatedAt,
}: {
  refreshing: boolean;
  updatedAt?: number | null;
}) {
  if (!refreshing) {
    if (updatedAt == null) return null;
    return (
      <div
        className="pointer-events-none fixed bottom-5 right-5 z-50 text-[10px] tabular-nums text-[var(--color-muted)]/70"
        role="status"
      >
        更新於 {new Date(updatedAt).toLocaleTimeString("zh-TW", { hour12: false })}
      </div>
    );
  }
  return (
    <div
      className="fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-md border border-[var(--color-card-border)]/60 bg-[var(--color-card)]/90 px-3 py-2 text-xs text-[var(--color-muted)] shadow-md backdrop-blur-sm"
      role="status"
    >
      <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-[var(--color-primary)] border-t-transparent" />
      背景更新資料中…
    </div>
  );
}
