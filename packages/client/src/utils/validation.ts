/**
 * Shared validation utilities
 *
 * Single source of truth for input validation patterns used across the client.
 */

/**
 * Regex for sanitizing player names.
 * Only allows letters, numbers, spaces, hyphens, and underscores.
 * All other characters are replaced.
 */
export const NAME_SANITIZE_REGEX = /[^a-zA-Z0-9\s\-_]/g;
