/**
 * HyperForge Constants
 * Shared constants used across services
 */

// =============================================================================
// HAND RIGGING
// =============================================================================

/**
 * Standard VRM hand bone names
 * Used for hand rigging and pose detection
 */
export const HAND_BONE_NAMES = {
  left: {
    wrist: "leftHand",
    thumb: ["leftThumbProximal", "leftThumbIntermediate", "leftThumbDistal"],
    index: ["leftIndexProximal", "leftIndexIntermediate", "leftIndexDistal"],
    middle: [
      "leftMiddleProximal",
      "leftMiddleIntermediate",
      "leftMiddleDistal",
    ],
    ring: ["leftRingProximal", "leftRingIntermediate", "leftRingDistal"],
    little: [
      "leftLittleProximal",
      "leftLittleIntermediate",
      "leftLittleDistal",
    ],
  },
  right: {
    wrist: "rightHand",
    thumb: ["rightThumbProximal", "rightThumbIntermediate", "rightThumbDistal"],
    index: ["rightIndexProximal", "rightIndexIntermediate", "rightIndexDistal"],
    middle: [
      "rightMiddleProximal",
      "rightMiddleIntermediate",
      "rightMiddleDistal",
    ],
    ring: ["rightRingProximal", "rightRingIntermediate", "rightRingDistal"],
    little: [
      "rightLittleProximal",
      "rightLittleIntermediate",
      "rightLittleDistal",
    ],
  },
} as const;

/**
 * MediaPipe hand landmark indices
 */
export const HAND_LANDMARK_INDICES = {
  wrist: 0,
  thumbCMC: 1,
  thumbMCP: 2,
  thumbIP: 3,
  thumbTip: 4,
  indexMCP: 5,
  indexPIP: 6,
  indexDIP: 7,
  indexTip: 8,
  middleMCP: 9,
  middlePIP: 10,
  middleDIP: 11,
  middleTip: 12,
  ringMCP: 13,
  ringPIP: 14,
  ringDIP: 15,
  ringTip: 16,
  littleMCP: 17,
  littlePIP: 18,
  littleDIP: 19,
  littleTip: 20,
} as const;

/**
 * Hand landmarks object with uppercase keys
 * Used for pose detection
 */
export const HAND_LANDMARKS = {
  WRIST: 0,
  THUMB_CMC: 1,
  THUMB_MCP: 2,
  THUMB_IP: 3,
  THUMB_TIP: 4,
  INDEX_MCP: 5,
  INDEX_PIP: 6,
  INDEX_DIP: 7,
  INDEX_TIP: 8,
  MIDDLE_MCP: 9,
  MIDDLE_PIP: 10,
  MIDDLE_DIP: 11,
  MIDDLE_TIP: 12,
  RING_MCP: 13,
  RING_PIP: 14,
  RING_DIP: 15,
  RING_TIP: 16,
  PINKY_MCP: 17,
  PINKY_PIP: 18,
  PINKY_DIP: 19,
  PINKY_TIP: 20,
} as const;

/**
 * Finger joint mappings for pose estimation
 */
export const FINGER_JOINTS = {
  thumb: [1, 2, 3, 4],
  index: [5, 6, 7, 8],
  middle: [9, 10, 11, 12],
  ring: [13, 14, 15, 16],
  little: [17, 18, 19, 20],
} as const;
