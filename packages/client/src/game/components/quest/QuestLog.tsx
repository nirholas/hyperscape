/**
 * Quest Log Component
 *
 * OSRS-style quest log with clean list view and popup details.
 * Features color-coded quest status and category grouping.
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
import { useTheme, useAccessibilityStore } from "@/ui";
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
  /** Abandon quest handler */
  onAbandonQuest?: (quest: Quest) => void;
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
  onAbandonQuest?: (quest: Quest) => void;
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
  onAbandonQuest,
  onCompleteQuest,
  onTrackQuest,
}: QuestDetailPopupProps): React.ReactElement {
  const theme = useTheme();
  const progress = calculateQuestProgress(quest);
  const categoryConfig = CATEGORY_CONFIG[quest.category];

  const canAccept = quest.state === "available";
  const canAbandon = quest.state === "active";
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

  const dangerButtonStyle: CSSProperties = {
    ...buttonBaseStyle,
    background: "rgba(248, 113, 113, 0.15)",
    color: theme.colors.state.danger,
    border: `1px solid rgba(248, 113, 113, 0.3)`,
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
          <h3 style={titleStyle}>{quest.title}</h3>
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
          {canAbandon && onAbandonQuest && (
            <button
              style={dangerButtonStyle}
              onClick={() => {
                onAbandonQuest(quest);
                onClose();
              }}
            >
              Abandon
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

/** Quest List Item Component - Simple row in the list */
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
  const [isHovered, setIsHovered] = useState(false);
  const progress = calculateQuestProgress(quest);

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

  // Determine background color based on selection and hover state
  const getBackgroundColor = () => {
    if (isSelected) {
      return theme.colors.slot.selected ?? theme.colors.accent.primary + "33";
    }
    if (isHovered) {
      return theme.colors.slot.hover;
    }
    return "transparent";
  };

  const rowStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: isMobile
      ? `${theme.spacing.sm}px ${theme.spacing.sm}px`
      : `${theme.spacing.sm}px ${theme.spacing.md}px`,
    cursor: "pointer",
    backgroundColor: getBackgroundColor(),
    borderBottom: `1px solid ${theme.colors.border.default}`,
    borderLeft: isSelected
      ? `3px solid ${theme.colors.accent.primary}`
      : "3px solid transparent",
    transition: theme.transitions.fast,
    minHeight: isMobile ? "48px" : "40px", // Touch-friendly on mobile
  };

  const nameStyle: CSSProperties = {
    color: STATUS_COLORS[quest.state],
    fontSize: isMobile
      ? theme.typography.fontSize.base
      : theme.typography.fontSize.sm,
    fontWeight: theme.typography.fontWeight.medium,
    flex: 1,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  };

  const progressStyle: CSSProperties = {
    color: theme.colors.text.muted,
    fontSize: isMobile
      ? theme.typography.fontSize.sm
      : theme.typography.fontSize.xs,
    marginLeft: isMobile ? theme.spacing.xs : theme.spacing.sm,
    flexShrink: 0,
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
            style={{ color: theme.colors.accent.primary, marginRight: "6px" }}
          >
            ★
          </span>
        )}
        {quest.title}
      </span>
      {quest.state === "active" && progress > 0 && progress < 100 && (
        <span style={progressStyle}>{progress}%</span>
      )}
      <span
        style={{
          color: theme.colors.text.muted,
          marginLeft: theme.spacing.sm,
          fontSize: theme.typography.fontSize.xs,
        }}
      >
        Lv. {quest.level}
      </span>
    </div>
  );
});

/** Category Group Component */
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
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const config = CATEGORY_CONFIG[category];

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

  if (quests.length === 0) {
    return null;
  }

  const headerStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: isMobile ? theme.spacing.xs : theme.spacing.sm,
    padding: isMobile
      ? `${theme.spacing.sm}px ${theme.spacing.sm}px`
      : `${theme.spacing.sm}px ${theme.spacing.md}px`,
    cursor: "pointer",
    userSelect: "none",
    backgroundColor: theme.colors.background.tertiary,
    borderBottom: `1px solid ${theme.colors.border.default}`,
    minHeight: isMobile ? "44px" : "36px", // Touch-friendly on mobile
  };

  const expandIconStyle: CSSProperties = {
    width: isMobile ? "16px" : "12px",
    height: isMobile ? "16px" : "12px",
    color: theme.colors.text.muted,
    transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)",
    transition: reducedMotion ? "none" : "transform 0.2s ease",
  };

  const indicatorStyle: CSSProperties = {
    width: isMobile ? "10px" : "8px",
    height: isMobile ? "10px" : "8px",
    borderRadius: "50%",
    backgroundColor: config.color,
  };

  const nameStyle: CSSProperties = {
    flex: 1,
    color: theme.colors.accent.primary,
    fontSize: isMobile
      ? theme.typography.fontSize.base
      : theme.typography.fontSize.sm,
    fontWeight: theme.typography.fontWeight.semibold,
    textTransform: "uppercase",
    letterSpacing: "0.5px",
  };

  const countStyle: CSSProperties = {
    color: theme.colors.text.muted,
    fontSize: theme.typography.fontSize.xs,
  };

  return (
    <div>
      <div style={headerStyle} onClick={() => setCollapsed(!collapsed)}>
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="currentColor"
          style={expandIconStyle}
        >
          <path d="M4 2l4 4-4 4V2z" />
        </svg>
        <div style={indicatorStyle} />
        <span style={nameStyle}>{config.label}</span>
        <span style={countStyle}>{quests.length}</span>
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
 * OSRS-style quest log with clean list and popup details.
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
  onAbandonQuest,
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
  const [popupQuest, setPopupQuest] = useState<Quest | null>(null);

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

  // Group quests by category
  const questsByCategory = useMemo(() => {
    if (!groupByCategory) return null;

    const groups: Record<QuestCategory, Quest[]> = {
      main: [],
      side: [],
      daily: [],
      weekly: [],
      event: [],
    };

    quests.forEach((quest) => {
      groups[quest.category].push(quest);
    });

    return groups;
  }, [quests, groupByCategory]);

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

  // Container styles - use theme tokens
  const containerStyle: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    backgroundColor: theme.colors.background.primary,
    overflow: "hidden",
    height: "100%",
    ...style,
  };

  // Header styles (responsive)
  const headerStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: isMobile
      ? `${theme.spacing.xs}px ${theme.spacing.sm}px`
      : `${theme.spacing.sm}px ${theme.spacing.md}px`,
    backgroundColor: theme.colors.background.secondary,
    borderBottom: `1px solid ${theme.colors.border.default}`,
    minHeight: isMobile ? "40px" : "44px",
  };

  // Title styles (responsive)
  const titleStyle: CSSProperties = {
    color: theme.colors.accent.primary,
    fontSize: isMobile
      ? theme.typography.fontSize.sm
      : theme.typography.fontSize.base,
    fontWeight: theme.typography.fontWeight.semibold,
    margin: 0,
  };

  // Stats container (responsive)
  const statsStyle: CSSProperties = {
    display: "flex",
    gap: isMobile ? theme.spacing.xs : theme.spacing.sm,
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.text.muted,
  };

  // Search container (responsive)
  const searchContainerStyle: CSSProperties = {
    padding: isMobile
      ? `${theme.spacing.xs}px ${theme.spacing.sm}px`
      : `${theme.spacing.sm}px ${theme.spacing.md}px`,
    borderBottom: `1px solid ${theme.colors.border.default}`,
  };

  // Search input (responsive)
  const searchInputStyle: CSSProperties = {
    width: "100%",
    padding: isMobile
      ? `${theme.spacing.sm}px ${theme.spacing.sm}px`
      : `${theme.spacing.xs}px ${theme.spacing.sm}px`,
    backgroundColor: theme.colors.background.tertiary,
    border: `1px solid ${theme.colors.border.default}`,
    borderRadius: `${theme.borderRadius.sm}px`,
    color: theme.colors.text.primary,
    fontSize: isMobile
      ? theme.typography.fontSize.base
      : theme.typography.fontSize.sm,
    outline: "none",
    minHeight: isMobile ? "40px" : "auto",
  };

  // Filters container (responsive)
  const filtersContainerStyle: CSSProperties = {
    padding: isMobile
      ? `${theme.spacing.xs}px ${theme.spacing.sm}px`
      : `${theme.spacing.sm}px ${theme.spacing.md}px`,
    borderBottom: `1px solid ${theme.colors.border.default}`,
    display: "flex",
    flexDirection: "column",
    gap: isMobile ? theme.spacing.sm : theme.spacing.xs,
  };

  // Filter row (responsive)
  const filterRowStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: isMobile ? theme.spacing.sm : theme.spacing.xs,
    flexWrap: "wrap",
  };

  // Filter label (responsive)
  const filterLabelStyle: CSSProperties = {
    color: theme.colors.text.muted,
    fontSize: isMobile
      ? theme.typography.fontSize.sm
      : theme.typography.fontSize.xs,
    fontWeight: theme.typography.fontWeight.medium,
    minWidth: isMobile ? "50px" : "45px",
  };

  // Filter chip (responsive - larger on mobile for touch)
  const getFilterChipStyle = (active: boolean): CSSProperties => ({
    padding: isMobile
      ? `${theme.spacing.xs}px ${theme.spacing.sm}px`
      : `2px ${theme.spacing.xs}px`,
    borderRadius: `${theme.borderRadius.sm}px`,
    backgroundColor: active
      ? theme.colors.accent.primary
      : theme.colors.background.tertiary,
    color: active
      ? theme.colors.background.primary
      : theme.colors.text.secondary,
    fontSize: isMobile
      ? theme.typography.fontSize.sm
      : theme.typography.fontSize.xs,
    fontWeight: theme.typography.fontWeight.medium,
    cursor: "pointer",
    border: active ? "none" : `1px solid ${theme.colors.border.default}`,
    transition: reducedMotion ? "none" : theme.transitions.fast,
    minHeight: isMobile ? "32px" : "auto",
  });

  // Sort container
  const sortContainerStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: isMobile ? theme.spacing.sm : theme.spacing.xs,
  };

  // Sort select (responsive)
  const sortSelectStyle: CSSProperties = {
    padding: isMobile
      ? `${theme.spacing.xs}px ${theme.spacing.sm}px`
      : `2px ${theme.spacing.xs}px`,
    backgroundColor: theme.colors.background.tertiary,
    border: `1px solid ${theme.colors.border.default}`,
    borderRadius: `${theme.borderRadius.sm}px`,
    color: theme.colors.text.secondary,
    fontSize: isMobile
      ? theme.typography.fontSize.sm
      : theme.typography.fontSize.xs,
    cursor: "pointer",
    outline: "none",
    minHeight: isMobile ? "32px" : "auto",
  };

  // Sort direction button
  const sortDirectionStyle: CSSProperties = {
    width: "22px",
    height: "22px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.background.tertiary,
    border: `1px solid ${theme.colors.border.default}`,
    borderRadius: `${theme.borderRadius.sm}px`,
    color: theme.colors.text.muted,
    cursor: "pointer",
    padding: 0,
  };

  // Content area (responsive)
  const contentStyle: CSSProperties = {
    flex: 1,
    overflowY: "auto",
    maxHeight: maxHeight,
    WebkitOverflowScrolling: "touch", // Smooth scrolling on iOS
  };

  // Empty state (responsive)
  const emptyStyle: CSSProperties = {
    padding: isMobile ? theme.spacing.lg : theme.spacing.xl,
    textAlign: "center",
    color: theme.colors.text.muted,
    fontSize: isMobile
      ? theme.typography.fontSize.base
      : theme.typography.fontSize.sm,
  };

  // Sort options
  const sortOptions: { value: QuestSortOption; label: string }[] = [
    { value: "category", label: "Category" },
    { value: "name", label: "Name" },
    { value: "level", label: "Level" },
    { value: "progress", label: "Progress" },
    { value: "recent", label: "Recent" },
  ];

  // State filter options
  const stateOptions: QuestState[] = [
    "available",
    "active",
    "completed",
    "failed",
  ];

  // Category filter options
  const categoryOptions: QuestCategory[] = [
    "main",
    "side",
    "daily",
    "weekly",
    "event",
  ];

  return (
    <>
      <div className={className} style={containerStyle}>
        {/* Header */}
        {showHeader && (
          <div style={headerStyle}>
            <span style={titleStyle}>{title}</span>
            {questCounts && (
              <div style={statsStyle}>
                <span style={{ color: theme.colors.state.warning }}>
                  {questCounts.active} Active
                </span>
                <span>·</span>
                <span style={{ color: theme.colors.state.danger }}>
                  {questCounts.available} Available
                </span>
                <span>·</span>
                <span style={{ color: theme.colors.state.success }}>
                  {questCounts.completed} Complete
                </span>
              </div>
            )}
          </div>
        )}

        {/* Search */}
        {showSearch && onSearchChange && (
          <div style={searchContainerStyle}>
            <input
              type="text"
              placeholder="Search quests..."
              value={searchText}
              onChange={(e) => onSearchChange(e.target.value)}
              style={searchInputStyle}
            />
          </div>
        )}

        {/* Filters */}
        {showFilters && (
          <div style={filtersContainerStyle}>
            {/* State filters */}
            {onStateFilterChange && (
              <div style={filterRowStyle}>
                <span style={filterLabelStyle}>Status:</span>
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
                <span style={filterLabelStyle}>Type:</span>
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

            {/* Sort */}
            {showSort && onSortChange && (
              <div style={filterRowStyle}>
                <span style={filterLabelStyle}>Sort:</span>
                <div style={sortContainerStyle}>
                  <select
                    value={sortBy}
                    onChange={(e) =>
                      onSortChange(e.target.value as QuestSortOption)
                    }
                    style={sortSelectStyle}
                  >
                    {sortOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  {onSortDirectionChange && (
                    <button
                      style={sortDirectionStyle}
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
                        width="10"
                        height="10"
                        viewBox="0 0 12 12"
                        fill="currentColor"
                        style={{
                          transform:
                            sortDirection === "desc"
                              ? "rotate(180deg)"
                              : "rotate(0deg)",
                        }}
                      >
                        <path d="M6 2l4 4H2l4-4zm0 8L2 6h8l-4 4z" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Content */}
        <div style={contentStyle} className="osrs-scrollbar">
          {quests.length === 0 ? (
            <div style={emptyStyle}>
              <svg
                width="40"
                height="40"
                viewBox="0 0 16 16"
                fill="currentColor"
                style={{ opacity: 0.3, marginBottom: theme.spacing.sm }}
              >
                <path d="M3 3v10h10V3H3zm1 1h8v8H4V4zm2 1v2h2V5H6zm3 0v2h2V5H9zM6 8v2h2V8H6zm3 0v2h2V8H9z" />
              </svg>
              <div>{emptyMessage}</div>
            </div>
          ) : groupByCategory && questsByCategory ? (
            // Grouped view
            <>
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
            // Flat list view
            <div>
              {quests.map((quest) => (
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
          onAbandonQuest={onAbandonQuest}
          onCompleteQuest={onCompleteQuest}
          onTrackQuest={onTrackQuest}
        />
      )}
    </>
  );
});

export default QuestLog;
