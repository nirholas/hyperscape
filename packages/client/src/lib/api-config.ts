/**
 * API Configuration
 *
 * Centralized configuration for external service URLs.
 * URLs are set via Vite's define feature in vite.config.ts.
 *
 * In production builds (vite build):
 *   - GAME_API_URL = https://api.hyperscape.lol
 *   - GAME_WS_URL = wss://api.hyperscape.lol/ws
 *   - CDN_URL = https://d20g7vd4m53hpb.cloudfront.net
 *
 * In development (vite dev):
 *   - GAME_API_URL = http://localhost:5555
 *   - GAME_WS_URL = ws://localhost:5555/ws
 *   - CDN_URL = http://localhost:8080
 */

// =============================================================================
// ElizaOS AI Agent Server
// =============================================================================

export const ELIZAOS_URL =
  import.meta.env.PUBLIC_ELIZAOS_URL ||
  (import.meta.env.PROD
    ? "https://api.hyperscape.lol"
    : "http://localhost:4001");

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
