/**
 * Avatar Definitions
 *
 * Defines available VRM avatar models for character creation.
 * These models are loaded from the asset server at runtime.
 */

export interface AvatarOption {
  id: string;
  name: string;
  url: string; // asset:// URL for in-game use
  previewPath: string; // Path portion for character preview (prepend CDN URL)
  description?: string;
}

/**
 * Available avatar models
 *
 * - `url`: Uses asset:// protocol which is resolved by the ClientLoader for in-game rendering
 * - `previewPath`: Path portion used by CharacterPreview component (CDN URL is prepended at runtime)
 *
 * The actual files are served from the CDN (S3/CloudFront in production)
 */
export const AVATAR_OPTIONS: AvatarOption[] = [
  {
    id: "male-01",
    name: "Male Avatar 01",
    url: "asset://avatars/avatar-male-01.vrm",
    previewPath: "/avatars/avatar-male-01.vrm",
    description: "Standard male humanoid avatar",
  },
  {
    id: "male-02",
    name: "Male Avatar 02",
    url: "asset://avatars/avatar-male-02.vrm",
    previewPath: "/avatars/avatar-male-02.vrm",
    description: "Standard male humanoid avatar",
  },
  {
    id: "female-01",
    name: "Female Avatar 01",
    url: "asset://avatars/avatar-female-01.vrm",
    previewPath: "/avatars/avatar-female-01.vrm",
    description: "Standard female humanoid avatar",
  },
  {
    id: "female-02",
    name: "Female Avatar 02",
    url: "asset://avatars/avatar-female-02.vrm",
    previewPath: "/avatars/avatar-female-02.vrm",
    description: "Standard female humanoid avatar",
  },
];

/**
 * Get avatar by ID
 */
export function getAvatarById(id: string): AvatarOption | undefined {
  return AVATAR_OPTIONS.find((avatar) => avatar.id === id);
}

/**
 * Get avatar by URL (checks both url and previewPath)
 */
export function getAvatarByUrl(url: string): AvatarOption | undefined {
  return AVATAR_OPTIONS.find(
    (avatar) => avatar.url === url || url.endsWith(avatar.previewPath),
  );
}
