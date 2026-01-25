import React, { useEffect, useRef, useState, useCallback, useId } from "react";
import { useMemo } from "react";
import { useThemeStore } from "hs-kit";

interface ContextMenuAction {
  id: string;
  label: string;
  icon?: string;
  enabled: boolean;
  onClick: () => void;
  /** Optional keyboard shortcut to display */
  shortcut?: string;
  /** Optional danger styling (for destructive actions) */
  danger?: boolean;
}

interface ContextMenuProps {
  visible: boolean;
  position: { x: number; y: number };
  actions: ContextMenuAction[];
  onClose: () => void;
  title?: string;
}

export function ContextMenu({
  visible,
  position,
  actions,
  onClose,
  title,
}: ContextMenuProps) {
  const theme = useThemeStore((s) => s.theme);
  const menuRef = useRef<HTMLDivElement>(null);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  // Refs for each menu item button for roving tabindex focus management

  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Generate unique ID for this menu instance (for aria-activedescendant)
  // Using React's useId() for stable, SSR-friendly IDs
  const menuId = `context-menu-${useId()}`;
  const [adjustedPosition, setAdjustedPosition] = useState(position);
  const [isPositioned, setIsPositioned] = useState(false);

  // Reset positioned state when visibility changes
  useEffect(() => {
    if (!visible) {
      setIsPositioned(false);
    }
  }, [visible]);

  // Focus the appropriate item when focusedIndex changes (roving tabindex)
  useEffect(() => {
    if (visible && focusedIndex >= 0 && itemRefs.current[focusedIndex]) {
      itemRefs.current[focusedIndex]?.focus();
    }
  }, [visible, focusedIndex]);

  // Adjust position to stay within viewport
  // Uses primitive values (position.x, position.y) to avoid re-triggering when callers
  // pass new inline position objects with the same coordinates.
  // Callers can also memoize the position prop for stable object identity.
  useEffect(() => {
    if (!visible || !menuRef.current) return;

    const menu = menuRef.current;
    const rect = menu.getBoundingClientRect();
    const padding = 8;

    let x = position.x;
    let y = position.y;

    // Flip horizontally if too close to right edge
    if (x + rect.width + padding > window.innerWidth) {
      x = Math.max(padding, window.innerWidth - rect.width - padding);
    }

    // Flip vertically if too close to bottom edge
    if (y + rect.height + padding > window.innerHeight) {
      y = Math.max(padding, window.innerHeight - rect.height - padding);
    }

    setAdjustedPosition({ x, y });
    setIsPositioned(true);
  }, [visible, position.x, position.y]);

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (!visible) return;

      switch (event.key) {
        case "Escape":
          onClose();
          break;
        case "ArrowDown":
          event.preventDefault();
          setFocusedIndex((prev) => {
            const enabledIndices = actions
              .map((a, i) => (a.enabled ? i : -1))
              .filter((i) => i !== -1);
            if (enabledIndices.length === 0) return prev;
            const currentIdx = enabledIndices.indexOf(prev);
            const nextIdx =
              currentIdx === -1 ? 0 : (currentIdx + 1) % enabledIndices.length;
            return enabledIndices[nextIdx];
          });
          break;
        case "ArrowUp":
          event.preventDefault();
          setFocusedIndex((prev) => {
            const enabledIndices = actions
              .map((a, i) => (a.enabled ? i : -1))
              .filter((i) => i !== -1);
            if (enabledIndices.length === 0) return prev;
            const currentIdx = enabledIndices.indexOf(prev);
            const nextIdx =
              currentIdx === -1
                ? enabledIndices.length - 1
                : (currentIdx - 1 + enabledIndices.length) %
                  enabledIndices.length;
            return enabledIndices[nextIdx];
          });
          break;
        case "Enter":
          event.preventDefault();
          if (focusedIndex >= 0 && actions[focusedIndex]?.enabled) {
            actions[focusedIndex].onClick();
            onClose();
          }
          break;
      }
    },
    [visible, actions, focusedIndex, onClose],
  );

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    if (visible) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleKeyDown);
      setFocusedIndex(-1);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [visible, onClose, handleKeyDown]);

  // Memoize styles to avoid recalculating on every render
  const styles = useMemo(
    () => ({
      menu: {
        position: "fixed" as const,
        left: adjustedPosition.x,
        top: adjustedPosition.y,
        minWidth: 180,
        background: `linear-gradient(135deg, ${theme.colors.background.glass} 0%, ${theme.colors.background.secondary} 100%)`,
        backdropFilter: `blur(${theme.glass.blur}px)`,
        border: `1px solid ${theme.colors.border.default}`,
        borderRadius: theme.borderRadius.lg,
        boxShadow: theme.shadows.lg,
        zIndex: theme.zIndex.popover,
        padding: `${theme.spacing.sm}px 0`,
        pointerEvents: "auto" as const,
        // Hide until positioned to prevent flash
        opacity: isPositioned ? 1 : 0,
        visibility: isPositioned ? ("visible" as const) : ("hidden" as const),
      },
      title: {
        padding: `${theme.spacing.sm}px ${theme.spacing.lg}px`,
        borderBottom: `1px solid ${theme.colors.border.default}`,
        marginBottom: theme.spacing.xs,
        fontSize: theme.typography.fontSize.xs,
        fontFamily: theme.typography.fontFamily.body,
        fontWeight: theme.typography.fontWeight.semibold,
        color: theme.colors.text.muted,
        textTransform: "uppercase" as const,
        letterSpacing: "0.05em",
      },
      menuItem: {
        width: "100%",
        display: "flex",
        alignItems: "center",
        gap: theme.spacing.sm,
        padding: `${theme.spacing.sm}px ${theme.spacing.lg}px`,
        background: "transparent",
        border: "none",
        outline: "none",
        fontSize: theme.typography.fontSize.sm,
        fontFamily: theme.typography.fontFamily.body,
        textAlign: "left" as const,
        transition: theme.transitions.fast,
      },
      shortcut: {
        fontSize: theme.typography.fontSize.xs,
        color: theme.colors.text.muted,
        fontFamily: theme.typography.fontFamily.mono,
      },
    }),
    [theme, adjustedPosition, isPositioned],
  );

  if (!visible) return null;

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label={title || "Context menu"}
      aria-activedescendant={
        focusedIndex >= 0 ? `${menuId}-item-${focusedIndex}` : undefined
      }
      style={styles.menu}
      className="animate-context-menu-in"
    >
      {title && <div style={styles.title}>{title}</div>}

      {actions.map((action, index) => (
        <button
          key={action.id}
          ref={(el) => {
            itemRefs.current[index] = el;
          }}
          id={`${menuId}-item-${index}`}
          role="menuitem"
          disabled={!action.enabled}
          aria-disabled={!action.enabled}
          tabIndex={focusedIndex === index ? 0 : -1}
          onClick={(e) => {
            e.stopPropagation();
            if (action.enabled) {
              action.onClick();
              onClose();
            }
          }}
          onMouseDown={(e) => e.stopPropagation()}
          onMouseEnter={() => {
            // Only update focus for enabled items to prevent disabled items from appearing focused
            if (action.enabled) {
              setFocusedIndex(index);
            }
          }}
          style={{
            ...styles.menuItem,
            background:
              focusedIndex === index ? theme.colors.slot.hover : "transparent",
            color: action.danger
              ? theme.colors.state.danger
              : action.enabled
                ? theme.colors.text.primary
                : theme.colors.text.disabled,
            cursor: action.enabled ? "pointer" : "not-allowed",
          }}
        >
          {action.icon && (
            <span style={{ fontSize: theme.typography.fontSize.base }}>
              {action.icon}
            </span>
          )}
          <span style={{ flex: 1 }}>{action.label}</span>
          {action.shortcut && (
            <span style={styles.shortcut}>{action.shortcut}</span>
          )}
        </button>
      ))}
    </div>
  );
}

export type { ContextMenuAction };
