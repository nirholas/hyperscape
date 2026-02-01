/**
 * Leaf Cluster Baker
 *
 * Bakes groups of leaves into billboard textures for efficient LOD rendering.
 * Each cluster becomes a single textured quad instead of many individual leaves.
 *
 * Features:
 * - Orthographic rendering of leaf clusters
 * - Alpha-cutout textures with color and depth
 * - Normal map generation for dynamic lighting
 * - Automatic atlas packing for multiple clusters
 *
 * Performance:
 * - Baking is done once per tree preset (cached)
 * - Runtime rendering uses simple textured billboards
 * - 50-100x reduction in draw complexity vs individual leaves
 */

import * as THREE from "three";
import type { LeafData, TreeParams } from "../types.js";
import type { LeafCluster, LeafClusterResult } from "./LeafClusterGenerator.js";
import {
  generateInstancedLeaves,
  createInstancedLeafMaterial,
  type ProceduralLeafShape,
} from "./LeafGeometry.js";

// ============================================================================
// TYPES
// ============================================================================

/**
 * Baked cluster texture data.
 */
export interface BakedCluster {
  /** Cluster ID */
  clusterId: number;
  /** Color/albedo texture */
  colorTexture: THREE.Texture;
  /** Normal map texture (optional) */
  normalTexture: THREE.Texture | null;
  /** Depth texture for parallax (optional) */
  depthTexture: THREE.Texture | null;
  /** Billboard width in world units */
  width: number;
  /** Billboard height in world units */
  height: number;
  /** Center position for placement */
  center: THREE.Vector3;
  /** Texture coordinates in atlas (if using atlas) */
  atlasUV?: { u: number; v: number; w: number; h: number };
}

/**
 * Complete baked cluster atlas.
 */
export interface ClusterAtlas {
  /** Atlas texture containing all cluster billboards */
  colorAtlas: THREE.Texture;
  /** Normal atlas (optional) */
  normalAtlas: THREE.Texture | null;
  /** Individual cluster data with atlas coordinates */
  clusters: BakedCluster[];
  /** Atlas dimensions */
  atlasWidth: number;
  atlasHeight: number;
  /** Grid layout info */
  gridCols: number;
  gridRows: number;
  /** Cell size */
  cellWidth: number;
  cellHeight: number;
}

/**
 * Options for cluster baking.
 */
export interface ClusterBakeOptions {
  /** Texture size per cluster (default: 64) */
  textureSize?: number;
  /** Enable normal map baking (default: true) */
  bakeNormals?: boolean;
  /** Enable depth map baking (default: false) */
  bakeDepth?: boolean;
  /** Background color (default: transparent black) */
  backgroundColor?: number;
  /** Background alpha (default: 0) */
  backgroundAlpha?: number;
  /** Leaf shape for procedural rendering */
  leafShape?: ProceduralLeafShape;
  /** Leaf color override */
  leafColor?: THREE.Color;
  /** Enable anti-aliasing (default: true) */
  antiAlias?: boolean;
  /** Pack into single atlas (default: true) */
  useAtlas?: boolean;
  /** Maximum atlas size (default: 2048) */
  maxAtlasSize?: number;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_OPTIONS: Required<ClusterBakeOptions> = {
  textureSize: 64,
  bakeNormals: true,
  bakeDepth: false,
  backgroundColor: 0x000000,
  backgroundAlpha: 0,
  leafShape: "elliptic",
  leafColor: new THREE.Color(0x3d7a3d),
  antiAlias: true,
  useAtlas: true,
  maxAtlasSize: 2048,
};

// ============================================================================
// CLUSTER BAKER
// ============================================================================

/**
 * Bakes leaf clusters to billboard textures.
 *
 * Usage:
 * ```typescript
 * const baker = new LeafClusterBaker(renderer);
 * const atlas = await baker.bakeClusterAtlas(clusterResult, params);
 *
 * // Use atlas for instanced rendering
 * const material = createClusterAtlasMaterial(atlas);
 * ```
 */
export class LeafClusterBaker {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.OrthographicCamera;
  private ambientLight: THREE.AmbientLight;
  private directionalLight: THREE.DirectionalLight;

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;

    // Create isolated baking scene
    this.scene = new THREE.Scene();
    this.scene.background = null;

    // Orthographic camera for flat billboard rendering
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);

    // Lighting for baking
    this.ambientLight = new THREE.AmbientLight(0xffffff, 2.0);
    this.directionalLight = new THREE.DirectionalLight(0xffffff, 1.5);
    this.directionalLight.position.set(0, 1, 1);

    this.scene.add(this.ambientLight);
    this.scene.add(this.directionalLight);
  }

  /**
   * Bake all clusters into a texture atlas.
   *
   * @param clusterResult - Result from LeafClusterGenerator
   * @param params - Tree parameters
   * @param options - Baking options
   * @returns Atlas with all baked clusters
   */
  async bakeClusterAtlas(
    clusterResult: LeafClusterResult,
    params: TreeParams,
    options: ClusterBakeOptions = {},
  ): Promise<ClusterAtlas> {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const { clusters, leaves } = clusterResult;

    if (clusters.length === 0) {
      return this.emptyAtlas(opts);
    }

    // Calculate atlas layout
    const cellSize = opts.textureSize;
    const clusterCount = clusters.length;
    const gridCols = Math.ceil(Math.sqrt(clusterCount));
    const gridRows = Math.ceil(clusterCount / gridCols);

    let atlasWidth = gridCols * cellSize;
    let atlasHeight = gridRows * cellSize;

    // Clamp to max atlas size
    if (atlasWidth > opts.maxAtlasSize || atlasHeight > opts.maxAtlasSize) {
      const scale = opts.maxAtlasSize / Math.max(atlasWidth, atlasHeight);
      atlasWidth = Math.floor(atlasWidth * scale);
      atlasHeight = Math.floor(atlasHeight * scale);
    }

    // Create render targets
    const colorTarget = new THREE.WebGLRenderTarget(atlasWidth, atlasHeight, {
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: false,
    });

    let normalTarget: THREE.WebGLRenderTarget | null = null;
    if (opts.bakeNormals) {
      normalTarget = new THREE.WebGLRenderTarget(atlasWidth, atlasHeight, {
        format: THREE.RGBAFormat,
        type: THREE.UnsignedByteType,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        generateMipmaps: false,
      });
    }

    // Save renderer state
    const originalTarget = this.renderer.getRenderTarget();
    const originalPixelRatio = this.renderer.getPixelRatio();
    this.renderer.setPixelRatio(1);

    // Clear atlas
    this.renderer.setRenderTarget(colorTarget);
    this.renderer.setClearColor(opts.backgroundColor, opts.backgroundAlpha);
    this.renderer.clear();

    if (normalTarget) {
      this.renderer.setRenderTarget(normalTarget);
      this.renderer.setClearColor(0x8080ff, 1); // Neutral normal
      this.renderer.clear();
    }

    // Bake each cluster
    const bakedClusters: BakedCluster[] = [];

    for (let i = 0; i < clusters.length; i++) {
      const cluster = clusters[i];

      // Calculate cell position in atlas
      const col = i % gridCols;
      const row = Math.floor(i / gridCols);
      const cellX = col * cellSize;
      const cellY = row * cellSize;

      // Extract leaves for this cluster
      const clusterLeaves = cluster.leafIndices.map((idx) => leaves[idx]);

      // Bake cluster to cell
      await this.bakeClusterToCell(
        cluster,
        clusterLeaves,
        params,
        opts,
        colorTarget,
        normalTarget,
        cellX,
        cellY,
        cellSize,
      );

      // Store baked cluster data
      bakedClusters.push({
        clusterId: cluster.id,
        colorTexture: colorTarget.texture,
        normalTexture: normalTarget?.texture ?? null,
        depthTexture: null,
        width: cluster.width,
        height: cluster.height,
        center: cluster.center.clone(),
        atlasUV: {
          u: cellX / atlasWidth,
          v: cellY / atlasHeight,
          w: cellSize / atlasWidth,
          h: cellSize / atlasHeight,
        },
      });
    }

    // Restore renderer state
    this.renderer.setRenderTarget(originalTarget);
    this.renderer.setPixelRatio(originalPixelRatio);

    return {
      colorAtlas: colorTarget.texture,
      normalAtlas: normalTarget?.texture ?? null,
      clusters: bakedClusters,
      atlasWidth,
      atlasHeight,
      gridCols,
      gridRows,
      cellWidth: cellSize,
      cellHeight: cellSize,
    };
  }

  /**
   * Bake a single cluster to a cell in the atlas.
   */
  private async bakeClusterToCell(
    cluster: LeafCluster,
    clusterLeaves: LeafData[],
    params: TreeParams,
    opts: Required<ClusterBakeOptions>,
    colorTarget: THREE.WebGLRenderTarget,
    normalTarget: THREE.WebGLRenderTarget | null,
    cellX: number,
    cellY: number,
    cellSize: number,
  ): Promise<void> {
    // Create leaf instances for this cluster
    const leafMesh = this.createClusterLeafMesh(
      cluster,
      clusterLeaves,
      params,
      opts,
    );

    if (!leafMesh) return;

    // Add to scene
    this.scene.add(leafMesh);

    // Position camera to view cluster from front
    this.setupCameraForCluster(cluster);

    // Render color pass
    this.renderer.setRenderTarget(colorTarget);
    this.renderer.setScissorTest(true);
    this.renderer.setScissor(cellX, cellY, cellSize, cellSize);
    this.renderer.setViewport(cellX, cellY, cellSize, cellSize);

    // Enable bake mode on material for unlit output
    if (leafMesh.material instanceof THREE.ShaderMaterial) {
      if (leafMesh.material.uniforms?.uBakeMode) {
        leafMesh.material.uniforms.uBakeMode.value = 1.0;
      }
    }

    this.renderer.render(this.scene, this.camera);

    // Render normal pass if enabled
    if (normalTarget) {
      // Swap to normal material
      const normalMaterial = new THREE.MeshNormalMaterial({
        side: THREE.DoubleSide,
      });
      const originalMaterial = leafMesh.material;
      leafMesh.material = normalMaterial;

      this.renderer.setRenderTarget(normalTarget);
      this.renderer.setScissorTest(true);
      this.renderer.setScissor(cellX, cellY, cellSize, cellSize);
      this.renderer.setViewport(cellX, cellY, cellSize, cellSize);
      this.renderer.render(this.scene, this.camera);

      // Restore material
      leafMesh.material = originalMaterial;
      normalMaterial.dispose();
    }

    // Cleanup
    this.renderer.setScissorTest(false);
    this.scene.remove(leafMesh);
    leafMesh.geometry.dispose();
    if (leafMesh.material instanceof THREE.Material) {
      leafMesh.material.dispose();
    }
  }

  /**
   * Create a mesh of leaves for a cluster.
   */
  private createClusterLeafMesh(
    cluster: LeafCluster,
    clusterLeaves: LeafData[],
    params: TreeParams,
    opts: Required<ClusterBakeOptions>,
  ): THREE.InstancedMesh | null {
    if (clusterLeaves.length === 0) return null;

    // Translate leaves to cluster-local coordinates
    const localLeaves: LeafData[] = clusterLeaves.map((leaf) => ({
      ...leaf,
      position: leaf.position.clone().sub(cluster.center),
    }));

    // Generate instanced leaf mesh
    const result = generateInstancedLeaves(localLeaves, params, params.gScale, {
      material: createInstancedLeafMaterial({
        color: opts.leafColor,
        leafShape: opts.leafShape,
        alphaTest: 0.5,
      }),
    });

    return result.mesh;
  }

  /**
   * Setup orthographic camera to view cluster.
   */
  private setupCameraForCluster(cluster: LeafCluster): void {
    // Calculate ortho frustum to fit cluster
    const halfWidth = cluster.width / 2;
    const halfHeight = cluster.height / 2;

    // Add padding
    const padding = 1.1;
    this.camera.left = -halfWidth * padding;
    this.camera.right = halfWidth * padding;
    this.camera.top = halfHeight * padding;
    this.camera.bottom = -halfHeight * padding;
    this.camera.near = 0.1;
    this.camera.far = cluster.width * 2 + 10;
    this.camera.updateProjectionMatrix();

    // Position camera in front of cluster, looking at center
    const viewDir = cluster.averageDirection.clone().normalize();
    if (viewDir.lengthSq() < 0.01) {
      viewDir.set(0, 0, 1);
    }

    // Camera looks from opposite of average direction
    const cameraPos = viewDir.clone().multiplyScalar(-cluster.width - 5);
    cameraPos.y += cluster.height / 2; // Offset to center

    this.camera.position.copy(cameraPos);
    this.camera.lookAt(0, cluster.height / 2, 0);
  }

  /**
   * Return empty atlas for trees with no clusters.
   */
  private emptyAtlas(_opts: Required<ClusterBakeOptions>): ClusterAtlas {
    // Create minimal 1x1 transparent texture (works in both browser and server)
    const data = new Uint8Array([0, 0, 0, 0]); // RGBA: transparent black
    const texture = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat);
    texture.needsUpdate = true;

    return {
      colorAtlas: texture,
      normalAtlas: null,
      clusters: [],
      atlasWidth: 1,
      atlasHeight: 1,
      gridCols: 1,
      gridRows: 1,
      cellWidth: 1,
      cellHeight: 1,
    };
  }

  /**
   * Dispose of baker resources.
   */
  dispose(): void {
    this.ambientLight.dispose();
    this.directionalLight.dispose();
  }
}

// ============================================================================
// CLUSTER ATLAS MATERIAL
// ============================================================================

/**
 * Create a material for rendering cluster atlas billboards.
 *
 * @param atlas - Baked cluster atlas
 * @param options - Material options
 * @returns Shader material for cluster rendering
 */
export function createClusterAtlasMaterial(
  atlas: ClusterAtlas,
  options: {
    alphaTest?: number;
    enableWind?: boolean;
    windStrength?: number;
  } = {},
): THREE.ShaderMaterial {
  const { alphaTest = 0.5, enableWind = false, windStrength = 0.1 } = options;

  return new THREE.ShaderMaterial({
    uniforms: {
      uColorAtlas: { value: atlas.colorAtlas },
      uNormalAtlas: { value: atlas.normalAtlas },
      uAlphaTest: { value: alphaTest },
      uTime: { value: 0 },
      uWindStrength: { value: windStrength },
      uGridCols: { value: atlas.gridCols },
      uGridRows: { value: atlas.gridRows },
    },
    vertexShader: /* glsl */ `
      attribute vec4 instanceUV; // x,y = atlas offset; z,w = cell size
      attribute float instanceClusterId;
      
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vWorldPosition;
      
      uniform float uTime;
      uniform float uWindStrength;
      
      void main() {
        // Apply instance transform
        vec4 worldPosition = instanceMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        
        // Billboard rotation handled by CPU (lookAt camera)
        
        // Wind sway (optional)
        ${
          enableWind
            ? `
        float windPhase = instanceClusterId * 0.1;
        float windAmount = uWindStrength * position.y * 0.5;
        worldPosition.x += sin(uTime * 2.0 + windPhase) * windAmount;
        worldPosition.z += cos(uTime * 1.5 + windPhase * 0.7) * windAmount * 0.5;
        `
            : ""
        }
        
        // Map UV to atlas cell
        vUv = instanceUV.xy + uv * instanceUV.zw;
        vNormal = normalMatrix * normal;
        
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
      
      void main() {
        vec4 texColor = texture2D(uColorAtlas, vUv);
        
        // Alpha test
        if (texColor.a < uAlphaTest) discard;
        
        // Simple diffuse lighting
        vec3 lightDir = normalize(vec3(0.5, 1.0, 0.3));
        float diff = max(dot(normalize(vNormal), lightDir), 0.0);
        float ambient = 0.4;
        float light = ambient + diff * 0.6;
        
        gl_FragColor = vec4(texColor.rgb * light, texColor.a);
      }
    `,
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: true,
    alphaTest,
  });
}

// ============================================================================
// EXPORTS
// ============================================================================

export { LeafClusterBaker as default };
