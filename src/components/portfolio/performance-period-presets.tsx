"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  applyPeriodPreset,
  createCustomPeriodPreset,
  formatPresetLabel,
  mergePeriodPresets,
  PERIOD_PRESET_UNIT_LABELS,
  type PerformancePeriodPreset,
  type PeriodPresetUnit,
} from "@/lib/performance-period-presets";
import { cn } from "@/lib/utils";

type EditableUnit = Exclude<PeriodPresetUnit, "mtd" | "ytd" | "all">;

export function PerformancePeriodPresets({
  start,
  end,
  activePresetId,
  customPresets,
  portfolioEarliest,
  onApply,
  onCustomPresetsChange,
  compact = false,
}: {
  start: string;
  end: string;
  activePresetId?: string | null;
  customPresets: PerformancePeriodPreset[];
  portfolioEarliest?: string;
  onApply: (range: { start: string; end: string }, presetId: string | null) => void;
  onCustomPresetsChange: (presets: PerformancePeriodPreset[]) => void;
  /** 精簡模式：隱藏標頭，按鈕直接橫排（放在日期選擇器右邊用） */
  compact?: boolean;
}) {
  const [managing, setManaging] = useState(false);
  const [draftLabel, setDraftLabel] = useState("");
  const [draftAmount, setDraftAmount] = useState("3");
  const [draftUnit, setDraftUnit] = useState<EditableUnit>("months");
  const [editingId, setEditingId] = useState<string | null>(null);

  const allPresets = useMemo(
    () => mergePeriodPresets(customPresets),
    [customPresets],
  );

  const addPreset = () => {
    const amount = Math.max(1, Math.floor(Number(draftAmount) || 1));
    const preset = createCustomPeriodPreset(draftLabel, draftUnit, amount);
    onCustomPresetsChange([...customPresets, preset]);
    setDraftLabel("");
    setDraftAmount("3");
    setManaging(true);
  };

  const updatePreset = (
    id: string,
    label: string,
    unit: EditableUnit,
    amount: number,
  ) => {
    onCustomPresetsChange(
      customPresets.map((p) =>
        p.id === id
          ? {
              ...p,
              label: label.trim() || formatPresetLabel(unit, amount),
              unit,
              amount,
            }
          : p,
      ),
    );
    setEditingId(null);
  };

  const removePreset = (id: string) => {
    onCustomPresetsChange(customPresets.filter((p) => p.id !== id));
  };

  // ── Shared: preset pill buttons ─────────────────────────────────────────
  const presetButtons = allPresets.map((preset) => {
    const isActive = activePresetId === preset.id;
    return (
      <button
        key={preset.id}
        type="button"
        onClick={() => {
          if (isActive) {
            onApply({ start, end }, null);
            return;
          }
          const range = applyPeriodPreset(preset, {
            end: new Date(),
            portfolioEarliest,
          });
          onApply(range, preset.id);
        }}
        className={cn(
          "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
          isActive
            ? "border-[var(--color-primary)] bg-[var(--color-primary)]/15 text-[var(--color-primary)]"
            : "border-[var(--color-card-border)] text-[var(--color-muted)] hover:border-[var(--color-primary)]/50 hover:text-[var(--color-foreground)]",
        )}
      >
        {preset.label}
      </button>
    );
  });

  // ── Shared: custom-preset manage panel ──────────────────────────────────
  const managePanel = managing ? (
    <div className="space-y-4 rounded-lg border border-[var(--color-card-border)]/60 bg-[var(--color-card)]/30 p-4">
      <p className="text-xs text-[var(--color-muted)]">
        新增自訂跨度（內建選項無法刪除）；點選套用，再點一次取消後改用手動日期。
      </p>

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[7rem] flex-1">
          <label className="mb-1 block text-[10px] text-[var(--color-muted)]">
            顯示名稱（選填）
          </label>
          <Input
            value={draftLabel}
            onChange={(e) => setDraftLabel(e.target.value)}
            placeholder="例：過去 2 季"
            className="h-8 text-sm"
          />
        </div>
        <div className="w-20">
          <label className="mb-1 block text-[10px] text-[var(--color-muted)]">
            數量
          </label>
          <Input
            type="number"
            min={1}
            value={draftAmount}
            onChange={(e) => setDraftAmount(e.target.value)}
            className="h-8 text-sm tabular-nums"
          />
        </div>
        <div className="w-24">
          <label className="mb-1 block text-[10px] text-[var(--color-muted)]">
            單位
          </label>
          <select
            value={draftUnit}
            onChange={(e) => setDraftUnit(e.target.value as EditableUnit)}
            className="h-8 w-full rounded-md border border-[var(--color-card-border)] bg-[var(--color-background)] px-2 text-sm"
          >
            {(Object.keys(PERIOD_PRESET_UNIT_LABELS) as EditableUnit[]).map(
              (u) => (
                <option key={u} value={u}>
                  {PERIOD_PRESET_UNIT_LABELS[u]}
                </option>
              ),
            )}
          </select>
        </div>
        <Button type="button" size="sm" onClick={addPreset}>
          新增
        </Button>
      </div>

      {customPresets.length > 0 && (
        <ul className="space-y-2">
          {customPresets.map((preset) =>
            editingId === preset.id ? (
              <CustomPresetEditor
                key={preset.id}
                preset={preset}
                onSave={updatePreset}
                onCancel={() => setEditingId(null)}
              />
            ) : (
              <li
                key={preset.id}
                className="flex items-center justify-between gap-2 rounded border border-[var(--color-card-border)]/40 px-3 py-2 text-sm"
              >
                <span>{preset.label}</span>
                <div className="flex gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs"
                    onClick={() => setEditingId(preset.id)}
                  >
                    編輯
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs text-[var(--color-negative)]"
                    onClick={() => removePreset(preset.id)}
                  >
                    刪除
                  </Button>
                </div>
              </li>
            ),
          )}
        </ul>
      )}
    </div>
  ) : null;

  // ── Compact mode: no header, buttons inline (for placing right of date pickers)
  if (compact) {
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {presetButtons}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 text-xs text-[var(--color-muted)]"
            onClick={() => setManaging((v) => !v)}
          >
            {managing ? "完成" : "管理"}
          </Button>
        </div>
        {managePanel}
      </div>
    );
  }

  // ── Default mode: with section header ───────────────────────────────────
  return (
    <div className="space-y-3 border-t border-[var(--color-card-border)]/50 pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-muted)]">
          時間跨度
        </p>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 text-xs"
          onClick={() => setManaging((v) => !v)}
        >
          {managing ? "完成" : "管理自訂"}
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        {presetButtons}
      </div>

      {managePanel}
    </div>
  );
}

function CustomPresetEditor({
  preset,
  onSave,
  onCancel,
}: {
  preset: PerformancePeriodPreset;
  onSave: (
    id: string,
    label: string,
    unit: EditableUnit,
    amount: number,
  ) => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState(preset.label);
  const [amount, setAmount] = useState(String(preset.amount ?? 1));
  const unit = (preset.unit === "mtd" ||
  preset.unit === "ytd" ||
  preset.unit === "all"
    ? "months"
    : preset.unit) as EditableUnit;
  const [unitState, setUnitState] = useState<EditableUnit>(unit);

  return (
    <li className="flex flex-wrap items-end gap-2 rounded border border-[var(--color-primary)]/30 bg-[var(--color-primary)]/5 p-3">
      <Input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        className="h-8 min-w-[6rem] flex-1 text-sm"
      />
      <Input
        type="number"
        min={1}
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        className="h-8 w-16 text-sm tabular-nums"
      />
      <select
        value={unitState}
        onChange={(e) => setUnitState(e.target.value as EditableUnit)}
        className="h-8 rounded-md border border-[var(--color-card-border)] bg-[var(--color-background)] px-2 text-sm"
      >
        {(Object.keys(PERIOD_PRESET_UNIT_LABELS) as EditableUnit[]).map((u) => (
          <option key={u} value={u}>
            {PERIOD_PRESET_UNIT_LABELS[u]}
          </option>
        ))}
      </select>
      <Button
        type="button"
        size="sm"
        onClick={() =>
          onSave(
            preset.id,
            label,
            unitState,
            Math.max(1, Math.floor(Number(amount) || 1)),
          )
        }
      >
        儲存
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
        取消
      </Button>
    </li>
  );
}
