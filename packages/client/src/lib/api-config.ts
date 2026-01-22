/**
 * API Configuration
 *
 * Centralized configuration for external service URLs.
 * URLs are set via Vite's define feature in vite.config.ts.
 *
 * In production builds (vite build):
 *   - GAME_API_URL = https://hyperscape-production.up.railway.app
 *   - GAME_WS_URL = wss://hyperscape-production.up.railway.app/ws
 *   - CDN_URL = (set via PUBLIC_CDN_URL env var)
 *
 * In development (vite dev):
 *   - GAME_API_URL = http://localhost:5555
 *   - GAME_WS_URL = ws://localhost:5555/ws
 *   - CDN_URL = http://localhost:8080
 */

// =============================================================================
// ElizaOS AI Agent Server (embedded in Hyperscape server)
// =============================================================================
// ElizaOS agent routes are now served directly from the Hyperscape game server.
// No separate ElizaOS process needed - routes are at /api/agents, /api/agents/:id, etc.

export const ELIZAOS_URL =
  import.meta.env.PUBLIC_ELIZAOS_URL ||
  import.meta.env.PUBLIC_API_URL ||
  (import.meta.env.PROD
    ? "https://hyperscape-production.up.railway.app"
    : "http://localhost:5555");

export const ELIZAOS_API = `${ELIZAOS_URL}/api`;

// =============================================================================
// Hyperscape Game Server
// =============================================================================
// These are replaced at build time by Vite's define feature

export const GAME_API_URL = import.meta.env.PUBLIC_API_URL;

export const GAME_WS_URL = import.meta.env.PUBLIC_WS_URL;

// =============================================================================
// CDN for Static Assets
// =============================================================================

export const CDN_URL = import.meta.env.PUBLIC_CDN_URL;
