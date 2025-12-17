/**
 * VRM Detection Utility
 * Checks if a 3D model is in VRM format
 */

import * as THREE from "three";
import type { Object3D } from "three";
import type { GLTFExtensionData } from "@/types/service-types";

/**
 * Type for the GLTF parser's JSON structure
 */
interface GLTFParserJson {
  extensions?: {
    VRMC_vrm?: GLTFExtensionData;
    [key: string]: GLTFExtensionData | undefined;
  };
}

/**
 * Type for GLTF parser with json property
 */
interface GLTFParser {
  json?: GLTFParserJson;
}

/**
 * Check if a loaded GLTF/GLB model has VRM extensions
 * VRM models have the VRMC_vrm extension in their glTF JSON
 */
export function isVRMModel(gltf: {
  scene: Object3D;
  parser?: GLTFParser;
}): boolean {
  // Check if the parser has VRM extension data
  if (gltf.parser?.json?.extensions?.VRMC_vrm) {
    return true;
  }

  // Check userData for VRM metadata (set by VRMLoaderPlugin)
  if (gltf.scene.userData?.vrm || gltf.scene.userData?.VRM) {
    return true;
  }

  // Check for VRM bone naming conventions (VRM uses standard bone names)
  const vrmBoneNames = [
    "hips",
    "spine",
    "chest",
    "neck",
    "head",
    "leftUpperArm",
    "rightUpperArm",
    "leftLowerArm",
    "rightLowerArm",
    "leftHand",
    "rightHand",
  ];

  let vrmBoneCount = 0;
  gltf.scene.traverse((child) => {
    if (child instanceof THREE.Bone || child.type === "Bone") {
      const boneName = child.name.toLowerCase();
      if (
        vrmBoneNames.some((vrmName) => boneName.includes(vrmName.toLowerCase()))
      ) {
        vrmBoneCount++;
      }
    }
  });

  // If we find multiple VRM-standard bone names, it's likely a VRM model
  return vrmBoneCount >= 5;
}

/**
 * Check if a model URL points to a VRM file
 */
export function isVRMUrl(url: string): boolean {
  return url.toLowerCase().endsWith(".vrm");
}

/**
 * Validate that a model is VRM format for equipment/weapon fitting
 */
export function validateVRMForFitting(
  model: Object3D | { scene: Object3D; parser?: GLTFParser },
  modelUrl?: string,
): { isValid: boolean; error?: string } {
  // Check URL first (fastest check)
  if (modelUrl && isVRMUrl(modelUrl)) {
    return { isValid: true };
  }

  // Check loaded model
  const gltf = "scene" in model ? model : { scene: model, parser: undefined };
  if (isVRMModel(gltf)) {
    return { isValid: true };
  }

  return {
    isValid: false,
    error:
      "Model must be in VRM format for equipment/weapon fitting. VRM format is required for proper bone mapping and animation compatibility.",
  };
}
