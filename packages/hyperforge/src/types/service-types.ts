/**
 * Service Types for HyperForge
 * Types used by various services (hand rigging, processing, etc.)
 */

import type * as THREE from "three";

// =============================================================================
// VIEWER REF TYPES
// =============================================================================

/**
 * Hand capture views result from viewer
 */
export interface HandCaptureViews {
  leftHandCloseup?: string;
  rightHandCloseup?: string;
  frontView?: string;
  topView?: string;
}

/**
 * Hand rigging viewer ref interface
 * Used by HandRiggingService to capture hand views from 3D viewer
 */
export interface HandRiggingViewerRef {
  captureHandViews: () => Promise<HandCaptureViews>;
}

// =============================================================================
// TENSORFLOW HAND DETECTION TYPES
// =============================================================================

/**
 * TensorFlow.js keypoint from hand pose detection
 */
export interface TensorFlowKeypoint {
  x: number;
  y: number;
  z?: number;
  score?: number;
  name?: string;
}

/**
 * TensorFlow.js hand detection result
 */
export interface TensorFlowHand {
  keypoints: TensorFlowKeypoint[];
  keypoints3D?: TensorFlowKeypoint[];
  handedness: "Left" | "Right";
  score: number;
}

// =============================================================================
// HAND RIGGING TYPES
// =============================================================================

/**
 * Hand bone structure for rigging
 */
export interface HandBoneStructure {
  wrist: THREE.Bone;
  thumb: THREE.Bone[];
  index: THREE.Bone[];
  middle: THREE.Bone[];
  ring: THREE.Bone[];
  little: THREE.Bone[];
  /** Alternative representation using fingers object */
  fingers?: {
    thumb?: THREE.Bone[];
    index?: THREE.Bone[];
    middle?: THREE.Bone[];
    ring?: THREE.Bone[];
    pinky?: THREE.Bone[];
    little?: THREE.Bone[];
  };
}

/**
 * Hand rigging options
 */
export interface HandRiggingOptions {
  detectPose?: boolean;
  imageUrl?: string;
  handedness?: "left" | "right" | "both";
  preserveExistingBones?: boolean;
  debug?: boolean;
  debugMode?: boolean;
  smoothingIterations?: number;
  minConfidence?: number;
  captureResolution?: number;
  viewerRef?: { current?: HandRiggingViewerRef | null };
}

/**
 * Required hand rigging options (for internal use)
 */
export interface RequiredHandRiggingOptions {
  detectPose: boolean;
  imageUrl?: string;
  handedness: "left" | "right" | "both";
  preserveExistingBones: boolean;
  debug: boolean;
  debugMode: boolean;
  smoothingIterations: number;
  minConfidence: number;
  captureResolution: number;
  viewerRef?: { current?: HandRiggingViewerRef | null };
}

/**
 * Single hand result from rigging process
 */
export interface SingleHandResult {
  bones: HandBoneStructure;
  detectionConfidence: number;
  vertexCount: number;
}

/**
 * Bone statistics for hand rigging
 */
export interface BoneStats {
  /** Number of bones per finger */
  fingerBoneCounts?: Record<string, number>;
  /** Total bones created */
  totalBones?: number;
  /** Bones successfully weighted */
  weightedBones?: number;
  /** Average vertex count per bone */
  avgVerticesPerBone?: number;
}

/**
 * Hand rigging result metadata
 */
export interface HandRiggingMetadata {
  handCount?: number;
  processingTimeMs?: number;
  boneStats?: BoneStats;
  originalBoneCount?: number;
  addedBoneCount?: number;
  processingTime?: number;
}

/**
 * Hand rigging result
 */
export interface HandRiggingResult {
  success?: boolean;
  model?: THREE.Group;
  riggedModel?: ArrayBuffer;
  bones?: {
    left?: HandBoneStructure;
    right?: HandBoneStructure;
  };
  leftHand?: SingleHandResult;
  rightHand?: SingleHandResult;
  error?: string;
  warnings?: string[];
  metadata?: HandRiggingMetadata;
}

/**
 * 3D point for bone positions
 */
export interface Point3D {
  x: number;
  y: number;
  z: number;
}

/**
 * Detected hand pose from TensorFlow
 */
export interface DetectedHandPose {
  landmarks: Point3D[];
  handedness: "Left" | "Right";
  confidence: number;
  worldLandmarks?: Point3D[];
}

/**
 * Detected pose result from hand detection
 */
export interface DetectedPoseResult {
  hands: DetectedHandPose[];
  imageWidth: number;
  imageHeight: number;
}

/**
 * Vertex segmentation by finger
 */
export interface VertexSegmentationResult {
  thumb: number[];
  index: number[];
  middle: number[];
  ring: number[];
  pinky: number[];
  palm: number[];
}

/**
 * Bone positions by finger name
 */
export type BonePositionsMap = Record<string, Point3D[]>;

/**
 * Hand rigging result with debug info
 */
export interface HandRiggingResultWithDebug extends HandRiggingResult {
  debugInfo?: {
    detectedPose?: DetectedPoseResult;
    vertexSegmentation?: VertexSegmentationResult;
    bonePositions?: BonePositionsMap;
    processingTimeMs?: number;
  };
  debugCaptures?:
    | Array<{
        name: string;
        imageDataUrl: string;
      }>
    | Record<string, string>;
}

// =============================================================================
// GLTF TYPES
// =============================================================================

/**
 * GLTF mesh primitive
 */
export interface GLTFPrimitive {
  attributes: {
    POSITION: number;
    NORMAL?: number;
    TEXCOORD_0?: number;
    JOINTS_0?: number;
    WEIGHTS_0?: number;
  };
  indices?: number;
  material?: number;
  mode?: number;
}

/**
 * GLTF mesh
 */
export interface GLTFMesh {
  name?: string;
  primitives: GLTFPrimitive[];
}

/**
 * GLTF node
 */
export interface GLTFNode {
  name?: string;
  mesh?: number;
  skin?: number;
  children?: number[];
  translation?: number[];
  rotation?: number[];
  scale?: number[];
  matrix?: number[];
}

/**
 * GLTF skin
 */
export interface GLTFSkin {
  name?: string;
  joints: number[];
  inverseBindMatrices?: number;
  skeleton?: number;
}

/**
 * GLTF accessor
 */
export interface GLTFAccessor {
  bufferView?: number;
  byteOffset?: number;
  componentType: number;
  count: number;
  type: string;
  max?: number[];
  min?: number[];
}

/**
 * GLTF buffer view
 */
export interface GLTFBufferView {
  buffer: number;
  byteOffset?: number;
  byteLength: number;
  byteStride?: number;
  target?: number;
}

/**
 * GLTF texture info reference
 */
export interface GLTFTextureInfo {
  index: number;
  texCoord?: number;
}

/**
 * GLTF PBR metallic roughness material
 */
export interface GLTFPbrMetallicRoughness {
  baseColorFactor?: [number, number, number, number];
  baseColorTexture?: GLTFTextureInfo;
  metallicFactor?: number;
  roughnessFactor?: number;
  metallicRoughnessTexture?: GLTFTextureInfo;
}

/**
 * GLTF material
 */
export interface GLTFMaterial {
  name?: string;
  pbrMetallicRoughness?: GLTFPbrMetallicRoughness;
  normalTexture?: GLTFTextureInfo & { scale?: number };
  occlusionTexture?: GLTFTextureInfo & { strength?: number };
  emissiveTexture?: GLTFTextureInfo;
  emissiveFactor?: [number, number, number];
  alphaMode?: "OPAQUE" | "MASK" | "BLEND";
  alphaCutoff?: number;
  doubleSided?: boolean;
  extensions?: Record<string, GLTFExtensionData>;
}

/**
 * GLTF texture
 */
export interface GLTFTexture {
  sampler?: number;
  source?: number;
  name?: string;
  extensions?: Record<string, GLTFExtensionData>;
}

/**
 * GLTF image
 */
export interface GLTFImage {
  uri?: string;
  mimeType?: string;
  bufferView?: number;
  name?: string;
}

/**
 * GLTF sampler
 */
export interface GLTFSampler {
  magFilter?: number;
  minFilter?: number;
  wrapS?: number;
  wrapT?: number;
  name?: string;
}

/**
 * GLTF animation channel target
 */
export interface GLTFAnimationChannelTarget {
  node?: number;
  path: "translation" | "rotation" | "scale" | "weights";
}

/**
 * GLTF animation channel
 */
export interface GLTFAnimationChannel {
  sampler: number;
  target: GLTFAnimationChannelTarget;
}

/**
 * GLTF animation sampler
 */
export interface GLTFAnimationSampler {
  input: number;
  output: number;
  interpolation?: "LINEAR" | "STEP" | "CUBICSPLINE";
}

/**
 * GLTF animation
 */
export interface GLTFAnimation {
  name?: string;
  channels: GLTFAnimationChannel[];
  samplers: GLTFAnimationSampler[];
}

/**
 * GLTF extension data (generic for extension-specific data)
 */
export type GLTFExtensionData = Record<string, unknown>;

/**
 * Full GLTF document
 */
export interface GLTFDocument {
  asset: { version: string; generator?: string };
  scene?: number;
  scenes?: Array<{ nodes?: number[] }>;
  nodes?: GLTFNode[];
  meshes?: GLTFMesh[];
  skins?: GLTFSkin[];
  accessors?: GLTFAccessor[];
  bufferViews?: GLTFBufferView[];
  buffers?: Array<{ uri?: string; byteLength: number }>;
  materials?: GLTFMaterial[];
  textures?: GLTFTexture[];
  images?: GLTFImage[];
  samplers?: GLTFSampler[];
  animations?: GLTFAnimation[];
  extensionsUsed?: string[];
  extensions?: Record<string, GLTFExtensionData>;
}

// =============================================================================
// NORMALIZATION TYPES
// =============================================================================

/**
 * Axis conventions for model normalization
 */
export type AxisConvention = "Y_UP" | "Z_UP";

/**
 * Front-facing direction
 */
export type FrontDirection = "+X" | "-X" | "+Y" | "-Y" | "+Z" | "-Z";

/**
 * Normalization conventions
 */
export interface NormalizationConventions {
  upAxis: AxisConvention;
  frontDirection: FrontDirection;
  scale: number;
  centerAtOrigin: boolean;
}

/**
 * Normalization result
 */
export interface NormalizationResult {
  success: boolean;
  transformsApplied: string[];
  warnings?: string[];
}

/**
 * Default conventions for different engines/formats
 */
export const NORMALIZATION_CONVENTIONS: Record<
  string,
  NormalizationConventions
> = {
  gltf: {
    upAxis: "Y_UP",
    frontDirection: "+Z",
    scale: 1,
    centerAtOrigin: true,
  },
  vrm: {
    upAxis: "Y_UP",
    frontDirection: "-Z",
    scale: 1,
    centerAtOrigin: true,
  },
  threejs: {
    upAxis: "Y_UP",
    frontDirection: "-Z",
    scale: 1,
    centerAtOrigin: true,
  },
};

/**
 * Get normalization convention by name
 */
export function getConvention(name: string): NormalizationConventions {
  return NORMALIZATION_CONVENTIONS[name] || NORMALIZATION_CONVENTIONS.gltf;
}
