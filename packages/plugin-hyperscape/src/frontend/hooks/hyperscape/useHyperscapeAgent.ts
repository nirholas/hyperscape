/**
 * Custom React hooks for accessing Hyperscape agent data
 *
 * These hooks provide a clean interface for components to access
 * Hyperscape game state through WebSocket connection to the game server.
 * Data is fetched in real-time from the Hyperscape world server.
 */

import { useMemo } from "react";
import type { UUID } from "@elizaos/core";
import { useHyperscapePlugin } from "../use-hyperscape-plugin";
import { useHyperscapeWebSocket } from "../use-hyperscape-websocket";
import type {
  HyperscapeAgentStatus,
  SkillProgressResponse,
  WorldStatusResponse,
  PerformanceMetrics,
  Inventory,
  Equipment,
  CombatSession,
  WorldPosition,
  NearbyEntity,
  PlayerStats,
} from "../../types/hyperscape/index.js";

// ============================================================================
// Main Agent Status Hook
// ============================================================================

/**
 * Get complete Hyperscape agent status via WebSocket
 * Includes all game state for a single agent
 *
 * @param agentId - The agent's UUID
 * @returns Query result with agent status, loading, and error states
 */
export function useHyperscapeAgent(agentId: UUID | undefined) {
  const { isActive, worldUrl } = useHyperscapePlugin(agentId);
  const wsState = useHyperscapeWebSocket({
    agentId: isActive ? agentId : undefined,
    url: worldUrl,
    autoReconnect: true,
  });

  return {
    data: wsState.agentStatus,
    isLoading: wsState.status === "connecting",
    error: wsState.error ? new Error(wsState.error) : null,
    status: wsState.status,
  };
}

// ============================================================================
// World Status Hook
// ============================================================================

/**
 * Get world connection status for an agent
 *
 * @param agentId - The agent's UUID
 * @returns World connection status including world name, player count, etc.
 */
export function useWorldStatus(agentId: UUID | undefined) {
  const { isActive, worldUrl } = useHyperscapePlugin(agentId);
  const wsState = useHyperscapeWebSocket({
    agentId: isActive ? agentId : undefined,
    url: worldUrl,
  });

  const worldStatus = useMemo((): WorldStatusResponse | undefined => {
    if (!wsState.agentStatus) return undefined;
    return {
      connected: wsState.status === "connected",
      worldId: wsState.agentStatus.worldId || "",
      worldName: wsState.agentStatus.worldId || "Unknown World",
      playerCount: 0, // TODO: Get from server
      wsUrl: worldUrl,
    };
  }, [wsState.agentStatus, wsState.status]);

  return {
    data: worldStatus,
    isLoading: wsState.status === "connecting",
    error: wsState.error ? new Error(wsState.error) : null,
  };
}

// ============================================================================
// Player Stats Hooks
// ============================================================================

/**
 * Get player skill levels and XP progress
 *
 * @param agentId - The agent's UUID
 * @returns Player stats with skill levels and progression
 */
export function usePlayerStats(agentId: UUID | undefined) {
  const { isActive, worldUrl } = useHyperscapePlugin(agentId);
  const wsState = useHyperscapeWebSocket({
    agentId: isActive ? agentId : undefined,
    url: worldUrl,
  });

  const skillProgress = useMemo((): SkillProgressResponse | undefined => {
    if (!wsState.stats) return undefined;

    // Convert stats to skill progress format with XP calculations
    const skills: Array<{
      skill: keyof PlayerStats;
      level: number;
      currentXP: number;
      nextLevelXP: number;
      percentage: number;
    }> = Object.keys(wsState.stats).map((skillName) => {
      const level = wsState.stats![skillName as keyof typeof wsState.stats];
      const currentXP = calculateXPForLevel(level);
      const nextLevelXP = calculateXPForLevel(level + 1);
      const xpInLevel = currentXP - calculateXPForLevel(level - 1);
      const xpToNextLevel = nextLevelXP - currentXP;
      const percentage =
        (xpInLevel / (nextLevelXP - calculateXPForLevel(level - 1))) * 100;

      return {
        skill: skillName as keyof PlayerStats,
        level,
        currentXP,
        nextLevelXP,
        percentage,
      };
    });

    const totalLevel = Object.values(wsState.stats).reduce(
      (sum, level) => sum + level,
      0,
    );

    return { skills, totalLevel };
  }, [wsState.stats]);

  return {
    data: skillProgress,
    isLoading: wsState.status === "connecting",
    error: wsState.error ? new Error(wsState.error) : null,
  };
}

/**
 * Get skill progress for all skills
 * Alias for usePlayerStats for backwards compatibility
 */
export function useSkillProgress(agentId: UUID | undefined) {
  return usePlayerStats(agentId);
}

// ============================================================================
// Inventory & Equipment Hooks
// ============================================================================

/**
 * Get player inventory (28 slots)
 *
 * @param agentId - The agent's UUID
 * @returns Inventory with items and slot information
 */
export function useInventory(agentId: UUID | undefined) {
  const { isActive, worldUrl } = useHyperscapePlugin(agentId);
  const wsState = useHyperscapeWebSocket({
    agentId: isActive ? agentId : undefined,
    url: worldUrl,
  });

  return {
    data: wsState.inventory,
    isLoading: wsState.status === "connecting",
    error: wsState.error ? new Error(wsState.error) : null,
  };
}

/**
 * Get equipped items
 *
 * @param agentId - The agent's UUID
 * @returns Equipment data for all equipment slots
 */
export function useEquipment(agentId: UUID | undefined) {
  const { isActive, worldUrl } = useHyperscapePlugin(agentId);
  const wsState = useHyperscapeWebSocket({
    agentId: isActive ? agentId : undefined,
    url: worldUrl,
  });

  const equipment = useMemo((): Equipment | undefined => {
    if (!wsState.agentStatus) return undefined;
    // TODO: Extract equipment from agent status when available
    return {
      head: null,
      body: null,
      legs: null,
      boots: null,
      gloves: null,
      weapon: null,
      shield: null,
      cape: null,
      neck: null,
      ring: null,
      ammunition: null,
    };
  }, [wsState.agentStatus]);

  return {
    data: equipment,
    isLoading: wsState.status === "connecting",
    error: wsState.error ? new Error(wsState.error) : null,
  };
}

// ============================================================================
// Position & World Hooks
// ============================================================================

/**
 * Get player position in world
 *
 * @param agentId - The agent's UUID
 * @returns World position with coordinates and area name
 */
export function usePosition(agentId: UUID | undefined) {
  const { isActive, worldUrl } = useHyperscapePlugin(agentId);
  const wsState = useHyperscapeWebSocket({
    agentId: isActive ? agentId : undefined,
    url: worldUrl,
  });

  return {
    data: wsState.position,
    isLoading: wsState.status === "connecting",
    error: wsState.error ? new Error(wsState.error) : null,
  };
}

/**
 * Get nearby entities (players, mobs, objects)
 *
 * @param agentId - The agent's UUID
 * @param radius - Search radius (unused with WebSocket, kept for API compatibility)
 * @returns Array of nearby entities
 */
export function useNearbyEntities(
  agentId: UUID | undefined,
  radius: number = 10,
) {
  const { isActive, worldUrl } = useHyperscapePlugin(agentId);
  const wsState = useHyperscapeWebSocket({
    agentId: isActive ? agentId : undefined,
    url: worldUrl,
  });

  return {
    data: wsState.nearbyEntities,
    isLoading: wsState.status === "connecting",
    error: wsState.error ? new Error(wsState.error) : null,
  };
}

// ============================================================================
// Combat Hooks
// ============================================================================

/**
 * Get current combat session (if in combat)
 *
 * @param agentId - The agent's UUID
 * @returns Current combat session or null if not in combat
 */
export function useCombatSession(agentId: UUID | undefined) {
  const { isActive, worldUrl } = useHyperscapePlugin(agentId);
  const wsState = useHyperscapeWebSocket({
    agentId: isActive ? agentId : undefined,
    url: worldUrl,
  });

  return {
    data: wsState.combatSession,
    isLoading: wsState.status === "connecting",
    error: wsState.error ? new Error(wsState.error) : null,
  };
}

/**
 * Get combat history
 * Note: Not yet implemented via WebSocket
 *
 * @param agentId - The agent's UUID
 * @param limit - Maximum number of combat sessions to return
 * @returns Array of past combat sessions
 */
export function useCombatHistory(
  agentId: UUID | undefined,
  limit: number = 10,
) {
  // TODO: Implement combat history via WebSocket or separate API
  return {
    data: [] as CombatSession[],
    isLoading: false,
    error: null,
  };
}

// ============================================================================
// Performance Metrics Hook
// ============================================================================

/**
 * Get performance metrics (XP/hr, gold/hr, efficiency)
 *
 * @param agentId - The agent's UUID
 * @returns Performance metrics including XP and gold rates
 */
export function usePerformanceMetrics(agentId: UUID | undefined) {
  const { isActive, worldUrl } = useHyperscapePlugin(agentId);
  const wsState = useHyperscapeWebSocket({
    agentId: isActive ? agentId : undefined,
    url: worldUrl,
  });

  return {
    data: wsState.metrics,
    isLoading: wsState.status === "connecting",
    error: wsState.error ? new Error(wsState.error) : null,
  };
}

// ============================================================================
// Connection Status Hook
// ============================================================================

/**
 * Check if agent is connected to Hyperscape world
 *
 * @param agentId - The agent's UUID
 * @returns Boolean indicating connection status
 */
export function useIsConnected(agentId: UUID | undefined): boolean {
  const { data } = useWorldStatus(agentId);
  return data?.connected ?? false;
}

// ============================================================================
// Combined Hook for Dashboard
// ============================================================================

/**
 * Get all essential Hyperscape data for dashboard view
 * Uses a single WebSocket connection for efficiency
 *
 * @param agentId - The agent's UUID
 * @returns Combined data from all hooks with loading and error states
 */
export function useHyperscapeDashboard(agentId: UUID | undefined) {
  const { isActive, worldUrl } = useHyperscapePlugin(agentId);
  const wsState = useHyperscapeWebSocket({
    agentId: isActive ? agentId : undefined,
    url: worldUrl,
    autoReconnect: true,
  });

  const isLoading = wsState.status === "connecting";
  const error = wsState.error ? new Error(wsState.error) : null;

  return {
    agentStatus: wsState.agentStatus,
    worldStatus:
      wsState.status === "connected"
        ? {
            connected: true,
            worldId: wsState.agentStatus?.worldId || null,
            worldName: wsState.agentStatus?.worldId || "Unknown World",
            playerCount: 0,
            serverTime: Date.now(),
          }
        : null,
    playerStats: wsState.stats,
    inventory: wsState.inventory,
    equipment: null, // TODO: Extract from agent status
    position: wsState.position,
    nearbyEntities: wsState.nearbyEntities,
    combatSession: wsState.combatSession,
    metrics: wsState.metrics,
    isLoading,
    error,
    wsStatus: wsState.status,
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Calculate XP required for a given level (RuneScape formula)
 * Used for skill progression calculations
 */
function calculateXPForLevel(level: number): number {
  if (level <= 1) return 0;
  let xp = 0;
  for (let i = 1; i < level; i++) {
    xp += Math.floor(i + 300 * Math.pow(2, i / 7));
  }
  return Math.floor(xp / 4);
}
