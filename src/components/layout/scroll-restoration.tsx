"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

const STORAGE_KEY = "pp-scroll";

function saveScroll(path: string, y: number): void {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    const map: Record<string, number> = raw ? (JSON.parse(raw) as Record<string, number>) : {};
    map[path] = y;
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // sessionStorage unavailable (private mode, quota)
  }
}

function loadScroll(path: string): number {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return 0;
    const map = JSON.parse(raw) as Record<string, number>;
    return map[path] ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Saves the scroll position for each pathname to sessionStorage on scroll,
 * and restores it whenever the pathname changes.
 *
 * Place this once inside AppShell so it runs app-wide.
 */
export function ScrollRestoration() {
  const pathname = usePathname();
  // Track whether this is the very first render (app cold-start)
  const firstMount = useRef(true);
  // Keep a ref so the scroll handler always uses the latest pathname
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;

  // ── Save: persist scroll position while the user scrolls ──────────────
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;

    function onScroll() {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        saveScroll(pathnameRef.current, window.scrollY);
      }, 80);
    }

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      if (timer !== null) clearTimeout(timer);
      window.removeEventListener("scroll", onScroll);
    };
  }, []); // attach once for the lifetime of the app

  // ── Restore: scroll to saved position when pathname changes ───────────
  useEffect(() => {
    // Skip on the very first render so the browser's own startup position
    // (e.g. deep-linked anchor) is respected.
    if (firstMount.current) {
      firstMount.current = false;
      return;
    }

    const saved = loadScroll(pathname);

    // Use a short timeout so the page content (especially client-cached
    // pages that render synchronously) has been committed to the DOM
    // before we try to scroll.
    const id = setTimeout(() => {
      window.scrollTo({ top: saved, behavior: "instant" });
    }, 30);

    return () => clearTimeout(id);
  }, [pathname]);

  return null;
}
