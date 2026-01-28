/**
 * Library Barrel Export
 */

export { ThreeResourceManager } from "./ThreeResourceManager";
export { windowManager } from "./responsiveWindowManager";
export { ErrorBoundary } from "./ErrorBoundary";
export * from "./error-reporting";
export { injectFarcasterMetaTags } from "./farcaster-frame-config";
export {
  apiClient,
  type ApiClientOptions,
  type ApiResponse,
} from "./api-client";
export {
  GAME_API_URL,
  GAME_WS_URL,
  CDN_URL,
  ELIZAOS_URL,
  ELIZAOS_API,
} from "./api-config";
export {
  WebSocketManager,
  createWebSocketManager,
  ConnectionState,
  type WebSocketManagerConfig,
  type WebSocketManagerCallbacks,
} from "./websocket-manager";
export {
  withRetry,
  tryWithRetry,
  retryable,
  retryFetch,
  type RetryOptions,
  type RetryResult,
} from "./retry";
export { logger } from "./logger";
// Object pooling for game entities (preferred for MMORPG patterns)
export {
  ObjectPool,
  EntityPool,
  poolRegistry,
  createMonitoredPool,
  type ObjectFactory,
  type ObjectReset,
} from "./LRUCache";

// Deprecated: Use ObjectPool instead for game patterns
export {
  LRUCache, // Deprecated alias for ObjectPool
  createMonitoredCache, // Deprecated
  cacheRegistry, // Deprecated alias for poolRegistry
} from "./LRUCache";
