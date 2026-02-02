/**
 * Quest Log Component
 *
 * Clean OSRS-style quest log with minimal UI chrome.
 * Features color-coded quest status and collapsible filters.
 *
 * @packageDocumentation
 */

import React, {
  memo,
  useState,
  useCallback,
  useMemo,
  useEffect,
  type CSSProperties,
} from "react";

/** Mobile breakpoint (matches client/constants breakpoints.md) */
const MOBILE_BREAKPOINT = 640;

/** Filter icon SVG */
const FilterIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
    <path d="M1 2h14v2H1V2zm2 4h10v2H3V6zm2 4h6v2H5v-2z" />
  </svg>
);

/** Search icon SVG */
const SearchIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
    <path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001c.03.04.062.078.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1.007 1.007 0 0 0-.115-.1zM12 6.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0z" />
  </svg>
);
import { useTheme, useAccessibilityStore, useMobileLayout } from "@/ui";
import {
  type Quest,
  type QuestState,
  type QuestCategory,
  type QuestSortOption,
  type SortDirection,
  CATEGORY_CONFIG,
  STATE_CONFIG,
  calculateQuestProgress,
  formatTimeRemaining,
} from "@/game/systems";
import { QuestObjective } from "./QuestObjective";
import { QuestRewards } from "./QuestRewards";

/** Props for QuestLog component */
export interface QuestLogProps {
  /** Quests to display (already filtered/sorted from hook) */
  quests: Quest[];
  /** Quest counts by state */
  questCounts?: {
    active: number;
    available: number;
    completed: number;
  };
  /** Search text */
  searchText?: string;
  /** Search change handler */
  onSearchChange?: (text: string) => void;
  /** Current sort option */
  sortBy?: QuestSortOption;
  /** Sort change handler */
  onSortChange?: (option: QuestSortOption) => void;
  /** Sort direction */
  sortDirection?: SortDirection;
  /** Sort direction change handler */
  onSortDirectionChange?: (direction: SortDirection) => void;
  /** Active state filter */
  stateFilter?: QuestState[];
  /** State filter change handler */
  onStateFilterChange?: (states: QuestState[]) => void;
  /** Active category filter */
  categoryFilter?: QuestCategory[];
  /** Category filter change handler */
  onCategoryFilterChange?: (categories: QuestCategory[]) => void;
  /** Currently selected quest ID */
  selectedQuestId?: string | null;
  /** Selection change handler */
  onSelectQuest?: (quest: Quest | null) => void;
  /** Pin toggle handler */
  onTogglePin?: (quest: Quest) => void;
  /** Accept quest handler */
  onAcceptQuest?: (quest: Quest) => void;
  /** Complete quest handler */
  onCompleteQuest?: (quest: Quest) => void;
  /** Track quest handler */
  onTrackQuest?: (quest: Quest) => void;
  /** Group by category */
  groupByCategory?: boolean;
  /** Show search bar */
  showSearch?: boolean;
  /** Show filters */
  showFilters?: boolean;
  /** Show sort options */
  showSort?: boolean;
  /** Show header */
  showHeader?: boolean;
  /** Title */
  title?: string;
  /** Empty state message */
  emptyMessage?: string;
  /** Max height (scrollable) */
  maxHeight?: number | string;
  /** Custom class name */
  className?: string;
  /** Custom style */
  style?: CSSProperties;
  /**
   * If true, the internal popup is disabled and onQuestClick is called instead.
   * Use this when you want to render the quest detail in a separate window.
   */
  useExternalPopup?: boolean;
  /**
   * Called when a quest is clicked (only when useExternalPopup is true).
   * Use this to open the quest detail in a separate window/panel.
   */
  onQuestClick?: (quest: Quest) => void;
}

// OSRS-style status colors
const STATUS_COLORS: Record<QuestState, string> = {
  available: "#ff4444", // Red - not started
  active: "#ffff00", // Yellow - in progress
  completed: "#00ff00", // Green - complete
  failed: "#888888", // Gray - failed
};

/** Props for Quest Detail Popup Component */
export interface QuestDetailPopupProps {
  quest: Quest;
  onClose: () => void;
  onTogglePin?: (quest: Quest) => void;
  onAcceptQuest?: (quest: Quest) => void;
  onCompleteQuest?: (quest: Quest) => void;
  onTrackQuest?: (quest: Quest) => void;
}

/**
 * Quest Detail Popup Component
 *
 * Displays detailed information about a quest including objectives,
 * rewards, and action buttons. Can be used standalone or within QuestLog.
 */
export const QuestDetailPopup = memo(function QuestDetailPopup({
  quest,
  onClose,
  onTogglePin,
  onAcceptQuest,
  onCompleteQuest,
  onTrackQuest,
}: QuestDetailPopupProps): React.ReactElement {
  const theme = useTheme();
  const progress = calculateQuestProgress(quest);
  const categoryConfig = CATEGORY_CONFIG[quest.category];

  const canAccept = quest.state === "available";
  const canComplete = quest.state === "active" && progress === 100;

  // Mobile responsiveness
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined"
      ? window.innerWidth < MOBILE_BREAKPOINT
      : false,
  );

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Overlay styles
  const overlayStyle: CSSProperties = {
    position: "fixed",
    inset: 0,
    zIndex: 9999,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0, 0, 0, 0.8)",
    backdropFilter: "blur(2px)",
    padding: isMobile ? `${theme.spacing.sm}px` : 0,
  };

  // Popup container - using theme colors (responsive)
  const popupStyle: CSSProperties = {
    width: isMobile ? "100%" : "400px",
    maxWidth: "90vw",
    maxHeight: isMobile ? "90vh" : "80vh",
    background: theme.colors.background.primary,
    border: `1px solid ${theme.colors.border.decorative}`,
    borderRadius: `${theme.borderRadius.lg}px`,
    padding: "0",
    boxShadow: theme.shadows.window,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  };

  // Header styles (responsive)
  const headerStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: isMobile ? theme.spacing.xs : theme.spacing.sm,
    padding: isMobile
      ? `${theme.spacing.sm}px ${theme.spacing.sm}px`
      : `${theme.spacing.sm}px ${theme.spacing.md}px`,
    borderBottom: `1px solid ${theme.colors.border.default}`,
    background: theme.colors.background.secondary,
    minHeight: isMobile ? "48px" : "44px",
  };

  // Back button (larger on mobile for touch)
  const buttonSize = isMobile ? "36px" : "24px";
  const backButtonStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: buttonSize,
    height: buttonSize,
    background: "transparent",
    border: "none",
    color: theme.colors.text.muted,
    cursor: "pointer",
    padding: 0,
    borderRadius: `${theme.borderRadius.sm}px`,
    transition: theme.transitions.fast,
  };

  const titleStyle: CSSProperties = {
    flex: 1,
    color: STATUS_COLORS[quest.state],
    fontSize: isMobile
      ? theme.typography.fontSize.lg
      : theme.typography.fontSize.base,
    fontWeight: theme.typography.fontWeight.semibold,
    margin: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  };

  const closeButtonStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: buttonSize,
    height: buttonSize,
    background: "transparent",
    border: "none",
    color: theme.colors.text.muted,
    cursor: "pointer",
    padding: 0,
    borderRadius: `${theme.borderRadius.sm}px`,
    fontSize: isMobile ? "22px" : "18px",
    lineHeight: 1,
  };

  // Content area with scrollbar (responsive padding)
  const contentStyle: CSSProperties = {
    flex: 1,
    overflowY: "auto",
    padding: isMobile ? theme.spacing.sm : theme.spacing.md,
    WebkitOverflowScrolling: "touch", // Smooth scrolling on iOS
  };

  // Section styles
  const sectionStyle: CSSProperties = {
    marginBottom: isMobile ? theme.spacing.sm : theme.spacing.md,
  };

  const sectionTitleStyle: CSSProperties = {
    color: theme.colors.accent.primary,
    fontSize: isMobile
      ? theme.typography.fontSize.sm
      : theme.typography.fontSize.xs,
    fontWeight: theme.typography.fontWeight.semibold,
    textTransform: "uppercase",
    letterSpacing: "0.5px",
    marginBottom: theme.spacing.xs,
  };

  const descriptionStyle: CSSProperties = {
    color: theme.colors.text.secondary,
    fontSize: isMobile
      ? theme.typography.fontSize.base
      : theme.typography.fontSize.sm,
    lineHeight: theme.typography.lineHeight.normal,
    margin: 0,
  };

  // Meta info row (responsive - wrap on mobile)
  const metaRowStyle: CSSProperties = {
    display: "flex",
    flexWrap: isMobile ? "wrap" : "nowrap",
    gap: isMobile ? theme.spacing.sm : theme.spacing.md,
    marginBottom: isMobile ? theme.spacing.sm : theme.spacing.md,
    padding: theme.spacing.sm,
    background: theme.colors.background.tertiary,
    borderRadius: `${theme.borderRadius.md}px`,
    border: `1px solid ${theme.colors.border.default}`,
    fontSize: isMobile
      ? theme.typography.fontSize.base
      : theme.typography.fontSize.sm,
  };

  const metaItemStyle: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    minWidth: isMobile ? "calc(50% - 8px)" : "auto",
  };

  const metaLabelStyle: CSSProperties = {
    color: theme.colors.text.muted,
    fontSize: isMobile
      ? theme.typography.fontSize.sm
      : theme.typography.fontSize.xs,
    textTransform: "uppercase",
  };

  const metaValueStyle: CSSProperties = {
    color: theme.colors.text.primary,
    fontWeight: theme.typography.fontWeight.medium,
  };

  // Progress bar (taller on mobile for visibility)
  const progressBarContainerStyle: CSSProperties = {
    height: isMobile ? "6px" : "4px",
    backgroundColor: theme.colors.background.tertiary,
    borderRadius: `${theme.borderRadius.sm}px`,
    overflow: "hidden",
    marginTop: theme.spacing.xs,
  };

  const progressBarFillStyle: CSSProperties = {
    height: "100%",
    width: `${progress}%`,
    backgroundColor:
      progress === 100
        ? theme.colors.state.success
        : theme.colors.accent.primary,
    transition: "width 0.3s ease",
  };

  // Action buttons container (responsive)
  const actionsStyle: CSSProperties = {
    display: "flex",
    flexDirection: isMobile ? "column" : "row",
    gap: theme.spacing.sm,
    padding: isMobile ? theme.spacing.sm : theme.spacing.md,
    borderTop: `1px solid ${theme.colors.border.default}`,
    background: theme.colors.background.secondary,
  };

  const buttonBaseStyle: CSSProperties = {
    flex: isMobile ? "none" : 1,
    padding: isMobile
      ? `${theme.spacing.md}px ${theme.spacing.md}px`
      : `${theme.spacing.sm}px ${theme.spacing.md}px`,
    border: "none",
    borderRadius: `${theme.borderRadius.md}px`,
    minHeight: isMobile ? "44px" : "auto", // Touch-friendly on mobile
    fontSize: theme.typography.fontSize.sm,
    fontWeight: theme.typography.fontWeight.semibold,
    cursor: "pointer",
    transition: theme.transitions.fast,
  };

  const primaryButtonStyle: CSSProperties = {
    ...buttonBaseStyle,
    background: theme.colors.accent.primary,
    color: theme.colors.background.primary,
  };

  const secondaryButtonStyle: CSSProperties = {
    ...buttonBaseStyle,
    background: theme.colors.background.tertiary,
    color: theme.colors.text.primary,
    border: `1px solid ${theme.colors.border.default}`,
  };

  return (
    <div
      style={overlayStyle}
      onClick={onClose}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div
        style={popupStyle}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {/* Header with back button */}
        <div style={headerStyle}>
          <button
            style={backButtonStyle}
            onClick={onClose}
            title="Back to quest list"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path
                d="M11 2L5 8l6 6"
                stroke="currentColor"
                strokeWidth="2"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <h3 style={titleStyle}>
            {quest.pinned && (
              <span
                style={{ color: "#ffd700", marginRight: "6px" }}
                title="Pinned"
              >
                ★
              </span>
            )}
            {quest.title}
          </h3>
          <button style={closeButtonStyle} onClick={onClose} title="Close">
            ×
          </button>
        </div>

        {/* Content */}
        <div style={contentStyle} className="scrollbar-thin">
          {/* Meta info */}
          <div style={metaRowStyle}>
            <div style={metaItemStyle}>
              <span style={metaLabelStyle}>Type</span>
              <span style={{ ...metaValueStyle, color: categoryConfig.color }}>
                {categoryConfig.label}
              </span>
            </div>
            <div style={metaItemStyle}>
              <span style={metaLabelStyle}>Level</span>
              <span style={metaValueStyle}>{quest.level}</span>
            </div>
            <div style={metaItemStyle}>
              <span style={metaLabelStyle}>Status</span>
              <span
                style={{ ...metaValueStyle, color: STATUS_COLORS[quest.state] }}
              >
                {STATE_CONFIG[quest.state].label}
              </span>
            </div>
            {quest.state === "active" && (
              <div style={metaItemStyle}>
                <span style={metaLabelStyle}>Progress</span>
                <span style={metaValueStyle}>{progress}%</span>
              </div>
            )}
          </div>

          {/* Timer if applicable */}
          {quest.timeRemaining !== undefined && quest.state === "active" && (
            <div
              style={{
                marginBottom: theme.spacing.md,
                padding: `${theme.spacing.xs}px ${theme.spacing.sm}px`,
                background:
                  quest.timeRemaining <= 60
                    ? "rgba(248, 113, 113, 0.15)"
                    : "rgba(251, 191, 36, 0.15)",
                borderRadius: `${theme.borderRadius.sm}px`,
                color:
                  quest.timeRemaining <= 60
                    ? theme.colors.state.danger
                    : theme.colors.state.warning,
                fontSize: theme.typography.fontSize.sm,
                display: "flex",
                alignItems: "center",
                gap: theme.spacing.xs,
              }}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 16 16"
                fill="currentColor"
              >
                <path d="M8 1a7 7 0 100 14A7 7 0 008 1zm0 12A5 5 0 118 3a5 5 0 010 10zm.5-8H7v4.5l3.5 2 .75-1.25-2.75-1.5V5z" />
              </svg>
              Time remaining: {formatTimeRemaining(quest.timeRemaining)}
            </div>
          )}

          {/* Description */}
          <div style={sectionStyle}>
            <div style={sectionTitleStyle}>Description</div>
            <p style={descriptionStyle}>{quest.description}</p>
          </div>

          {/* Quest giver */}
          {quest.questGiver && (
            <div style={sectionStyle}>
              <div style={sectionTitleStyle}>Quest Giver</div>
              <div
                style={{
                  color: theme.colors.text.primary,
                  fontSize: theme.typography.fontSize.sm,
                }}
              >
                {quest.questGiver}
                {quest.questGiverLocation && (
                  <span style={{ color: theme.colors.text.muted }}>
                    {" "}
                    · {quest.questGiverLocation}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Objectives */}
          {quest.objectives.length > 0 && (
            <div style={sectionStyle}>
              <div style={sectionTitleStyle}>Objectives</div>
              {quest.state === "active" && (
                <div style={progressBarContainerStyle}>
                  <div style={progressBarFillStyle} />
                </div>
              )}
              <div style={{ marginTop: theme.spacing.sm }}>
                {quest.objectives.map((objective) => (
                  <QuestObjective
                    key={objective.id}
                    objective={objective}
                    showProgress
                  />
                ))}
              </div>
            </div>
          )}

          {/* Rewards */}
          {quest.rewards.length > 0 && (
            <div style={sectionStyle}>
              <QuestRewards rewards={quest.rewards} showTitle />
            </div>
          )}
        </div>

        {/* Actions */}
        <div style={actionsStyle}>
          {canAccept && onAcceptQuest && (
            <button
              style={primaryButtonStyle}
              onClick={() => {
                onAcceptQuest(quest);
                onClose();
              }}
            >
              Accept Quest
            </button>
          )}
          {canComplete && onCompleteQuest && (
            <button
              style={primaryButtonStyle}
              onClick={() => {
                onCompleteQuest(quest);
                onClose();
              }}
            >
              Complete Quest
            </button>
          )}
          {quest.state === "active" && onTogglePin && (
            <button
              style={secondaryButtonStyle}
              onClick={() => onTogglePin(quest)}
            >
              {quest.pinned ? "Unpin" : "Pin"}
            </button>
          )}
          {quest.state === "active" && onTrackQuest && (
            <button
              style={secondaryButtonStyle}
              onClick={() => onTrackQuest(quest)}
            >
              Track
            </button>
          )}
          {quest.state === "completed" && (
            <button style={secondaryButtonStyle} onClick={onClose}>
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
});

/** Quest List Item Component - Clean minimal row */
interface QuestListItemProps {
  quest: Quest;
  onClick: () => void;
  isSelected?: boolean;
}

const QuestListItem = memo(function QuestListItem({
  quest,
  onClick,
  isSelected = false,
}: QuestListItemProps): React.ReactElement {
  const theme = useTheme();
  const { shouldUseMobileUI } = useMobileLayout();
  const [isHovered, setIsHovered] = useState(false);
  const progress = calculateQuestProgress(quest);

  const rowStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: shouldUseMobileUI ? "8px 12px" : "4px 8px",
    cursor: "pointer",
    backgroundColor: isSelected
      ? `${theme.colors.accent.primary}30`
      : isHovered
        ? theme.colors.slot.hover
        : "transparent",
    borderLeft: isSelected
      ? `3px solid ${theme.colors.accent.primary}`
      : "3px solid transparent",
    transition: "background-color 0.1s ease, border-color 0.1s ease",
    minHeight: shouldUseMobileUI ? "44px" : "28px",
  };

  const nameStyle: CSSProperties = {
    color: STATUS_COLORS[quest.state],
    fontSize: shouldUseMobileUI ? "14px" : "11px",
    fontWeight: 500,
    flex: 1,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  };

  return (
    <div
      style={rowStyle}
      onClick={onClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <span style={nameStyle}>
        {quest.pinned && (
          <span
            style={{
              color: "#ffd700", // Gold star for pinned quests
              marginRight: shouldUseMobileUI ? "6px" : "4px",
            }}
            title="Pinned"
          >
            ★
          </span>
        )}
        {quest.title}
      </span>
      {quest.state === "active" && progress > 0 && progress < 100 && (
        <span
          style={{
            color: theme.colors.text.muted,
            fontSize: shouldUseMobileUI ? "12px" : "9px",
            marginLeft: shouldUseMobileUI ? "8px" : "6px",
          }}
        >
          {progress}%
        </span>
      )}
      <span
        style={{
          color: theme.colors.text.muted,
          marginLeft: shouldUseMobileUI ? "8px" : "6px",
          fontSize: shouldUseMobileUI ? "12px" : "9px",
        }}
      >
        Lv. {quest.level}
      </span>
    </div>
  );
});

/** Category Group Component - Clean minimal header */
interface CategoryGroupProps {
  category: QuestCategory;
  quests: Quest[];
  onQuestClick: (quest: Quest) => void;
  selectedQuestId?: string | null;
  defaultCollapsed?: boolean;
}

const CategoryGroup = memo(function CategoryGroup({
  category,
  quests,
  onQuestClick,
  selectedQuestId,
  defaultCollapsed = false,
}: CategoryGroupProps): React.ReactElement | null {
  const theme = useTheme();
  const { reducedMotion } = useAccessibilityStore();
  const { shouldUseMobileUI } = useMobileLayout();
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const config = CATEGORY_CONFIG[category];

  if (quests.length === 0) {
    return null;
  }

  const headerStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: shouldUseMobileUI ? "8px" : "6px",
    padding: shouldUseMobileUI ? "8px 12px" : "5px 8px",
    cursor: "pointer",
    userSelect: "none",
    backgroundColor: theme.colors.slot.filled,
    borderBottom: `1px solid ${theme.colors.border.default}30`,
    minHeight: shouldUseMobileUI ? "40px" : "26px",
  };

  const expandIconStyle: CSSProperties = {
    width: shouldUseMobileUI ? "14px" : "10px",
    height: shouldUseMobileUI ? "14px" : "10px",
    color: theme.colors.text.muted,
    transform: collapsed ? "rotate(0deg)" : "rotate(90deg)",
    transition: reducedMotion ? "none" : "transform 0.15s ease",
  };

  const indicatorStyle: CSSProperties = {
    width: shouldUseMobileUI ? "8px" : "6px",
    height: shouldUseMobileUI ? "8px" : "6px",
    borderRadius: "50%",
    backgroundColor: config.color,
  };

  const nameStyle: CSSProperties = {
    flex: 1,
    color: theme.colors.text.secondary,
    fontSize: shouldUseMobileUI ? "13px" : "10px",
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.3px",
  };

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        aria-expanded={!collapsed}
        aria-label={`${config.label} category${collapsed ? ", collapsed" : ", expanded"}`}
        style={headerStyle}
        onClick={() => setCollapsed(!collapsed)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setCollapsed(!collapsed);
          }
        }}
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 12 12"
          fill="currentColor"
          style={expandIconStyle}
          aria-hidden="true"
        >
          <path d="M4 2l4 4-4 4V2z" />
        </svg>
        <div style={indicatorStyle} aria-hidden="true" />
        <span style={nameStyle}>{config.label}</span>
      </div>
      {!collapsed && (
        <div>
          {quests.map((quest) => (
            <QuestListItem
              key={quest.id}
              quest={quest}
              onClick={() => onQuestClick(quest)}
              isSelected={quest.id === selectedQuestId}
            />
          ))}
        </div>
      )}
    </div>
  );
});

/** Pinned Group Component - Shows pinned quests at top */
interface PinnedGroupProps {
  quests: Quest[];
  onQuestClick: (quest: Quest) => void;
  selectedQuestId?: string | null;
  defaultCollapsed?: boolean;
}

const PinnedGroup = memo(function PinnedGroup({
  quests,
  onQuestClick,
  selectedQuestId,
  defaultCollapsed = false,
}: PinnedGroupProps): React.ReactElement | null {
  const theme = useTheme();
  const { reducedMotion } = useAccessibilityStore();
  const { shouldUseMobileUI } = useMobileLayout();
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  // Don't render if no pinned quests
  if (quests.length === 0) {
    return null;
  }

  const headerStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: shouldUseMobileUI ? "8px" : "6px",
    padding: shouldUseMobileUI ? "8px 12px" : "5px 8px",
    cursor: "pointer",
    userSelect: "none",
    backgroundColor: theme.colors.slot.filled,
    borderBottom: `1px solid ${theme.colors.border.default}30`,
    minHeight: shouldUseMobileUI ? "40px" : "26px",
  };

  const expandIconStyle: CSSProperties = {
    width: shouldUseMobileUI ? "14px" : "10px",
    height: shouldUseMobileUI ? "14px" : "10px",
    color: theme.colors.text.muted,
    transform: collapsed ? "rotate(0deg)" : "rotate(90deg)",
    transition: reducedMotion ? "none" : "transform 0.15s ease",
  };

  const indicatorStyle: CSSProperties = {
    width: shouldUseMobileUI ? "8px" : "6px",
    height: shouldUseMobileUI ? "8px" : "6px",
    borderRadius: "50%",
    backgroundColor: "#ffd700", // Gold color for pinned
  };

  const nameStyle: CSSProperties = {
    flex: 1,
    color: theme.colors.text.secondary,
    fontSize: shouldUseMobileUI ? "13px" : "10px",
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.3px",
  };

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        aria-expanded={!collapsed}
        aria-label={`Pinned quests${collapsed ? ", collapsed" : ", expanded"}`}
        style={headerStyle}
        onClick={() => setCollapsed(!collapsed)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setCollapsed(!collapsed);
          }
        }}
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 12 12"
          fill="currentColor"
          style={expandIconStyle}
          aria-hidden="true"
        >
          <path d="M4 2l4 4-4 4V2z" />
        </svg>
        <div style={indicatorStyle} aria-hidden="true" />
        <span style={nameStyle}>Pinned</span>
      </div>
      {!collapsed && (
        <div>
          {quests.map((quest) => (
            <QuestListItem
              key={quest.id}
              quest={quest}
              onClick={() => onQuestClick(quest)}
              isSelected={quest.id === selectedQuestId}
            />
          ))}
        </div>
      )}
    </div>
  );
});

/**
 * Quest Log Component
 *
 * Clean OSRS-style quest log with minimal UI chrome and collapsible filters.
 */
export const QuestLog = memo(function QuestLog({
  quests,
  questCounts,
  searchText = "",
  onSearchChange,
  sortBy = "category",
  onSortChange,
  sortDirection = "asc",
  onSortDirectionChange,
  stateFilter = [],
  onStateFilterChange,
  categoryFilter = [],
  onCategoryFilterChange,
  selectedQuestId,
  onSelectQuest,
  onTogglePin,
  onAcceptQuest,
  onCompleteQuest,
  onTrackQuest,
  groupByCategory = true,
  showSearch = true,
  showFilters = true,
  showSort = true,
  showHeader = true,
  title = "Quest Log",
  emptyMessage = "No quests found",
  maxHeight,
  className,
  style,
  useExternalPopup = false,
  onQuestClick,
}: QuestLogProps): React.ReactElement {
  const theme = useTheme();
  const { reducedMotion } = useAccessibilityStore();
  const { shouldUseMobileUI } = useMobileLayout();
  const [popupQuest, setPopupQuest] = useState<Quest | null>(null);
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [searchExpanded, setSearchExpanded] = useState(false);

  // Auto-expand search if there's text
  useEffect(() => {
    if (searchText && searchText.length > 0) {
      setSearchExpanded(true);
    }
  }, [searchText]);

  // Handle quest click - open popup or call external handler
  const handleQuestClick = useCallback(
    (quest: Quest) => {
      // Notify parent of selection change
      if (onSelectQuest) {
        onSelectQuest(quest);
      }

      if (useExternalPopup && onQuestClick) {
        // Use external popup handler
        onQuestClick(quest);
      } else {
        // Use internal popup
        setPopupQuest(quest);
      }
    },
    [useExternalPopup, onQuestClick, onSelectQuest],
  );

  // Close popup
  const handleClosePopup = useCallback(() => {
    setPopupQuest(null);
  }, []);

  // Keep popupQuest in sync with quests array (for pinned state changes, etc.)
  useEffect(() => {
    if (popupQuest) {
      const updatedQuest = quests.find((q) => q.id === popupQuest.id);
      if (updatedQuest && updatedQuest.pinned !== popupQuest.pinned) {
        setPopupQuest(updatedQuest);
      }
    }
  }, [quests, popupQuest]);

  // Listen for pin changes from other components for immediate popup update
  useEffect(() => {
    const handlePinChange = (event: Event) => {
      const customEvent = event as CustomEvent<{
        questId: string;
        pinned: boolean;
      }>;
      const { questId, pinned } = customEvent.detail;
      if (popupQuest && popupQuest.id === questId) {
        setPopupQuest((prev) => (prev ? { ...prev, pinned } : null));
      }
    };

    window.addEventListener("questPinChanged", handlePinChange);
    return () => window.removeEventListener("questPinChanged", handlePinChange);
  }, [popupQuest]);

  // Separate pinned quests from non-pinned
  const pinnedQuests = useMemo(() => {
    return quests.filter((quest) => quest.pinned);
  }, [quests]);

  const nonPinnedQuests = useMemo(() => {
    return quests.filter((quest) => !quest.pinned);
  }, [quests]);

  // Group non-pinned quests by category
  const questsByCategory = useMemo(() => {
    if (!groupByCategory) return null;

    const groups: Record<QuestCategory, Quest[]> = {
      main: [],
      side: [],
      daily: [],
      weekly: [],
      event: [],
    };

    nonPinnedQuests.forEach((quest) => {
      groups[quest.category].push(quest);
    });

    return groups;
  }, [nonPinnedQuests, groupByCategory]);

  // Toggle state filter
  const toggleStateFilter = useCallback(
    (state: QuestState) => {
      if (!onStateFilterChange) return;

      if (stateFilter.includes(state)) {
        onStateFilterChange(stateFilter.filter((s) => s !== state));
      } else {
        onStateFilterChange([...stateFilter, state]);
      }
    },
    [stateFilter, onStateFilterChange],
  );

  // Toggle category filter
  const toggleCategoryFilter = useCallback(
    (category: QuestCategory) => {
      if (!onCategoryFilterChange) return;

      if (categoryFilter.includes(category)) {
        onCategoryFilterChange(categoryFilter.filter((c) => c !== category));
      } else {
        onCategoryFilterChange([...categoryFilter, category]);
      }
    },
    [categoryFilter, onCategoryFilterChange],
  );

  // Check if any filters are active
  const hasActiveFilters = stateFilter.length > 0 || categoryFilter.length > 0;

  // Container styles - clean minimal
  const containerStyle: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    backgroundColor: theme.colors.background.panelSecondary,
    overflow: "hidden",
    height: "100%",
    ...style,
  };

  // Compact header with stats and toolbar - mobile responsive
  const headerStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: shouldUseMobileUI ? "6px 8px" : "4px 6px",
    backgroundColor: theme.colors.slot.filled,
    borderBottom: `1px solid ${theme.colors.border.default}30`,
    minHeight: shouldUseMobileUI ? "36px" : "26px",
    gap: shouldUseMobileUI ? "6px" : "4px",
  };

  // Compact stats - mobile responsive
  const statsStyle: CSSProperties = {
    display: "flex",
    gap: shouldUseMobileUI ? "8px" : "6px",
    fontSize: shouldUseMobileUI ? "12px" : "10px",
    color: theme.colors.text.muted,
    flex: 1,
  };

  // Toolbar buttons
  const toolbarStyle: CSSProperties = {
    display: "flex",
    gap: shouldUseMobileUI ? "6px" : "3px",
    alignItems: "center",
  };

  // Icon button - mobile responsive for touch targets
  const iconButtonStyle = (active: boolean): CSSProperties => ({
    width: shouldUseMobileUI ? "32px" : "20px",
    height: shouldUseMobileUI ? "32px" : "20px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: active
      ? theme.colors.accent.primary
      : theme.colors.slot.filled,
    color: active ? theme.colors.background.primary : theme.colors.text.muted,
    border: `1px solid ${active ? theme.colors.accent.primary : theme.colors.border.default}30`,
    borderRadius: shouldUseMobileUI ? "4px" : "3px",
    cursor: "pointer",
    padding: 0,
    transition: reducedMotion ? "none" : "all 0.1s ease",
  });

  // Collapsible search - mobile responsive
  const searchContainerStyle: CSSProperties = {
    padding: shouldUseMobileUI ? "6px 8px" : "4px 6px",
    borderBottom: `1px solid ${theme.colors.border.default}30`,
    display: searchExpanded ? "block" : "none",
  };

  const searchInputStyle: CSSProperties = {
    width: "100%",
    padding: shouldUseMobileUI ? "8px 12px" : "4px 8px",
    backgroundColor: theme.colors.slot.empty,
    border: `1px solid ${theme.colors.border.default}30`,
    borderRadius: shouldUseMobileUI ? "4px" : "3px",
    color: theme.colors.text.primary,
    fontSize: shouldUseMobileUI ? "14px" : "10px",
    outline: "none",
  };

  // Collapsible filters - compact, mobile responsive
  const filtersContainerStyle: CSSProperties = {
    padding: shouldUseMobileUI ? "6px 8px" : "4px 6px",
    borderBottom: `1px solid ${theme.colors.border.default}30`,
    display: filtersExpanded ? "flex" : "none",
    flexDirection: "column",
    gap: shouldUseMobileUI ? "6px" : "3px",
    backgroundColor: theme.colors.slot.filled,
  };

  // Compact filter row - mobile responsive
  const filterRowStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: shouldUseMobileUI ? "6px" : "3px",
    flexWrap: "wrap",
  };

  // Filter chips - mobile responsive for touch targets
  const getFilterChipStyle = (active: boolean): CSSProperties => ({
    padding: shouldUseMobileUI ? "6px 10px" : "2px 5px",
    borderRadius: shouldUseMobileUI ? "4px" : "3px",
    backgroundColor: active
      ? theme.colors.accent.primary
      : theme.colors.slot.empty,
    color: active ? theme.colors.background.primary : theme.colors.text.muted,
    fontSize: shouldUseMobileUI ? "12px" : "9px",
    fontWeight: 500,
    cursor: "pointer",
    border: active ? "none" : `1px solid ${theme.colors.border.default}30`,
    transition: reducedMotion ? "none" : "all 0.1s ease",
    lineHeight: "1.3",
  });

  // Content area - takes remaining space
  const contentStyle: CSSProperties = {
    flex: 1,
    overflowY: "auto",
    maxHeight: maxHeight,
    WebkitOverflowScrolling: "touch",
  };

  // Empty state - mobile responsive
  const emptyStyle: CSSProperties = {
    padding: shouldUseMobileUI ? "24px" : "16px",
    textAlign: "center",
    color: theme.colors.text.muted,
    fontSize: shouldUseMobileUI ? "14px" : "11px",
  };

  // Sort options
  const sortOptions: { value: QuestSortOption; label: string }[] = [
    { value: "category", label: "Category" },
    { value: "name", label: "Name" },
    { value: "level", label: "Level" },
    { value: "progress", label: "Progress" },
  ];

  // State filter options
  const stateOptions: QuestState[] = [
    "available",
    "active",
    "completed",
    "failed",
  ];

  // Category filter options - only main ones
  const categoryOptions: QuestCategory[] = ["main", "side", "daily"];

  return (
    <>
      <div className={className} style={containerStyle}>
        {/* Header with Title, Stats and Toolbar */}
        {showHeader && (
          <div style={headerStyle}>
            {/* Title */}
            <span
              style={{
                color: theme.colors.text.secondary,
                fontSize: shouldUseMobileUI ? "13px" : "10px",
                fontWeight: 600,
                marginRight: shouldUseMobileUI ? "8px" : "6px",
              }}
            >
              {title}
            </span>
            {/* Quest counts - colored numbers */}
            {questCounts && (
              <div style={statsStyle}>
                <span style={{ color: STATUS_COLORS.active, fontWeight: 600 }}>
                  {questCounts.active}
                </span>
                <span
                  style={{ color: STATUS_COLORS.available, fontWeight: 600 }}
                >
                  {questCounts.available}
                </span>
                <span
                  style={{ color: STATUS_COLORS.completed, fontWeight: 600 }}
                >
                  {questCounts.completed}
                </span>
              </div>
            )}
            <div style={toolbarStyle}>
              {/* Search toggle */}
              {showSearch && onSearchChange && (
                <button
                  style={iconButtonStyle(searchExpanded)}
                  onClick={() => setSearchExpanded(!searchExpanded)}
                  title="Search"
                >
                  <SearchIcon />
                </button>
              )}
              {/* Filter toggle */}
              {showFilters &&
                (onStateFilterChange || onCategoryFilterChange) && (
                  <button
                    style={iconButtonStyle(filtersExpanded || hasActiveFilters)}
                    onClick={() => setFiltersExpanded(!filtersExpanded)}
                    title="Filters"
                  >
                    <FilterIcon />
                  </button>
                )}
              {/* Sort dropdown with direction toggle */}
              {showSort && onSortChange && (
                <>
                  <select
                    value={sortBy}
                    onChange={(e) =>
                      onSortChange(e.target.value as QuestSortOption)
                    }
                    style={{
                      padding: shouldUseMobileUI ? "6px 8px" : "2px 4px",
                      backgroundColor: theme.colors.slot.empty,
                      border: `1px solid ${theme.colors.border.default}30`,
                      borderRadius: shouldUseMobileUI ? "4px" : "3px",
                      color: theme.colors.text.muted,
                      fontSize: shouldUseMobileUI ? "12px" : "9px",
                      cursor: "pointer",
                      outline: "none",
                    }}
                  >
                    {sortOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  {onSortDirectionChange && (
                    <button
                      style={{
                        ...iconButtonStyle(false),
                        width: shouldUseMobileUI ? "28px" : "18px",
                        height: shouldUseMobileUI ? "28px" : "18px",
                      }}
                      onClick={() =>
                        onSortDirectionChange(
                          sortDirection === "asc" ? "desc" : "asc",
                        )
                      }
                      title={
                        sortDirection === "asc" ? "Ascending" : "Descending"
                      }
                    >
                      <svg
                        width="8"
                        height="8"
                        viewBox="0 0 12 12"
                        fill="currentColor"
                        style={{
                          transform:
                            sortDirection === "desc"
                              ? "rotate(180deg)"
                              : "rotate(0deg)",
                          transition: reducedMotion
                            ? "none"
                            : "transform 0.15s",
                        }}
                      >
                        <path d="M6 2l4 4H2l4-4z" />
                      </svg>
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {/* Collapsible Search */}
        {showSearch && onSearchChange && (
          <div style={searchContainerStyle}>
            <input
              type="text"
              placeholder="Search quests..."
              value={searchText}
              onChange={(e) => onSearchChange(e.target.value)}
              style={searchInputStyle}
              autoFocus={searchExpanded}
            />
          </div>
        )}

        {/* Collapsible Filters */}
        {showFilters && (
          <div style={filtersContainerStyle}>
            {/* State filters */}
            {onStateFilterChange && (
              <div style={filterRowStyle}>
                {stateOptions.map((state) => (
                  <button
                    key={state}
                    style={getFilterChipStyle(stateFilter.includes(state))}
                    onClick={() => toggleStateFilter(state)}
                  >
                    {STATE_CONFIG[state].label}
                  </button>
                ))}
              </div>
            )}

            {/* Category filters */}
            {onCategoryFilterChange && (
              <div style={filterRowStyle}>
                {categoryOptions.map((category) => (
                  <button
                    key={category}
                    style={getFilterChipStyle(
                      categoryFilter.includes(category),
                    )}
                    onClick={() => toggleCategoryFilter(category)}
                  >
                    {CATEGORY_CONFIG[category].label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Content - Quest List */}
        <div style={contentStyle} className="osrs-scrollbar">
          {quests.length === 0 ? (
            <div style={emptyStyle}>
              <div style={{ opacity: 0.5, marginBottom: theme.spacing.xs }}>
                📜
              </div>
              <div>{emptyMessage}</div>
            </div>
          ) : groupByCategory && questsByCategory ? (
            // Grouped view with pinned quests at top
            <>
              {/* Pinned quests group - only shows if there are pinned quests */}
              <PinnedGroup
                quests={pinnedQuests}
                onQuestClick={handleQuestClick}
                selectedQuestId={selectedQuestId}
              />
              {/* Category groups - non-pinned quests */}
              {(Object.keys(questsByCategory) as QuestCategory[]).map(
                (category) => (
                  <CategoryGroup
                    key={category}
                    category={category}
                    quests={questsByCategory[category]}
                    onQuestClick={handleQuestClick}
                    selectedQuestId={selectedQuestId}
                  />
                ),
              )}
            </>
          ) : (
            // Flat list view with pinned quests at top
            <div>
              {/* Pinned quests group - only shows if there are pinned quests */}
              <PinnedGroup
                quests={pinnedQuests}
                onQuestClick={handleQuestClick}
                selectedQuestId={selectedQuestId}
              />
              {/* Non-pinned quests */}
              {nonPinnedQuests.map((quest) => (
                <QuestListItem
                  key={quest.id}
                  quest={quest}
                  onClick={() => handleQuestClick(quest)}
                  isSelected={quest.id === selectedQuestId}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Quest Detail Popup - only shown when not using external popup */}
      {!useExternalPopup && popupQuest && (
        <QuestDetailPopup
          quest={popupQuest}
          onClose={handleClosePopup}
          onTogglePin={onTogglePin}
          onAcceptQuest={onAcceptQuest}
          onCompleteQuest={onCompleteQuest}
          onTrackQuest={onTrackQuest}
        />
      )}
    </>
  );
});

export default QuestLog;
