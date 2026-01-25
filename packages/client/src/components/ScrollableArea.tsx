/**
 * ScrollableArea - Unified scrollable container component
 *
 * Provides consistent scrollbar styling across all panels using design tokens.
 * Supports three variants:
 * - hidden: Scrollable but invisible scrollbar (default for most UI)
 * - thin: 6px gold-themed scrollbar (for content panels)
 * - thick: 8px brown-themed scrollbar (for inventory/bank grids)
 *
 * @example
 * // Hidden scrollbar (default)
 * <ScrollableArea>
 *   <div>Content...</div>
 * </ScrollableArea>
 *
 * // Thin gold scrollbar
 * <ScrollableArea variant="thin">
 *   <div>Content...</div>
 * </ScrollableArea>
 *
 * // Thick brown scrollbar for inventory grids
 * <ScrollableArea variant="thick" colorScheme="brown">
 *   <div>Content...</div>
 * </ScrollableArea>
 */

import React, { forwardRef, useMemo } from "react";
import { gameUI } from "../constants";

/** Scrollbar variant types */
export type ScrollbarVariant = "hidden" | "thin" | "thick";

/** Color scheme for visible scrollbars */
export type ScrollbarColorScheme = "gold" | "brown";

/** Scroll direction */
export type ScrollDirection = "vertical" | "horizontal" | "both";

export interface ScrollableAreaProps {
  /** Content to render inside the scrollable area */
  children: React.ReactNode;
  /** Scrollbar variant: hidden (default), thin (6px), or thick (8px) */
  variant?: ScrollbarVariant;
  /** Color scheme for visible scrollbars: gold (default) or brown */
  colorScheme?: ScrollbarColorScheme;
  /** Scroll direction: vertical (default), horizontal, or both */
  direction?: ScrollDirection;
  /** Additional className for the container */
  className?: string;
  /** Additional inline styles */
  style?: React.CSSProperties;
  /** Maximum height (useful for fixed-height containers) */
  maxHeight?: string | number;
  /** Whether to use flex: 1 and minHeight: 0 for flex containers */
  flex?: boolean;
  /** HTML id attribute */
  id?: string;
  /** Test id for testing */
  "data-testid"?: string;
}

/**
 * Get CSS class name for scrollbar variant
 */
function getScrollbarClassName(
  variant: ScrollbarVariant,
  colorScheme: ScrollbarColorScheme,
): string {
  switch (variant) {
    case "hidden":
      return "noscrollbar";
    case "thin":
      return colorScheme === "brown"
        ? "scrollbar-thin-brown"
        : "scrollbar-thin";
    case "thick":
      return colorScheme === "brown"
        ? "scrollbar-thick-brown"
        : "scrollbar-thick-gold";
    default:
      return "noscrollbar";
  }
}

/**
 * Get overflow styles based on direction
 */
function getOverflowStyles(direction: ScrollDirection): React.CSSProperties {
  switch (direction) {
    case "vertical":
      return { overflowY: "auto", overflowX: "hidden" };
    case "horizontal":
      return { overflowX: "auto", overflowY: "hidden" };
    case "both":
      return { overflow: "auto" };
    default:
      return { overflowY: "auto", overflowX: "hidden" };
  }
}

/**
 * ScrollableArea Component
 *
 * A unified scrollable container that provides consistent scrollbar styling
 * across all panels. Uses design tokens from constants/tokens.ts.
 */
export const ScrollableArea = forwardRef<HTMLDivElement, ScrollableAreaProps>(
  (
    {
      children,
      variant = "hidden",
      colorScheme = "gold",
      direction = "vertical",
      className = "",
      style,
      maxHeight,
      flex = false,
      id,
      "data-testid": testId,
    },
    ref,
  ) => {
    const scrollbarClassName = useMemo(
      () => getScrollbarClassName(variant, colorScheme),
      [variant, colorScheme],
    );

    const overflowStyles = useMemo(
      () => getOverflowStyles(direction),
      [direction],
    );

    const combinedStyles: React.CSSProperties = useMemo(
      () => ({
        ...overflowStyles,
        ...(flex && { flex: 1, minHeight: 0 }),
        ...(maxHeight !== undefined && { maxHeight }),
        ...style,
      }),
      [overflowStyles, flex, maxHeight, style],
    );

    const combinedClassName = useMemo(
      () => [scrollbarClassName, className].filter(Boolean).join(" "),
      [scrollbarClassName, className],
    );

    return (
      <div
        ref={ref}
        id={id}
        data-testid={testId}
        className={combinedClassName}
        style={combinedStyles}
      >
        {children}
      </div>
    );
  },
);

ScrollableArea.displayName = "ScrollableArea";

/**
 * Generate CSS for custom scrollbar styling
 *
 * This is used internally to create the scrollbar CSS classes.
 * The CSS is injected via index.css using the design tokens.
 */
export function generateScrollbarCSS(): string {
  const { scrollbar } = gameUI;
  const { thin, thick, colors } = scrollbar;

  return `
/* Thin Gold Scrollbar (6px) - Default for most panels */
.scrollbar-thin {
  scrollbar-width: thin;
  scrollbar-color: ${colors.gold.thumb} ${colors.gold.track};
}
.scrollbar-thin::-webkit-scrollbar {
  width: ${thin.width};
}
.scrollbar-thin::-webkit-scrollbar-track {
  background: ${colors.gold.track};
  border-radius: ${thin.borderRadius};
}
.scrollbar-thin::-webkit-scrollbar-thumb {
  background-color: ${colors.gold.thumb};
  border-radius: ${thin.borderRadius};
  border: none;
}
.scrollbar-thin::-webkit-scrollbar-thumb:hover {
  background-color: ${colors.gold.thumbHover};
}

/* Thin Brown Scrollbar (6px) - Alternative for brown-themed panels */
.scrollbar-thin-brown {
  scrollbar-width: thin;
  scrollbar-color: ${colors.brown.thumb} ${colors.brown.track};
}
.scrollbar-thin-brown::-webkit-scrollbar {
  width: ${thin.width};
}
.scrollbar-thin-brown::-webkit-scrollbar-track {
  background: ${colors.brown.track};
  border-radius: ${thin.borderRadius};
}
.scrollbar-thin-brown::-webkit-scrollbar-thumb {
  background-color: ${colors.brown.thumb};
  border-radius: ${thin.borderRadius};
  border: none;
}
.scrollbar-thin-brown::-webkit-scrollbar-thumb:hover {
  background-color: ${colors.brown.thumbHover};
}

/* Thick Gold Scrollbar (8px) - For inventory/bank grids */
.scrollbar-thick-gold {
  scrollbar-width: auto;
  scrollbar-color: ${colors.gold.thumb} ${colors.gold.track};
}
.scrollbar-thick-gold::-webkit-scrollbar {
  width: ${thick.width};
}
.scrollbar-thick-gold::-webkit-scrollbar-track {
  background: ${colors.gold.track};
  border-radius: ${thick.borderRadius};
}
.scrollbar-thick-gold::-webkit-scrollbar-thumb {
  background-color: ${colors.gold.thumb};
  border-radius: ${thick.borderRadius};
  border: none;
}
.scrollbar-thick-gold::-webkit-scrollbar-thumb:hover {
  background-color: ${colors.gold.thumbHover};
}

/* Thick Brown Scrollbar (8px) - For bank/store panels */
.scrollbar-thick-brown {
  scrollbar-width: auto;
  scrollbar-color: ${colors.brown.thumb} ${colors.brown.track};
}
.scrollbar-thick-brown::-webkit-scrollbar {
  width: ${thick.width};
}
.scrollbar-thick-brown::-webkit-scrollbar-track {
  background: ${colors.brown.track};
  border-radius: ${thick.borderRadius};
}
.scrollbar-thick-brown::-webkit-scrollbar-thumb {
  background-color: ${colors.brown.thumb};
  border-radius: ${thick.borderRadius};
  border: none;
}
.scrollbar-thick-brown::-webkit-scrollbar-thumb:hover {
  background-color: ${colors.brown.thumbHover};
}
`;
}

export default ScrollableArea;
