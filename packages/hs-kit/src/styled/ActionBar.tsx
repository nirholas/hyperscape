/**
 * Action Bar Components
 *
 * Combat ability bar system with keybinds and cooldowns.
 * Supports multiple bars, drag-drop, and customizable keybinds.
 *
 * @packageDocumentation
 */

import React, { memo, useCallback, useMemo, type CSSProperties } from "react";
import { useDraggable, useDroppable } from "../core/drag";
import { useTheme } from "../stores/themeStore";
import { useActionBarKeybinds } from "../stores/keybindStore";
import { useFeatureEnabled } from "../stores/complexityStore";

/** Action type */
export type ActionType =
  | "ability"
  | "prayer"
  | "spell"
  | "item"
  | "emote"
  | "teleport";

/** Action definition */
export interface Action {
  id: string;
  type: ActionType;
  /** Icon - can be emoji string or React component */
  icon: string | React.ComponentType<{ size?: number; className?: string }>;
  name: string;
  tooltip?: string;
  cooldown?: number; // Base cooldown in ms
  charges?: number;
}

/** Action slot state */
export interface ActionSlot {
  index: number;
  action: Action | null;
  keybind: string;
  cooldownRemaining: number; // ms
}

/** Action bar state */
export interface ActionBarState {
  id: number;
  visible: boolean;
  locked: boolean;
  orientation: "horizontal" | "vertical";
  slots: ActionSlot[];
}

/** Props for ActionSlot component */
interface ActionSlotProps {
  slot: ActionSlot;
  barId: number;
  size?: number;
  onActionClick?: (slot: ActionSlot) => void;
  onActionDrop?: (
    barId: number,
    slotIndex: number,
    action: Action | null,
  ) => void;
}

/** Props for ActionBar component */
export interface ActionBarProps {
  bar: ActionBarState;
  slotSize?: number;
  onActionClick?: (slot: ActionSlot) => void;
  onActionDrop?: (
    barId: number,
    slotIndex: number,
    action: Action | null,
  ) => void;
  onLockToggle?: (barId: number) => void;
  className?: string;
  style?: CSSProperties;
}

/**
 * Individual action slot component
 */
const ActionSlotComponent = memo(function ActionSlotComponent({
  slot,
  barId,
  size = 40,
  onActionClick,
  onActionDrop: _onActionDrop,
}: ActionSlotProps) {
  const theme = useTheme();

  const {
    attributes,
    listeners,
    setNodeRef: setDragRef,
    isDragging,
  } = useDraggable({
    id: `action-${barId}-${slot.index}`,
    data: { action: slot.action, barId, slotIndex: slot.index },
    disabled: !slot.action,
  });

  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `action-drop-${barId}-${slot.index}`,
    data: { barId, slotIndex: slot.index },
  });

  const setNodeRef = useCallback(
    (node: HTMLElement | null) => {
      setDragRef(node);
      setDropRef(node);
    },
    [setDragRef, setDropRef],
  );

  const handleClick = useCallback(() => {
    if (slot.action && slot.cooldownRemaining <= 0) {
      onActionClick?.(slot);
    }
  }, [slot, onActionClick]);

  const cooldownPercent =
    slot.action?.cooldown && slot.cooldownRemaining > 0
      ? (slot.cooldownRemaining / slot.action.cooldown) * 100
      : 0;

  const slotStyle: CSSProperties = {
    width: size,
    height: size,
    position: "relative",
    backgroundColor: isOver
      ? theme.colors.accent.primary + "33"
      : theme.colors.slot.empty,
    border: `1px solid ${isOver ? theme.colors.accent.primary : theme.colors.border.default}`,
    borderRadius: theme.slot.borderRadius,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: slot.action ? "pointer" : "default",
    opacity: isDragging ? 0.5 : 1,
    transition: `background-color ${theme.transitions.fast}, border-color ${theme.transitions.fast}`,
  };

  const iconSize = Math.round(size * 0.55);
  const iconStyle: CSSProperties = {
    fontSize: iconSize,
    opacity: slot.cooldownRemaining > 0 ? 0.6 : 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: theme.colors.accent.primary,
  };

  // Render icon - supports both emoji strings and React components
  const renderIcon = () => {
    if (!slot.action) return null;
    const { icon } = slot.action;

    if (typeof icon === "string") {
      // Emoji or text icon
      return <span style={iconStyle}>{icon}</span>;
    }

    // React component icon (e.g., Lucide)
    const IconComponent = icon;
    return (
      <span style={{ ...iconStyle, fontSize: undefined }}>
        <IconComponent size={iconSize} />
      </span>
    );
  };

  const cooldownOverlayStyle: CSSProperties = {
    position: "absolute",
    inset: 0,
    background: `conic-gradient(
      rgba(0, 0, 0, 0.7) ${cooldownPercent}%,
      transparent ${cooldownPercent}%
    )`,
    borderRadius: theme.slot.borderRadius,
    pointerEvents: "none",
  };

  const cooldownTextStyle: CSSProperties = {
    position: "absolute",
    inset: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: theme.colors.text.primary,
    fontSize: size * 0.3,
    fontWeight: theme.typography.fontWeight.bold,
    textShadow: "1px 1px 2px rgba(0,0,0,0.8)",
    pointerEvents: "none",
  };

  const keybindStyle: CSSProperties = {
    position: "absolute",
    top: 2,
    right: 2,
    fontSize: size * 0.2,
    color: theme.colors.text.secondary,
    backgroundColor: "rgba(0,0,0,0.6)",
    padding: "1px 3px",
    borderRadius: 2,
    lineHeight: 1,
  };

  const chargesStyle: CSSProperties = {
    position: "absolute",
    bottom: 2,
    right: 2,
    fontSize: size * 0.22,
    color: theme.colors.state.success,
    fontWeight: theme.typography.fontWeight.bold,
    textShadow: "1px 1px 2px rgba(0,0,0,0.8)",
  };

  return (
    <button
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={handleClick}
      style={slotStyle}
      title={slot.action?.tooltip || slot.action?.name}
    >
      {/* Action icon */}
      {renderIcon()}

      {/* Cooldown overlay */}
      {cooldownPercent > 0 && <div style={cooldownOverlayStyle} />}

      {/* Cooldown text */}
      {slot.cooldownRemaining > 1000 && (
        <div style={cooldownTextStyle}>
          {Math.ceil(slot.cooldownRemaining / 1000)}
        </div>
      )}

      {/* Keybind display */}
      {slot.keybind && <span style={keybindStyle}>{slot.keybind}</span>}

      {/* Charges display */}
      {slot.action?.charges !== undefined && slot.action.charges > 0 && (
        <span style={chargesStyle}>{slot.action.charges}</span>
      )}
    </button>
  );
});

/**
 * Action Bar Component
 *
 * @example
 * ```tsx
 * function CombatUI() {
 *   const [bar, setBar] = useState<ActionBarState>({
 *     id: 1,
 *     visible: true,
 *     locked: false,
 *     orientation: 'horizontal',
 *     slots: Array.from({ length: 14 }, (_, i) => ({
 *       index: i,
 *       action: null,
 *       keybind: String(i + 1),
 *       cooldownRemaining: 0,
 *     })),
 *   });
 *
 *   return (
 *     <ActionBar
 *       bar={bar}
 *       onActionClick={(slot) => console.log('Clicked', slot.action)}
 *       onLockToggle={() => setBar(b => ({ ...b, locked: !b.locked }))}
 *     />
 *   );
 * }
 * ```
 */
export const ActionBar = memo(function ActionBar({
  bar,
  slotSize = 40,
  onActionClick,
  onActionDrop,
  onLockToggle,
  className,
  style,
}: ActionBarProps) {
  const theme = useTheme();

  if (!bar.visible) return null;

  const containerStyle: CSSProperties = {
    display: "flex",
    flexDirection: bar.orientation === "horizontal" ? "row" : "column",
    gap: theme.slot.gap,
    padding: theme.spacing.xs,
    backgroundColor: theme.colors.background.glass,
    borderRadius: theme.borderRadius.md,
    border: `1px solid ${theme.colors.border.default}`,
    backdropFilter: `blur(${theme.glass.blur}px)`,
    WebkitBackdropFilter: `blur(${theme.glass.blur}px)`,
    ...style,
  };

  const lockButtonStyle: CSSProperties = {
    width: slotSize * 0.6,
    height: slotSize * 0.6,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: bar.locked
      ? theme.colors.state.danger + "33"
      : theme.colors.background.secondary,
    border: `1px solid ${bar.locked ? theme.colors.state.danger : theme.colors.border.default}`,
    borderRadius: theme.borderRadius.sm,
    color: theme.colors.text.secondary,
    fontSize: slotSize * 0.3,
    cursor: "pointer",
    transition: theme.transitions.fast,
  };

  return (
    <div className={className} style={containerStyle}>
      {/* Lock toggle button */}
      <button
        onClick={() => onLockToggle?.(bar.id)}
        style={lockButtonStyle}
        title={bar.locked ? "Unlock action bar" : "Lock action bar"}
      >
        {bar.locked ? "🔒" : "🔓"}
      </button>

      {/* Action slots */}
      {bar.slots.map((slot) => (
        <ActionSlotComponent
          key={slot.index}
          slot={slot}
          barId={bar.id}
          size={slotSize}
          onActionClick={onActionClick}
          onActionDrop={onActionDrop}
        />
      ))}
    </div>
  );
});

/**
 * Create an empty action bar with default keybinds
 */
export function createActionBar(
  id: number,
  keybinds?: string[],
): ActionBarState {
  const defaultKeybinds = [
    "1",
    "2",
    "3",
    "4",
    "5",
    "6",
    "7",
    "8",
    "9",
    "0",
    "-",
    "=",
    "Backspace",
    "Insert",
  ];

  return {
    id,
    visible: true,
    locked: false,
    orientation: "horizontal",
    slots: Array.from({ length: 14 }, (_, i) => ({
      index: i,
      action: null,
      keybind: keybinds?.[i] ?? defaultKeybinds[i] ?? "",
      cooldownRemaining: 0,
    })),
  };
}

/**
 * Default keybinds for each action bar (fallback when customKeybinds disabled)
 */
export const DEFAULT_ACTION_BAR_KEYBINDS = {
  1: [
    "1",
    "2",
    "3",
    "4",
    "5",
    "6",
    "7",
    "8",
    "9",
    "0",
    "-",
    "=",
    "Backspace",
    "Insert",
  ],
  2: [
    "Ctrl+1",
    "Ctrl+2",
    "Ctrl+3",
    "Ctrl+4",
    "Ctrl+5",
    "Ctrl+6",
    "Ctrl+7",
    "Ctrl+8",
    "Ctrl+9",
    "Ctrl+0",
    "Ctrl+-",
    "Ctrl+=",
    "Ctrl+Backspace",
    "Ctrl+Insert",
  ],
  3: [
    "Shift+1",
    "Shift+2",
    "Shift+3",
    "Shift+4",
    "Shift+5",
    "Shift+6",
    "Shift+7",
    "Shift+8",
    "Shift+9",
    "Shift+0",
    "Shift+-",
    "Shift+=",
    "Shift+Backspace",
    "Shift+Insert",
  ],
  4: [
    "Alt+1",
    "Alt+2",
    "Alt+3",
    "Alt+4",
    "Alt+5",
    "Alt+6",
    "Alt+7",
    "Alt+8",
    "Alt+9",
    "Alt+0",
    "Alt+-",
    "Alt+=",
    "Alt+Backspace",
    "Alt+Insert",
  ],
  5: [
    "Q",
    "W",
    "E",
    "R",
    "T",
    "Y",
    "U",
    "I",
    "O",
    "P",
    "[",
    "]",
    "\\",
    "Delete",
  ],
};

/**
 * Hook to get keybinds for an action bar
 *
 * Returns custom keybinds from keybindStore when customKeybinds feature is enabled,
 * otherwise falls back to DEFAULT_ACTION_BAR_KEYBINDS.
 *
 * @param barId - The action bar ID (1-5)
 * @returns Array of 14 keybind strings for the slots
 *
 * @example
 * ```tsx
 * function MyActionBar({ barId }: { barId: number }) {
 *   const keybinds = useActionBarKeybindsForBar(barId);
 *   const bar = useMemo(() => createActionBar(barId, keybinds), [barId, keybinds]);
 *   return <ActionBar bar={bar} />;
 * }
 * ```
 */
export function useActionBarKeybindsForBar(barId: number): string[] {
  const customKeybindsEnabled = useFeatureEnabled("customKeybinds");
  const storeKeybinds = useActionBarKeybinds();

  return useMemo(() => {
    // Only bar 1 uses the keybindStore (primary action bar)
    // Other bars use the hardcoded defaults with modifiers
    if (barId === 1 && customKeybindsEnabled) {
      return storeKeybinds;
    }

    // Fall back to default keybinds for this bar
    const defaults =
      DEFAULT_ACTION_BAR_KEYBINDS[
        barId as keyof typeof DEFAULT_ACTION_BAR_KEYBINDS
      ];
    return defaults ?? DEFAULT_ACTION_BAR_KEYBINDS[1];
  }, [barId, customKeybindsEnabled, storeKeybinds]);
}

/**
 * Panel action definition for menu/panel shortcuts
 */
export interface PanelActionDef {
  id: string;
  name: string;
  tooltip?: string;
  keybind?: string;
}

/**
 * Create panel actions using hs-kit GameIcons
 * This is a convenience function for creating menu bar actions with Lucide icons
 *
 * @example
 * ```tsx
 * import { createPanelActions, GameIcons } from 'hs-kit';
 *
 * const panelActions = createPanelActions([
 *   { id: 'inventory', name: 'Inventory', tooltip: 'Open Inventory (I)', keybind: 'I' },
 *   { id: 'equipment', name: 'Equipment', tooltip: 'Open Equipment (E)', keybind: 'E' },
 *   { id: 'stats', name: 'Stats', tooltip: 'View Stats (S)', keybind: 'S' },
 * ]);
 * ```
 */
export function createPanelActions(
  panels: PanelActionDef[],
  iconMap?: Record<
    string,
    React.ComponentType<{ size?: number; className?: string }>
  >,
): Action[] {
  // Default icon mapping using GameIcons
  const defaultIconMap: Record<
    string,
    React.ComponentType<{ size?: number; className?: string }>
  > = {};

  // We'll let the consumer provide icons or use a fallback
  const icons = iconMap || defaultIconMap;

  return panels.map((panel) => ({
    id: panel.id,
    type: "ability" as ActionType,
    icon: icons[panel.id] || panel.id.charAt(0).toUpperCase(), // Fallback to first letter
    name: panel.name,
    tooltip: panel.tooltip || panel.name,
  }));
}
