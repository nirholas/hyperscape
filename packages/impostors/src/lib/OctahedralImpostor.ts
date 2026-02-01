/**
 * Octahedral Impostor Library - Main Class
 *
 * High-level API for creating and managing octahedral impostors.
 */

import * as THREE from "three/webgpu";
import type {
  ImpostorBakeConfig,
  ImpostorBakeResult,
  ImpostorInstance,
  OctahedronTypeValue,
  DissolveConfig,
} from "./types";
import { OctahedronType } from "./types";
import {
  ImpostorBaker,
  DEFAULT_BAKE_CONFIG,
  type CompatibleRenderer,
} from "./ImpostorBaker";
import {
  createTSLImpostorMaterial,
  type TSLImpostorMaterial,
} from "./ImpostorMaterialTSL";
import {
  buildOctahedronMesh,
  lerpOctahedronGeometry,
  getViewDirection,
  directionToGridCell,
} from "./OctahedronGeometry";

// Reusable objects to avoid allocations (no more raycaster - using O(1) math!)
const _viewDirection = new THREE.Vector3();

/**
 * Lighting configuration for TSL impostor materials
 */
export interface ImpostorLightingConfig {
  ambientColor?: THREE.Vector3;
  ambientIntensity?: number;
  directionalLights?: Array<{
    direction: THREE.Vector3;
    color: THREE.Vector3;
    intensity: number;
  }>;
  pointLights?: Array<{
    position: THREE.Vector3;
    color: THREE.Vector3;
    intensity: number;
    distance: number;
    decay: number;
  }>;
  specular?: {
    f0?: number;
    shininess?: number;
    intensity?: number;
  };
}

/**
 * Simple lighting config (for backwards compatibility)
 */
export interface SimpleLightingConfig {
  lightDirection?: THREE.Vector3;
  lightColor?: THREE.Vector3;
  lightIntensity?: number;
  ambientColor?: THREE.Vector3;
  ambientIntensity?: number;
}

/**
 * Options for creating an impostor instance
 */
export interface CreateInstanceOptions {
  /** Whether to use TSL (WebGPU) material instead of GLSL (WebGL) */
  useTSL?: boolean;
  /** Dissolve configuration for distance-based fade */
  dissolve?: DissolveConfig;
  /**
   * Debug mode for TSL material:
   * - 0: Normal rendering (default)
   * - 1: Raw texture sample (no blending)
   * - 2: Show UV coordinates as color
   * - 3: Show face indices as color
   * - 4: Solid red (verify shader runs)
   * - 5: Sample texture at fixed center (0.5, 0.5) - tests texture binding
   * - 6: Sample texture with billboard UVs (no grid) - tests texture content
   */
  debugMode?: 0 | 1 | 2 | 3 | 4 | 5 | 6;
}

/**
 * OctahedralImpostor - Main class for creating and rendering octahedral impostors
 *
 * An octahedral impostor is a billboard-based LOD representation of a 3D model
 * that blends between multiple pre-rendered views based on the viewing angle.
 *
 * @example
 * ```typescript
 * // Create an impostor from a mesh
 * const impostor = new OctahedralImpostor(renderer);
 * const result = impostor.bake(myMesh, { atlasSize: 2048, gridSize: 16 });
 *
 * // Create runtime instance
 * const instance = impostor.createInstance(result);
 * scene.add(instance.mesh);
 *
 * // Update each frame
 * instance.update(camera);
 * ```
 */
export class OctahedralImpostor {
  private baker: ImpostorBaker;
  private octahedronMeshes: Map<
    string,
    ReturnType<typeof buildOctahedronMesh>
  > = new Map();

  constructor(renderer: CompatibleRenderer) {
    this.baker = new ImpostorBaker(renderer);
  }

  /**
   * Bake a mesh into an octahedral impostor atlas
   *
   * @param source - The source mesh or group
   * @param config - Baking configuration
   * @returns The bake result
   */
  async bake(
    source: THREE.Object3D,
    config: Partial<ImpostorBakeConfig> = {},
  ): Promise<ImpostorBakeResult> {
    return this.baker.bake(source, config);
  }

  /**
   * Bake with custom lighting
   */
  async bakeWithLighting(
    source: THREE.Object3D,
    config: Partial<ImpostorBakeConfig> = {},
    lighting: Parameters<ImpostorBaker["bakeWithLighting"]>[2] = {},
  ): Promise<ImpostorBakeResult> {
    return this.baker.bakeWithLighting(source, config, lighting);
  }

  /**
   * Bake both color and normal atlases for dynamic lighting.
   *
   * The normal atlas enables real-time lighting on the impostor,
   * allowing it to respond to changing light conditions.
   *
   * @param source - The source mesh or group
   * @param config - Baking configuration
   * @returns Bake result with both color and normal atlases
   */
  async bakeWithNormals(
    source: THREE.Object3D,
    config: Partial<ImpostorBakeConfig> = {},
  ): Promise<ImpostorBakeResult> {
    return this.baker.bakeWithNormals(source, config);
  }

  /**
   * Hybrid bake: uses standard bake() for colors, separate pass for normals.
   *
   * This is useful when bakeWithNormals() produces incorrect colors but you
   * still want normal-based dynamic lighting. The color atlas will have
   * scene lighting baked in (same as regular bake), and the normal atlas
   * provides surface detail for additional lighting effects.
   *
   * @param source - The source mesh or group
   * @param config - Baking configuration
   * @returns Bake result with both color and normal atlases
   */
  async bakeHybrid(
    source: THREE.Object3D,
    config: Partial<ImpostorBakeConfig> = {},
  ): Promise<ImpostorBakeResult> {
    return this.baker.bakeHybrid(source, config);
  }

  /**
   * AAA-quality full bake: albedo + normals + depth + optional PBR channels.
   *
   * This is the highest quality bake mode, producing all textures needed for:
   * - Dynamic multi-light rendering
   * - Depth-based frame blending (eliminates ghosting)
   * - Proper depth buffer integration
   * - PBR material properties (roughness, metallic, AO)
   * - Specular highlights
   *
   * @param source - The source mesh or group
   * @param config - Baking configuration (including pbrMode)
   * @returns Complete bake result with all atlas textures
   */
  async bakeFull(
    source: THREE.Object3D,
    config: Partial<ImpostorBakeConfig> = {},
  ): Promise<ImpostorBakeResult> {
    return this.baker.bakeFull(source, config);
  }

  /**
   * Create a flattened baking source for debugging/export.
   * This clones and flattens InstancedMesh into regular geometry.
   */
  createBakingSource(source: THREE.Object3D): THREE.Group {
    return this.baker.createBakingSource(source);
  }

  /**
   * Create a runtime impostor instance from a bake result
   *
   * gridSizeX/Y represents the number of cells/points per axis.
   * This matches the old code convention where GRID_SIZE=31 means 31 cells.
   *
   * @param bakeResult - The result from baking
   * @param scale - Scale factor to apply to the original object's dimensions (default: 1)
   * @param options - Optional configuration (dissolve, etc.)
   * @returns An impostor instance with mesh, update function, and updateLighting function
   */
  createInstance(
    bakeResult: ImpostorBakeResult,
    scale: number = 1,
    options?: CreateInstanceOptions,
  ): ImpostorInstance & {
    /** Update lighting uniforms (only works if baked with normals) */
    updateLighting?: (
      lighting: SimpleLightingConfig | ImpostorLightingConfig,
    ) => void;
    /** Update dissolve uniforms (only works if dissolve enabled) */
    updateDissolve?: (playerPos: THREE.Vector3) => void;
  } {
    const {
      atlasTexture,
      normalAtlasTexture,
      depthAtlasTexture,
      pbrAtlasTexture,
      gridSizeX,
      gridSizeY,
      octType,
      octMeshData,
      boundingBox,
      boundingSphere,
      depthNear,
      depthFar,
    } = bakeResult;

    // Determine AAA features based on available atlases
    const hasNormalAtlas = !!normalAtlasTexture;
    const hasDepthAtlas = !!depthAtlasTexture;
    const hasPbrAtlas = !!pbrAtlasTexture;
    const enableTSLAAA = hasNormalAtlas || hasDepthAtlas || hasPbrAtlas;

    // Create TSL material (WebGPU only - no GLSL fallback)
    const material = createTSLImpostorMaterial({
      atlasTexture,
      normalAtlasTexture,
      depthAtlasTexture,
      pbrAtlasTexture,
      gridSizeX,
      gridSizeY,
      enableAAA: enableTSLAAA,
      enableDepthBlending: hasDepthAtlas,
      enableSpecular: hasNormalAtlas,
      depthNear: depthNear ?? 0.001,
      depthFar: depthFar ?? 10,
      dissolve: options?.dissolve,
      debugMode: options?.debugMode ?? 0,
    });

    // Calculate dimensions to match atlas cell proportions
    // The atlas bakes using maxDimension as the reference, so we must match that
    let width: number;
    let height: number;

    if (boundingBox) {
      const boxSize = new THREE.Vector3();
      boundingBox.getSize(boxSize);
      // Atlas uses maxDimension for scaling, so plane must use same proportions
      // This creates a square plane that matches the atlas cell
      const maxDimension = Math.max(boxSize.x, boxSize.y, boxSize.z);
      width = maxDimension * scale;
      height = maxDimension * scale;
    } else if (boundingSphere) {
      // Fallback: use sphere diameter for both (square)
      const diameter = boundingSphere.radius * 2 * scale;
      width = diameter;
      height = diameter;
    } else {
      // No bounds info, use scale directly
      width = scale;
      height = scale;
    }

    // Create billboard mesh with actual object dimensions
    const geometry = new THREE.PlaneGeometry(width, height);
    const mesh = new THREE.Mesh(geometry, material);

    // Use octahedron mesh from bake result if available, otherwise create new one
    // Using the same mesh ensures perfect alignment between atlas cells and raycast indices
    let octMesh = octMeshData;
    if (!octMesh) {
      // Fallback: create new octahedron mesh (may have subtle differences from baking)
      const key = `${octType}-${gridSizeX}-${gridSizeY}`;
      octMesh = this.octahedronMeshes.get(key);
      if (!octMesh) {
        octMesh = buildOctahedronMesh(
          octType,
          gridSizeX,
          gridSizeY,
          [0, 0, 0],
          true,
        );
        lerpOctahedronGeometry(octMesh, 1.0); // Fully morphed to octahedron shape
        // Recompute bounds after morphing - critical for raycasting!
        // filledMesh is used for raycasting (has triangle indices)
        octMesh.filledMesh.geometry.computeBoundingSphere();
        octMesh.filledMesh.geometry.computeBoundingBox();
        octMesh.wireframeMesh.geometry.computeBoundingSphere();
        octMesh.wireframeMesh.geometry.computeBoundingBox();
        this.octahedronMeshes.set(key, octMesh);
      }
    }

    // Store grid info for O(1) direction-to-cell lookup (no raycasting!)
    const gridInfo = { gridSizeX, gridSizeY, octType };

    const instance: ImpostorInstance & {
      updateLighting?: (
        lighting: SimpleLightingConfig | ImpostorLightingConfig,
      ) => void;
      updateDissolve?: (playerPos: THREE.Vector3) => void;
    } = {
      mesh,
      material: material as unknown as THREE.ShaderMaterial, // Cast for interface compatibility

      update: (camera: THREE.Camera) => {
        // Billboard towards camera
        mesh.lookAt(camera.position);

        // Compute normalized view direction from impostor to camera
        // This determines which part of the octahedron (and thus atlas) to sample
        _viewDirection.subVectors(camera.position, mesh.position).normalize();

        // O(1) direction-to-cell lookup - NO RAYCASTING!
        // This uses analytical octahedral math instead of expensive raycast
        const { faceIndices, faceWeights } = directionToGridCell(
          _viewDirection,
          gridInfo.gridSizeX,
          gridInfo.gridSizeY,
          gridInfo.octType,
        );

        // Update TSL material view
        material.updateView(faceIndices, faceWeights);
      },

      dispose: () => {
        geometry.dispose();
        material.dispose();
      },
    };

    // Add lighting update function if normals are available
    if (normalAtlasTexture && material.updateLighting) {
      instance.updateLighting = (
        lighting: SimpleLightingConfig | ImpostorLightingConfig,
      ) => {
        // Check if this is simple lighting format (has lightDirection) or full format (has directionalLights)
        if ("directionalLights" in lighting || "pointLights" in lighting) {
          // Full format - pass directly
          material.updateLighting!(lighting as ImpostorLightingConfig);
        } else {
          // Simple format - convert to full format
          const simple = lighting as SimpleLightingConfig;
          const directionalLights = simple.lightDirection
            ? [
                {
                  direction: simple.lightDirection,
                  color: simple.lightColor ?? new THREE.Vector3(1, 1, 1),
                  intensity: simple.lightIntensity ?? 1.0,
                },
              ]
            : [];

          material.updateLighting!({
            ambientColor: simple.ambientColor,
            ambientIntensity: simple.ambientIntensity,
            directionalLights,
            pointLights: [],
          });
        }
      };
    }

    // Add dissolve update function if dissolve is enabled
    if (material.impostorUniforms?.playerPos) {
      instance.updateDissolve = (playerPos: THREE.Vector3) => {
        material.impostorUniforms.playerPos!.value.copy(playerPos);
      };
    }

    return instance;
  }

  /**
   * Create multiple instances for instanced rendering
   *
   * @param bakeResult - The bake result
   * @param count - Number of instances
   * @param size - Size of each impostor
   * @returns Instanced mesh and update function
   */
  createInstancedMesh(
    bakeResult: ImpostorBakeResult,
    count: number,
    size: number = 1,
  ): {
    mesh: THREE.InstancedMesh;
    material: TSLImpostorMaterial;
    setPosition: (index: number, position: THREE.Vector3) => void;
    update: (camera: THREE.Camera) => void;
    dispose: () => void;
  } {
    const { atlasTexture, normalAtlasTexture, gridSizeX, gridSizeY, octType } =
      bakeResult;

    // Create TSL material (WebGPU only - no GLSL fallback)
    const material = createTSLImpostorMaterial({
      atlasTexture,
      normalAtlasTexture,
      gridSizeX,
      gridSizeY,
      enableAAA: !!normalAtlasTexture,
      enableSpecular: !!normalAtlasTexture,
    });

    const geometry = new THREE.PlaneGeometry(size, size);
    const mesh = new THREE.InstancedMesh(geometry, material, count);

    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3(1, 1, 1);

    // Reusable vector for view direction
    const viewDir = new THREE.Vector3();

    return {
      mesh,
      material,

      setPosition: (index: number, pos: THREE.Vector3) => {
        position.copy(pos);
        matrix.compose(position, quaternion, scale);
        mesh.setMatrixAt(index, matrix);
        mesh.instanceMatrix.needsUpdate = true;
      },

      update: (camera: THREE.Camera) => {
        // For instanced meshes, all billboards use the SAME atlas view
        // This is a valid LOD optimization - at distance the parallax error is minimal

        // Calculate view direction from camera to forest center (origin)
        viewDir.set(0, 0, 0).sub(camera.position).normalize();

        // O(1) direction-to-cell lookup - NO RAYCASTING!
        const { faceIndices, faceWeights } = directionToGridCell(
          viewDir,
          gridSizeX,
          gridSizeY,
          octType,
        );

        // Update TSL material view
        material.updateView(faceIndices, faceWeights);

        // Billboard orientation: all instances face the camera
        const lookAtMatrix = new THREE.Matrix4();
        lookAtMatrix.lookAt(
          camera.position,
          new THREE.Vector3(0, 0, 0),
          new THREE.Vector3(0, 1, 0),
        );
        quaternion.setFromRotationMatrix(lookAtMatrix);

        // Update all instance matrices to face camera while preserving position and scale
        for (let i = 0; i < count; i++) {
          mesh.getMatrixAt(i, matrix);
          matrix.decompose(position, new THREE.Quaternion(), scale);
          matrix.compose(position, quaternion, scale);
          mesh.setMatrixAt(i, matrix);
        }
        mesh.instanceMatrix.needsUpdate = true;
      },

      dispose: () => {
        geometry.dispose();
        material.dispose();
        mesh.dispose();
      },
    };
  }

  /**
   * Export atlas as data URL (sync version, WebGL only)
   */
  exportAtlasAsDataURL(
    result: ImpostorBakeResult,
    format: "png" | "jpeg" = "png",
  ): string {
    return this.baker.exportAtlasAsDataURL(result, format);
  }

  /**
   * Export atlas as data URL (async version, works with both WebGL and WebGPU)
   */
  exportAtlasAsDataURLAsync(
    result: ImpostorBakeResult,
    format: "png" | "jpeg" = "png",
  ): Promise<string> {
    return this.baker.exportAtlasAsDataURLAsync(result, format);
  }

  /**
   * Export atlas as Blob
   */
  exportAtlasAsBlob(
    result: ImpostorBakeResult,
    format: "png" | "jpeg" = "png",
  ): Promise<Blob> {
    return this.baker.exportAtlasAsBlob(result, format);
  }

  /**
   * Get view direction for a UV coordinate
   */
  getViewDirection(
    u: number,
    v: number,
    octType: OctahedronTypeValue,
  ): THREE.Vector3 {
    return getViewDirection(u, v, octType);
  }

  /**
   * Dispose of all resources
   */
  dispose(): void {
    this.baker.dispose();
    this.octahedronMeshes.forEach((mesh) => {
      mesh.wireframeMesh.geometry.dispose();
      (mesh.wireframeMesh.material as THREE.Material).dispose();
      (mesh.filledMesh.material as THREE.Material).dispose();
    });
    this.octahedronMeshes.clear();
  }
}

// Re-export commonly used items
export { OctahedronType, DEFAULT_BAKE_CONFIG };
