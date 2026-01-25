/**
 * useTooltipSize Hook
 *
 * Measures tooltip dimensions with retry for portal-mounted content.
 * Used by SkillsPanel, PrayerPanel, and other components with hover tooltips.
 *
 * @packageDocumentation
 */

import { useState, useLayoutEffect, type RefObject } from "react";

/**
 * Custom hook for measuring tooltip dimensions with retry for portal-mounted content.
 *
 * @param hoveredItem - The currently hovered item (null when nothing is hovered)
 * @param tooltipRef - React ref to the tooltip DOM element
 * @param defaultSize - Default dimensions to use before measurement
 * @returns Measured tooltip dimensions { width, height }
 *
 * @example
 * ```tsx
 * const tooltipRef = useRef<HTMLDivElement>(null);
 * const tooltipSize = useTooltipSize(hoveredSkill, tooltipRef, { width: 180, height: 90 });
 * ```
 */
export function useTooltipSize<T>(
  hoveredItem: T | null,
  tooltipRef: RefObject<HTMLDivElement | null>,
  defaultSize: { width: number; height: number },
): { width: number; height: number } {
  const [size, setSize] = useState(defaultSize);

  useLayoutEffect(() => {
    if (!hoveredItem) return;

    const measureTooltip = () => {
      if (tooltipRef.current) {
        const rect = tooltipRef.current.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          setSize({ width: rect.width, height: rect.height });
        }
      }
    };

    measureTooltip();
    const rafId = requestAnimationFrame(measureTooltip);
    return () => window.cancelAnimationFrame(rafId);
  }, [hoveredItem, tooltipRef]);

  return size;
}
