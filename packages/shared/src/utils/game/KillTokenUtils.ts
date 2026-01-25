/**
 * Kill Token Utilities
 *
 * Provides HMAC-based kill token generation and validation to prevent
 * spoofed NPC_DIED events from compromised components.
 *
 * **Security Model:**
 * - CombatSystem/MobEntity generates token on kill
 * - QuestSystem validates token before crediting progress
 * - Prevents quest progress manipulation via event spoofing
 *
 * **Implementation:**
 * - Uses HMAC-SHA256 for token generation
 * - Tokens include: mobId, killedBy, timestamp
 * - Validates timestamp within acceptable window (default: 5 seconds)
 *
 * **Runs on:** Server only (uses Node.js crypto)
 */

type CryptoModule = typeof import("crypto");
type CryptoRequire = (moduleId: "crypto") => CryptoModule;

declare const require: CryptoRequire;

// Lazy-loaded crypto module (Node.js only)
let cryptoModule: typeof import("crypto") | null = null;
let cryptoLoadAttempted = false;

/** Type for dynamic require function */
type RequireFn = (id: string) => unknown;

/**
 * Get the crypto module (lazy load to avoid client-side errors)
 */
function getCrypto(): typeof import("crypto") | null {
  if (!cryptoLoadAttempted) {
    cryptoLoadAttempted = true;
    try {
      // Use globalThis to access require in Node.js environment
      // This avoids ESLint issues while maintaining compatibility
      const g = globalThis as { require?: RequireFn };
      const nodeRequire =
        typeof g !== "undefined" && typeof g.require === "function"
          ? g.require
          : null;

      if (nodeRequire) {
        cryptoModule = nodeRequire("crypto") as typeof import("crypto");
      }
    } catch {
      // Not available (running on client or bundled environment)
      cryptoModule = null;
    }
  }
  return cryptoModule;
}

/** Default secret for development (override via KILL_TOKEN_SECRET env var) */
const DEFAULT_SECRET = "hyperscape-kill-secret-dev";

/** Maximum age of a valid kill event (milliseconds) */
const MAX_KILL_EVENT_AGE_MS = 5000;

/**
 * Get the secret used for kill token generation/validation
 */
function getSecret(): string {
  // Use environment variable if available, otherwise default
  if (typeof process !== "undefined" && process.env?.KILL_TOKEN_SECRET) {
    return process.env.KILL_TOKEN_SECRET;
  }
  return DEFAULT_SECRET;
}

/**
 * Generate a kill token for an NPC death event
 *
 * @param mobId - The mob entity ID
 * @param killedBy - The player ID who killed the mob
 * @param timestamp - When the kill occurred (Unix ms)
 * @returns HMAC token string (16 hex chars), or empty string if crypto unavailable
 */
export function generateKillToken(
  mobId: string,
  killedBy: string,
  timestamp: number,
): string {
  const crypto = getCrypto();
  if (!crypto) {
    // Client-side or crypto unavailable - return empty (validation will be skipped)
    return "";
  }

  const secret = getSecret();
  const data = `${mobId}:${killedBy}:${timestamp}`;

  return crypto
    .createHmac("sha256", secret)
    .update(data)
    .digest("hex")
    .substring(0, 16);
}

/**
 * Validate a kill token from an NPC death event
 *
 * @param mobId - The mob entity ID
 * @param killedBy - The player ID who killed the mob
 * @param timestamp - When the kill occurred (Unix ms)
 * @param token - The token to validate
 * @returns true if token is valid and not stale, false otherwise
 */
export function validateKillToken(
  mobId: string,
  killedBy: string,
  timestamp: number,
  token: string,
): boolean {
  const crypto = getCrypto();
  if (!crypto) {
    // Crypto unavailable - skip validation (development/client mode)
    return true;
  }

  // Check for missing token (backwards compatibility during rollout)
  if (!token) {
    // During rollout phase, allow events without tokens
    // TODO: Make this stricter after full rollout
    return true;
  }

  // Validate timestamp freshness
  const now = Date.now();
  const age = Math.abs(now - timestamp);
  if (age > MAX_KILL_EVENT_AGE_MS) {
    // Event is too old - likely replay attack or stale event
    return false;
  }

  // Validate token signature
  const expectedToken = generateKillToken(mobId, killedBy, timestamp);
  return token === expectedToken;
}

/**
 * Check if kill token validation is available
 *
 * @returns true if crypto module is available (server-side)
 */
export function isKillTokenValidationAvailable(): boolean {
  return getCrypto() !== null;
}
