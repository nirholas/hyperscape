/**
 * Leaf Cluster Instancer
 *
 * GPU-instanced rendering of leaf card clusters using Three.js TSL.
 * Single draw call for all clusters in a tree = massive performance win.
 *
 * Features:
 * - InstancedMesh with per-cluster attributes
 * - TSL material with billboard rendering
 * - Wind animation support
 * - LOD fade integration
 * - Camera-facing billboard rotation
 *
 * Usage:
 * ```typescript
 * const instancer = new LeafClusterInstancer(scene, atlas);
 * instancer.addTree(treeId, position, rotation, scale, clusters);
 *
 * // In render loop:
 * instancer.update(camera, deltaTime);
 * ```
 */

import * as THREE from "three";
import type { ClusterAtlas } from "./LeafClusterBaker.js";
import type { LeafCluster } from "./LeafClusterGenerator.js";

// ============================================================================
// TYPES
// ============================================================================

/**
 * Per-tree cluster instance data.
 */
interface TreeClusterData {
  /** Tree ID */
  treeId: string;
  /** Instance indices in the global buffer */
  instanceIndices: number[];
  /** Current fade value (0-1) */
  fade: number;
}

/**
 * Options for cluster instancer.
 */
export interface ClusterInstancerOptions {
  /** Maximum total cluster instances */
  maxInstances?: number;
  /** Enable wind animation */
  enableWind?: boolean;
  /** Wind strength multiplier */
  windStrength?: number;
  /** Enable LOD fade */
  enableFade?: boolean;
  /** Billboard mode: 'spherical' (face camera fully) or 'cylindrical' (Y-axis only) */
  billboardMode?: "spherical" | "cylindrical";
}

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_OPTIONS: Required<ClusterInstancerOptions> = {
  maxInstances: 10000,
  enableWind: true,
  windStrength: 0.15,
  enableFade: true,
  billboardMode: "cylindrical",
};

// ============================================================================
// LEAF CLUSTER INSTANCER
// ============================================================================

/**
 * Manages GPU-instanced rendering of leaf card clusters.
 *
 * Architecture:
 * - Single InstancedMesh for ALL clusters across ALL trees
 * - Per-instance attributes: transform, atlas UV, fade, cluster ID
 * - TSL shader handles billboard rotation and wind
 * - Update loop rotates billboards to face camera
 */
export class LeafClusterInstancer {
  private scene: THREE.Scene;
  private atlas: ClusterAtlas;
  private options: Required<ClusterInstancerOptions>;

  // InstancedMesh components
  private geometry: THREE.BufferGeometry;
  private material: THREE.ShaderMaterial;
  private mesh: THREE.InstancedMesh;

  // Instance attributes
  private instanceMatrices: THREE.Matrix4[];
  private instanceUVs: Float32Array;
  private instanceFades: Float32Array;
  private instanceClusterIds: Float32Array;

  // Attribute buffers
  private uvAttr: THREE.InstancedBufferAttribute;
  private fadeAttr: THREE.InstancedBufferAttribute;
  private clusterIdAttr: THREE.InstancedBufferAttribute;

  // Tree tracking
  private trees: Map<string, TreeClusterData> = new Map();
  private freeIndices: number[] = [];
  private nextIndex = 0;
  private instanceCount = 0;
  private dirty = false;

  // Animation state
  private time = 0;
  private windDir = new THREE.Vector3(1, 0, 0);
  private windStrength = 1;

  // Temp objects for billboard calculations
  private _tempMatrix = new THREE.Matrix4();
  private _tempPosition = new THREE.Vector3();
  private _tempQuaternion = new THREE.Quaternion();
  private _tempScale = new THREE.Vector3();
  private _camPosition = new THREE.Vector3();
  private _lookDir = new THREE.Vector3();

  constructor(
    scene: THREE.Scene,
    atlas: ClusterAtlas,
    options: ClusterInstancerOptions = {},
  ) {
    this.scene = scene;
    this.atlas = atlas;
    this.options = { ...DEFAULT_OPTIONS, ...options };

    // Create billboard geometry (single quad)
    this.geometry = this.createBillboardGeometry();

    // Create instanced material
    this.material = this.createMaterial();

    // Initialize instance arrays
    const maxInst = this.options.maxInstances;
    this.instanceMatrices = new Array(maxInst)
      .fill(null)
      .map(() => new THREE.Matrix4());
    this.instanceUVs = new Float32Array(maxInst * 4); // x,y,w,h per instance
    this.instanceFades = new Float32Array(maxInst).fill(1);
    this.instanceClusterIds = new Float32Array(maxInst);

    // Create instanced mesh
    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, maxInst);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.name = "LeafClusterInstancer";
    this.mesh.layers.set(1);

    // Create attribute buffers
    this.uvAttr = new THREE.InstancedBufferAttribute(this.instanceUVs, 4);
    this.uvAttr.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute("instanceUV", this.uvAttr);

    this.fadeAttr = new THREE.InstancedBufferAttribute(this.instanceFades, 1);
    this.fadeAttr.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute("instanceFade", this.fadeAttr);

    this.clusterIdAttr = new THREE.InstancedBufferAttribute(
      this.instanceClusterIds,
      1,
    );
    this.clusterIdAttr.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute("instanceClusterId", this.clusterIdAttr);

    scene.add(this.mesh);
  }

  /**
   * Create billboard quad geometry.
   */
  private createBillboardGeometry(): THREE.BufferGeometry {
    const geo = new THREE.BufferGeometry();

    // Unit quad centered at bottom
    const positions = new Float32Array([
      -0.5,
      0,
      0, // bottom-left
      0.5,
      0,
      0, // bottom-right
      0.5,
      1,
      0, // top-right
      -0.5,
      1,
      0, // top-left
    ]);

    const normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]);

    const uvs = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);

    const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);

    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(new THREE.BufferAttribute(indices, 1));

    return geo;
  }

  /**
   * Create instanced billboard material.
   */
  private createMaterial(): THREE.ShaderMaterial {
    const atlas = this.atlas;
    const opts = this.options;

    return new THREE.ShaderMaterial({
      uniforms: {
        uColorAtlas: { value: atlas.colorAtlas },
        uNormalAtlas: { value: atlas.normalAtlas },
        uAlphaTest: { value: 0.5 },
        uTime: { value: 0 },
        uWindStrength: { value: opts.windStrength },
        uWindDirection: { value: new THREE.Vector3(1, 0, 0) },
      },
      vertexShader: /* glsl */ `
        attribute vec4 instanceUV;
        attribute float instanceFade;
        attribute float instanceClusterId;
        
        varying vec2 vUv;
        varying vec3 vNormal;
        varying vec3 vWorldPosition;
        varying float vFade;
        varying float vClusterId;
        
        uniform float uTime;
        uniform float uWindStrength;
        uniform vec3 uWindDirection;
        
        // Hash for variation
        float hash(float n) {
          return fract(sin(n) * 43758.5453123);
        }
        
        void main() {
          // Apply instance transform (includes billboard rotation)
          vec4 worldPosition = instanceMatrix * vec4(position, 1.0);
          vWorldPosition = worldPosition.xyz;
          
          // Wind animation
          ${
            opts.enableWind
              ? `
          float windPhase = hash(instanceClusterId) * 6.28;
          float heightFactor = position.y;
          float windAmount = uWindStrength * heightFactor * 0.3;
          
          float wave1 = sin(uTime * 2.0 + windPhase);
          float wave2 = sin(uTime * 1.3 + windPhase * 0.7);
          float combined = (wave1 * 0.7 + wave2 * 0.3) * windAmount;
          
          worldPosition.x += combined * uWindDirection.x;
          worldPosition.z += combined * uWindDirection.z;
          `
              : ""
          }
          
          // Map UV to atlas cell
          vUv = instanceUV.xy + uv * instanceUV.zw;
          vNormal = normalMatrix * normal;
          vFade = instanceFade;
          vClusterId = instanceClusterId;
          
          gl_Position = projectionMatrix * viewMatrix * worldPosition;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uColorAtlas;
        uniform sampler2D uNormalAtlas;
        uniform float uAlphaTest;
        
        varying vec2 vUv;
        varying vec3 vNormal;
        varying vec3 vWorldPosition;
        varying float vFade;
        varying float vClusterId;
        
        // Screen-space dithering for LOD fade
        float dither4x4(vec2 position) {
          int x = int(mod(position.x, 4.0));
          int y = int(mod(position.y, 4.0));
          int index = x + y * 4;
          
          // 4x4 Bayer matrix
          float matrix[16];
          matrix[0] = 0.0; matrix[1] = 8.0; matrix[2] = 2.0; matrix[3] = 10.0;
          matrix[4] = 12.0; matrix[5] = 4.0; matrix[6] = 14.0; matrix[7] = 6.0;
          matrix[8] = 3.0; matrix[9] = 11.0; matrix[10] = 1.0; matrix[11] = 9.0;
          matrix[12] = 15.0; matrix[13] = 7.0; matrix[14] = 13.0; matrix[15] = 5.0;
          
          return matrix[index] / 16.0;
        }
        
        void main() {
          vec4 texColor = texture2D(uColorAtlas, vUv);
          
          // Alpha test for cutout
          if (texColor.a < uAlphaTest) discard;
          
          // LOD fade with dithering
          ${
            opts.enableFade
              ? `
          float ditherValue = dither4x4(gl_FragCoord.xy);
          if (vFade < ditherValue) discard;
          `
              : ""
          }
          
          // Two-sided diffuse lighting
          vec3 normal = normalize(vNormal);
          vec3 lightDir = normalize(vec3(0.5, 1.0, 0.3));
          float NdotL = dot(normal, lightDir);
          float diff = abs(NdotL);
          
          float ambient = 0.35;
          float light = ambient + diff * 0.5;
          
          // Subsurface-like effect for backlit leaves
          float subsurface = NdotL < 0.0 ? -NdotL * 0.2 : 0.0;
          light += subsurface;
          
          vec3 finalColor = texColor.rgb * light;
          
          gl_FragColor = vec4(finalColor, texColor.a);
        }
      `,
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: true,
      alphaTest: 0.5,
    });
  }

  /**
   * Add a tree's clusters to the instancer.
   *
   * @param treeId - Unique tree identifier
   * @param position - Tree world position
   * @param rotation - Tree Y rotation (radians)
   * @param scale - Tree scale
   * @param clusters - Cluster data from generator
   */
  addTree(
    treeId: string,
    position: THREE.Vector3,
    rotation: number,
    scale: number,
    clusters: LeafCluster[],
  ): void {
    // Remove existing if present
    this.removeTree(treeId);

    if (clusters.length === 0) return;

    const treeData: TreeClusterData = {
      treeId,
      instanceIndices: [],
      fade: 1,
    };

    // Allocate instances for each cluster
    for (const cluster of clusters) {
      const idx = this.allocateInstance();
      if (idx < 0) {
        console.warn(
          `[LeafClusterInstancer] Max instances reached, skipping cluster`,
        );
        continue;
      }

      treeData.instanceIndices.push(idx);

      // Calculate world position for this cluster
      const clusterWorld = cluster.center
        .clone()
        .applyAxisAngle(new THREE.Vector3(0, 1, 0), rotation)
        .multiplyScalar(scale)
        .add(position);

      // Set initial transform (will be updated for billboard)
      this._tempMatrix.identity();
      this._tempMatrix.setPosition(clusterWorld);
      this._tempMatrix.scale(
        new THREE.Vector3(cluster.width * scale, cluster.height * scale, 1),
      );
      this.instanceMatrices[idx].copy(this._tempMatrix);
      this.mesh.setMatrixAt(idx, this._tempMatrix);

      // Set atlas UV
      const bakedCluster = this.atlas.clusters.find(
        (c) => c.clusterId === cluster.id,
      );
      if (bakedCluster?.atlasUV) {
        const uv = bakedCluster.atlasUV;
        this.instanceUVs[idx * 4] = uv.u;
        this.instanceUVs[idx * 4 + 1] = uv.v;
        this.instanceUVs[idx * 4 + 2] = uv.w;
        this.instanceUVs[idx * 4 + 3] = uv.h;
      }

      // Set cluster ID for wind variation
      this.instanceClusterIds[idx] = cluster.id;

      // Set fade
      this.instanceFades[idx] = 1;
    }

    this.trees.set(treeId, treeData);
    this.dirty = true;
  }

  /**
   * Remove a tree's clusters from the instancer.
   */
  removeTree(treeId: string): void {
    const treeData = this.trees.get(treeId);
    if (!treeData) return;

    // Free all instance slots
    for (const idx of treeData.instanceIndices) {
      this.freeInstance(idx);
    }

    this.trees.delete(treeId);
    this.dirty = true;
  }

  /**
   * Set fade value for a tree (for LOD transitions).
   */
  setTreeFade(treeId: string, fade: number): void {
    const treeData = this.trees.get(treeId);
    if (!treeData) return;

    treeData.fade = fade;
    for (const idx of treeData.instanceIndices) {
      this.instanceFades[idx] = fade;
    }

    this.fadeAttr.needsUpdate = true;
  }

  /**
   * Allocate a new instance slot.
   */
  private allocateInstance(): number {
    // Try to reuse a free slot
    if (this.freeIndices.length > 0) {
      return this.freeIndices.pop()!;
    }

    // Allocate new slot
    if (this.nextIndex >= this.options.maxInstances) {
      return -1;
    }

    const idx = this.nextIndex++;
    this.instanceCount = Math.max(this.instanceCount, idx + 1);
    return idx;
  }

  /**
   * Free an instance slot.
   */
  private freeInstance(idx: number): void {
    // Hide by scaling to zero
    const zeroMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
    this.mesh.setMatrixAt(idx, zeroMatrix);
    this.freeIndices.push(idx);
  }

  /**
   * Update billboards to face camera and handle wind.
   *
   * @param camera - Current camera
   * @param deltaTime - Time since last frame
   * @param windDir - Wind direction (optional)
   * @param windStrength - Wind strength multiplier (optional)
   */
  update(
    camera: THREE.Camera,
    deltaTime: number,
    windDir?: THREE.Vector3,
    windStrength?: number,
  ): void {
    this.time += deltaTime;

    // Update wind uniforms
    if (windDir) this.windDir.copy(windDir);
    if (windStrength !== undefined) this.windStrength = windStrength;

    this.material.uniforms.uTime.value = this.time;
    this.material.uniforms.uWindStrength.value =
      this.windStrength * this.options.windStrength;
    this.material.uniforms.uWindDirection.value.copy(this.windDir);

    // Get camera position
    camera.getWorldPosition(this._camPosition);

    // Update billboard rotations
    if (this.options.billboardMode === "cylindrical") {
      this.updateCylindricalBillboards();
    } else {
      this.updateSphericalBillboards();
    }

    // Flush dirty state
    if (this.dirty) {
      this.mesh.instanceMatrix.needsUpdate = true;
      this.uvAttr.needsUpdate = true;
      this.fadeAttr.needsUpdate = true;
      this.clusterIdAttr.needsUpdate = true;
      this.mesh.count = this.instanceCount;
      this.dirty = false;
    }
  }

  /**
   * Update billboards to rotate around Y-axis toward camera.
   */
  private updateCylindricalBillboards(): void {
    for (const treeData of this.trees.values()) {
      for (const idx of treeData.instanceIndices) {
        // Get current position
        this.mesh.getMatrixAt(idx, this._tempMatrix);
        this._tempMatrix.decompose(
          this._tempPosition,
          this._tempQuaternion,
          this._tempScale,
        );

        // Calculate look direction (Y-axis rotation only)
        this._lookDir.subVectors(this._camPosition, this._tempPosition);
        this._lookDir.y = 0;
        this._lookDir.normalize();

        // Create rotation to face camera
        const angle = Math.atan2(this._lookDir.x, this._lookDir.z);
        this._tempQuaternion.setFromAxisAngle(
          new THREE.Vector3(0, 1, 0),
          angle,
        );

        // Rebuild matrix
        this._tempMatrix.compose(
          this._tempPosition,
          this._tempQuaternion,
          this._tempScale,
        );
        this.mesh.setMatrixAt(idx, this._tempMatrix);
      }
    }

    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /**
   * Update billboards to fully face camera.
   */
  private updateSphericalBillboards(): void {
    for (const treeData of this.trees.values()) {
      for (const idx of treeData.instanceIndices) {
        // Get current position
        this.mesh.getMatrixAt(idx, this._tempMatrix);
        this._tempMatrix.decompose(
          this._tempPosition,
          this._tempQuaternion,
          this._tempScale,
        );

        // Look at camera
        this._tempMatrix.lookAt(
          this._tempPosition,
          this._camPosition,
          new THREE.Vector3(0, 1, 0),
        );
        this._tempQuaternion.setFromRotationMatrix(this._tempMatrix);

        // Rebuild matrix with scale
        this._tempMatrix.compose(
          this._tempPosition,
          this._tempQuaternion,
          this._tempScale,
        );
        this.mesh.setMatrixAt(idx, this._tempMatrix);
      }
    }

    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /**
   * Get statistics about the instancer.
   */
  getStats(): {
    treeCount: number;
    instanceCount: number;
    maxInstances: number;
    freeSlots: number;
    drawCalls: number;
  } {
    return {
      treeCount: this.trees.size,
      instanceCount: this.instanceCount - this.freeIndices.length,
      maxInstances: this.options.maxInstances,
      freeSlots: this.freeIndices.length,
      drawCalls: 1, // Always 1 draw call!
    };
  }

  /**
   * Dispose of all resources.
   */
  dispose(): void {
    this.scene.remove(this.mesh);
    this.geometry.dispose();
    this.material.dispose();
    this.mesh.dispose();
    this.trees.clear();
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export { LeafClusterInstancer as default };
