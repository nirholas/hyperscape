import { vi } from "vitest";

// Re-export from test-mocks for consistency
export { createMockWorld } from "../../types/test-mocks";

interface MockHyperscapeServiceOverrides {
  [key: string]: unknown;
}

/**
 * Creates a mock Hyperscape service for testing
 * Matches the current HyperscapeService API (WebSocket-based, no local World)
 */
export function createMockHyperscapeService(
  overrides: MockHyperscapeServiceOverrides = {},
) {
  const mockPlayerEntity = {
    id: "test-player-id",
    name: "TestPlayer",
    position: [0, 0, 0] as [number, number, number],
    alive: true,
    health: 100,
    skills: {},
    inventory: [],
    equipment: {},
  };

  const mockNearbyEntities = new Map<string, unknown>();

  return {
    serviceType: "hyperscapeService",
    capabilityDescription:
      "Manages WebSocket connection to Hyperscape game server",

    // Connection state
    isConnected: vi.fn().mockReturnValue(true),
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),

    // Game state access
    getPlayerEntity: vi.fn().mockReturnValue(mockPlayerEntity),
    getNearbyEntities: vi
      .fn()
      .mockReturnValue(Array.from(mockNearbyEntities.values())),
    getGameState: vi.fn().mockReturnValue({
      playerEntity: mockPlayerEntity,
      nearbyEntities: mockNearbyEntities,
      currentRoomId: null,
      worldId: "test-world",
      lastUpdate: Date.now(),
    }),
    getLastRemovedEntity: vi.fn().mockReturnValue(null),

    // Behavior manager (the only manager that still exists)
    getBehaviorManager: vi.fn().mockReturnValue({
      running: false,
      start: vi.fn(),
      stop: vi.fn(),
      getGoal: vi.fn().mockReturnValue(null),
      setGoal: vi.fn(),
      clearGoal: vi.fn(),
      pauseGoals: vi.fn(),
      resumeGoals: vi.fn(),
      isGoalsPaused: vi.fn().mockReturnValue(false),
    }),

    // Event handling
    onGameEvent: vi.fn(),
    offGameEvent: vi.fn(),
    getLogs: vi.fn().mockReturnValue([]),

    // Command execution
    executeMove: vi.fn().mockResolvedValue(undefined),
    executeAttack: vi.fn().mockResolvedValue(undefined),
    executeUseItem: vi.fn().mockResolvedValue(undefined),
    executeEquipItem: vi.fn().mockResolvedValue(undefined),
    executePickupItem: vi.fn().mockResolvedValue(undefined),
    executeDropItem: vi.fn().mockResolvedValue(undefined),
    executeChatMessage: vi.fn().mockResolvedValue(undefined),
    executeGatherResource: vi.fn().mockResolvedValue(undefined),
    executeBankAction: vi.fn().mockResolvedValue(undefined),

    // Autonomous behavior control
    startAutonomousBehavior: vi.fn(),
    stopAutonomousBehavior: vi.fn(),
    isAutonomousBehaviorRunning: vi.fn().mockReturnValue(false),
    setAutonomousBehaviorEnabled: vi.fn(),

    // Legacy aliases
    startAutonomousExploration: vi.fn(),
    stopAutonomousExploration: vi.fn(),
    isExplorationRunning: vi.fn().mockReturnValue(false),

    // Goal sync
    syncGoalToServer: vi.fn(),
    unlockGoal: vi.fn(),

    // Adapter methods (return null since we don't have a local World)
    currentWorldId: "test-world",
    getWorld: vi.fn().mockReturnValue(null),
    getEmoteManager: vi.fn().mockReturnValue(null),
    getMessageManager: vi.fn().mockReturnValue(null),
    getDynamicActionLoader: vi.fn().mockReturnValue(null),
    playEmote: vi.fn().mockResolvedValue(undefined),

    // Apply overrides
    ...overrides,
  };
}

interface MockChatMessageOverrides {
  fromId?: string;
  from?: string;
  body?: string;
  text?: string;
  createdAt?: string;
  [key: string]: unknown;
}

/**
 * Helper to create a mock chat message
 */
export function createMockChatMessage(
  overrides: MockChatMessageOverrides = {},
) {
  const body = overrides.body || "Hello agent!";
  return {
    id: `msg-${Date.now()}`,
    fromId: overrides.fromId || "user-123",
    from: overrides.from || "TestUser",
    body,
    text: overrides.text || body,
    createdAt: overrides.createdAt || new Date().toISOString(),
    timestamp: Date.now(),
    ...overrides,
  };
}

interface MockWorld {
  _eventListeners?: Record<string, ((...args: unknown[]) => void)[]>;
  [key: string]: unknown;
}

/**
 * Helper to simulate world events
 */
export function simulateWorldEvent(
  world: MockWorld,
  event: string,
  data: unknown,
) {
  const listeners = world._eventListeners?.[event] || [];
  listeners.forEach((listener) => listener(data));
}

/**
 * Creates a mock behavior manager for testing
 * This is the only manager that still exists in the plugin
 */
export function createMockBehaviorManager(): {
  running: boolean;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  getGoal: ReturnType<typeof vi.fn>;
  setGoal: ReturnType<typeof vi.fn>;
  clearGoal: ReturnType<typeof vi.fn>;
  pauseGoals: ReturnType<typeof vi.fn>;
  resumeGoals: ReturnType<typeof vi.fn>;
  isGoalsPaused: ReturnType<typeof vi.fn>;
} {
  return {
    running: false,
    start: vi.fn(),
    stop: vi.fn(),
    getGoal: vi.fn().mockReturnValue(null),
    setGoal: vi.fn(),
    clearGoal: vi.fn(),
    pauseGoals: vi.fn(),
    resumeGoals: vi.fn(),
    isGoalsPaused: vi.fn().mockReturnValue(false),
  };
}
