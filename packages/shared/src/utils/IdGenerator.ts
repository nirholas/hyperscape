/**
 * ID Generation Utilities
 *
 * Provides unique ID generation for entities, players, sessions, and more.
 */

import { customAlphabet } from "nanoid";

const ALPHABET =
  "1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

/**
 * Generates a unique 10-character alphanumeric ID
 *
 * Uses nano-id with a custom alphabet for collision-resistant short IDs.
 * Safe for use as primary keys in databases and entity identifiers.
 *
 * Collision probability: ~1% chance after 129 million IDs or 148 years of use
 * See: https://zelark.github.io/nano-id-cc/
 *
 * @returns A 10-character unique ID (e.g., "a3B9xK7m2Q")
 *
 * @example
 * const playerId = uuid() // => "a3B9xK7m2Q"
 * const entityId = uuid() // => "7kP2mX9bH4"
 */
export const uuid = customAlphabet(ALPHABET, 10);

/**
 * Generate unique transaction ID for loot operations
 *
 * Used for tracking loot requests between client and server.
 * Enables shadow state confirmation/rollback on client.
 *
 * Format: loot_{timestamp36}_{random6}
 *
 * @returns A unique transaction ID (e.g., "loot_m1abc2_x7y8z9")
 *
 * @example
 * const txId = generateTransactionId() // => "loot_m1abc2_x7y8z9"
 */
export function generateTransactionId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `loot_${timestamp}_${random}`;
}
