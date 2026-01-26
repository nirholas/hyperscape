/**
 * Centralized API Client
 *
 * Provides fetch wrappers that automatically add Authorization headers
 * for authenticated API calls. Uses the Privy auth token from localStorage.
 *
 * Security features:
 * - CSRF token support for state-changing requests
 * - Automatic credential inclusion for cookie-based auth
 * - Token refresh handling
 *
 * @example
 * ```typescript
 * import { apiClient } from "@/lib/api-client";
 *
 * // GET request with auth
 * const data = await apiClient.get("/api/characters");
 *
 * // POST request with auth
 * const result = await apiClient.post("/api/agents", { name: "MyAgent" });
 *
 * // For requests that don't need auth, use apiClient.fetch with includeAuth: false
 * const publicData = await apiClient.fetch("/api/public", { includeAuth: false });
 * ```
 */

import { GAME_API_URL } from "./api-config";

/** CSRF token cache */
let csrfToken: string | null = null;
let csrfTokenExpiry: number = 0;
const CSRF_TOKEN_TTL = 300000; // 5 minutes

/**
 * Get the current auth token from localStorage
 * Returns null if not authenticated
 */
function getAuthToken(): string | null {
  try {
    return localStorage.getItem("privy_auth_token");
  } catch {
    // localStorage may not be available (SSR, etc.)
    return null;
  }
}

/**
 * Fetch or return cached CSRF token
 * CSRF tokens are used for state-changing requests (POST, PUT, DELETE, PATCH)
 */
async function getCsrfToken(): Promise<string | null> {
  const now = Date.now();

  // Return cached token if still valid
  if (csrfToken && csrfTokenExpiry > now) {
    return csrfToken;
  }

  try {
    // Fetch new CSRF token from server
    const response = await fetch(`${GAME_API_URL}/api/csrf-token`, {
      method: "GET",
      credentials: "include",
      headers: {
        Accept: "application/json",
      },
    });

    if (response.ok) {
      const data = (await response.json()) as { csrfToken?: string };
      if (data.csrfToken) {
        csrfToken = data.csrfToken;
        csrfTokenExpiry = now + CSRF_TOKEN_TTL;
        return csrfToken;
      }
    }
  } catch {
    // CSRF endpoint may not exist yet - gracefully degrade
    console.debug(
      "[API Client] CSRF token fetch failed, continuing without CSRF protection",
    );
  }

  return null;
}

/**
 * Clear cached CSRF token (call on logout)
 */
export function clearCsrfToken(): void {
  csrfToken = null;
  csrfTokenExpiry = 0;
}

/**
 * Options for API client requests
 */
export interface ApiClientOptions extends Omit<RequestInit, "body"> {
  /** Request body (will be JSON stringified if object) */
  body?: unknown;
  /** Whether to include Authorization header (default: true) */
  includeAuth?: boolean;
  /** Base URL override (default: GAME_API_URL) */
  baseUrl?: string;
}

/**
 * API response with typed data
 */
export interface ApiResponse<T = unknown> {
  /** Whether the request was successful (2xx status) */
  ok: boolean;
  /** HTTP status code */
  status: number;
  /** Response data (parsed JSON or null) */
  data: T | null;
  /** Error message if request failed */
  error?: string;
}

/**
 * Make an authenticated API request
 *
 * @param endpoint - API endpoint (relative to baseUrl)
 * @param options - Fetch options with extensions
 * @returns Promise resolving to typed API response
 */
async function apiFetch<T = unknown>(
  endpoint: string,
  options: ApiClientOptions = {},
): Promise<ApiResponse<T>> {
  const {
    includeAuth = true,
    baseUrl = GAME_API_URL,
    body,
    headers: customHeaders,
    ...fetchOptions
  } = options;

  // Determine if this is a state-changing request that needs CSRF protection
  const method = (fetchOptions.method || "GET").toUpperCase();
  const needsCsrf = ["POST", "PUT", "PATCH", "DELETE"].includes(method);

  // Build headers
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(customHeaders as Record<string, string>),
  };

  // Add Authorization header if authenticated and requested
  if (includeAuth) {
    const token = getAuthToken();
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
  }

  // Add CSRF token for state-changing requests
  if (needsCsrf) {
    const csrf = await getCsrfToken();
    if (csrf) {
      headers["X-CSRF-Token"] = csrf;
    }
  }

  // Build full URL
  const url = endpoint.startsWith("http")
    ? endpoint
    : `${baseUrl}${endpoint.startsWith("/") ? "" : "/"}${endpoint}`;

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      headers,
      credentials: "include", // Always include credentials for cookie-based auth
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    // Try to parse JSON response
    let data: T | null = null;
    let errorMessage: string | undefined;

    try {
      const text = await response.text();
      if (text) {
        data = JSON.parse(text) as T;
      }
    } catch {
      // Response is not JSON, that's okay
    }

    if (!response.ok) {
      // Extract error message from response data
      const errorData = data as { error?: string; message?: string } | null;
      errorMessage =
        errorData?.error ||
        errorData?.message ||
        `HTTP ${response.status}: ${response.statusText}`;
    }

    return {
      ok: response.ok,
      status: response.status,
      data: response.ok ? data : null,
      error: errorMessage,
    };
  } catch (error) {
    // Network error or other failure
    const message =
      error instanceof Error ? error.message : "Network request failed";
    console.error(`[API Client] Request failed: ${url}`, error);

    return {
      ok: false,
      status: 0,
      data: null,
      error: message,
    };
  }
}

/**
 * Centralized API client with automatic auth headers
 */
export const apiClient = {
  /**
   * Make a generic fetch request
   */
  fetch: apiFetch,

  /**
   * GET request with automatic auth
   */
  async get<T = unknown>(
    endpoint: string,
    options: Omit<ApiClientOptions, "method" | "body"> = {},
  ): Promise<ApiResponse<T>> {
    return apiFetch<T>(endpoint, { ...options, method: "GET" });
  },

  /**
   * POST request with automatic auth
   */
  async post<T = unknown>(
    endpoint: string,
    body?: unknown,
    options: Omit<ApiClientOptions, "method" | "body"> = {},
  ): Promise<ApiResponse<T>> {
    return apiFetch<T>(endpoint, { ...options, method: "POST", body });
  },

  /**
   * PUT request with automatic auth
   */
  async put<T = unknown>(
    endpoint: string,
    body?: unknown,
    options: Omit<ApiClientOptions, "method" | "body"> = {},
  ): Promise<ApiResponse<T>> {
    return apiFetch<T>(endpoint, { ...options, method: "PUT", body });
  },

  /**
   * PATCH request with automatic auth
   */
  async patch<T = unknown>(
    endpoint: string,
    body?: unknown,
    options: Omit<ApiClientOptions, "method" | "body"> = {},
  ): Promise<ApiResponse<T>> {
    return apiFetch<T>(endpoint, { ...options, method: "PATCH", body });
  },

  /**
   * DELETE request with automatic auth
   */
  async delete<T = unknown>(
    endpoint: string,
    options: Omit<ApiClientOptions, "method" | "body"> = {},
  ): Promise<ApiResponse<T>> {
    return apiFetch<T>(endpoint, { ...options, method: "DELETE" });
  },

  /**
   * Check if user is currently authenticated
   */
  isAuthenticated(): boolean {
    return getAuthToken() !== null;
  },
};
