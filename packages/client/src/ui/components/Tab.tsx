import React, { memo } from "react";
import {
  // Combat & Action
  Swords,
  Zap,
  // Skills & Magic
  Wand2,
  Sparkles,
  // Inventory & Equipment
  Package,
  Gem,
  // Stats & Info
  Activity,
  // Navigation
  Radar,
  Globe2,
  // Social
  MessageCircle,
  Users2,
  // Account & Settings
  CircleUserRound,
  SlidersHorizontal,
  // Quests & Other
  ScrollText,
  LayoutGrid,
  Landmark,
  Menu,
  type LucideIcon,
} from "lucide-react";
import { useDrag } from "../core/drag/useDrag";
import { useEditMode } from "../core/edit/useEditMode";
import { useTheme } from "../stores/themeStore";
import type { TabProps } from "../types";

/** Map icon identifiers to Lucide components */
const LUCIDE_ICON_MAP: Record<string, LucideIcon> = {
  // Panel icons
  inventory: Package,
  equipment: Gem,
  stats: Activity,
  skills: Wand2,
  prayer: Sparkles,
  combat: Swords,
  chat: MessageCircle,
  account: CircleUserRound,
  settings: SlidersHorizontal,
  minimap: Radar,
  map: Globe2,
  friends: Users2,
  quests: ScrollText,
  dashboard: LayoutGrid,
  action: Zap,
  "actionbar-0": Zap,
  "actionbar-1": Zap,
  "actionbar-2": Zap,
  "actionbar-3": Zap,
  "actionbar-4": Zap,
  menubar: Menu,
  bank: Landmark,
  presets: LayoutGrid,
};

/**
 * Single tab component
 *
 * @example
 * ```tsx
 * <Tab
 *   tab={tab}
 *   isActive={true}
 *   onActivate={() => setActiveTab(index)}
 *   onClose={() => removeTab(tab.id)}
 * />
 * ```
 */
export const Tab = memo(function Tab({
  tab,
  isActive,
  onActivate,
  onClose,
  className,
  style,
}: TabProps): React.ReactElement {
  const theme = useTheme();
  const { isUnlocked } = useEditMode();

  const { isDragging, dragHandleProps } = useDrag({
    id: tab.id,
    type: "tab",
    sourceId: tab.windowId,
    disabled: !isUnlocked,
  });

  // Icon-only mode: show icon instead of text for compact tabs
  const hasIcon = Boolean(tab.icon);

  // Get Lucide icon component if available (check by tab content ID or tab ID)
  const contentId = typeof tab.content === "string" ? tab.content : "";
  const LucideIcon =
    LUCIDE_ICON_MAP[contentId] || LUCIDE_ICON_MAP[tab.id] || null;

  // Merge styles properly to avoid overwriting
  const containerStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing.xs,
    padding: hasIcon
      ? `${theme.spacing.xs}px ${theme.spacing.sm}px`
      : `${theme.spacing.xs}px ${theme.spacing.sm}px`,
    backgroundColor: isActive
      ? theme.colors.background.secondary
      : "transparent",
    borderRight: `1px solid ${theme.colors.border.default}`,
    opacity: isDragging ? 0.5 : 1,
    transition: `background-color ${theme.transitions.fast}`,
    userSelect: "none",
    minWidth: hasIcon ? 32 : 60,
    maxWidth: hasIcon ? 40 : 120,
    ...style,
    ...(isUnlocked ? dragHandleProps.style : { cursor: "pointer" }),
  };

  const iconStyle: React.CSSProperties = {
    fontSize: 16,
    lineHeight: 1,
    filter: isActive ? "none" : "grayscale(30%)",
    opacity: isActive ? 1 : 0.8,
    color: isActive ? theme.colors.accent.primary : theme.colors.text.secondary,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  };

  const labelStyle: React.CSSProperties = {
    flex: 1,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: isActive ? theme.colors.text.primary : theme.colors.text.secondary,
    fontSize: theme.typography.fontSize.sm,
  };

  const closeButtonStyle: React.CSSProperties = {
    width: 16,
    height: 16,
    border: "none",
    background: "transparent",
    color: theme.colors.text.muted,
    cursor: "pointer",
    borderRadius: theme.borderRadius.sm,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: theme.typography.fontSize.sm,
    padding: 0,
    opacity: isActive ? 1 : 0,
    transition: `opacity ${theme.transitions.fast}`,
  };

  return (
    <div
      className={className}
      style={containerStyle}
      data-tab={tab.id}
      onClick={onActivate}
      onKeyDown={(e: React.KeyboardEvent<HTMLDivElement>) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onActivate();
        }
      }}
      onMouseEnter={(e: React.MouseEvent<HTMLDivElement>) => {
        if (!isActive) {
          e.currentTarget.style.backgroundColor =
            theme.colors.background.tertiary;
        }
        const closeBtn = e.currentTarget.querySelector(
          "[data-close-btn]",
        ) as HTMLElement;
        if (closeBtn) closeBtn.style.opacity = "1";
      }}
      onMouseLeave={(e: React.MouseEvent<HTMLDivElement>) => {
        if (!isActive) {
          e.currentTarget.style.backgroundColor = "transparent";
        }
        const closeBtn = e.currentTarget.querySelector(
          "[data-close-btn]",
        ) as HTMLElement;
        if (closeBtn && !isActive) closeBtn.style.opacity = "0";
      }}
      {...(isUnlocked ? { onPointerDown: dragHandleProps.onPointerDown } : {})}
      role="tab"
      tabIndex={isActive ? 0 : -1}
      aria-selected={isActive}
      aria-label={tab.label}
      title={tab.label}
    >
      {hasIcon || LucideIcon ? (
        <span style={iconStyle}>
          {LucideIcon ? <LucideIcon size={16} strokeWidth={1.75} /> : tab.icon}
        </span>
      ) : (
        <span style={labelStyle}>{tab.label}</span>
      )}
      {/* Only show close button when in edit mode (isUnlocked) */}
      {onClose && isActive && isUnlocked && (
        <button
          data-close-btn
          style={closeButtonStyle}
          onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
            e.stopPropagation();
            onClose();
          }}
          onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) => {
            e.currentTarget.style.backgroundColor = theme.colors.state.danger;
            e.currentTarget.style.color = theme.colors.text.primary;
          }}
          onMouseLeave={(e: React.MouseEvent<HTMLButtonElement>) => {
            e.currentTarget.style.backgroundColor = "transparent";
            e.currentTarget.style.color = theme.colors.text.muted;
          }}
        >
          ×
        </button>
      )}
    </div>
  );
});
