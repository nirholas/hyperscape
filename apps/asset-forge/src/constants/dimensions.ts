/**
 * Dimension Constants
 * Size and dimension values used throughout the app
 */

// Canvas dimensions
export const CANVAS_WIDTH = 512
export const CANVAS_HEIGHT = 512

// Preview dimensions
export const PREVIEW_WIDTH = 256
export const PREVIEW_HEIGHT = 256

// Thumbnail dimensions
export const THUMBNAIL_WIDTH = 128
export const THUMBNAIL_HEIGHT = 128

// Sprite dimensions
export const SPRITE_SIZE = 64
export const SPRITE_SHEET_COLS = 8
export const SPRITE_SHEET_ROWS = 8

// Model dimensions
export const MODEL_GRID_SIZE = 10
export const MODEL_UNIT_SIZE = 1

// UI dimensions
export const SIDEBAR_WIDTH = 280
export const SIDEBAR_COLLAPSED_WIDTH = 64
export const HEADER_HEIGHT = 64
export const FOOTER_HEIGHT = 48

// Sprite Generation Constants (for SpriteGenerationService)
export const CANVAS_SIZE_LARGE = 1024
export const CANVAS_SIZE_SMALL = 512
export const DEFAULT_SPRITE_SIZE = 512
export const DEFAULT_PADDING = 16

// Lighting
export const AMBIENT_LIGHT_INTENSITY = 0.5
export const DIRECTIONAL_LIGHT_INTENSITY = 0.8

// Camera settings
export const CAMERA_NEAR_CLIP = 0.1
export const CAMERA_FAR_CLIP = 1000
export const SHADOW_CAMERA_FAR = 50
export const SHADOW_CAMERA_BOUNDS = 10
export const DEFAULT_CAMERA_DISTANCE = 5
export const DEFAULT_CAMERA_Y_POSITION = 2
export const ISOMETRIC_CAMERA_DISTANCE = 8
export const FRUSTUM_SIZE = 5
export const ISOMETRIC_ANGLE = Math.PI / 6 // 30 degrees

// Sprite direction angles (in radians)
export const SPRITE_ANGLES_8_DIR = [
  0,              // South
  Math.PI / 4,    // South-East
  Math.PI / 2,    // East
  3 * Math.PI / 4,// North-East
  Math.PI,        // North
  5 * Math.PI / 4,// North-West
  3 * Math.PI / 2,// West
  7 * Math.PI / 4 // South-West
]

export const SPRITE_ANGLES_4_DIR = [
  0,           // South
  Math.PI / 2, // East
  Math.PI,     // North
  3 * Math.PI / 2 // West
]
