/**
 * Dimension Constants
 * Used for sprite generation, canvas sizes, and 3D rendering
 */

// Canvas sizes
export const DEFAULT_CANVAS_WIDTH = 512
export const DEFAULT_CANVAS_HEIGHT = 512
export const CANVAS_SIZE_LARGE = 1024
export const CANVAS_SIZE_SMALL = 512
export const THUMBNAIL_SIZE = 128

// Sprite dimensions
export const DEFAULT_SPRITE_SIZE = 64
export const DEFAULT_PADDING = 8

// Lighting
export const AMBIENT_LIGHT_INTENSITY = 0.5
export const DIRECTIONAL_LIGHT_INTENSITY = 0.8

// Camera settings
export const CAMERA_NEAR_CLIP = 0.1
export const CAMERA_FAR_CLIP = 1000
export const DEFAULT_CAMERA_DISTANCE = 5
export const DEFAULT_CAMERA_Y_POSITION = 1.5
export const ISOMETRIC_CAMERA_DISTANCE = 8
export const FRUSTUM_SIZE = 5

// Shadow settings
export const SHADOW_CAMERA_FAR = 50
export const SHADOW_CAMERA_BOUNDS = 10

// Angles
export const ISOMETRIC_ANGLE = Math.PI / 4 // 45 degrees

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
