/**
 * Type Utilities for HyperForge
 *
 * This file contains utility types for:
 * - Branded types (type-safe IDs)
 * - Result types (discriminated unions for success/error)
 * - Error handling utilities
 * - Validation patterns
 *
 * These patterns enforce compile-time safety and prevent runtime bugs.
 */

import { logger } from "@/lib/utils";

const log = logger.child("Utils");

// =============================================================================
// BRANDED TYPES - Prevent mixing string IDs
// =============================================================================

/**
 * Brand marker for nominal typing
 * Used to create unique string types that can't be mixed
 */
declare const __brand: unique symbol;
type Brand<T, B> = T & { readonly [__brand]: B };

/**
 * Branded ID types - prevent mixing different ID strings
 *
 * @example
 * const userId: UserId = "user_123" as UserId;
 * const assetId: AssetId = "asset_456" as AssetId;
 * // assetId = userId; // ❌ Compile error!
 */
export type UserId = Brand<string, "UserId">;
export type AssetId = Brand<string, "AssetId">;
export type TaskId = Brand<string, "TaskId">;
export type GenerationId = Brand<string, "GenerationId">;
export type ManifestId = Brand<string, "ManifestId">;
export type VoiceId = Brand<string, "VoiceId">;
export type MusicId = Brand<string, "MusicId">;
export type SpriteId = Brand<string, "SpriteId">;
export type DialogueId = Brand<string, "DialogueId">;
export type ItemId = Brand<string, "ItemId">;
export type NpcId = Brand<string, "NpcId">;

/**
 * Create a branded ID from a string
 * Only use at boundaries (parsing/validation)
 */
export function createUserId(id: string): UserId {
  return id as UserId;
}

export function createAssetId(id: string): AssetId {
  return id as AssetId;
}

export function createTaskId(id: string): TaskId {
  return id as TaskId;
}

export function createGenerationId(id: string): GenerationId {
  return id as GenerationId;
}

// =============================================================================
// RESULT TYPES - Discriminated unions for success/error
// =============================================================================

/**
 * Standard result type for operations that can fail
 * Use instead of throwing exceptions for expected failures
 *
 * @example
 * function fetchAsset(id: AssetId): Promise<Result<Asset, FetchError>> {
 *   try {
 *     const asset = await db.get(id);
 *     return { ok: true, value: asset };
 *   } catch (e) {
 *     return { ok: false, error: toAppError(e) };
 *   }
 * }
 */
export type Result<T, E = Error> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

/**
 * Create a success result
 */
export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

/**
 * Create an error result
 */
export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

/**
 * Async result type
 */
export type AsyncResult<T, E = Error> = Promise<Result<T, E>>;

/**
 * Optional result - for operations that may return nothing (not an error)
 */
export type Option<T> =
  | { readonly some: true; readonly value: T }
  | { readonly some: false };

export function some<T>(value: T): Option<T> {
  return { some: true, value };
}

export function none(): Option<never> {
  return { some: false };
}

// =============================================================================
// EXHAUSTIVENESS CHECKING
// =============================================================================

/**
 * Exhaustiveness check helper
 * Use in switch statements to ensure all cases are handled
 *
 * @example
 * type Status = "pending" | "completed" | "failed";
 *
 * function handleStatus(status: Status) {
 *   switch (status) {
 *     case "pending": return "...";
 *     case "completed": return "...";
 *     case "failed": return "...";
 *     default:
 *       assertNever(status); // ❌ Compile error if a case is missing
 *   }
 * }
 */
export function assertNever(value: never, message?: string): never {
  throw new Error(message ?? `Unexpected value: ${JSON.stringify(value)}`);
}

/**
 * Exhaustive check that returns a value (for expressions)
 */
export function exhaustive<T>(value: never, fallback: T): T {
  log.error("Unhandled case", { value });
  return fallback;
}

// =============================================================================
// ERROR HANDLING UTILITIES
// =============================================================================

/**
 * Standard error structure for HyperForge
 */
export interface AppError {
  readonly code: string;
  readonly message: string;
  readonly details?: Record<string, unknown>;
  readonly cause?: unknown;
}

/**
 * Type guard for Error objects
 */
export function isError(value: unknown): value is Error {
  return value instanceof Error;
}

/**
 * Convert unknown catch variable to Error
 * Use after catching exceptions
 *
 * @example
 * try {
 *   await riskyOperation();
 * } catch (e) {
 *   const error = toError(e);
 *   console.error(error.message);
 * }
 */
export function toError(value: unknown): Error {
  if (value instanceof Error) {
    return value;
  }
  if (typeof value === "string") {
    return new Error(value);
  }
  if (typeof value === "object" && value !== null) {
    const msg =
      "message" in value && typeof value.message === "string"
        ? value.message
        : JSON.stringify(value);
    return new Error(msg);
  }
  return new Error(String(value));
}

/**
 * Convert unknown to AppError
 */
export function toAppError(value: unknown, code = "UNKNOWN_ERROR"): AppError {
  const error = toError(value);
  return {
    code,
    message: error.message,
    cause: value,
  };
}

/**
 * Get error message from unknown catch variable
 */
export function getErrorMessage(value: unknown): string {
  return toError(value).message;
}

// =============================================================================
// VALIDATION UTILITIES
// =============================================================================

/**
 * Validate and return or throw
 * Use at boundaries when you want to fail fast
 *
 * @example
 * function processRequest(body: unknown): ProcessedRequest {
 *   return validateOrThrow(RequestSchema, body, "Invalid request body");
 * }
 */
export function validateOrThrow<T>(
  validator: (input: unknown) => T | undefined,
  input: unknown,
  errorMessage: string,
): T {
  const result = validator(input);
  if (result === undefined) {
    throw new Error(errorMessage);
  }
  return result;
}

/**
 * Narrow a record access with undefined check
 * Use with noUncheckedIndexedAccess
 *
 * @example
 * const map: Record<string, Item> = { ... };
 * const item = getOrThrow(map, key, `Item not found: ${key}`);
 */
export function getOrThrow<T>(
  record: Record<string, T | undefined>,
  key: string,
  errorMessage?: string,
): T {
  const value = record[key];
  if (value === undefined) {
    throw new Error(errorMessage ?? `Key not found: ${key}`);
  }
  return value;
}

/**
 * Safe index access with default
 */
export function getOr<T>(
  record: Record<string, T | undefined>,
  key: string,
  defaultValue: T,
): T {
  const value = record[key];
  return value ?? defaultValue;
}

// =============================================================================
// TYPE GUARDS FOR COMMON PATTERNS
// =============================================================================

/**
 * Check if value is a non-null object
 */
export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Check if value is a non-empty string
 */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/**
 * Check if value is a positive number
 */
export function isPositiveNumber(value: unknown): value is number {
  return typeof value === "number" && value > 0 && isFinite(value);
}

/**
 * Assert a condition (for invariants)
 * Throws if condition is false
 */
export function assert(
  condition: unknown,
  message?: string,
): asserts condition {
  if (!condition) {
    throw new Error(message ?? "Assertion failed");
  }
}

/**
 * Assert value is defined (not null/undefined)
 */
export function assertDefined<T>(
  value: T | null | undefined,
  message?: string,
): asserts value is T {
  if (value === null || value === undefined) {
    throw new Error(message ?? "Expected value to be defined");
  }
}
