/**
 * Notification Badge System
 *
 * Provides badge management for UI elements like ribbon tabs.
 * Supports different badge types (info, warning, error) with pulsating animation.
 *
 * @packageDocumentation
 */

import { useCallback, useMemo } from "react";
import { create } from "zustand";

/** Badge type determines color and urgency */
export type BadgeType = "info" | "warning" | "error" | "success";

/** Individual badge state */
export interface Badge {
  id: string;
  count: number;
  type: BadgeType;
  pulsate: boolean;
  label?: string;
}

/** Badge store state */
interface BadgeStoreState {
  badges: Map<string, Badge>;
  setBadge: (
    id: string,
    count: number,
    type?: BadgeType,
    pulsate?: boolean,
  ) => void;
  clearBadge: (id: string) => void;
  clearAllBadges: () => void;
  getBadge: (id: string) => Badge | undefined;
  incrementBadge: (id: string, amount?: number) => void;
  decrementBadge: (id: string, amount?: number) => void;
}

/**
 * Zustand store for badge management
 */
export const useBadgeStore = create<BadgeStoreState>((set, get) => ({
  badges: new Map(),

  setBadge: (
    id: string,
    count: number,
    type: BadgeType = "info",
    pulsate: boolean = false,
  ) => {
    set((state) => {
      const badges = new Map(state.badges);
      badges.set(id, { id, count, type, pulsate });
      return { badges };
    });
  },

  clearBadge: (id: string) => {
    set((state) => {
      const badges = new Map(state.badges);
      badges.delete(id);
      return { badges };
    });
  },

  clearAllBadges: () => {
    set({ badges: new Map() });
  },

  getBadge: (id: string) => {
    return get().badges.get(id);
  },

  incrementBadge: (id: string, amount: number = 1) => {
    set((state) => {
      const badges = new Map(state.badges);
      const existing = badges.get(id);
      if (existing) {
        badges.set(id, { ...existing, count: existing.count + amount });
      } else {
        badges.set(id, { id, count: amount, type: "info", pulsate: false });
      }
      return { badges };
    });
  },

  decrementBadge: (id: string, amount: number = 1) => {
    set((state) => {
      const badges = new Map(state.badges);
      const existing = badges.get(id);
      if (existing) {
        const newCount = Math.max(0, existing.count - amount);
        if (newCount === 0) {
          badges.delete(id);
        } else {
          badges.set(id, { ...existing, count: newCount });
        }
      }
      return { badges };
    });
  },
}));

/** Return value from useBadge hook */
export interface UseBadgeResult {
  /** Current badge state (undefined if no badge) */
  badge: Badge | undefined;
  /** Set badge count and options */
  setBadge: (count: number, type?: BadgeType, pulsate?: boolean) => void;
  /** Clear badge */
  clearBadge: () => void;
  /** Increment badge count */
  increment: (amount?: number) => void;
  /** Decrement badge count */
  decrement: (amount?: number) => void;
  /** Whether badge is visible (count > 0) */
  isVisible: boolean;
}

/**
 * Hook for managing a single badge
 *
 * @example
 * ```tsx
 * function RibbonTab({ id, label }: { id: string; label: string }) {
 *   const { badge, isVisible } = useBadge(id);
 *
 *   return (
 *     <button className="ribbon-tab">
 *       {label}
 *       {isVisible && (
 *         <span
 *           className={`badge badge-${badge?.type} ${badge?.pulsate ? 'pulsate' : ''}`}
 *         >
 *           {badge?.count}
 *         </span>
 *       )}
 *     </button>
 *   );
 * }
 *
 * // Set badge from anywhere
 * function NotificationHandler() {
 *   const { setBadge } = useBadge('community');
 *
 *   useEffect(() => {
 *     // New message arrived
 *     setBadge(5, 'info', true);
 *   }, []);
 * }
 * ```
 */
export function useBadge(id: string): UseBadgeResult {
  const badge = useBadgeStore((s) => s.badges.get(id));
  const storeSetBadge = useBadgeStore((s) => s.setBadge);
  const storeClearBadge = useBadgeStore((s) => s.clearBadge);
  const storeIncrement = useBadgeStore((s) => s.incrementBadge);
  const storeDecrement = useBadgeStore((s) => s.decrementBadge);

  const setBadge = useCallback(
    (count: number, type?: BadgeType, pulsate?: boolean) => {
      storeSetBadge(id, count, type, pulsate);
    },
    [id, storeSetBadge],
  );

  const clearBadge = useCallback(() => {
    storeClearBadge(id);
  }, [id, storeClearBadge]);

  const increment = useCallback(
    (amount?: number) => {
      storeIncrement(id, amount);
    },
    [id, storeIncrement],
  );

  const decrement = useCallback(
    (amount?: number) => {
      storeDecrement(id, amount);
    },
    [id, storeDecrement],
  );

  const isVisible = badge !== undefined && badge.count > 0;

  return {
    badge,
    setBadge,
    clearBadge,
    increment,
    decrement,
    isVisible,
  };
}

/** Return value from useBadges hook */
export interface UseBadgesResult {
  /** All badges */
  badges: Badge[];
  /** Set a badge */
  setBadge: (
    id: string,
    count: number,
    type?: BadgeType,
    pulsate?: boolean,
  ) => void;
  /** Clear a badge */
  clearBadge: (id: string) => void;
  /** Clear all badges */
  clearAll: () => void;
  /** Get a specific badge */
  getBadge: (id: string) => Badge | undefined;
  /** Total badge count across all badges */
  totalCount: number;
}

/**
 * Hook for managing multiple badges
 *
 * @example
 * ```tsx
 * function NotificationCenter() {
 *   const { badges, totalCount, clearAll } = useBadges();
 *
 *   return (
 *     <div>
 *       <h3>Notifications ({totalCount})</h3>
 *       {badges.map(badge => (
 *         <div key={badge.id}>
 *           {badge.id}: {badge.count}
 *         </div>
 *       ))}
 *       <button onClick={clearAll}>Clear All</button>
 *     </div>
 *   );
 * }
 * ```
 */
export function useBadges(): UseBadgesResult {
  const badgeMap = useBadgeStore((s) => s.badges);
  const setBadge = useBadgeStore((s) => s.setBadge);
  const clearBadge = useBadgeStore((s) => s.clearBadge);
  const clearAll = useBadgeStore((s) => s.clearAllBadges);
  const getBadge = useBadgeStore((s) => s.getBadge);

  const badges = useMemo(() => Array.from(badgeMap.values()), [badgeMap]);

  const totalCount = useMemo(
    () => badges.reduce((sum, b) => sum + b.count, 0),
    [badges],
  );

  return {
    badges,
    setBadge,
    clearBadge,
    clearAll,
    getBadge,
    totalCount,
  };
}

/** Badge colors by type */
export const BADGE_COLORS: Record<BadgeType, string> = {
  info: "#4a9eff",
  success: "#5cb85c",
  warning: "#f0ad4e",
  error: "#d9534f",
};

/**
 * Get badge style based on type
 */
export function getBadgeStyle(badge: Badge): React.CSSProperties {
  return {
    backgroundColor: BADGE_COLORS[badge.type],
    color: "#ffffff",
    fontSize: "10px",
    fontWeight: 600,
    borderRadius: "9999px",
    padding: "2px 6px",
    minWidth: "18px",
    textAlign: "center",
    animation: badge.pulsate ? "badge-pulse 1s infinite" : undefined,
  };
}
