// API base URL - uses environment variable in production, empty for dev (proxy handles it)
export const API_BASE_URL = import.meta.env.VITE_API_URL || "";

// Helper to construct full API URL
const apiUrl = (path: string) => `${API_BASE_URL}${path}`;

// API endpoints
export const API_ENDPOINTS = {
  // Assets
  ASSETS: apiUrl("/api/assets"),
  ASSET_BY_ID: (id: string) => apiUrl(`/api/assets/${id}`),
  ASSET_MODEL: (id: string) => apiUrl(`/api/assets/${id}/model`),
  ASSET_FILE: (id: string, filename: string) =>
    apiUrl(`/api/assets/${id}/${filename}`),
  ASSET_SPRITES: (id: string) => apiUrl(`/api/assets/${id}/sprites`),

  // Generation
  GENERATION: apiUrl("/api/generation"),
  GENERATION_STATUS: apiUrl("/api/generation/status"),

  // Materials
  MATERIAL_PRESETS: apiUrl("/api/material-presets"),

  // Equipment
  EQUIPMENT_CONFIG: apiUrl("/api/equipment/config"),
} as const;

// Export the helper for use in components
export { apiUrl };

// API response status codes
export const API_STATUS = {
  SUCCESS: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  NOT_FOUND: 404,
  SERVER_ERROR: 500,
} as const;

// Pagination defaults
export const PAGINATION = {
  DEFAULT_PAGE_SIZE: 20,
  MAX_PAGE_SIZE: 100,
} as const;
