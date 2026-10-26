"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Copy, Plus, Save, TextCursorInput, Trash2, X } from "lucide-react";
import { Drawer } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MarkdownNotesEditor } from "@/components/ui/markdown-notes-editor";
import { Badge } from "@/components/ui/badge";
import { NotesCalendar } from "@/components/notes/notes-calendar";
import {
  NoteInstrumentPicker,
  type PickableInstrument,
} from "@/components/notes/note-instrument-picker";
import { NoteTagPicker } from "@/components/notes/note-tag-picker";
import { useNotesDrawer } from "@/components/notes/notes-drawer-context";
import { toLocalDateKey } from "@/lib/date-keys";
import {
  PAGE_CACHE_KEYS,
  clearClientCache,
  readClientCache,
  writeClientCache,
} from "@/lib/client-data-cache";

type NoteJson = {
  id: string;
  title: string;
  content: string;
  kind: string;
  noteDate: string;
  instruments: PickableInstrument[];
  tags: string[];
  createdAt: string;
  updatedAt: string;
};

type NoteKindOption = { id: string; name: string };

type AutosaveStatus = "idle" | "pending" | "saving" | "saved" | "error";

type FormState = {
  title: string;
  content: string;
  kind: string;
  noteDate: string;
  instruments: PickableInstrument[];
  tags: string[];
};

function emptyForm(defaultKind: string): FormState {
  return {
    title: "",
    content: "",
    kind: defaultKind,
    noteDate: toLocalDateKey(new Date()),
    instruments: [],
    tags: [],
  };
}

function toForm(note: NoteJson): FormState {
  return {
    title: note.title,
    content: note.content,
    kind: note.kind,
    noteDate: note.noteDate,
    instruments: note.instruments,
    tags: note.tags,
  };
}

/** 複製筆記的檔名邏輯：仿檔案總管，「筆記」→「筆記 (1)」，若已存在就往上找到
 *  沒被佔用的號碼。就算複製的來源本身就是「筆記 (1)」，也會先剝掉尾巴的
 *  「(N)」拿回原始標題當 base，才不會疊成「筆記 (1) (1)」。 */
function nextDuplicateTitle(sourceTitle: string, existingTitles: Set<string>): string {
  const match = sourceTitle.match(/^(.*) \((\d+)\)$/);
  const base = match ? match[1] : sourceTitle;
  let n = 1;
  while (existingTitles.has(`${base} (${n})`)) n++;
  return `${base} (${n})`;
}

export function NotesDrawer() {
  const {
    isOpen,
    pendingNoteId,
    pendingNewNoteInstrument,
    close,
    consumePendingNoteId,
    consumePendingNewNoteInstrument,
  } = useNotesDrawer();

  const [notes, setNotes] = useState<NoteJson[]>(
    () => readClientCache<NoteJson[]>(PAGE_CACHE_KEYS.notes) ?? [],
  );
  const [allTags, setAllTags] = useState<string[]>([]);
  const [kinds, setKinds] = useState<NoteKindOption[]>([]);
  const [managingKinds, setManagingKinds] = useState(false);
  const [newKindName, setNewKindName] = useState("");
  const [viewMode, setViewMode] = useState<"list" | "editor">("list");
  const [editingId, setEditingId] = useState<string | null>(null);
  // 是否為「這次編輯 session 一開始就是新筆記」；跟 editingId 分開存是因為新筆記
  // 自動儲存後 editingId 會從 null 變成真正的 id，但這不代表使用者換了一篇筆記，
  // 編輯器的檢視模式不該因此被重置。
  const [editorIsNewNote, setEditorIsNewNote] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm(""));
  const [saving, setSaving] = useState(false);
  const [autosaveStatus, setAutosaveStatus] = useState<AutosaveStatus>("idle");
  const lastSavedSnapshotRef = useRef<string>("");

  const [filterKind, setFilterKind] = useState("");
  const [filterTag, setFilterTag] = useState("");
  const [filterQuery, setFilterQuery] = useState("");
  const [filterDate, setFilterDate] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ noteId: string; x: number; y: number } | null>(
    null,
  );

  const refresh = useMemo(
    () => async () => {
      const res = await fetch("/api/notes", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as NoteJson[];
      setNotes(data);
      writeClientCache(PAGE_CACHE_KEYS.notes, data);
    },
    [],
  );

  const refreshKinds = useMemo(
    () => async () => {
      const res = await fetch("/api/note-kinds");
      if (!res.ok) return;
      const data = (await res.json()) as NoteKindOption[];
      setKinds(data);
    },
    [],
  );

  useEffect(() => {
    if (!isOpen) return;
    void refresh();
    void refreshKinds();
    void fetch("/api/tags")
      .then((r) => (r.ok ? r.json() : { tags: [] }))
      .then((d: { tags: string[] }) => setAllTags(d.tags ?? []))
      .catch(() => {});
  }, [isOpen, refresh, refreshKinds]);

  useEffect(() => {
    if (!isOpen || !pendingNoteId) return;
    const note = notes.find((n) => n.id === pendingNoteId);
    if (note) {
      const initial = toForm(note);
      setEditingId(note.id);
      setEditorIsNewNote(false);
      setForm(initial);
      lastSavedSnapshotRef.current = JSON.stringify(initial);
      setAutosaveStatus("idle");
      setViewMode("editor");
      consumePendingNoteId();
    }
  }, [isOpen, pendingNoteId, notes, consumePendingNoteId]);

  useEffect(() => {
    if (!isOpen || !pendingNewNoteInstrument || kinds.length === 0) return;
    const initial = {
      ...emptyForm(kinds[0]?.name ?? ""),
      instruments: [pendingNewNoteInstrument],
    };
    setEditingId(null);
    setEditorIsNewNote(true);
    setForm(initial);
    lastSavedSnapshotRef.current = JSON.stringify(initial);
    setAutosaveStatus("idle");
    setViewMode("editor");
    consumePendingNewNoteInstrument();
  }, [isOpen, pendingNewNoteInstrument, kinds, consumePendingNewNoteInstrument]);

  // 智慧自動儲存：欄位變動後 1.5 秒沒有新的變動、且標題/內容/類型都齊全時自動存檔，
  // 不打斷正在輸入的使用者，也不會為空白草稿建立垃圾筆記。
  // editingId 也放進依賴：新筆記第一次存檔（不論是手動按存檔還是自動存檔）成功後
  // editingId 會從 null 變成真正的 id，這裡要跟著重新掛一次 effect，把「存檔前」
  // 排的那個舊 timer（closure 裡 editingId 還是 null）取消掉，不然它 1.5 秒後
  // 照樣會用 POST 建立第二筆一模一樣的筆記。
  useEffect(() => {
    if (viewMode !== "editor") return;
    const dirty = JSON.stringify(form) !== lastSavedSnapshotRef.current;
    if (!dirty) return;
    setAutosaveStatus("pending");
    const timer = window.setTimeout(() => {
      void performSave();
    }, 1500);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, viewMode, editingId]);

  const filteredNotes = useMemo(() => {
    const q = filterQuery.trim().toLowerCase();
    return notes.filter((n) => {
      if (filterKind && n.kind !== filterKind) return false;
      if (filterTag && !n.tags.includes(filterTag)) return false;
      if (filterDate && n.noteDate !== filterDate) return false;
      if (q && !n.title.toLowerCase().includes(q) && !n.content.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [notes, filterKind, filterTag, filterDate, filterQuery]);

  function startNew() {
    const initial = emptyForm(kinds[0]?.name ?? "");
    setEditingId(null);
    setEditorIsNewNote(true);
    setForm(initial);
    lastSavedSnapshotRef.current = JSON.stringify(initial);
    setAutosaveStatus("idle");
    setViewMode("editor");
  }

  function startEdit(note: NoteJson) {
    const initial = toForm(note);
    setEditingId(note.id);
    setEditorIsNewNote(false);
    setForm(initial);
    lastSavedSnapshotRef.current = JSON.stringify(initial);
    setAutosaveStatus("idle");
    setViewMode("editor");
  }

  function backToList() {
    setViewMode("list");
    setEditingId(null);
    setManagingKinds(false);
    setAutosaveStatus("idle");
  }

  async function addKind() {
    const name = newKindName.trim();
    if (!name) return;
    const res = await fetch("/api/note-kinds", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) {
      const err = await res.json();
      alert(err.error ?? "新增失敗");
      return;
    }
    setNewKindName("");
    await refreshKinds();
    setForm((f) => (f.kind ? f : { ...f, kind: name }));
  }

  async function deleteKind(id: string, name: string) {
    if (!window.confirm(`確定刪除「${name}」這個筆記類型？（已使用此類型的舊筆記不受影響）`)) {
      return;
    }
    const res = await fetch(`/api/note-kinds/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const err = await res.json();
      alert(err.error ?? "刪除失敗");
      return;
    }
    await refreshKinds();
    if (filterKind === name) setFilterKind("");
    setForm((f) => (f.kind === name ? { ...f, kind: "" } : f));
  }

  /** 核心存檔邏輯：新筆記用 POST（存完把回傳的 id 記下來，之後變成就地編輯），
   *  已有 id 就用 PATCH。標題／內容／類型不齊全時靜默跳過，不彈錯誤——這是自動
   *  儲存要「安靜」的地方，只有手動按存檔（manualSave）才會跳警告。存完不會
   *  離開編輯畫面，讓自動儲存不會打斷正在寫的東西。 */
  async function performSave(): Promise<boolean> {
    if (!form.title.trim() || !form.content.trim() || !form.kind) return false;
    setSaving(true);
    setAutosaveStatus("saving");
    try {
      const payload = {
        title: form.title.trim(),
        content: form.content.trim(),
        kind: form.kind,
        noteDate: form.noteDate,
        instrumentIds: form.instruments.map((i) => i.id),
        tags: form.tags,
      };
      const res = editingId
        ? await fetch(`/api/notes/${editingId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetch("/api/notes", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
      if (!res.ok) {
        setAutosaveStatus("error");
        return false;
      }
      const saved = (await res.json()) as NoteJson;
      if (!editingId) setEditingId(saved.id);
      lastSavedSnapshotRef.current = JSON.stringify(form);
      clearClientCache(PAGE_CACHE_KEYS.notes);
      await refresh();
      setAutosaveStatus("saved");
      window.setTimeout(() => {
        setAutosaveStatus((s) => (s === "saved" ? "idle" : s));
      }, 2000);
      return true;
    } catch {
      setAutosaveStatus("error");
      return false;
    } finally {
      setSaving(false);
    }
  }

  /** 手動按存檔：不齊全的話跳警告（跟以前一樣），存完留在編輯畫面，不跳走 */
  async function manualSave() {
    if (!form.title.trim() || !form.content.trim()) {
      alert("標題與內容必填");
      return;
    }
    if (!form.kind) {
      alert("請選擇筆記類型");
      return;
    }
    await performSave();
  }

  /** 關閉抽屜或返回列表前，把還沒被 debounce 存到的變動立刻存掉 */
  async function flush() {
    if (viewMode !== "editor") return;
    const dirty = JSON.stringify(form) !== lastSavedSnapshotRef.current;
    if (!dirty) return;
    if (!form.title.trim() || !form.content.trim() || !form.kind) return;
    await performSave();
  }

  async function handleClose() {
    await flush();
    close();
  }

  async function handleBackToList() {
    await flush();
    backToList();
  }

  async function deleteNoteById(id: string) {
    const res = await fetch(`/api/notes/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const err = await res.json();
      alert(err.error ?? "刪除失敗");
      return false;
    }
    clearClientCache(PAGE_CACHE_KEYS.notes);
    await refresh();
    return true;
  }

  async function remove() {
    if (!editingId) return;
    if (!window.confirm("確定刪除這篇筆記？")) return;
    // 標記成「已存檔」狀態，避免刪除當下如果剛好有 pending 的自動儲存把它救回來
    lastSavedSnapshotRef.current = JSON.stringify(form);
    setSaving(true);
    try {
      if (await deleteNoteById(editingId)) backToList();
    } finally {
      setSaving(false);
    }
  }

  function openContextMenu(e: React.MouseEvent, noteId: string) {
    e.preventDefault();
    setContextMenu({ noteId, x: e.clientX, y: e.clientY });
  }

  async function renameFromMenu(note: NoteJson) {
    setContextMenu(null);
    const next = window.prompt("重新命名筆記", note.title);
    if (next == null) return;
    const trimmed = next.trim();
    if (!trimmed || trimmed === note.title) return;
    const res = await fetch(`/api/notes/${note.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: trimmed }),
    });
    if (!res.ok) {
      const err = await res.json();
      alert(err.error ?? "重新命名失敗");
      return;
    }
    clearClientCache(PAGE_CACHE_KEYS.notes);
    await refresh();
  }

  async function deleteFromMenu(note: NoteJson) {
    setContextMenu(null);
    if (!window.confirm(`確定刪除「${note.title}」？`)) return;
    await deleteNoteById(note.id);
  }

  async function duplicateFromMenu(note: NoteJson) {
    setContextMenu(null);
    const existingTitles = new Set(notes.map((n) => n.title));
    const payload = {
      title: nextDuplicateTitle(note.title, existingTitles),
      content: note.content,
      kind: note.kind,
      noteDate: note.noteDate,
      instrumentIds: note.instruments.map((i) => i.id),
      tags: note.tags,
    };
    const res = await fetch("/api/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json();
      alert(err.error ?? "複製失敗");
      return;
    }
    clearClientCache(PAGE_CACHE_KEYS.notes);
    await refresh();
  }

  if (!isOpen) return null;

  const headerLeft =
    viewMode === "editor" ? (
      <button
        type="button"
        onClick={handleBackToList}
        aria-label="返回列表"
        title="返回列表"
        className="flex items-center gap-1.5 rounded-md p-1.5 text-[var(--color-muted)] transition-colors hover:bg-[color-mix(in_srgb,var(--color-foreground)_6%,transparent)] hover:text-[var(--color-primary)]"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        <span className="text-sm font-medium">{editingId ? "編輯筆記" : "新增筆記"}</span>
      </button>
    ) : (
      <h2 className="text-base font-semibold text-[var(--color-foreground)]">筆記</h2>
    );

  const headerRight =
    viewMode === "editor" ? (
      <>
        {autosaveStatus !== "idle" && (
          <span className="mr-1 text-[10px] text-[var(--color-muted)]" aria-live="polite">
            {autosaveStatus === "pending" && "編輯中…"}
            {autosaveStatus === "saving" && "儲存中…"}
            {autosaveStatus === "saved" && "已自動儲存"}
            {autosaveStatus === "error" && "儲存失敗"}
          </span>
        )}
        {editingId && (
          <button
            type="button"
            onClick={remove}
            disabled={saving}
            aria-label="刪除筆記"
            title="刪除筆記"
            className="rounded-md p-1.5 text-[var(--color-muted)] transition-colors hover:bg-[color-mix(in_srgb,var(--color-negative)_12%,transparent)] hover:text-[var(--color-negative)] disabled:opacity-50"
          >
            <Trash2 className="h-4 w-4" aria-hidden />
          </button>
        )}
        <button
          type="button"
          onClick={manualSave}
          disabled={saving}
          aria-label="儲存"
          title="儲存"
          className="rounded-md p-1.5 text-[var(--color-muted)] transition-colors hover:bg-[color-mix(in_srgb,var(--color-primary)_12%,transparent)] hover:text-[var(--color-primary)] disabled:opacity-50"
        >
          <Save className="h-4 w-4" aria-hidden />
        </button>
      </>
    ) : undefined;

  const contextMenuNote = contextMenu ? notes.find((n) => n.id === contextMenu.noteId) : undefined;

  return (
    <>
      <Drawer left={headerLeft} right={headerRight} onClose={handleClose}>
        {viewMode === "list" ? (
        <div className="space-y-4">
          <NotesCalendar selectedDate={filterDate} onSelectDate={setFilterDate} />

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={filterKind}
              onChange={(e) => setFilterKind(e.target.value)}
              className="h-9 rounded-md border border-[var(--color-card-border)] bg-[var(--color-background)] px-2 text-sm"
            >
              <option value="">全部類型</option>
              {kinds.map((k) => (
                <option key={k.id} value={k.name}>
                  {k.name}
                </option>
              ))}
            </select>
            <select
              value={filterTag}
              onChange={(e) => setFilterTag(e.target.value)}
              className="h-9 rounded-md border border-[var(--color-card-border)] bg-[var(--color-background)] px-2 text-sm"
            >
              <option value="">全部標籤</option>
              {allTags.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <Input
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              placeholder="關鍵字…"
              className="h-9 flex-1 min-w-[8rem]"
            />
            <button
              type="button"
              onClick={startNew}
              aria-label="新增筆記"
              title="新增筆記"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-[var(--color-card-border)] text-[var(--color-muted)] transition-colors hover:border-[var(--color-primary)]/40 hover:bg-[var(--color-primary)]/10 hover:text-[var(--color-primary)]"
            >
              <Plus className="h-4 w-4" aria-hidden />
            </button>
          </div>

          {filterDate && (
            <p className="text-xs text-[var(--color-muted)]">
              篩選日期：{filterDate}
              <button
                type="button"
                onClick={() => setFilterDate(null)}
                className="ml-2 text-[var(--color-primary)] hover:underline"
              >
                清除
              </button>
            </p>
          )}

          <div className="space-y-2">
            {filteredNotes.length === 0 ? (
              <p className="py-8 text-center text-sm text-[var(--color-muted)]">
                沒有符合條件的筆記
              </p>
            ) : (
              filteredNotes.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => startEdit(n)}
                  onContextMenu={(e) => openContextMenu(e, n.id)}
                  className="block w-full rounded-md border border-[var(--color-card-border)]/60 px-3 py-2.5 text-left transition-colors hover:bg-[var(--color-card-border)]/20"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-[var(--color-foreground)]">
                      {n.title}
                    </span>
                    <span className="shrink-0 text-xs text-[var(--color-muted)]">
                      {n.noteDate}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <Badge className="text-[10px]">{n.kind}</Badge>
                    {n.tags.map((t) => (
                      <span key={t} className="text-xs text-[var(--color-muted)]">
                        #{t}
                      </span>
                    ))}
                  </div>
                  <p className="mt-1 truncate text-xs text-[var(--color-muted)]">
                    {n.content.split("\n")[0]}
                  </p>
                </button>
              ))
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <input
            type="text"
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            placeholder="無標題筆記"
            className="w-full border-0 bg-transparent p-0 text-2xl font-semibold text-[var(--color-foreground)] placeholder:text-[var(--color-muted)] focus:outline-none focus:ring-0"
          />

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className="form-label block text-xs">類型</label>
                <button
                  type="button"
                  onClick={() => setManagingKinds((v) => !v)}
                  className="text-[10px] text-[var(--color-muted)] hover:text-[var(--color-primary)]"
                >
                  {managingKinds ? "完成" : "管理類型"}
                </button>
              </div>
              {managingKinds ? (
                <div className="space-y-2 rounded-md border border-[var(--color-card-border)]/70 p-2">
                  <div className="flex flex-wrap gap-1.5">
                    {kinds.length === 0 && (
                      <p className="text-xs text-[var(--color-muted)]">尚無類型</p>
                    )}
                    {kinds.map((k) => (
                      <Badge key={k.id} className="gap-1 pr-1 text-[10px]">
                        {k.name}
                        <button
                          type="button"
                          onClick={() => deleteKind(k.id, k.name)}
                          aria-label={`刪除 ${k.name}`}
                          className="rounded-full p-0.5 hover:bg-[var(--color-primary)]/20"
                        >
                          <X className="h-2.5 w-2.5" aria-hidden />
                        </button>
                      </Badge>
                    ))}
                  </div>
                  <div className="flex gap-1.5">
                    <Input
                      value={newKindName}
                      onChange={(e) => setNewKindName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void addKind();
                        }
                      }}
                      placeholder="新增類型名稱"
                      className="h-8 text-xs"
                    />
                    <Button type="button" size="sm" className="h-8 shrink-0 px-2" onClick={addKind}>
                      <Plus className="h-3 w-3" aria-hidden />
                    </Button>
                  </div>
                </div>
              ) : (
                <select
                  value={form.kind}
                  onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value }))}
                  className="h-10 w-full rounded-md border border-[var(--color-card-border)] bg-[var(--color-background)] px-3 text-sm"
                >
                  {form.kind === "" && <option value="">請選擇類型</option>}
                  {kinds.map((k) => (
                    <option key={k.id} value={k.name}>
                      {k.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div>
              <label className="form-label mb-1 block text-xs">日期</label>
              <Input
                type="date"
                value={form.noteDate}
                onChange={(e) => setForm((f) => ({ ...f, noteDate: e.target.value }))}
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="form-label mb-1 block text-xs">關聯標的</label>
              <NoteInstrumentPicker
                selected={form.instruments}
                onChange={(instruments) => setForm((f) => ({ ...f, instruments }))}
              />
            </div>
            <div>
              <label className="form-label mb-1 block text-xs">標籤</label>
              <NoteTagPicker
                selected={form.tags}
                onChange={(tags) => setForm((f) => ({ ...f, tags }))}
                suggestions={allTags}
              />
            </div>
          </div>

          <hr className="border-t border-[var(--color-card-border)]/60" />

          <MarkdownNotesEditor
            value={form.content}
            onChange={(content) => setForm((f) => ({ ...f, content }))}
            placeholder={"## 論點\n- ...\n\n## 風險\n- ..."}
            minHeight="12rem"
            isNewNote={editorIsNewNote}
          />
        </div>
      )}
      </Drawer>
      {contextMenu && contextMenuNote && (
        <div
          className="fixed inset-0 z-[110]"
          onMouseDown={() => setContextMenu(null)}
          onContextMenu={(e) => {
            e.preventDefault();
            setContextMenu(null);
          }}
        >
          <div
            style={{ left: contextMenu.x, top: contextMenu.y }}
            className="absolute w-36 overflow-hidden rounded-md border border-[var(--color-card-border)] bg-[var(--color-background)] py-1 shadow-lg"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => renameFromMenu(contextMenuNote)}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-[var(--color-foreground)] hover:bg-[var(--color-card-border)]/40"
            >
              <TextCursorInput className="h-3.5 w-3.5" aria-hidden />
              重新命名
            </button>
            <button
              type="button"
              onClick={() => duplicateFromMenu(contextMenuNote)}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-[var(--color-foreground)] hover:bg-[var(--color-card-border)]/40"
            >
              <Copy className="h-3.5 w-3.5" aria-hidden />
              複製
            </button>
            <button
              type="button"
              onClick={() => deleteFromMenu(contextMenuNote)}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-[var(--color-negative)] hover:bg-[color-mix(in_srgb,var(--color-negative)_10%,transparent)]"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
              刪除
            </button>
          </div>
        </div>
      )}
    </>
  );
}
