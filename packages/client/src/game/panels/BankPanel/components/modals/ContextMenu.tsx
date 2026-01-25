/**
 * Bank Context Menu Component
 *
 * Right-click context menu for bank items with withdraw/deposit options.
 * RS3-style: Shows different options for placeholders (qty=0) vs items.
 * Uses hs-kit theme system for consistent styling.
 */

import { useState, useEffect, useRef, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { getItem } from "@hyperscape/shared";
import { useThemeStore } from "hs-kit";
import type { ContextMenuState } from "../../types";
import type { RightPanelMode } from "../../types";

interface ContextMenuProps {
  menu: ContextMenuState;
  onAction: (action: string, quantity: number) => void;
  onClose: () => void;
  rightPanelMode: RightPanelMode;
}

export function ContextMenu({
  menu,
  onAction,
  onClose,
  rightPanelMode,
}: ContextMenuProps) {
  const theme = useThemeStore((s) => s.theme);
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [customAmount, setCustomAmount] = useState("");
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // RS3-style: Items with qty=0 are placeholders
  const isPlaceholder = menu.type === "bank" && menu.quantity === 0;
  const actionLabel = menu.type === "bank" ? "Withdraw" : "Deposit";

  // RS3-style: Check if item is equipable for "Equip" option
  const itemData = menu.itemId ? getItem(menu.itemId) : null;
  const isEquipable = itemData?.equipSlot || itemData?.equipable;

  const handleCustomSubmit = () => {
    const amount = parseInt(customAmount, 10);
    if (amount > 0) {
      onAction(menu.type === "bank" ? "withdraw" : "deposit", amount);
    }
    onClose();
  };

  // Close on click outside - MUST be before any conditional returns (Rules of Hooks)
  useEffect(() => {
    if (!menu.visible) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    requestAnimationFrame(() => {
      document.addEventListener("mousedown", handleClickOutside, true);
    });

    return () => {
      document.removeEventListener("mousedown", handleClickOutside, true);
    };
  }, [menu.visible, onClose]);

  // IMPORTANT: Check visibility FIRST before any rendering
  if (!menu.visible) return null;

  // Clamp menu position to viewport boundaries
  const menuWidth = 200;
  const menuHeight = 250;
  const padding = 8;

  let adjustedX = menu.x;
  let adjustedY = menu.y;

  if (adjustedX + menuWidth + padding > window.innerWidth) {
    adjustedX = Math.max(padding, window.innerWidth - menuWidth - padding);
  }
  if (adjustedY + menuHeight + padding > window.innerHeight) {
    adjustedY = Math.max(padding, window.innerHeight - menuHeight - padding);
  }
  adjustedX = Math.max(padding, adjustedX);
  adjustedY = Math.max(padding, adjustedY);

  const menuContainerStyle: CSSProperties = {
    background: `linear-gradient(135deg, ${theme.colors.background.secondary} 0%, ${theme.colors.background.primary} 100%)`,
    border: `1px solid ${theme.colors.border.default}`,
    borderRadius: theme.borderRadius.md,
    boxShadow: theme.shadows.lg,
    padding: `${theme.spacing.xs}px 0`,
    display: "inline-block",
  };

  const menuItemStyle = (isHovered: boolean): CSSProperties => ({
    display: "block",
    width: "100%",
    padding: `${theme.spacing.xs}px ${theme.spacing.md}px`,
    textAlign: "left",
    fontSize: theme.typography.fontSize.xs,
    color: isHovered ? theme.colors.text.primary : theme.colors.text.secondary,
    background: isHovered ? theme.colors.background.tertiary : "transparent",
    border: "none",
    cursor: "pointer",
    transition: "all 0.15s ease",
    whiteSpace: "nowrap",
  });

  // RS3-style: Handle placeholder-only context menu (qty=0 bank items)
  if (isPlaceholder) {
    return createPortal(
      <div
        ref={menuRef}
        style={{
          position: "fixed",
          left: adjustedX,
          top: adjustedY,
          width: "auto",
          zIndex: 10000,
          pointerEvents: "auto",
        }}
      >
        <div style={menuContainerStyle}>
          <button
            style={menuItemStyle(hoveredIndex === 0)}
            onMouseEnter={() => setHoveredIndex(0)}
            onMouseLeave={() => setHoveredIndex(null)}
            onClick={(e) => {
              e.stopPropagation();
              onAction("releasePlaceholder", 0);
              onClose();
            }}
          >
            Release
          </button>
        </div>
      </div>,
      document.body,
    );
  }

  const menuOptions: Array<{ label: string; amount: number; action: string }> =
    [];

  // RS3-style: "Equip" option position depends on rightPanelMode
  const canEquip = menu.type === "bank" && isEquipable && menu.quantity > 0;

  if (canEquip && rightPanelMode === "equipment") {
    menuOptions.push({ label: "Equip", amount: 1, action: "equip" });
  }

  // Standard withdraw/deposit options
  menuOptions.push(
    {
      label: `${actionLabel} 1`,
      amount: 1,
      action: menu.type === "bank" ? "withdraw" : "deposit",
    },
    {
      label: `${actionLabel} 5`,
      amount: 5,
      action: menu.type === "bank" ? "withdraw" : "deposit",
    },
    {
      label: `${actionLabel} 10`,
      amount: 10,
      action: menu.type === "bank" ? "withdraw" : "deposit",
    },
    {
      label: `${actionLabel} All`,
      amount: menu.quantity,
      action: menu.type === "bank" ? "withdraw" : "deposit",
    },
    {
      label: `${actionLabel} X`,
      amount: -1,
      action: menu.type === "bank" ? "withdraw" : "deposit",
    },
  );

  if (canEquip && rightPanelMode === "inventory") {
    menuOptions.push({ label: "Equip", amount: 1, action: "equip" });
  }

  if (menu.type === "bank" && menu.quantity > 0) {
    menuOptions.push({
      label: "Withdraw-Placeholder",
      amount: menu.quantity,
      action: "withdrawPlaceholder",
    });
  }

  return createPortal(
    <div
      ref={menuRef}
      style={{
        position: "fixed",
        left: adjustedX,
        top: adjustedY,
        width: "auto",
        zIndex: 10000,
        pointerEvents: "auto",
      }}
    >
      <div style={menuContainerStyle}>
        {showCustomInput ? (
          <div style={{ padding: theme.spacing.sm }}>
            <input
              type="number"
              min="1"
              max={menu.quantity}
              value={customAmount}
              onChange={(e) => setCustomAmount(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCustomSubmit();
                if (e.key === "Escape") onClose();
              }}
              autoFocus
              style={{
                width: "100%",
                padding: `${theme.spacing.xs}px ${theme.spacing.sm}px`,
                fontSize: theme.typography.fontSize.sm,
                borderRadius: theme.borderRadius.sm,
                background: theme.colors.background.tertiary,
                border: `1px solid ${theme.colors.border.default}`,
                color: theme.colors.text.primary,
                outline: "none",
              }}
              placeholder={`1-${menu.quantity}`}
            />
            <div
              style={{
                display: "flex",
                gap: theme.spacing.xs,
                marginTop: theme.spacing.xs,
              }}
            >
              <button
                onClick={handleCustomSubmit}
                style={{
                  flex: 1,
                  padding: `${theme.spacing.xs}px ${theme.spacing.sm}px`,
                  fontSize: theme.typography.fontSize.xs,
                  borderRadius: theme.borderRadius.sm,
                  background: `${theme.colors.state.success}99`,
                  color: theme.colors.text.primary,
                  border: "none",
                  cursor: "pointer",
                }}
              >
                OK
              </button>
              <button
                onClick={onClose}
                style={{
                  flex: 1,
                  padding: `${theme.spacing.xs}px ${theme.spacing.sm}px`,
                  fontSize: theme.typography.fontSize.xs,
                  borderRadius: theme.borderRadius.sm,
                  background: `${theme.colors.state.danger}99`,
                  color: theme.colors.text.primary,
                  border: "none",
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          menuOptions.map((option, idx) => (
            <button
              key={idx}
              style={menuItemStyle(hoveredIndex === idx)}
              onMouseEnter={() => setHoveredIndex(idx)}
              onMouseLeave={() => setHoveredIndex(null)}
              onClick={(e) => {
                e.stopPropagation();
                if (option.amount === -1) {
                  setShowCustomInput(true);
                } else if (
                  option.action === "setPlaceholder" ||
                  option.action === "releasePlaceholder"
                ) {
                  onAction(option.action, 0);
                  onClose();
                } else {
                  onAction(
                    option.action,
                    Math.min(option.amount, menu.quantity),
                  );
                  onClose();
                }
              }}
            >
              {option.label}
            </button>
          ))
        )}
      </div>
    </div>,
    document.body,
  );
}
