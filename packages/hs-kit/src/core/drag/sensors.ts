/**
 * Sensors for different input methods
 *
 * Sensors detect user input and translate it into drag operations.
 * hs-kit includes pointer (mouse/touch) and keyboard sensors.
 */

import type { Point } from "../../types";

// ============================================================================
// Sensor Types
// ============================================================================

/** Activation constraints for sensors */
export interface ActivationConstraint {
  /** Minimum distance in pixels before drag activates */
  distance?: number;
  /** Delay in milliseconds before drag activates */
  delay?: number;
  /** Tolerance in pixels of movement during delay */
  tolerance?: number;
}

/** Sensor configuration */
export interface SensorConfig {
  /** Activation constraints */
  activationConstraint?: ActivationConstraint;
}

/** Pointer sensor options */
export interface PointerSensorOptions extends SensorConfig {
  /** Only activate on specific pointer types */
  pointerTypes?: Array<"mouse" | "touch" | "pen">;
}

/** Keyboard sensor options */
export interface KeyboardSensorOptions extends SensorConfig {
  /** Key to start drag (default: Space or Enter) */
  startKeys?: string[];
  /** Key to cancel drag (default: Escape) */
  cancelKeys?: string[];
  /** Key to drop (default: Space or Enter) */
  dropKeys?: string[];
  /** Movement keys (default: Arrow keys) */
  movementKeys?: {
    up?: string[];
    down?: string[];
    left?: string[];
    right?: string[];
  };
  /** Pixels to move per keypress */
  moveStep?: number;
  /** Multiplier when Shift is held (default: 5) */
  shiftMultiplier?: number;
}

// ============================================================================
// Default Configurations
// ============================================================================

export const DEFAULT_POINTER_ACTIVATION: ActivationConstraint = {
  distance: 3,
};

export const DEFAULT_KEYBOARD_OPTIONS: Required<KeyboardSensorOptions> = {
  activationConstraint: {},
  startKeys: [" ", "Enter"],
  cancelKeys: ["Escape"],
  dropKeys: [" ", "Enter"],
  movementKeys: {
    up: ["ArrowUp"],
    down: ["ArrowDown"],
    left: ["ArrowLeft"],
    right: ["ArrowRight"],
  },
  moveStep: 10,
  shiftMultiplier: 5,
};

// ============================================================================
// Sensor Utilities
// ============================================================================

/**
 * Check if activation constraint is met
 */
export function checkActivationConstraint(
  origin: Point,
  current: Point,
  startTime: number,
  constraint: ActivationConstraint,
): { activated: boolean; shouldCancel: boolean } {
  const distance = Math.sqrt(
    Math.pow(current.x - origin.x, 2) + Math.pow(current.y - origin.y, 2),
  );

  // Distance-based activation
  if (constraint.distance !== undefined) {
    if (distance >= constraint.distance) {
      return { activated: true, shouldCancel: false };
    }
  }

  // Delay-based activation
  if (constraint.delay !== undefined) {
    const elapsed = Date.now() - startTime;

    // Check if we moved too much during delay
    if (constraint.tolerance !== undefined && distance > constraint.tolerance) {
      return { activated: false, shouldCancel: true };
    }

    if (elapsed >= constraint.delay) {
      return { activated: true, shouldCancel: false };
    }
  }

  // Default: activate on any distance if no constraints
  if (constraint.distance === undefined && constraint.delay === undefined) {
    if (distance > 0) {
      return { activated: true, shouldCancel: false };
    }
  }

  return { activated: false, shouldCancel: false };
}

/**
 * Calculate keyboard movement delta
 */
export function getKeyboardMovementDelta(
  key: string,
  options: KeyboardSensorOptions,
  shiftKey: boolean = false,
): Point | null {
  const step =
    (options.moveStep ?? DEFAULT_KEYBOARD_OPTIONS.moveStep) *
    (shiftKey ? 5 : 1);
  const movement =
    options.movementKeys ?? DEFAULT_KEYBOARD_OPTIONS.movementKeys;

  if (movement.up?.includes(key)) return { x: 0, y: -step };
  if (movement.down?.includes(key)) return { x: 0, y: step };
  if (movement.left?.includes(key)) return { x: -step, y: 0 };
  if (movement.right?.includes(key)) return { x: step, y: 0 };

  return null;
}

/**
 * Check if key is a start key
 */
export function isStartKey(
  key: string,
  options?: KeyboardSensorOptions,
): boolean {
  const startKeys = options?.startKeys ?? DEFAULT_KEYBOARD_OPTIONS.startKeys;
  return startKeys.includes(key);
}

/**
 * Check if key is a cancel key
 */
export function isCancelKey(
  key: string,
  options?: KeyboardSensorOptions,
): boolean {
  const cancelKeys = options?.cancelKeys ?? DEFAULT_KEYBOARD_OPTIONS.cancelKeys;
  return cancelKeys.includes(key);
}

/**
 * Check if key is a drop key
 */
export function isDropKey(
  key: string,
  options?: KeyboardSensorOptions,
): boolean {
  const dropKeys = options?.dropKeys ?? DEFAULT_KEYBOARD_OPTIONS.dropKeys;
  return dropKeys.includes(key);
}
