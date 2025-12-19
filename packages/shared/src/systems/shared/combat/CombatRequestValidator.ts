/**
 * Combat Request Validator with HMAC Signing
 *
 * Provides request signing and validation for combat actions.
 * Prevents request forgery and replay attacks.
 *
 * Uses HMAC-SHA256 for signature generation and verification.
 * Includes timestamp freshness checks to prevent replay attacks.
 *
 * @see OSRS-IMPLEMENTATION-PLAN.md Phase 5.3
 */

import { createHmac } from "crypto";

// =============================================================================
// TYPES
// =============================================================================

/**
 * Combat action types that can be signed
 */
export type CombatAction = "attack" | "disengage" | "retaliate";

/**
 * Signed combat request structure
 */
export interface SignedCombatRequest {
  /** Player initiating the action */
  playerId: string;
  /** Target of the action */
  targetId: string;
  /** Type of combat action */
  action: CombatAction;
  /** Game tick when request was made */
  tick: number;
  /** Wall-clock timestamp when request was made */
  timestamp: number;
  /** Player's session ID */
  sessionId: string;
  /** HMAC-SHA256 signature of the request */
  signature: string;
}

/**
 * Unsigned combat request (for signing)
 */
export type UnsignedCombatRequest = Omit<SignedCombatRequest, "signature">;

/**
 * Result of validating a signed request
 */
export interface ValidationResult {
  /** Whether the request is valid */
  valid: boolean;
  /** Reason for failure (if invalid) */
  reason?: "request_expired" | "request_future" | "invalid_signature";
}

// =============================================================================
// VALIDATOR
// =============================================================================

/**
 * Configuration for CombatRequestValidator
 */
export interface CombatRequestValidatorConfig {
  /** Maximum age of a request in ms (default: 5000) */
  maxRequestAgeMs: number;
  /** Maximum future time allowed in ms (default: 1000) */
  maxFutureMs: number;
}

const DEFAULT_CONFIG: CombatRequestValidatorConfig = {
  maxRequestAgeMs: 5000, // 5 second window
  maxFutureMs: 1000, // 1 second future tolerance (clock skew)
};

/**
 * Combat Request Validator
 *
 * Signs and validates combat requests using HMAC-SHA256.
 * Ensures requests are fresh and haven't been tampered with.
 *
 * @example
 * ```typescript
 * // Server-side
 * const validator = new CombatRequestValidator(process.env.COMBAT_SECRET!);
 *
 * // Validate incoming request
 * const result = validator.validateRequest(request);
 * if (!result.valid) {
 *   console.log(`Invalid request: ${result.reason}`);
 *   return;
 * }
 *
 * // Client-side (trusted server creates signatures)
 * const signature = validator.signRequest({
 *   playerId: 'player1',
 *   targetId: 'mob1',
 *   action: 'attack',
 *   tick: 100,
 *   timestamp: Date.now(),
 *   sessionId: 'session123',
 * });
 * ```
 */
export class CombatRequestValidator {
  private readonly secretKey: string;
  private readonly config: CombatRequestValidatorConfig;

  /**
   * Create a new validator
   *
   * @param secretKey - Secret key for HMAC signing (keep secure!)
   * @param config - Optional configuration overrides
   */
  constructor(
    secretKey: string,
    config?: Partial<CombatRequestValidatorConfig>,
  ) {
    if (!secretKey || secretKey.length < 16) {
      throw new Error(
        "CombatRequestValidator: secretKey must be at least 16 characters",
      );
    }
    this.secretKey = secretKey;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Validate HMAC signature and request freshness
   *
   * @param request - The signed request to validate
   * @returns Validation result with valid flag and optional reason
   */
  validateRequest(request: SignedCombatRequest): ValidationResult {
    const now = Date.now();
    const age = now - request.timestamp;

    // Check if request is too old
    if (age > this.config.maxRequestAgeMs) {
      return { valid: false, reason: "request_expired" };
    }

    // Check if request is from the future (clock skew protection)
    if (age < -this.config.maxFutureMs) {
      return { valid: false, reason: "request_future" };
    }

    // Verify HMAC signature
    const expectedSignature = this.computeSignature({
      playerId: request.playerId,
      targetId: request.targetId,
      action: request.action,
      tick: request.tick,
      timestamp: request.timestamp,
      sessionId: request.sessionId,
    });

    // Use timing-safe comparison to prevent timing attacks
    if (!this.timingSafeEqual(request.signature, expectedSignature)) {
      return { valid: false, reason: "invalid_signature" };
    }

    return { valid: true };
  }

  /**
   * Create signature for a request (server-side use only)
   *
   * The signature should be generated server-side and sent to trusted clients.
   * Never expose the secret key to the client.
   *
   * @param request - The unsigned request to sign
   * @returns HMAC-SHA256 signature as hex string
   */
  signRequest(request: UnsignedCombatRequest): string {
    return this.computeSignature(request);
  }

  /**
   * Create a fully signed request
   *
   * Convenience method that takes an unsigned request and returns
   * a complete signed request.
   *
   * @param request - The unsigned request
   * @returns Complete signed request with signature
   */
  createSignedRequest(request: UnsignedCombatRequest): SignedCombatRequest {
    return {
      ...request,
      signature: this.computeSignature(request),
    };
  }

  /**
   * Compute HMAC-SHA256 signature for a request
   *
   * Payload format: "playerId:targetId:action:tick:timestamp:sessionId"
   */
  private computeSignature(request: UnsignedCombatRequest): string {
    const payload = `${request.playerId}:${request.targetId}:${request.action}:${request.tick}:${request.timestamp}:${request.sessionId}`;

    return createHmac("sha256", this.secretKey).update(payload).digest("hex");
  }

  /**
   * Timing-safe string comparison
   *
   * Prevents timing attacks by ensuring comparison takes
   * constant time regardless of where strings differ.
   */
  private timingSafeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) {
      return false;
    }

    let result = 0;
    for (let i = 0; i < a.length; i++) {
      result |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return result === 0;
  }
}

/**
 * Factory function to create a validator with environment variable
 *
 * @param envVarName - Name of environment variable containing secret key
 * @returns CombatRequestValidator instance
 * @throws Error if environment variable is not set
 */
export function createValidatorFromEnv(
  envVarName: string = "COMBAT_REQUEST_SECRET",
): CombatRequestValidator {
  const secretKey = process.env[envVarName];
  if (!secretKey) {
    throw new Error(
      `CombatRequestValidator: ${envVarName} environment variable is not set`,
    );
  }
  return new CombatRequestValidator(secretKey);
}
