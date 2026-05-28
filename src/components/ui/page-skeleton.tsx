export function PageSkeleton({ title }: { title: string }) {
  return (
    <div className="animate-pulse space-y-8">
      <div>
        <div className="h-8 w-48 rounded bg-[var(--color-card-border)]/50" />
        <div className="mt-2 h-4 w-64 rounded bg-[var(--color-card-border)]/30" />
        <p className="mt-2 text-xs text-[var(--color-muted)]">載入 {title}…</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="h-24 rounded-lg border border-[var(--color-card-border)]/40 bg-[var(--color-card)]"
          />
        ))}
      </div>
      <div className="h-64 rounded-lg border border-[var(--color-card-border)]/40 bg-[var(--color-card)]" />
    </div>
  );
}
