"use client";

import { useCallback, useState } from "react";
import { withAlpha } from "@/lib/chart-theme";

/** 被 hover 的線加粗多少 px */
const HOVER_WIDTH_BOOST = 1.5;
/** 其餘線條淡出到的透明度 */
const DIMMED_OPACITY = 0.25;
/** 透明感應線的粗細：折線本身只有 2～3px，滑鼠很難精準壓中 */
const HIT_AREA_WIDTH = 18;

/**
 * 感應線在 tooltip payload 裡的名字。Recharts 的 tooltipType="none" 只影響預設
 * tooltip，自訂 content 拿到的 payload 仍然包含感應線，每個 dataKey 會重複兩筆
 * （React 也會噴 duplicate key 警告），所以 tooltip 要自己用 isHitAreaEntry 濾掉。
 */
export const HIT_AREA_NAME = "__hover-hit-area__";

export function isHitAreaEntry(entry: { name?: unknown }) {
  return entry.name === HIT_AREA_NAME;
}

export type LineEmphasis = {
  strokeWidth: number;
  strokeOpacity: number;
  style: { filter?: string; pointerEvents: "none" };
};

/**
 * 讓折線在滑鼠移上去時「浮起」：該線加粗、底下透出同色陰影，其餘線條同時淡出，
 * 靠前後對比做出層次感。
 *
 * Recharts 的折線只有 2～3px 寬，瀏覽器的 hit-test 只認 stroke 實際覆蓋的像素，
 * 直接掛 onMouseEnter 在可見線上會非常難命中，所以每條線另外疊一條透明粗線當
 * 感應區（hitAreaProps），並用 tooltipType/legendType="none" 把它排除在
 * tooltip 與圖例之外，避免出現重複項目。
 */
export function useLineHoverEmphasis() {
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);

  const hitAreaProps = useCallback(
    (dataKey: string) =>
      ({
        name: HIT_AREA_NAME,
        stroke: "transparent",
        strokeWidth: HIT_AREA_WIDTH,
        dot: false,
        activeDot: false,
        legendType: "none",
        tooltipType: "none",
        isAnimationActive: false,
        style: { pointerEvents: "stroke", cursor: "pointer" },
        onMouseEnter: () => setHoveredKey(dataKey),
        onMouseLeave: () =>
          setHoveredKey((current) => (current === dataKey ? null : current)),
      }) as const,
    [],
  );

  const emphasisFor = useCallback(
    (dataKey: string, baseWidth: number, color: string): LineEmphasis => {
      // 可見折線畫在感應線之上，若讓它吃掉滑鼠事件，游標正好壓在線正中央時
      // 反而會觸發感應線的 mouseleave，造成閃爍，所以一律讓事件穿透過去。
      const base = { pointerEvents: "none" } as const;
      if (hoveredKey === null) {
        return { strokeWidth: baseWidth, strokeOpacity: 1, style: base };
      }
      if (hoveredKey === dataKey) {
        return {
          strokeWidth: baseWidth + HOVER_WIDTH_BOOST,
          strokeOpacity: 1,
          style: {
            ...base,
            filter: `drop-shadow(0 2px 5px ${withAlpha(color, 0.6)})`,
          },
        };
      }
      return {
        strokeWidth: baseWidth,
        strokeOpacity: DIMMED_OPACITY,
        style: base,
      };
    },
    [hoveredKey],
  );

  /** SVG 後畫的蓋在上面：把被 hover 的線排到最後，才會真的浮在其他線之上 */
  const withHoveredLast = useCallback(
    <T extends { dataKey: string }>(lines: T[]): T[] => {
      if (hoveredKey === null) return lines;
      const index = lines.findIndex((line) => line.dataKey === hoveredKey);
      if (index < 0) return lines;
      return [
        ...lines.slice(0, index),
        ...lines.slice(index + 1),
        lines[index]!,
      ];
    },
    [hoveredKey],
  );

  return { hoveredKey, hitAreaProps, emphasisFor, withHoveredLast };
}
