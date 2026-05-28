import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <h1 className="font-mono text-4xl text-[var(--color-primary)]">404</h1>
      <p className="mt-2 text-[var(--color-muted)]">找不到此頁面或標的</p>
      <Link href="/" className="mt-6">
        <Button>返回 Dashboard</Button>
      </Link>
    </div>
  );
}
