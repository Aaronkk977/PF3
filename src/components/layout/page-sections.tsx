"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";

type SectionEntry = { id: string; title: string; navOrder: number };

function sortSections(entries: SectionEntry[]): SectionEntry[] {
  return [...entries].sort((a, b) => {
    if (a.navOrder !== b.navOrder) return a.navOrder - b.navOrder;
    return a.id.localeCompare(b.id);
  });
}

type PageSectionsDispatch = {
  register: (entry: SectionEntry) => void;
  unregister: (id: string) => void;
};

const PageSectionsDispatchContext =
  createContext<PageSectionsDispatch | null>(null);
const PageSectionsStateContext = createContext<SectionEntry[]>([]);

function SectionNav() {
  const sections = sortSections(useContext(PageSectionsStateContext));
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    if (sections.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        const top = visible[0]?.target;
        if (top instanceof HTMLElement) setActiveId(top.id);
      },
      { rootMargin: "-15% 0px -65% 0px", threshold: 0 },
    );

    for (const s of sections) {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [sections]);

  if (sections.length < 2) return null;

  return (
    <nav
      className="sticky top-24 hidden w-40 shrink-0 xl:block"
      aria-label="本頁章節"
    >
      <p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-[var(--color-muted)]">
        本頁導覽
      </p>
      <ul className="space-y-0.5 border-l border-[var(--color-card-border)]/60 pl-3">
        {sections.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              onClick={() =>
                document.getElementById(s.id)?.scrollIntoView({
                  behavior: "smooth",
                  block: "start",
                })
              }
              className={cn(
                "block w-full py-1.5 text-left text-xs leading-snug transition-colors",
                activeId === s.id
                  ? "font-medium text-[var(--color-primary)]"
                  : "text-[var(--color-muted)] hover:text-[var(--color-foreground)]",
              )}
            >
              {s.title}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function PageSectionsProvider({ children }: { children: ReactNode }) {
  const [sections, setSections] = useState<SectionEntry[]>([]);

  const register = useCallback((entry: SectionEntry) => {
    setSections((prev) => {
      const idx = prev.findIndex((s) => s.id === entry.id);
      if (idx >= 0) {
        const cur = prev[idx]!;
        if (cur.title === entry.title && cur.navOrder === entry.navOrder) {
          return prev;
        }
        const next = [...prev];
        next[idx] = entry;
        return sortSections(next);
      }
      return sortSections([...prev, entry]);
    });
  }, []);

  const unregister = useCallback((id: string) => {
    setSections((prev) => {
      if (!prev.some((s) => s.id === id)) return prev;
      return prev.filter((s) => s.id !== id);
    });
  }, []);

  const dispatch = useMemo(
    () => ({ register, unregister }),
    [register, unregister],
  );

  return (
    <PageSectionsDispatchContext.Provider value={dispatch}>
      <PageSectionsStateContext.Provider value={sections}>
        <div className="flex items-start gap-6 lg:gap-8">
          <SectionNav />
          <div className="min-w-0 flex-1">{children}</div>
        </div>
      </PageSectionsStateContext.Provider>
    </PageSectionsDispatchContext.Provider>
  );
}

export function PageSection({
  id,
  title,
  children,
  className,
  navOrder = 100,
}: {
  id: string;
  title: string;
  children: ReactNode;
  className?: string;
  /** 本頁導覽排序（數字越小越靠上） */
  navOrder?: number;
}) {
  const dispatch = useContext(PageSectionsDispatchContext);

  useEffect(() => {
    if (!dispatch) return;
    dispatch.register({ id, title, navOrder });
    return () => dispatch.unregister(id);
  }, [id, title, navOrder, dispatch]);

  return (
    <section id={id} className={cn("scroll-mt-28", className)}>
      {children}
    </section>
  );
}
