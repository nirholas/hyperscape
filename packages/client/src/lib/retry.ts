/**
 * Retry Utility with Exponential Backoff
 *
 * Provides a robust retry mechanism for async operations with configurable:
 * - Maximum retry attempts
 * - Exponential or linear backoff
 * - Custom delay configuration
 * - Abort controller support
 *
 * @packageDocumentation
 */

/* global AbortSignal */

/** Retry options configuration */
export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries?: number;
  /** Initial delay in milliseconds (default: 1000) */
  initialDelay?: number;
  /** Maximum delay in milliseconds (default: 30000) */
  maxDelay?: number;
  /** Backoff strategy (default: 'exponential') */
  backoff?: "exponential" | "linear" | "fixed";
  /** Backoff multiplier for exponential backoff (default: 2) */
  backoffMultiplier?: number;
  /** Linear increment in milliseconds for linear backoff (default: 1000) */
  linearIncrement?: number;
  /** Optional abort signal to cancel retries */
  signal?: AbortSignal;
  /** Optional callback for each retry attempt */
  onRetry?: (attempt: number, error: Error, nextDelay: number) => void;
  /** Optional predicate to determine if error is retryable (default: all errors) */
  isRetryable?: (error: Error) => boolean;
}

/** Result of a retry operation */
export interface RetryResult<T> {
  /** Whether the operation succeeded */
  success: boolean;
  /** The result value if successful */
  value?: T;
  /** The last error if failed */
  error?: Error;
  /** Number of attempts made */
  attempts: number;
}

/**
 * Execute an async function with retry logic
 *
 * @param fn - The async function to execute
 * @param options - Retry configuration options
 * @returns Promise that resolves to the function result or rejects after max retries
 *
 * @example
 * ```typescript
 * // Basic usage
 * const result = await withRetry(() => fetch('/api/data'));
 *
 * // With custom options
 * const result = await withRetry(
 *   () => fetch('/api/data'),
 *   {
 *     maxRetries: 5,
 *     backoff: 'exponential',
 *     onRetry: (attempt, error) => console.log(`Retry ${attempt}: ${error.message}`)
 *   }
 * );
 * ```
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const {
    maxRetries = 3,
    initialDelay = 1000,
    maxDelay = 30000,
    backoff = "exponential",
    backoffMultiplier = 2,
    linearIncrement = 1000,
    signal,
    onRetry,
    isRetryable = () => true,
  } = options;

  let lastError: Error | undefined;
  let attempt = 0;

  while (attempt <= maxRetries) {
    // Check if aborted
    if (signal?.aborted) {
      throw new Error("Retry aborted");
    }

    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Check if we should retry
      if (attempt >= maxRetries || !isRetryable(lastError)) {
        throw lastError;
      }

      // Calculate delay based on backoff strategy
      let delay: number;
      switch (backoff) {
        case "exponential":
          delay = Math.min(
            initialDelay * Math.pow(backoffMultiplier, attempt),
            maxDelay,
          );
          break;
        case "linear":
          delay = Math.min(initialDelay + linearIncrement * attempt, maxDelay);
          break;
        case "fixed":
        default:
          delay = initialDelay;
      }

      // Notify about retry
      onRetry?.(attempt + 1, lastError, delay);

      // Wait before next attempt
      await sleep(delay, signal);

      attempt++;
    }
  }

  throw lastError ?? new Error("Max retries exceeded");
}

/**
 * Execute an async function with retry logic, returning a result object
 *
 * Unlike `withRetry`, this function never throws and returns a result object
 * indicating success or failure.
 *
 * @param fn - The async function to execute
 * @param options - Retry configuration options
 * @returns Promise that resolves to a result object
 *
 * @example
 * ```typescript
 * const result = await tryWithRetry(() => fetch('/api/data'));
 * if (result.success) {
 *   console.log('Data:', result.value);
 * } else {
 *   console.error('Failed after', result.attempts, 'attempts:', result.error);
 * }
 * ```
 */
export async function tryWithRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<RetryResult<T>> {
  const startAttempts = 0;
  let attempts = startAttempts;

  const wrappedOnRetry = options.onRetry;
  const newOptions: RetryOptions = {
    ...options,
    onRetry: (attempt, error, delay) => {
      attempts = attempt;
      wrappedOnRetry?.(attempt, error, delay);
    },
  };

  try {
    const value = await withRetry(fn, newOptions);
    return {
      success: true,
      value,
      attempts: attempts + 1,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error : new Error(String(error)),
      attempts: attempts + 1,
    };
  }
}

/**
 * Sleep for a specified duration with abort support
 *
 * @param ms - Duration in milliseconds
 * @param signal - Optional abort signal
 * @returns Promise that resolves after the delay
 */
async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(resolve, ms);

    if (signal) {
      if (signal.aborted) {
        clearTimeout(timeoutId);
        reject(new Error("Sleep aborted"));
        return;
      }

      const abortHandler = () => {
        clearTimeout(timeoutId);
        reject(new Error("Sleep aborted"));
      };

      signal.addEventListener("abort", abortHandler, { once: true });
    }
  });
}

/**
 * Create a retryable version of an async function
 *
 * @param fn - The async function to make retryable
 * @param options - Default retry options
 * @returns A new function that wraps the original with retry logic
 *
 * @example
 * ```typescript
 * const fetchWithRetry = retryable(fetch, { maxRetries: 3 });
 * const response = await fetchWithRetry('/api/data');
 * ```
 */
export function retryable<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
  options: RetryOptions = {},
): (...args: TArgs) => Promise<TResult> {
  return (...args: TArgs) => withRetry(() => fn(...args), options);
}

/**
 * Retry utility for network requests with common error handling
 *
 * Automatically retries on network errors, 5xx server errors, and 429 rate limits.
 *
 * @param fn - The fetch function to execute
 * @param options - Retry configuration options
 * @returns Promise that resolves to the Response
 *
 * @example
 * ```typescript
 * const response = await retryFetch(() => fetch('/api/data'));
 * ```
 */
export async function retryFetch(
  fn: () => Promise<Response>,
  options: Omit<RetryOptions, "isRetryable"> = {},
): Promise<Response> {
  const isRetryable = (error: Error): boolean => {
    // Network errors are retryable
    if (error.name === "TypeError" && error.message.includes("fetch")) {
      return true;
    }
    // AbortError is not retryable
    if (error.name === "AbortError") {
      return false;
    }
    return true;
  };

  const response = await withRetry(
    async () => {
      const res = await fn();

      // Retry on 5xx server errors and 429 rate limit
      if (res.status >= 500 || res.status === 429) {
        const error = new Error(`HTTP ${res.status}: ${res.statusText}`);
        error.name = "HTTPError";
        throw error;
      }

      return res;
    },
    { ...options, isRetryable },
  );

  return response;
}
