export interface RequestOptions extends RequestInit {
  timeoutMs?: number;
}

// Get API base URL from environment variable, fallback to relative path for dev
export const API_BASE_URL = import.meta.env.VITE_API_URL || "";

/**
 * Prepend API base URL to paths starting with /api
 */
export function getFullUrl(input: string): string {
  if (API_BASE_URL && input.startsWith("/api")) {
    return `${API_BASE_URL}${input}`;
  }
  return input;
}

/**
 * Get the full URL for an asset's model
 */
export function getAssetModelUrl(assetId: string): string {
  return getFullUrl(`/api/assets/${assetId}/model`);
}

/**
 * Get the full URL for an asset's file
 */
export function getAssetFileUrl(assetId: string, filename: string): string {
  return getFullUrl(`/api/assets/${assetId}/${filename}`);
}

/**
 * Get the full URL for an asset's concept art
 */
export function getAssetConceptArtUrl(assetId: string): string {
  return getFullUrl(`/api/assets/${assetId}/concept-art.png`);
}

/**
 * Get the full URL for an asset's sprites
 */
export function getAssetSpritesUrl(assetId: string): string {
  return getFullUrl(`/api/assets/${assetId}/sprites`);
}

export async function apiFetch(
  input: string,
  init: RequestOptions = {},
): Promise<Response> {
  const { timeoutMs = 15000, signal, ...rest } = init;
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new DOMException("Timeout", "AbortError")),
    timeoutMs,
  );

  const url = getFullUrl(input);

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
