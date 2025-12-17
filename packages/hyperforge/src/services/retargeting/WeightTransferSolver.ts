/**
 * WeightTransferSolver - Production-quality weight transfer via bone correspondence
 *
 * This is the CORRECT approach used by Maya, Blender, Unreal, etc.
 * Instead of calculating new weights, we PRESERVE original weights by remapping bone indices.
 *
 * Why this is better:
 * - Preserves artist-authored/auto-rigged weights from source mesh
 * - Fast (no distance calculations needed)
 * - Robust (works even with imperfect bone placement)
 * - Production-proven technique
 */

import * as THREE from "three";

import { logger } from "@/lib/utils";

import {
  createBoneMapping,
  MESHY_TO_MIXAMO,
} from "@/services/vrm/BoneMappings";

const log = logger.child("WeightTransferSolver");

export interface BoneMapping {
  [sourceBoneName: string]: string; // maps to target bone name
}

export class WeightTransferSolver {
  private sourceGeometry: THREE.BufferGeometry;
  private sourceSkeleton: THREE.Skeleton;
  private targetSkeleton: THREE.Skeleton;
  private boneMapping: BoneMapping;

  constructor(
    sourceGeometry: THREE.BufferGeometry,
    sourceSkeleton: THREE.Skeleton,
    targetSkeleton: THREE.Skeleton,
    boneMapping?: BoneMapping,
  ) {
    this.sourceGeometry = sourceGeometry;
    this.sourceSkeleton = sourceSkeleton;
    this.targetSkeleton = targetSkeleton;

    // Use provided mapping, or try Meshy→Mixamo, or fall back to fuzzy matching
    if (boneMapping) {
      this.boneMapping = boneMapping;
      log.info("🎯 Using provided bone mapping");
    } else {
      // Try to use semantic mapping (Meshy → Mixamo)
      const sourceBoneNames = sourceSkeleton.bones.map((b) => b.name);
      const targetBoneNames = targetSkeleton.bones.map((b) => b.name);

      const semanticMapping = createBoneMapping(
        sourceBoneNames,
        targetBoneNames,
        MESHY_TO_MIXAMO,
      );

      if (semanticMapping.size > 0) {
        // Convert Map to Record
        this.boneMapping = Object.fromEntries(semanticMapping);
        log.info("🎯 Using semantic Meshy→Mixamo bone mapping");
      } else {
        log.warn("⚠️  Semantic mapping failed, falling back to fuzzy matching");
        this.boneMapping = this.generateBoneMapping();
      }
    }

    const mappingQuality =
      Object.keys(this.boneMapping).length / sourceSkeleton.bones.length;
    log.info(
      {
        sourceBones: sourceSkeleton.bones.length,
        targetBones: targetSkeleton.bones.length,
        mappedBones: Object.keys(this.boneMapping).length,
        quality: `${(mappingQuality * 100).toFixed(1)}%`,
      },
      "📊 WeightTransferSolver initialized",
    );

    if (mappingQuality < 0.5) {
      log.error(
        { quality: `${(mappingQuality * 100).toFixed(1)}%` },
        "❌ POOR BONE MAPPING! Weight transfer will produce bad results. Consider using distance-based weight calculation instead.",
      );
    }
  }

  /**
   * Check if bone mapping quality is good enough for weight transfer
   * Returns true if at least 50% of source bones are mapped
   */
  isMappingQualityGood(): boolean {
    const mappedCount = Object.keys(this.boneMapping).length;
    const totalCount = this.sourceSkeleton.bones.length;
    const quality = mappedCount / totalCount;
    return quality >= 0.5; // At least 50% mapped
  }

  /**
   * Align target skeleton to match source skeleton's bind pose
   * This prevents deformation - mesh stays in original shape!
   *
   * CRITICAL: This aligns rotations AND positions/scale to match source exactly
   * The target skeleton's user-applied scale is preserved at the ROOT level only
   */
  alignToSourceBindPose(): void {
    log.debug("🔄 Aligning target skeleton to source bind pose...");

    const sourceRoot = this.sourceSkeleton.bones[0];
    const targetRoot = this.targetSkeleton.bones[0];

    // Calculate scale ratio between target and source root
    sourceRoot.updateMatrixWorld(true);
    targetRoot.updateMatrixWorld(true);

    const sourceRootScale = new THREE.Vector3();
    const targetRootScale = new THREE.Vector3();
    sourceRoot.matrixWorld.decompose(
      new THREE.Vector3(),
      new THREE.Quaternion(),
      sourceRootScale,
    );
    targetRoot.matrixWorld.decompose(
      new THREE.Vector3(),
      new THREE.Quaternion(),
      targetRootScale,
    );

    const scaleRatio = targetRootScale.x / sourceRootScale.x; // Assume uniform scale

    log.debug(
      {
        sourceRootScale: sourceRootScale.toArray(),
        targetRootScale: targetRootScale.toArray(),
        scaleRatio: scaleRatio.toFixed(3),
      },
      "Root scale comparison",
    );

    let alignedCount = 0;

    // For each mapped bone, copy the source bone's local transforms
    // But scale positions by the scale ratio to maintain target skeleton's size
    for (const [sourceBoneName, targetBoneName] of Object.entries(
      this.boneMapping,
    )) {
      const sourceBone = this.sourceSkeleton.bones.find(
        (b) => b.name === sourceBoneName,
      );
      const targetBone = this.targetSkeleton.bones.find(
        (b) => b.name === targetBoneName,
      );

      if (sourceBone && targetBone) {
        // Copy local rotation (bind pose orientation)
        targetBone.quaternion.copy(sourceBone.quaternion);

        // Copy local position but scale it by the ratio
        targetBone.position
          .copy(sourceBone.position)
          .multiplyScalar(scaleRatio);

        // Keep target bone's scale
        // targetBone.scale stays as is

        targetBone.updateMatrix();
        alignedCount++;
      }
    }

    // Update all matrices
    this.targetSkeleton.bones.forEach((bone) => bone.updateMatrixWorld(true));

    log.info(
      { alignedCount, scaleRatio: scaleRatio.toFixed(3) },
      "✅ Aligned bones to source bind pose - mesh will maintain original shape",
    );
  }

  /**
   * Transfer weights from source mesh to target skeleton
   * This preserves the original weights - just remaps the bone indices
   */
  transferWeights(): { skinIndices: number[]; skinWeights: number[] } {
    const vertexCount = this.sourceGeometry.attributes.position.count;
    const skinIndices: number[] = [];
    const skinWeights: number[] = [];

    // Get source weights
    const sourceSkinIndices = this.sourceGeometry.attributes
      .skinIndex as THREE.BufferAttribute;
    const sourceSkinWeights = this.sourceGeometry.attributes
      .skinWeight as THREE.BufferAttribute;

    if (!sourceSkinIndices || !sourceSkinWeights) {
      log.error("❌ Source mesh has no skin weights! Cannot transfer.");
      throw new Error(
        "Source mesh must have skinIndex and skinWeight attributes",
      );
    }

    log.debug({ vertexCount }, "📊 Transferring weights for vertices...");

    let transferredCount = 0;
    let unmappedCount = 0;

    // For each vertex, remap its bone indices from source to target
    for (let i = 0; i < vertexCount; i++) {
      const newIndices: number[] = [];
      const newWeights: number[] = [];

      // Get original 4 bone influences for this vertex
      for (let j = 0; j < 4; j++) {
        const sourceBoneIndex = sourceSkinIndices.getX(i * 4 + j) || 0;
        const weight = sourceSkinWeights.getX(i * 4 + j) || 0;

        if (weight > 0.0001) {
          const sourceBone = this.sourceSkeleton.bones[sourceBoneIndex];
          const targetBoneIndex = this.findTargetBoneIndex(sourceBone.name);

          if (targetBoneIndex !== -1) {
            newIndices.push(targetBoneIndex);
            newWeights.push(weight);
            transferredCount++;
          } else {
            // Bone not mapped - we'll handle this in fallback
            unmappedCount++;
          }
        }
      }

      // Normalize weights to sum to 1.0
      const totalWeight = newWeights.reduce((sum, w) => sum + w, 0);
      if (totalWeight > 0) {
        for (let j = 0; j < newWeights.length; j++) {
          newWeights[j] /= totalWeight;
        }
      }

      // Pad to 4 influences
      while (newIndices.length < 4) {
        newIndices.push(0);
        newWeights.push(0);
      }

      // Truncate to 4 influences (keep strongest)
      if (newIndices.length > 4) {
        // Sort by weight descending
        const combined = newIndices.map((idx, i) => ({
          idx,
          weight: newWeights[i],
        }));
        combined.sort((a, b) => b.weight - a.weight);

        newIndices.length = 4;
        newWeights.length = 4;

        for (let j = 0; j < 4; j++) {
          newIndices[j] = combined[j].idx;
          newWeights[j] = combined[j].weight;
        }

        // Re-normalize
        const sum = newWeights.reduce((s, w) => s + w, 0);
        if (sum > 0) {
          for (let j = 0; j < 4; j++) {
            newWeights[j] /= sum;
          }
        }
      }

      // Add to arrays
      skinIndices.push(...newIndices);
      skinWeights.push(...newWeights);
    }

    log.info(
      {
        transferred: transferredCount,
        unmapped: unmappedCount,
        successRate: `${((transferredCount / (transferredCount + unmappedCount)) * 100).toFixed(1)}%`,
      },
      "✅ Weight transfer complete!",
    );

    return { skinIndices, skinWeights };
  }

  /**
   * Find target bone index by name using the bone mapping
   */
  private findTargetBoneIndex(sourceBoneName: string): number {
    const targetBoneName = this.boneMapping[sourceBoneName];
    if (!targetBoneName) {
      return -1;
    }

    return this.targetSkeleton.bones.findIndex(
      (bone) => bone.name === targetBoneName,
    );
  }

  /**
   * Auto-generate bone mapping using fuzzy name matching
   * This handles common naming conventions: Mixamo, Rigify, etc.
   */
  private generateBoneMapping(): BoneMapping {
    const mapping: BoneMapping = {};

    log.debug("🔍 Auto-generating bone mapping...");

    for (const sourceBone of this.sourceSkeleton.bones) {
      const targetBone = this.findBestMatch(
        sourceBone.name,
        this.targetSkeleton.bones,
      );
      if (targetBone) {
        mapping[sourceBone.name] = targetBone.name;
      }
    }

    log.debug(
      {
        mappedBones: Object.keys(mapping).length,
        sampleMappings: Object.entries(mapping).slice(0, 10),
      },
      "📋 Generated bone mapping",
    );

    // Log unmapped bones
    const unmappedSource = this.sourceSkeleton.bones.filter(
      (b) => !mapping[b.name],
    );
    if (unmappedSource.length > 0) {
      log.warn(
        {
          count: unmappedSource.length,
          examples: unmappedSource.slice(0, 5).map((b) => b.name),
        },
        "⚠️ Unmapped source bones",
      );
    }

    return mapping;
  }

  /**
   * Find best matching bone using fuzzy name matching
   * Handles naming convention differences (Mixamo, Rigify, etc.)
   */
  private findBestMatch(
    sourceName: string,
    targetBones: THREE.Bone[],
  ): THREE.Bone | null {
    const normalize = (name: string) =>
      name
        .toLowerCase()
        .replace(/[-_:.]/g, "")
        .replace(/\d+/g, "") // Remove numbers
        .replace(/def/g, "") // Remove DEF prefix
        .replace(/mixamorig/g, ""); // Remove mixamorig prefix

    const sourceNorm = normalize(sourceName);

    // Exact match after normalization
    for (const bone of targetBones) {
      if (normalize(bone.name) === sourceNorm) {
        return bone;
      }
    }

    // Partial match (source name contains target or vice versa)
    for (const bone of targetBones) {
      const targetNorm = normalize(bone.name);
      if (sourceNorm.includes(targetNorm) || targetNorm.includes(sourceNorm)) {
        return bone;
      }
    }

    // Semantic matching for common bones
    const semanticMap: { [key: string]: string[] } = {
      hips: ["pelvis", "hip", "root"],
      spine: ["spine", "back"],
      chest: ["chest", "spine"],
      neck: ["neck"],
      head: ["head"],
      shoulder: ["shoulder", "clavicle"],
      upperarm: ["arm", "shoulder"],
      lowerarm: ["forearm", "elbow"],
      hand: ["hand", "wrist"],
      thigh: ["thigh", "upleg"],
      calf: ["leg", "shin", "calf"],
      foot: ["foot", "ankle"],
      toe: ["toe"],
      thumb: ["thumb"],
      index: ["index"],
      middle: ["middle"],
      ring: ["ring"],
      pinky: ["pinky", "little"],
    };

    for (const [_semantic, patterns] of Object.entries(semanticMap)) {
      if (patterns.some((p) => sourceNorm.includes(p))) {
        for (const bone of targetBones) {
          const targetNorm = normalize(bone.name);
          if (patterns.some((p) => targetNorm.includes(p))) {
            // Also check for L/R matching
            const sourceHasL =
              sourceName.toLowerCase().includes("l") ||
              sourceName.toLowerCase().includes("left");
            const sourceHasR =
              sourceName.toLowerCase().includes("r") ||
              sourceName.toLowerCase().includes("right");
            const targetHasL =
              bone.name.toLowerCase().includes("l") ||
              bone.name.toLowerCase().includes("left");
            const targetHasR =
              bone.name.toLowerCase().includes("r") ||
              bone.name.toLowerCase().includes("right");

            if (
              (sourceHasL && targetHasL) ||
              (sourceHasR && targetHasR) ||
              (!sourceHasL && !sourceHasR && !targetHasL && !targetHasR)
            ) {
              return bone;
            }
          }
        }
      }
    }

    return null;
  }
}
