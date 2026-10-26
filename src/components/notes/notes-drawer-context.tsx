"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import type { PickableInstrument } from "@/components/notes/note-instrument-picker";

type NotesDrawerContextValue = {
  isOpen: boolean;
  /** 開啟時若帶 id，抽屜會直接跳進該筆記的編輯畫面 */
  pendingNoteId: string | null;
  /** 開啟時若帶標的，抽屜會直接開新筆記畫面，並預先掛上這個相關標的 */
  pendingNewNoteInstrument: PickableInstrument | null;
  open: (noteId?: string) => void;
  openNewNoteFor: (instrument: PickableInstrument) => void;
  close: () => void;
  toggle: () => void;
  /** 抽屜已讀取 pendingNoteId 並完成導向後呼叫，避免重複觸發 */
  consumePendingNoteId: () => void;
  /** 抽屜已讀取 pendingNewNoteInstrument 並完成導向後呼叫，避免重複觸發 */
  consumePendingNewNoteInstrument: () => void;
};

const NotesDrawerContext = createContext<NotesDrawerContextValue | null>(null);

export function NotesDrawerProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [pendingNoteId, setPendingNoteId] = useState<string | null>(null);
  const [pendingNewNoteInstrument, setPendingNewNoteInstrument] =
    useState<PickableInstrument | null>(null);

  const open = useCallback((noteId?: string) => {
    setIsOpen(true);
    if (noteId) setPendingNoteId(noteId);
  }, []);

  const openNewNoteFor = useCallback((instrument: PickableInstrument) => {
    setIsOpen(true);
    setPendingNewNoteInstrument(instrument);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
    setPendingNoteId(null);
    setPendingNewNoteInstrument(null);
  }, []);

  const toggle = useCallback(() => {
    setIsOpen((v) => {
      if (v) {
        setPendingNoteId(null);
        setPendingNewNoteInstrument(null);
      }
      return !v;
    });
  }, []);

  const consumePendingNoteId = useCallback(() => {
    setPendingNoteId(null);
  }, []);

  const consumePendingNewNoteInstrument = useCallback(() => {
    setPendingNewNoteInstrument(null);
  }, []);

  return (
    <NotesDrawerContext.Provider
      value={{
        isOpen,
        pendingNoteId,
        pendingNewNoteInstrument,
        open,
        openNewNoteFor,
        close,
        toggle,
        consumePendingNoteId,
        consumePendingNewNoteInstrument,
      }}
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
