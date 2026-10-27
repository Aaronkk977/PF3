"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Columns2, Eye, Pencil } from "lucide-react";
import { MarkdownPreview } from "@/components/ui/markdown-preview";
import { writeSetting } from "@/lib/persisted-settings";
import { cn } from "@/lib/utils";

type EditorMode = "edit" | "split" | "preview";

const MODES: { value: EditorMode; label: string; icon: typeof Pencil }[] = [
  { value: "edit", label: "純編輯", icon: Pencil },
  { value: "split", label: "同步顯示", icon: Columns2 },
  { value: "preview", label: "預覽", icon: Eye },
];

const MODE_STORAGE_KEY = "notes-editor-mode";

/** 讀取使用者上次切換到的檢視模式；讀不到（第一次使用／非瀏覽器環境）就預設同步顯示 */
function readStoredMode(): EditorMode {
  if (typeof window === "undefined") return "split";
  const stored = window.localStorage.getItem(MODE_STORAGE_KEY);
  return stored === "edit" || stored === "split" || stored === "preview" ? stored : "split";
}

/** 開頭數字清單，例如「1. 」或「2) 」（結尾一定要有空白，符合 CommonMark 規則） */
const ORDERED_LIST_RE = /^(\s*)(\d+)([.)])(\s+)/;
/** 開頭項目清單，例如「- 」「* 」「+ 」，選擇性帶 GFM 勾選框「- [ ] 」 */
const UNORDERED_LIST_RE = /^(\s*)([-*+])(\s+)(\[[ xX]\]\s+)?/;

/** 從某個元素往上找最近「真的在捲動」的祖先容器（overflow-y 是 auto/scroll 且內容確實溢出） */
function findScrollableAncestor(el: HTMLElement): HTMLElement | null {
  let node = el.parentElement;
  while (node) {
    const overflowY = getComputedStyle(node).overflowY;
    if (/(auto|scroll)/.test(overflowY) && node.scrollHeight > node.clientHeight) return node;
    node = node.parentElement;
  }
  return null;
}

/** 游標在最後面時（連續打字／換行）才自動跟著往下捲，避免編輯文件中段時被強制跳走 */
function followCaretScroll(ta: HTMLTextAreaElement) {
  if (ta.selectionStart !== ta.value.length) return;
  const ancestor = findScrollableAncestor(ta);
  if (!ancestor) return;
  const overflow = ta.getBoundingClientRect().bottom - ancestor.getBoundingClientRect().bottom;
  if (overflow > 0) ancestor.scrollTop += overflow + 16;
}

export function MarkdownNotesEditor({
  value,
  onChange,
  placeholder = "支援 Markdown：標題、清單、連結、程式碼區塊…",
  minHeight = "14rem",
  isNewNote = false,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  minHeight?: string;
  /** 新建立的筆記固定從「同步顯示」開始，不套用使用者之前切換過的模式 */
  isNewNote?: boolean;
}) {
  const [mode, setModeState] = useState<EditorMode>(() => (isNewNote ? "split" : readStoredMode()));
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const pendingCursorRef = useRef<number | null>(null);

  // 新筆記固定同步顯示；切到既有筆記則套用使用者上次切換到的模式，並記住之後
  // 手動切換的結果（同一個編輯器元件在新增/編輯筆記間切換時不會整個重新掛載，
  // 所以要靠這個 effect 而非 useState 初始值來反映 isNewNote 的變化）。
  useEffect(() => {
    setModeState(isNewNote ? "split" : readStoredMode());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNewNote]);

  function setMode(next: EditorMode) {
    setModeState(next);
    writeSetting(MODE_STORAGE_KEY, next);
  }

  // 同步顯示模式下，編輯框跟預覽框的高度要一致（取兩者實際內容較高的那個），
  // 不然打字量不同時兩個框會長短不一，很醜。單框模式（純編輯／預覽）則各自
  // 依內容自然長高即可，不需要同步。
  useEffect(() => {
    const ta = textareaRef.current;
    const preview = previewRef.current;

    function measureAndSync() {
      let target = 0;
      if (ta) {
        ta.style.height = "auto";
        target = Math.max(target, ta.scrollHeight);
      }
      if (preview) {
        preview.style.height = "auto";
        target = Math.max(target, preview.scrollHeight);
      }
      if (ta) ta.style.height = `${target}px`;
      if (preview) preview.style.height = `${target}px`;
      if (ta) followCaretScroll(ta);
    }

    measureAndSync();

    // 抽屜寬度可拖曳調整時換行寬度跟著變，兩個框都要重新量測避免高度對不上
    const observers = [ta, preview]
      .filter((el): el is HTMLTextAreaElement | HTMLDivElement => el != null)
      .map((el) => {
        const observer = new ResizeObserver(measureAndSync);
        observer.observe(el);
        return observer;
      });
    return () => observers.forEach((o) => o.disconnect());
  }, [value, mode]);

  // Enter 換行後游標位置：用 useEffect 等 value 真的更新到 DOM 後再校正，
  // 比 requestAnimationFrame 準（不會受渲染排程時機影響）。
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta || pendingCursorRef.current == null) return;
    ta.setSelectionRange(pendingCursorRef.current, pendingCursorRef.current);
    pendingCursorRef.current = null;
  }, [value]);

  /** 清單裡按 Enter：自動接續下一個項目符號／遞增數字；空白項目按 Enter 則跳出清單 */
  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== "Enter" || e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return;
    const ta = e.currentTarget;
    const { selectionStart, selectionEnd } = ta;
    if (selectionStart !== selectionEnd) return;

    const lineStart = value.lastIndexOf("\n", selectionStart - 1) + 1;
    const currentLine = value.slice(lineStart, selectionStart);

    const orderedMatch = currentLine.match(ORDERED_LIST_RE);
    const unorderedMatch = !orderedMatch ? currentLine.match(UNORDERED_LIST_RE) : null;
    if (!orderedMatch && !unorderedMatch) return;

    const match = (orderedMatch ?? unorderedMatch)!;
    const marker = match[0];
    const indent = match[1];
    const isEmptyItem = currentLine.trim() === marker.trim();

    e.preventDefault();

    if (isEmptyItem) {
      const next = value.slice(0, lineStart) + value.slice(selectionStart);
      pendingCursorRef.current = lineStart;
      onChange(next);
      return;
    }

    const nextPrefix = orderedMatch
      ? `${indent}${Number(orderedMatch[2]) + 1}${orderedMatch[3]}${orderedMatch[4]}`
      : `${indent}${unorderedMatch![2]}${unorderedMatch![3]}${unorderedMatch![4] ? "[ ] " : ""}`;

    const insertion = `\n${nextPrefix}`;
    const next = value.slice(0, selectionStart) + insertion + value.slice(selectionEnd);
    pendingCursorRef.current = selectionStart + insertion.length;
    onChange(next);
  }

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-end gap-1">
        {MODES.map(({ value: m, label, icon: Icon }) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            aria-label={label}
            title={label}
            className={cn(
              "flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors",
              mode === m
                ? "bg-[var(--color-primary)]/15 text-[var(--color-primary)]"
                : "text-[var(--color-muted)] hover:bg-[var(--color-card-border)]/40 hover:text-[var(--color-primary)]",
            )}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden />
            {label}
          </button>
        ))}
      </div>
      <div className={cn("grid items-start gap-4", mode === "split" && "lg:grid-cols-2")}>
        {mode !== "preview" && (
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            spellCheck
            className={cn(
              "w-full resize-none overflow-hidden rounded-md border border-[var(--color-card-border)] bg-[var(--color-background)] px-3 py-2 text-sm text-[var(--color-foreground)]",
              "placeholder:text-[var(--color-muted)] focus:border-[var(--color-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]",
            )}
            style={{ minHeight }}
          />
        )}
        {mode !== "edit" && (
          <div
            ref={previewRef}
            className="rounded-md border border-[var(--color-card-border)]/80 bg-[color-mix(in_srgb,var(--color-background)_60%,var(--color-card))] px-3 py-2"
            style={{ minHeight }}
          >
            <MarkdownPreview content={value} />
          </div>
        )}
      </div>
    </div>
  );
}
