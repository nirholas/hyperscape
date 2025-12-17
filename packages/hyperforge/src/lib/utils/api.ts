/**
 * API Utilities
 * Server-side and client-side API utilities for Next.js
 */

/**
 * JSON-serializable value types for API payloads
 */
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;
export type JsonObject = { [key: string]: JsonValue };
export type JsonArray = JsonValue[];

/**
 * Error details that can be included in API responses
 */
export type ApiErrorDetails = JsonObject | string | null;

/**
 * Caught error type - what you get in a catch block
 * More specific than unknown for error handling
 */
export type CaughtError = Error | string | null | undefined;

/**
 * Request options extending standard fetch options
 */
export interface ApiRequestOptions extends RequestInit {
  /** Timeout in milliseconds (default: 30000) */
  timeoutMs?: number;
  /** Base URL for relative paths */
  baseUrl?: string;
}

/**
 * API Error class for structured error handling
 */
export class ApiError extends Error {
  constructor(
    message: string,
    public statusCode: number = 500,
    public details?: ApiErrorDetails,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Fetch with timeout support
 * Works on both client and server (Next.js API routes)
 */
export async function apiFetch(
  input: string,
  init: ApiRequestOptions = {},
): Promise<Response> {
  const { timeoutMs = 30000, baseUrl, signal, ...rest } = init;

  // Construct full URL if baseUrl is provided
  const url = baseUrl ? new URL(input, baseUrl).toString() : input;

  // Create abort controller for timeout
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new DOMException("Request timeout", "AbortError")),
    timeoutMs,
  );

  try {
    const response = await fetch(url, {
      ...rest,
      signal: signal ?? controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Fetch JSON with automatic parsing and error handling
 */
export async function fetchJson<T>(
  input: string,
  init: ApiRequestOptions = {},
): Promise<T> {
  const response = await apiFetch(input, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init.headers,
    },
  });

  if (!response.ok) {
    let errorMessage = `API request failed: ${response.status} ${response.statusText}`;

    try {
      const errorBody = await response.json();
      if (errorBody.error) {
        errorMessage = errorBody.error;
      }
    } catch {
      // Ignore JSON parse errors for error responses
    }

    throw new ApiError(errorMessage, response.status);
  }

  return response.json() as Promise<T>;
}

/**
 * POST JSON data
 */
export async function postJson<T>(
  url: string,
  data: JsonValue,
  options: ApiRequestOptions = {},
): Promise<T> {
  return fetchJson<T>(url, {
    ...options,
    method: "POST",
    body: JSON.stringify(data),
  });
}

/**
 * PUT JSON data
 */
export async function putJson<T>(
  url: string,
  data: JsonValue,
  options: ApiRequestOptions = {},
): Promise<T> {
  return fetchJson<T>(url, {
    ...options,
    method: "PUT",
    body: JSON.stringify(data),
  });
}

/**
 * DELETE request
 */
export async function deleteRequest<T = void>(
  url: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  const response = await apiFetch(url, {
    ...options,
    method: "DELETE",
  });

  if (!response.ok) {
    throw new ApiError(
      `Delete request failed: ${response.status}`,
      response.status,
    );
  }

  // Return undefined for void responses
  // Callers expecting data should use apiGet or apiPost instead
  const text = await response.text();
  if (!text) return undefined as T;

  return JSON.parse(text) as T;
}

/**
 * Retry a function with exponential backoff
 * Useful for retrying failed API calls
 */
export async function retryFetch<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries?: number;
    initialDelay?: number;
    maxDelay?: number;
    shouldRetry?: (error: Error) => boolean;
  } = {},
): Promise<T> {
  const {
    maxRetries = 3,
    initialDelay = 1000,
    maxDelay = 10000,
    shouldRetry = () => true,
  } = options;

  let lastError: Error = new Error("No attempts made");

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      // Don't retry on abort errors
      if (lastError.name === "AbortError") {
        throw lastError;
      }

      // Check if we should retry
      if (!shouldRetry(lastError)) {
        throw lastError;
      }

      // Calculate delay with exponential backoff
      if (attempt < maxRetries - 1) {
        const delay = Math.min(initialDelay * Math.pow(2, attempt), maxDelay);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}

/**
 * Create an API response (for Next.js API routes)
 */
export function apiResponse<T>(data: T, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

/**
 * Create an error API response (for Next.js API routes)
 */
export function apiErrorResponse(
  message: string,
  status = 500,
  details?: ApiErrorDetails,
): Response {
  return new Response(
    JSON.stringify({
      error: message,
      details,
    }),
    {
      status,
      headers: {
        "Content-Type": "application/json",
      },
    },
  );
}

/**
 * Extract error message from various error types
 */
export function getErrorMessage(error: CaughtError): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "An unknown error occurred";
}

/**
 * Check if an error is an abort error (timeout or manual abort)
 */
export function isAbortError(error: CaughtError | DOMException): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
