/**
 * Player Store - Server-Authoritative State Management
 *
 * Zustand store for player state synchronized directly from the server.
 * This is NOT a cache - it's a reactive view of the server's authoritative state.
 *
 * Design Principles (MMORPG Best Practices):
 * - Server is the single source of truth
 * - Client renders server state immediately (no TTL/staleness checks)
 * - Request deduplication prevents duplicate network calls
 * - State is cleared on disconnect/logout
 * - Optimistic updates are applied then reconciled with server response
 *
 * @packageDocumentation
 */

import { create } from "zustand";
import type { PlayerStats, PlayerEquipmentItems } from "@hyperscape/shared";

/** Inventory item for display */
export interface InventorySlotViewItem {
  itemId: string;
  quantity: number;
  slot: number;
  stackable?: boolean;
  noted?: boolean;
  name?: string;
  actions?: string[];
}

/** Optimistic update tracking */
interface OptimisticUpdate {
  id: string;
  type: "inventory" | "equipment";
  appliedAt: number;
}

/** Player store state */
export interface PlayerStoreState {
  // Player data (server-authoritative)
  inventory: InventorySlotViewItem[];
  equipment: PlayerEquipmentItems | null;
  playerStats: PlayerStats | null;
  coins: number;
  playerId: string | null;

  // Last server update timestamp (for debugging, not caching)
  lastServerUpdate: number;

  // Pending requests for deduplication
  pendingRequests: Set<string>;

  // Optimistic updates pending server confirmation
  pendingOptimistic: OptimisticUpdate[];

  // Actions - apply server state immediately
  setInventory: (items: InventorySlotViewItem[]) => void;
  setEquipment: (equipment: PlayerEquipmentItems | null) => void;
  setPlayerStats: (stats: PlayerStats | null) => void;
  setCoins: (coins: number) => void;
  setPlayerId: (id: string | null) => void;

  // Apply server update (the authoritative source)
  applyServerState: (
    data: Partial<{
      inventory: InventorySlotViewItem[];
      equipment: PlayerEquipmentItems | null;
      playerStats: PlayerStats | null;
      coins: number;
    }>,
  ) => void;

  // Optimistic updates (apply immediately, reconcile with server)
  applyOptimistic: (
    type: "inventory" | "equipment",
    update: () => void,
  ) => string;
  confirmOptimistic: (id: string) => void;
  revertOptimistic: (
    id: string,
    serverState: InventorySlotViewItem[] | PlayerEquipmentItems | null,
  ) => void;

  // Request deduplication
  markRequestPending: (requestType: string) => void;
  markRequestComplete: (requestType: string) => void;
  isRequestPending: (requestType: string) => boolean;

  // Lifecycle
  reset: () => void;
  hasData: () => boolean;
}

/**
 * Zustand store for player data management
 *
 * IMPORTANT: This store receives state from the server.
 * Do NOT add TTL or cache invalidation - the server pushes updates.
 *
 * @example
 * ```tsx
 * function InventoryDisplay() {
 *   const inventory = useInventory();
 *   const coins = useCoins();
 *
 *   return (
 *     <div>
 *       <span>Coins: {coins}</span>
 *       <ul>
 *         {inventory.map(item => (
 *           <li key={item.slot}>{item.name} x{item.quantity}</li>
 *         ))}
 *       </ul>
 *     </div>
 *   );
 * }
 * ```
 */
export const usePlayerStore = create<PlayerStoreState>()((set, get) => ({
  // Initial state - empty until server provides data
  inventory: [],
  equipment: null,
  playerStats: null,
  coins: 0,
  playerId: null,

  // Last server update (for debugging only)
  lastServerUpdate: 0,

  // Pending requests
  pendingRequests: new Set(),

  // Optimistic updates
  pendingOptimistic: [],

  // Direct setters (for server events)
  setInventory: (items) => {
    set({ inventory: items, lastServerUpdate: Date.now() });
  },

  setEquipment: (equipment) => {
    set({ equipment, lastServerUpdate: Date.now() });
  },

  setPlayerStats: (stats) => {
    set({ playerStats: stats, lastServerUpdate: Date.now() });
  },

  setCoins: (coins) => {
    set({ coins, lastServerUpdate: Date.now() });
  },

  setPlayerId: (id) => {
    // Reset state when player changes (logout/login)
    if (id !== get().playerId && get().playerId !== null) {
      get().reset();
    }
    set({ playerId: id });
  },

  // Apply authoritative server state
  applyServerState: (data) => {
    const updates: Partial<PlayerStoreState> = {
      lastServerUpdate: Date.now(),
    };

    if (data.inventory !== undefined) {
      updates.inventory = data.inventory;
    }
    if (data.equipment !== undefined) {
      updates.equipment = data.equipment;
    }
    if (data.playerStats !== undefined) {
      updates.playerStats = data.playerStats;
    }
    if (data.coins !== undefined) {
      updates.coins = data.coins;
    }

    set(updates);
  },

  // Optimistic updates - apply immediately, track for reconciliation
  applyOptimistic: (type, update) => {
    const id = `${type}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    // Apply the update
    update();

    // Track it
    const pending = [
      ...get().pendingOptimistic,
      { id, type, appliedAt: Date.now() },
    ];
    set({ pendingOptimistic: pending });

    return id;
  },

  confirmOptimistic: (id) => {
    const pending = get().pendingOptimistic.filter((u) => u.id !== id);
    set({ pendingOptimistic: pending });
  },

  revertOptimistic: (id, serverState) => {
    const update = get().pendingOptimistic.find((u) => u.id === id);
    if (!update) return;

    // Revert to server state
    if (update.type === "inventory" && Array.isArray(serverState)) {
      set({ inventory: serverState });
    } else if (update.type === "equipment" && !Array.isArray(serverState)) {
      set({ equipment: serverState });
    }

    // Remove from pending
    const pending = get().pendingOptimistic.filter((u) => u.id !== id);
    set({ pendingOptimistic: pending });
  },

  // Request deduplication
  markRequestPending: (requestType) => {
    const pending = new Set(get().pendingRequests);
    pending.add(requestType);
    set({ pendingRequests: pending });
  },

  markRequestComplete: (requestType) => {
    const pending = new Set(get().pendingRequests);
    pending.delete(requestType);
    set({ pendingRequests: pending });
  },

  isRequestPending: (requestType) => {
    return get().pendingRequests.has(requestType);
  },

  // Check if we have received player data
  hasData: () => {
    return get().playerId !== null;
  },

  // Reset on logout/disconnect
  reset: () => {
    set({
      inventory: [],
      equipment: null,
      playerStats: null,
      coins: 0,
      playerId: null,
      lastServerUpdate: 0,
      pendingRequests: new Set(),
      pendingOptimistic: [],
    });
  },
}));

/**
 * Selector for inventory only (avoids re-renders from other state changes)
 */
export function useInventory() {
  return usePlayerStore((s) => s.inventory);
}

/**
 * Selector for equipment only
 */
export function useEquipment() {
  return usePlayerStore((s) => s.equipment);
}

/**
 * Selector for player stats only
 */
export function usePlayerStats() {
  return usePlayerStore((s) => s.playerStats);
}

/**
 * Selector for coins only
 */
export function useCoins() {
  return usePlayerStore((s) => s.coins);
}

/**
 * Selector for player ID
 */
export function usePlayerId() {
  return usePlayerStore((s) => s.playerId);
}
