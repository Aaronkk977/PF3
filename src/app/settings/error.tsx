"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function SettingsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto max-w-lg space-y-4 py-16 text-center">
      <h1 className="font-mono text-xl text-[var(--color-primary)]">
        Settings 載入失敗
      </h1>
      <p className="text-sm text-[var(--color-muted)]">
        多半是開發模式熱更新中斷，或本機儲存的設定資料損壞。請重新整理；若仍失敗，可清除瀏覽器本站的
        localStorage 後再試。
      </p>
      <div className="flex justify-center gap-2">
        <Button type="button" onClick={() => reset()}>
          重試
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => window.location.reload()}
        >
          重新整理
        </Button>
      </div>
    </div>
  );
}
