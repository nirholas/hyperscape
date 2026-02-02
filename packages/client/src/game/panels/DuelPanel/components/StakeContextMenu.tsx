/**
 * StakeContextMenu — Right-click quantity menu for staking items
 *
 * Shows options: Stake 1, 5, 10, All.
 * Uses React state for hover effects instead of direct DOM manipulation.
 */

import { useState, type CSSProperties } from "react";
import type { Theme } from "@/ui";

// ============================================================================
// Types
// ============================================================================

interface StakeContextMenuProps {
  x: number;
  y: number;
  theme: Theme;
  menuStyle: CSSProperties;
  menuItemStyle: CSSProperties;
  onSelect: (quantity: number | "all") => void;
  onClose: () => void;
}

const QUANTITY_OPTIONS: Array<{ value: number | "all"; label: string }> = [
  { value: 1, label: "Stake 1" },
  { value: 5, label: "Stake 5" },
  { value: 10, label: "Stake 10" },
  { value: "all", label: "Stake All" },
];

// ============================================================================
// Component
// ============================================================================

export function StakeContextMenu({
  x,
  y,
  theme,
  menuStyle,
  menuItemStyle,
  onSelect,
  onClose,
}: StakeContextMenuProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  return (
    <div
      style={{ position: "fixed", left: x, top: y, ...menuStyle }}
      onMouseLeave={onClose}
    >
      {QUANTITY_OPTIONS.map((option, index) => (
        <div
          key={option.label}
          onClick={() => onSelect(option.value)}
          style={{
            ...menuItemStyle,
            background:
              hoveredIndex === index
                ? theme.colors.background.tertiary
                : "transparent",
          }}
          onMouseEnter={() => setHoveredIndex(index)}
          onMouseLeave={() => setHoveredIndex(null)}
        >
          {option.label}
        </div>
      ))}
    </div>
  );
}
