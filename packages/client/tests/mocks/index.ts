/**
 * Mock utilities for testing
 *
 * Exports all mock factories and utilities for use in tests.
 */

import { vi } from "vitest";

// Re-export MockWorld
export {
  createMockWorld,
  type MockWorld,
  asClientWorld,
  createEventTracker,
} from "./MockWorld";

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

// NOTE: Performance mocks are handled by setup.ts
// Do not duplicate them here to avoid conflicting spy implementations

// Drag event helpers for testing drag-drop functionality

/**
 * Create a mock element with getBoundingClientRect
 */
function createMockElement(
  width: number = 40,
  height: number = 40,
  left: number = 0,
  top: number = 0,
): HTMLElement {
  const el = document.createElement("div");
  el.getBoundingClientRect = () => ({
    width,
    height,
    left,
    top,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({}),
  });
  return el;
}

/**
 * Create a drag event at a specific position within an element
 * Used to test swap vs insert zone detection based on horizontal position
 *
 * @param type - Event type ("dragover", "drop", etc.)
 * @param position - Either a ratio (0.0-1.0 of element width) or named position
 * @param elementWidth - Width of the element in pixels (default 40)
 */
export function createDragEventAtPosition(
  type: string,
  position: "left" | "center" | "right" | number,
  elementWidth: number = 40,
): DragEvent {
  // Calculate clientX based on position (relative to element left edge at 0)
  // Left 40% = insert before, Right 60% = swap (per hook logic)
  let clientX: number;

  if (typeof position === "number") {
    // Numeric ratio: 0.2 means 20% from left
    clientX = elementWidth * position;
  } else {
    switch (position) {
      case "left":
        clientX = elementWidth * 0.2; // 20% from left (in insert zone)
        break;
      case "center":
        clientX = elementWidth * 0.5; // Center (in swap zone)
        break;
      case "right":
        clientX = elementWidth * 0.8; // 80% from left (in swap zone)
        break;
    }
  }

  const event = new DragEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX,
    clientY: 20,
  });

  // Attach mock currentTarget with getBoundingClientRect
  const mockElement = createMockElement(elementWidth, 40, 0, 0);
  Object.defineProperty(event, "currentTarget", {
    value: mockElement,
    writable: false,
  });

  return event;
}

/**
 * Create a drag event in the insert zone (left or right edge)
 */
export function createInsertZoneDragEvent(
  type: string,
  side: "left" | "right" = "left",
): DragEvent {
  return createDragEventAtPosition(type, side, 40);
}

/**
 * Create a drag event in the swap zone (center)
 */
export function createSwapZoneDragEvent(type: string): DragEvent {
  return createDragEventAtPosition(type, "center", 40);
}

/**
 * Create a basic mock drag event with currentTarget and spy on preventDefault
 */
export function createMockDragEvent(type: string): DragEvent {
  const event = new DragEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: 20,
    clientY: 20,
  });

  const mockElement = createMockElement(40, 40, 0, 0);
  Object.defineProperty(event, "currentTarget", {
    value: mockElement,
    writable: false,
  });

  // Make preventDefault a spy so tests can verify it was called
  event.preventDefault = vi.fn();

  return event;
}

/**
 * Create a drag event with custom options
 */
export function createDragEvent(
  type: string,
  options: {
    dataTransfer?: DataTransfer;
    clientX?: number;
    clientY?: number;
  } = {},
): DragEvent {
  const event = new DragEvent(type, {
    bubbles: true,
    cancelable: true,
    dataTransfer: options.dataTransfer,
    clientX: options.clientX ?? 20,
    clientY: options.clientY ?? 20,
  });

  const mockElement = createMockElement(40, 40, 0, 0);
  Object.defineProperty(event, "currentTarget", {
    value: mockElement,
    writable: false,
  });

  return event;
}

export function createMockDragStartEvent(slotIndex: number): DragEvent {
  const event = createDragEvent("dragstart");
  if (event.dataTransfer) {
    event.dataTransfer.setData("text/plain", String(slotIndex));
  }
  return event;
}
