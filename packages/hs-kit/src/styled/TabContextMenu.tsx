import React, { memo, useEffect, useRef } from "react";
import { useTheme } from "../stores/themeStore";
import type { Point } from "../types";

export interface TabContextMenuAction {
  label: string;
  action: () => void;
  disabled?: boolean;
  danger?: boolean;
}

interface TabContextMenuProps {
  isOpen: boolean;
  position: Point;
  actions: TabContextMenuAction[];
  onClose: () => void;
}

export const TabContextMenu = memo(function TabContextMenu({
  isOpen,
  position,
  actions,
  onClose,
}: TabContextMenuProps): React.ReactElement | null {
  const theme = useTheme();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen, onClose]);

  if (!isOpen || actions.length === 0) return null;

  const menuStyle: React.CSSProperties = {
    position: "fixed",
    left: position.x,
    top: position.y,
    backgroundColor: theme.colors.background.primary,
    border: `1px solid ${theme.colors.border.default}`,
    borderRadius: theme.borderRadius.md,
    boxShadow: theme.shadows.lg,
    padding: `${theme.spacing.xs}px 0`,
    minWidth: 160,
    zIndex: theme.zIndex.tooltip,
  };

  const getItemStyle = (
    danger?: boolean,
    disabled?: boolean,
  ): React.CSSProperties => ({
    padding: `${theme.spacing.sm}px ${theme.spacing.md}px`,
    cursor: disabled ? "not-allowed" : "pointer",
    color: disabled
      ? theme.colors.text.muted
      : danger
        ? theme.colors.state.danger
        : theme.colors.text.primary,
    opacity: disabled ? 0.5 : 1,
    fontSize: theme.typography.fontSize.sm,
  });

  return (
    <div ref={menuRef} style={menuStyle}>
      {actions.map((action, index) => (
        <div
          key={index}
          style={getItemStyle(action.danger, action.disabled)}
          onClick={action.disabled ? undefined : action.action}
          onMouseEnter={(e) => {
            if (!action.disabled) {
              (e.target as HTMLElement).style.backgroundColor =
                theme.colors.background.secondary;
            }
          }}
          onMouseLeave={(e) => {
            (e.target as HTMLElement).style.backgroundColor = "transparent";
          }}
        >
          {action.label}
        </div>
      ))}
    </div>
  );
});
