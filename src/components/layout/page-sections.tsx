"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
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
  const { position, select } = useSectionScrollPosition(sections);

  if (sections.length < 2) return null;

  return (
    <SectionNavList sections={sections} position={position} onSelect={select} />
  );
}

/** 目前章節的索引，以及從這個章節捲向下一個章節的進度（0～1） */
type SectionScrollPosition = { index: number; fraction: number };

/** 允許的捲動誤差：smooth scroll 停下來時常差個零點幾 px */
const SCROLL_EPSILON = 2;

/**
 * 把各章節的原始錨點（遞增、可能超出可捲範圍）整理成可用的錨點。
 * 頁面捲不到的章節（底部較短的、或與上一個並排同高的）會擠在同一個值，
 * 只有最後一個輪得到；這裡把擠在一起的錨點平均攤開，讓每個章節都有一段捲動範圍：
 * - 擠在最底的一串：攤在上一個錨點到最底之間，最後一個貼齊最底
 * - 中途並排同高的一串：攤在這個位置到下一個錨點之間
 */
function spreadAnchors(raw: number[], max: number): number[] {
  const out = raw.map((v) => Math.min(max, Math.max(0, v)));
  for (let i = 1; i < out.length; i++) out[i] = Math.max(out[i]!, out[i - 1]!);

  let j = 0;
  while (j < out.length) {
    let k = j;
    while (k + 1 < out.length && out[k + 1] === out[j]) k++;
    const count = k - j + 1;
    if (count > 1) {
      const v = out[j]!;
      if (k === out.length - 1) {
        const lo = j > 0 ? out[j - 1]! : 0;
        for (let t = 0; t < count; t++) {
          out[j + t] =
            j > 0
              ? lo + ((v - lo) * (t + 1)) / count
              : (v * t) / (count - 1);
        }
      } else {
        const hi = out[k + 1]!;
        for (let t = 0; t < count; t++) {
          out[j + t] = v + ((hi - v) * t) / count;
        }
      }
    }
    j = k + 1;
  }
  return out;
}

/**
 * 依各章節實際位置換算捲動位置。
 * 每個章節的「錨點」是點導覽跳過去時的 scrollY（章節頂端貼齊 scroll-margin），
 * 超過錨點就算目前章節，錨點之間線性內插（見 spreadAnchors）。
 * 點了導覽卻因頁面捲不到而停在別的章節範圍時，以點的那個為準，直到使用者自己捲動。
 */
function useSectionScrollPosition(sections: SectionEntry[]): {
  position: SectionScrollPosition;
  select: (id: string) => void;
} {
  const [position, setPosition] = useState<SectionScrollPosition>({
    index: 0,
    fraction: 0,
  });
  const idsKey = sections.map((s) => s.id).join("|");
  const pinnedRef = useRef<string | null>(null);
  /** 點選時目標在下方（往下捲） */
  const pinnedDownRef = useRef(false);
  const scheduleRef = useRef<() => void>(() => {});

  useEffect(() => {
    const ids = idsKey ? idsKey.split("|") : [];
    let frame = 0;
    const update = () => {
      frame = 0;
      const max = Math.max(
        0,
        document.documentElement.scrollHeight - window.innerHeight,
      );
      const y = window.scrollY;

      const present: string[] = [];
      const raw: number[] = [];
      for (const id of ids) {
        const el = document.getElementById(id);
        if (!el) continue;
        const margin = parseFloat(getComputedStyle(el).scrollMarginTop) || 0;
        present.push(id);
        raw.push(el.getBoundingClientRect().top + y - margin);
      }
      if (raw.length === 0) return;

      let index = 0;
      let fraction = 0;
      const pinned = pinnedRef.current
        ? present.indexOf(pinnedRef.current)
        : -1;
      const pinnedTarget =
        pinned >= 0 ? Math.min(max, Math.max(0, raw[pinned]!)) : null;

      if (
        pinned >= 0 &&
        pinnedTarget != null &&
        Math.abs(y - pinnedTarget) <= SCROLL_EPSILON
      ) {
        index = pinned;
      } else if (max > 0) {
        const anchors = spreadAnchors(raw, max);
        for (let i = 0; i < anchors.length; i++) {
          if (y + SCROLL_EPSILON >= anchors[i]!) index = i;
        }
        const from = anchors[index]!;
        const to = anchors[index + 1];
        if (to != null && to > from) {
          fraction = Math.min(1, Math.max(0, (y - from) / (to - from)));
        }
        // 點選後 smooth scroll 途中：目標被壓在最底時會先經過後面章節的範圍，
        // 不讓圓點超過點的那一項，免得先衝到底再彈回來
        if (pinned >= 0 && pinnedDownRef.current && index >= pinned) {
          index = pinned;
          fraction = 0;
        }
      }

      // present 只含目前在 DOM 裡的章節；換回 sections 的索引
      index = Math.max(0, ids.indexOf(present[index]!));
      setPosition((prev) =>
        prev.index === index && prev.fraction === fraction
          ? prev
          : { index, fraction },
      );
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    const unpin = () => {
      if (!pinnedRef.current) return;
      pinnedRef.current = null;
      schedule();
    };
    scheduleRef.current = schedule;
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    // 使用者自己捲動（滾輪、觸控、鍵盤）就取消「點選優先」
    window.addEventListener("wheel", unpin, { passive: true });
    window.addEventListener("touchstart", unpin, { passive: true });
    window.addEventListener("keydown", unpin);
    const ro = new ResizeObserver(schedule);
    ro.observe(document.body);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("wheel", unpin);
      window.removeEventListener("touchstart", unpin);
      window.removeEventListener("keydown", unpin);
      ro.disconnect();
    };
  }, [idsKey]);

  const select = useCallback((id: string) => {
    pinnedRef.current = id;
    const el = document.getElementById(id);
    if (el) {
      const margin = parseFloat(getComputedStyle(el).scrollMarginTop) || 0;
      pinnedDownRef.current = el.getBoundingClientRect().top - margin > 0;
    }
    el?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
    // 已經在目標位置（頁面捲不動）時不會有 scroll 事件，手動更新一次
    scheduleRef.current();
  }, []);

  return { position, select };
}

function SectionNavList({
  sections,
  position,
  onSelect,
}: {
  sections: SectionEntry[];
  position: SectionScrollPosition;
  onSelect: (id: string) => void;
}) {
  const listRef = useRef<HTMLUListElement>(null);
  /** 各導覽項目中心相對於直線頂端的 px 位置 */
  const [itemCenters, setItemCenters] = useState<number[]>([]);
  const idsKey = sections.map((s) => s.id).join("|");

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const measure = () => {
      const centers = [
        ...list.querySelectorAll<HTMLElement>("[data-nav-item]"),
      ].map((el) => el.offsetTop + el.offsetHeight / 2);
      setItemCenters((prev) =>
        prev.length === centers.length && prev.every((v, i) => v === centers[i])
          ? prev
          : centers,
      );
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(list);
    return () => ro.disconnect();
  }, [idsKey]);

  const activeId = sections[position.index]?.id ?? null;
  const fromY = itemCenters[position.index];
  const toY = itemCenters[position.index + 1] ?? fromY;
  const dotTop =
    fromY != null && toY != null
      ? fromY + position.fraction * (toY - fromY)
      : null;

  return (
    <nav
      className="sticky top-24 hidden w-40 shrink-0 xl:block"
      aria-label="本頁章節"
    >
      <p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-[var(--color-muted)]">
        本頁導覽
      </p>
      <ul
        ref={listRef}
        className="relative space-y-0.5 border-l border-[var(--color-card-border)]/60 pl-3"
      >
        {/* 取代頁面捲軸的進度指示：停在目前章節旁，捲動時滑向下一個章節；僅供顯示 */}
        {dotTop != null && (
          <li
            aria-hidden
            className="pointer-events-none absolute inset-y-0 -left-px w-0"
          >
            <span
              className="absolute left-0 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--color-primary)] shadow-[0_0_4px_var(--color-primary)] transition-[top] duration-150 ease-out"
              style={{ top: dotTop }}
            />
          </li>
        )}
        {sections.map((s) => (
          <li key={s.id} data-nav-item>
            <button
              type="button"
              onClick={() => onSelect(s.id)}
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
