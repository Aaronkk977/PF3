export function PageRefreshBanner({ refreshing }: { refreshing: boolean }) {
  if (!refreshing) return null;
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
