/**
 * Global Type Declarations
 *
 * Type definitions for browser APIs, PhysX, and environment variables.
 */

import THREE from "../extras/three/three";
import { World } from "../core/World";

// ============================================================================
// GLOBAL AUGMENTATIONS
// ============================================================================

declare global {
  const PHYSX: PhysXModule | undefined;

  interface Window {
    THREE?: typeof THREE;
    world?: World;
    preview?: unknown; // AvatarPreview instance
    app?: unknown; // App instance for debugging
    env?: Record<string, string>;
    require?: unknown; // Monaco editor require function
    monaco?: unknown; // Monaco editor instance
    gc?: () => void; // Garbage collection function
    PARTICLES_PATH?: string;
  }

  // Node.js/Browser timer functions
  function setTimeout(
    callback: (...args: unknown[]) => void,
    ms?: number,
    ...args: unknown[]
  ): NodeJS.Timeout;
  function clearTimeout(timeoutId: NodeJS.Timeout): void;
  function setInterval(
    callback: (...args: unknown[]) => void,
    ms?: number,
    ...args: unknown[]
  ): NodeJS.Timeout;
  function clearInterval(intervalId: NodeJS.Timeout): void;

  interface NodeJS {
    global: unknown;
  }

  // Augment globalThis for non-browser environments
  var env: Record<string, string> | undefined;

  // Vite/import.meta types
  interface ImportMetaEnv {
    readonly PUBLIC_WS_URL?: string;
    readonly VITE_PUBLIC_WS_URL?: string;
    [key: string]: string | undefined;
  }

  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }
}

// ============================================================================
// BROWSER APIs
// ============================================================================

// Browser Touch API
declare interface Touch {
  identifier: number;
  target: EventTarget;
  clientX: number;
  clientY: number;
  screenX: number;
  screenY: number;
  pageX: number;
  pageY: number;
  radiusX: number;
  radiusY: number;
  rotationAngle: number;
  force: number;
}

// Database item row type (for system interfaces)
declare interface ItemRow {
  id: string;
  player_id: string;
  item_id: string;
  quantity: number;
  slot: number;
  equipped: boolean;
}

export {};
