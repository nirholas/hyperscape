/**
 * Quest Log Component
 *
 * Main quest log panel with categories, filtering, sorting,
 * and quest management functionality.
 *
 * @packageDocumentation
 */

import React, {
  memo,
  useState,
  useCallback,
  useMemo,
  type CSSProperties,
} from "react";
import { useTheme } from "../stores/themeStore";
import { useAccessibilityStore } from "../stores/accessibilityStore";
import {
  type Quest,
  type QuestState,
  type QuestCategory,
  type QuestSortOption,
  type SortDirection,
  CATEGORY_CONFIG,
  STATE_CONFIG,
} from "../core/quest";
import { QuestEntry } from "./QuestEntry";

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
}

/** Category group component */
interface CategoryGroupProps {
  category: QuestCategory;
  quests: Quest[];
  selectedQuestId?: string | null;
  onSelectQuest?: (quest: Quest | null) => void;
  onTogglePin?: (quest: Quest) => void;
  onAcceptQuest?: (quest: Quest) => void;
  onAbandonQuest?: (quest: Quest) => void;
  onCompleteQuest?: (quest: Quest) => void;
  onTrackQuest?: (quest: Quest) => void;
  defaultCollapsed?: boolean;
}

const CategoryGroup = memo(function CategoryGroup({
  category,
  quests,
  selectedQuestId,
  onSelectQuest,
  onTogglePin,
  onAcceptQuest,
  onAbandonQuest,
  onCompleteQuest,
  onTrackQuest,
  defaultCollapsed = false,
}: CategoryGroupProps): React.ReactElement | null {
  const theme = useTheme();
  const { reducedMotion } = useAccessibilityStore();
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  const config = CATEGORY_CONFIG[category];

  if (quests.length === 0) {
    return null;
  }

  // Group header styles
  const headerStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: theme.spacing.sm,
    padding: `${theme.spacing.xs}px ${theme.spacing.sm}px`,
    cursor: "pointer",
    userSelect: "none",
    backgroundColor: theme.colors.background.tertiary,
    borderRadius: theme.borderRadius.sm,
    marginBottom: theme.spacing.xs,
  };

  // Expand indicator
  const expandStyle: CSSProperties = {
    width: 14,
    height: 14,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: theme.colors.text.muted,
    transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)",
    transition: reducedMotion ? "none" : "transform 0.2s ease",
  };

  // Category indicator
  const indicatorStyle: CSSProperties = {
    width: 8,
    height: 8,
    borderRadius: "50%",
    backgroundColor: config.color,
  };

  // Category name
  const nameStyle: CSSProperties = {
    flex: 1,
    color: theme.colors.text.primary,
    fontSize: theme.typography.fontSize.sm,
    fontWeight: theme.typography.fontWeight.medium,
  };

  // Quest count
  const countStyle: CSSProperties = {
    color: theme.colors.text.muted,
    fontSize: theme.typography.fontSize.xs,
  };

  // Quests list
  const listStyle: CSSProperties = {
    display: collapsed ? "none" : "flex",
    flexDirection: "column",
    gap: theme.spacing.xs,
    marginBottom: theme.spacing.sm,
  };

  return (
    <div>
      <div style={headerStyle} onClick={() => setCollapsed(!collapsed)}>
        <div style={expandStyle}>
          <svg width="10" height="10" viewBox="0 0 12 12" fill="currentColor">
            <path d="M4 2l4 4-4 4V2z" />
          </svg>
        </div>
        <div style={indicatorStyle} />
        <span style={nameStyle}>{config.label}</span>
        <span style={countStyle}>{quests.length}</span>
      </div>
      <div style={listStyle}>
        {quests.map((quest) => (
          <QuestEntry
            key={quest.id}
            quest={quest}
            selected={selectedQuestId === quest.id}
            onClick={onSelectQuest}
            onTogglePin={onTogglePin}
            onAccept={onAcceptQuest}
            onAbandon={onAbandonQuest}
            onComplete={onCompleteQuest}
            onTrack={onTrackQuest}
            showCategory={false}
            showLevel
          />
        ))}
      </div>
    </div>
  );
});

/**
 * Quest Log Component
 *
 * Full quest log panel with filtering, sorting, and category grouping.
 *
 * @example
 * ```tsx
 * const { filteredQuests, searchText, setSearchText, ... } = useQuestLog();
 *
 * <QuestLog
 *   quests={filteredQuests}
 *   searchText={searchText}
 *   onSearchChange={setSearchText}
 *   onAcceptQuest={(q) => acceptQuest(q.id)}
 *   groupByCategory
 *   showSearch
 *   showFilters
 * />
 * ```
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
}: QuestLogProps): React.ReactElement {
  const theme = useTheme();
  const { reducedMotion } = useAccessibilityStore();

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

  // Container styles
  const containerStyle: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    backgroundColor: theme.colors.background.primary,
    borderRadius: theme.borderRadius.lg,
    border: `1px solid ${theme.colors.border.default}`,
    overflow: "hidden",
    ...style,
  };

  // Header styles
  const headerStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: theme.spacing.sm,
    backgroundColor: theme.colors.background.secondary,
    borderBottom: `1px solid ${theme.colors.border.default}`,
  };

  // Title styles
  const titleStyle: CSSProperties = {
    color: theme.colors.text.primary,
    fontSize: theme.typography.fontSize.lg,
    fontWeight: theme.typography.fontWeight.semibold,
  };

  // Stats container
  const statsStyle: CSSProperties = {
    display: "flex",
    gap: theme.spacing.sm,
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.text.muted,
  };

  // Search container
  const searchContainerStyle: CSSProperties = {
    padding: theme.spacing.sm,
    borderBottom: `1px solid ${theme.colors.border.default}`,
  };

  // Search input
  const searchInputStyle: CSSProperties = {
    width: "100%",
    padding: `${theme.spacing.xs}px ${theme.spacing.sm}px`,
    backgroundColor: theme.colors.background.tertiary,
    border: `1px solid ${theme.colors.border.default}`,
    borderRadius: theme.borderRadius.sm,
    color: theme.colors.text.primary,
    fontSize: theme.typography.fontSize.sm,
    outline: "none",
    transition: reducedMotion ? "none" : theme.transitions.fast,
  };

  // Filters container
  const filtersContainerStyle: CSSProperties = {
    padding: theme.spacing.sm,
    borderBottom: `1px solid ${theme.colors.border.default}`,
    display: "flex",
    flexDirection: "column",
    gap: theme.spacing.sm,
  };

  // Filter row
  const filterRowStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: theme.spacing.xs,
    flexWrap: "wrap",
  };

  // Filter label
  const filterLabelStyle: CSSProperties = {
    color: theme.colors.text.secondary,
    fontSize: theme.typography.fontSize.xs,
    fontWeight: theme.typography.fontWeight.medium,
    marginRight: theme.spacing.xs,
    minWidth: 50,
  };

  // Filter chip
  const getFilterChipStyle = (active: boolean): CSSProperties => ({
    padding: `2px ${theme.spacing.xs}px`,
    borderRadius: theme.borderRadius.sm,
    backgroundColor: active
      ? theme.colors.accent.primary
      : theme.colors.background.tertiary,
    color: active
      ? theme.colors.background.primary
      : theme.colors.text.secondary,
    fontSize: theme.typography.fontSize.xs,
    cursor: "pointer",
    userSelect: "none",
    transition: reducedMotion ? "none" : theme.transitions.fast,
    border: "none",
  });

  // Sort container
  const sortContainerStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: theme.spacing.xs,
  };

  // Sort select
  const sortSelectStyle: CSSProperties = {
    padding: `2px ${theme.spacing.xs}px`,
    backgroundColor: theme.colors.background.tertiary,
    border: `1px solid ${theme.colors.border.default}`,
    borderRadius: theme.borderRadius.sm,
    color: theme.colors.text.primary,
    fontSize: theme.typography.fontSize.xs,
    cursor: "pointer",
    outline: "none",
  };

  // Sort direction button
  const sortDirectionStyle: CSSProperties = {
    width: 20,
    height: 20,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.background.tertiary,
    border: `1px solid ${theme.colors.border.default}`,
    borderRadius: theme.borderRadius.sm,
    color: theme.colors.text.secondary,
    cursor: "pointer",
    padding: 0,
  };

  // Content area
  const contentStyle: CSSProperties = {
    flex: 1,
    padding: theme.spacing.sm,
    overflowY: "auto",
    maxHeight: maxHeight,
  };

  // Empty state
  const emptyStyle: CSSProperties = {
    padding: theme.spacing.xl,
    textAlign: "center",
    color: theme.colors.text.muted,
    fontSize: theme.typography.fontSize.sm,
  };

  // Quest list (non-grouped)
  const listStyle: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: theme.spacing.xs,
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
    <div className={className} style={containerStyle}>
      {/* Header */}
      {showHeader && (
        <div style={headerStyle}>
          <span style={titleStyle}>{title}</span>
          {questCounts && (
            <div style={statsStyle}>
              <span>{questCounts.active} Active</span>
              <span>·</span>
              <span>{questCounts.available} Available</span>
              <span>·</span>
              <span>{questCounts.completed} Complete</span>
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
                  style={getFilterChipStyle(categoryFilter.includes(category))}
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
                    title={sortDirection === "asc" ? "Ascending" : "Descending"}
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
      <div style={contentStyle}>
        {quests.length === 0 ? (
          <div style={emptyStyle}>
            <svg
              width="48"
              height="48"
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
                  selectedQuestId={selectedQuestId}
                  onSelectQuest={onSelectQuest}
                  onTogglePin={onTogglePin}
                  onAcceptQuest={onAcceptQuest}
                  onAbandonQuest={onAbandonQuest}
                  onCompleteQuest={onCompleteQuest}
                  onTrackQuest={onTrackQuest}
                />
              ),
            )}
          </>
        ) : (
          // Flat list view
          <div style={listStyle}>
            {quests.map((quest) => (
              <QuestEntry
                key={quest.id}
                quest={quest}
                selected={selectedQuestId === quest.id}
                onClick={onSelectQuest}
                onTogglePin={onTogglePin}
                onAccept={onAcceptQuest}
                onAbandon={onAbandonQuest}
                onComplete={onCompleteQuest}
                onTrack={onTrackQuest}
                showCategory
                showLevel
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
});

export default QuestLog;
