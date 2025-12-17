import * as THREE from "three";

import { logger } from "@/lib/utils";
import type { GLTFDocument, GLTFNode } from "@/types";

const log = logger.child("BoneDiagnostics");

// GLTFExportResult is the callback type from the exporter
type GLTFExportResult = GLTFDocument;

/**
 * Diagnostic utilities for understanding bone scaling issues
 */
export class BoneDiagnostics {
  /**
   * Analyze a skeleton and provide detailed diagnostics
   */
  static analyzeSkeletonForExport(
    skeleton: THREE.Skeleton,
    name: string = "Skeleton",
  ): void {
    log.info(`=== BONE DIAGNOSTICS: ${name} ===`);

    // Calculate various metrics
    const bones = skeleton.bones;
    const rootBones = bones.filter(
      (b) => !b.parent || !(b.parent instanceof THREE.Bone),
    );

    log.debug(`Total bones: ${bones.length}`);
    log.debug(`Root bones: ${rootBones.length}`);

    // Analyze bone distances
    const distances: number[] = [];
    bones.forEach((bone) => {
      if (bone.children.length > 0) {
        bone.children.forEach((child) => {
          if (child instanceof THREE.Bone) {
            const dist = bone.position.distanceTo(child.position);
            distances.push(dist);
          }
        });
      }
    });

    if (distances.length > 0) {
      const avgDist = distances.reduce((a, b) => a + b, 0) / distances.length;
      const minDist = Math.min(...distances);
      const maxDist = Math.max(...distances);

      log.debug("Bone Distance Analysis:", {
        average: `${avgDist.toFixed(3)} units`,
        min: `${minDist.toFixed(3)} units`,
        max: `${maxDist.toFixed(3)} units`,
      });

      // Guess the units
      if (avgDist > 10) {
        log.debug("Likely units: CENTIMETERS (typical human bone ~10-50cm)");
      } else if (avgDist > 0.1 && avgDist < 1) {
        log.debug("Likely units: METERS (typical human bone ~0.1-0.5m)");
      } else {
        log.debug("Units unclear - might be custom scale");
      }
    }

    // Analyze world transforms
    log.debug("Root Bone World Transforms:");
    rootBones.forEach((bone) => {
      const worldPos = new THREE.Vector3();
      const worldScale = new THREE.Vector3();
      bone.getWorldPosition(worldPos);
      bone.getWorldScale(worldScale);

      log.debug(`${bone.name}:`, {
        worldPos: worldPos.toArray().map((v) => v.toFixed(3)),
        worldScale: worldScale.toArray().map((v) => v.toFixed(3)),
      });
    });

    // Check for scale issues
    const hasNonUniformScale = bones.some((bone) => {
      const s = bone.scale;
      return (
        Math.abs(s.x - 1) > 0.001 ||
        Math.abs(s.y - 1) > 0.001 ||
        Math.abs(s.z - 1) > 0.001
      );
    });

    if (hasNonUniformScale) {
      log.warn("Some bones have non-uniform scale!");
      bones.forEach((bone) => {
        const s = bone.scale;
        if (
          Math.abs(s.x - 1) > 0.001 ||
          Math.abs(s.y - 1) > 0.001 ||
          Math.abs(s.z - 1) > 0.001
        ) {
          log.warn(`${bone.name}: scale=${s.toArray()}`);
        }
      });
    }

    log.info("=== END DIAGNOSTICS ===");
  }

  /**
   * Create a test skeleton with known dimensions
   */
  static createTestSkeleton(
    scale: "meters" | "centimeters" = "meters",
  ): THREE.Skeleton {
    const scaleFactor = scale === "meters" ? 1 : 100;

    // Create a simple 3-bone chain
    const root = new THREE.Bone();
    root.name = "TestRoot";
    root.position.set(0, 0, 0);

    const middle = new THREE.Bone();
    middle.name = "TestMiddle";
    middle.position.set(0, 0.5 * scaleFactor, 0); // 50cm or 0.5m
    root.add(middle);

    const end = new THREE.Bone();
    end.name = "TestEnd";
    end.position.set(0, 0.3 * scaleFactor, 0); // 30cm or 0.3m
    middle.add(end);

    const bones = [root, middle, end];
    const skeleton = new THREE.Skeleton(bones);

    log.debug(`Created test skeleton in ${scale}:`, {
      rootToMiddle: `${middle.position.y} units`,
      middleToEnd: `${end.position.y} units`,
    });

    return skeleton;
  }

  /**
   * Compare two skeletons to understand scaling differences
   */
  static compareSkeletons(
    skeleton1: THREE.Skeleton,
    name1: string,
    skeleton2: THREE.Skeleton,
    name2: string,
  ): void {
    log.info(`=== SKELETON COMPARISON ===`);
    log.debug(`Comparing "${name1}" vs "${name2}"`);

    // Compare bone counts
    log.debug("Bone counts:", {
      [name1]: `${skeleton1.bones.length} bones`,
      [name2]: `${skeleton2.bones.length} bones`,
    });

    // Compare average bone distances
    const getAvgDistance = (skeleton: THREE.Skeleton): number => {
      const distances: number[] = [];
      skeleton.bones.forEach((bone) => {
        bone.children.forEach((child) => {
          if (child instanceof THREE.Bone) {
            distances.push(bone.position.distanceTo(child.position));
          }
        });
      });
      return distances.length > 0
        ? distances.reduce((a, b) => a + b, 0) / distances.length
        : 0;
    };

    const avg1 = getAvgDistance(skeleton1);
    const avg2 = getAvgDistance(skeleton2);

    log.debug("Average bone distances:", {
      [name1]: `${avg1.toFixed(3)} units`,
      [name2]: `${avg2.toFixed(3)} units`,
      ratio: (avg1 / avg2).toFixed(3),
    });

    log.info("=== END COMPARISON ===");
  }

  /**
   * Test how GLTFExporter handles different skeleton configurations
   */
  static async testGLTFExport(
    skeleton: THREE.Skeleton,
    geometry: THREE.BufferGeometry,
  ): Promise<void> {
    log.info("=== GLTF EXPORT TEST ===");

    const scene = new THREE.Scene();
    const material = new THREE.MeshBasicMaterial();

    // Create skinned mesh
    const mesh = new THREE.SkinnedMesh(geometry, material);
    mesh.bind(skeleton);

    // Add to scene
    const rootBones = skeleton.bones.filter((b) => !b.parent);
    rootBones.forEach((root) => scene.add(root));
    scene.add(mesh);

    // Export
    const { GLTFExporter } = await import(
      "three/examples/jsm/exporters/GLTFExporter.js"
    );
    const exporter = new GLTFExporter();

    try {
      const gltf = (await exporter.parseAsync(scene, {
        binary: false,
      })) as unknown as GLTFExportResult;

      log.debug("GLTF Structure:", {
        nodes: gltf.nodes?.length || 0,
        skins: gltf.skins?.length || 0,
      });

      if (gltf.nodes) {
        log.debug("Node transforms:");
        gltf.nodes.forEach((node: GLTFNode, i: number) => {
          if (node.translation || node.scale) {
            log.debug(`Node ${i} (${node.name || "unnamed"}):`, {
              translation: node.translation,
              scale: node.scale,
            });
          }
        });
      }
    } catch (error) {
      log.error("GLTF export test failed:", error);
    }

    log.info("=== END EXPORT TEST ===");
  }
}
