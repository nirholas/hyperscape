/**
 * Mock utilities for testing
 *
 * Exports all mock factories and utilities for use in tests.
 */

import { vi } from "vitest";

// Re-export MockWorld
export { createMockWorld, type MockWorld } from "./MockWorld";

// Type alias for consistency with existing tests
export type MockClientWorld = import("./MockWorld").MockWorld;

/**
 * Create a mock world without network capabilities
 */
export function createMockWorldWithoutNetwork(): MockClientWorld {
  const { createMockWorld } = require("./MockWorld");
  const world = createMockWorld();
  world.network = undefined as unknown as typeof world.network;
  return world;
}

/**
 * Get the last network call made on a mock world
 */
export function getLastNetworkCall(world: MockClientWorld): {
  event: string;
  data: unknown;
} | null {
  const sendMock = world.network?.send;
  if (!sendMock || sendMock.mock.calls.length === 0) {
    return null;
  }
  const lastCall = sendMock.mock.calls[sendMock.mock.calls.length - 1];
  return { event: lastCall[0], data: lastCall[1] };
}

/**
 * Clear all mock calls on a mock world
 */
export function clearMockWorldCalls(world: MockClientWorld): void {
  world.emit.mockClear();
  world.on.mockClear();
  world.off.mockClear();
  world.network?.send.mockClear();
}

/**
 * Create a mock drag event at a specific position
 */
export function createDragEventAtPosition(
  x: number,
  y: number,
): React.DragEvent<HTMLDivElement> {
  return {
    clientX: x,
    clientY: y,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    dataTransfer: {
      setData: vi.fn(),
      getData: vi.fn(),
      effectAllowed: "move",
      dropEffect: "move",
    },
  } as unknown as React.DragEvent<HTMLDivElement>;
}

/**
 * Create a mock drag event for insert zone
 */
export function createInsertZoneDragEvent(): React.DragEvent<HTMLDivElement> {
  return createDragEventAtPosition(10, 50);
}

/**
 * Create a mock drag event for swap zone
 */
export function createSwapZoneDragEvent(): React.DragEvent<HTMLDivElement> {
  return createDragEventAtPosition(50, 50);
}

/**
 * Create a generic mock drag event
 */
export function createMockDragEvent(): React.DragEvent<HTMLDivElement> {
  return createDragEventAtPosition(0, 0);
}
