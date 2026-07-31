"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

type NotesDrawerContextValue = {
  isOpen: boolean;
  /** 開啟時若帶 id，抽屜會直接跳進該筆記的編輯畫面 */
  pendingNoteId: string | null;
  open: (noteId?: string) => void;
  close: () => void;
  toggle: () => void;
  /** 抽屜已讀取 pendingNoteId 並完成導向後呼叫，避免重複觸發 */
  consumePendingNoteId: () => void;
};

const NotesDrawerContext = createContext<NotesDrawerContextValue | null>(null);

export function NotesDrawerProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [pendingNoteId, setPendingNoteId] = useState<string | null>(null);

  const open = useCallback((noteId?: string) => {
    setIsOpen(true);
    if (noteId) setPendingNoteId(noteId);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
    setPendingNoteId(null);
  }, []);

  const toggle = useCallback(() => {
    setIsOpen((v) => {
      if (v) setPendingNoteId(null);
      return !v;
    });
  }, []);

  const consumePendingNoteId = useCallback(() => {
    setPendingNoteId(null);
  }, []);

  return (
    <NotesDrawerContext.Provider
      value={{ isOpen, pendingNoteId, open, close, toggle, consumePendingNoteId }}
    >
      {children}
    </NotesDrawerContext.Provider>
  );
}

export function useNotesDrawer() {
  const ctx = useContext(NotesDrawerContext);
  if (!ctx) throw new Error("useNotesDrawer must be used within NotesDrawerProvider");
  return ctx;
}
