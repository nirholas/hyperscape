/**
 * Octahedral Impostor Library - Atlas Baker
 *
 * Handles baking of 3D meshes into octahedral impostor atlases.
 * Supports AAA-quality impostor rendering with:
 * - Per-pixel depth maps for parallax and depth-based blending
 * - PBR material channels (roughness, metallic, AO)
 * - Unlit albedo for proper dynamic lighting
 */

import * as THREE from "three/webgpu";
import { MeshBasicNodeMaterial, MeshStandardNodeMaterial } from "three/webgpu";
import type { ImpostorBakeConfig, ImpostorBakeResult } from "./types";
import { OctahedronType, PBRBakeMode } from "./types";
import {
  buildOctahedronMesh,
  lerpOctahedronGeometry,
} from "./OctahedronGeometry";

import * as THREE_WEBGPU from "three/webgpu";

// TSL functions from three/webgpu for baking materials
const {
  Fn,
  uv,
  positionView,
  uniform,
  texture,
  float,
  vec4,
  sub,
  div,
  mul,
  clamp,
} = THREE_WEBGPU.TSL;

// ============================================================================
// TSL BAKING MATERIALS (WebGPU-native)
// ============================================================================

/**
 * TSL depth material type with uniforms for camera planes
 */
type TSLDepthMaterial = MeshBasicNodeMaterial & {
  depthUniforms: {
    cameraNear: { value: number };
    cameraFar: { value: number };
  };
};

/**
 * Create a TSL depth material for baking linear depth to atlas.
 * WebGPU-compatible version of the GLSL depthMaterial.
 *
 * @param nearPlane - Camera near plane distance
 * @param farPlane - Camera far plane distance
 * @returns TSL material that outputs linear depth
 */
export function createTSLDepthMaterial(
  nearPlane: number,
  farPlane: number,
): TSLDepthMaterial {
  const material = new MeshBasicNodeMaterial();

  const uNear = uniform(nearPlane);
  const uFar = uniform(farPlane);

  // Color node outputs linear depth in all channels
  material.colorNode = Fn(() => {
    // Get view-space Z (positionView.z is negative for visible objects)
    const viewZ = mul(positionView.z, float(-1.0));

    // Linear depth normalized to 0-1 range (0 = near, 1 = far)
    const linearDepth = clamp(
      div(sub(viewZ, uNear), sub(uFar, uNear)),
      float(0.0),
      float(1.0),
    );

    // Output depth in RGB, alpha=1 for valid pixel
    return vec4(linearDepth, linearDepth, linearDepth, float(1.0));
  })();

  material.side = THREE.DoubleSide;

  const tslMaterial = material as TSLDepthMaterial;
  tslMaterial.depthUniforms = {
    cameraNear: uNear,
    cameraFar: uFar,
  };

  return tslMaterial;
}

/**
 * TSL PBR material type with uniforms
 */
type TSLPBRMaterial = MeshBasicNodeMaterial & {
  pbrUniforms: {
    roughness: { value: number };
    metalness: { value: number };
    aoMapIntensity: { value: number };
  };
};

/**
 * Create a TSL PBR channel material for baking roughness/metallic/AO to atlas.
 * WebGPU-compatible version of the GLSL pbrShader.
 *
 * @param roughnessVal - Base roughness value
 * @param metalnessVal - Base metalness value
 * @param aoIntensity - AO map intensity
 * @param roughnessMap - Optional roughness texture
 * @param metalnessMap - Optional metalness texture
 * @param aoMap - Optional ambient occlusion texture
 * @returns TSL material that outputs PBR channels to RGB
 */
export function createTSLPBRMaterial(
  roughnessVal: number,
  metalnessVal: number,
  aoIntensity: number,
  roughnessMap: THREE.Texture | null = null,
  metalnessMap: THREE.Texture | null = null,
  aoMap: THREE.Texture | null = null,
): TSLPBRMaterial {
  const material = new MeshBasicNodeMaterial();

  const uRoughness = uniform(roughnessVal);
  const uMetalness = uniform(metalnessVal);
  const uAOIntensity = uniform(aoIntensity);

  // Color node outputs PBR channels: R=roughness, G=metallic, B=AO
  material.colorNode = Fn(() => {
    const uvCoord = uv();

    // Sample or use uniform for roughness (R channel)
    let r;
    if (roughnessMap) {
      const roughTex = texture(roughnessMap, uvCoord);
      r = mul(roughTex.g, uRoughness);
    } else {
      r = uRoughness;
    }

    // Sample or use uniform for metalness (G channel)
    let g;
    if (metalnessMap) {
      const metalTex = texture(metalnessMap, uvCoord);
      g = mul(metalTex.b, uMetalness);
    } else {
      g = uMetalness;
    }

    // Sample or use default for AO (B channel)
    let b;
    if (aoMap) {
      const aoTex = texture(aoMap, uvCoord);
      b = mul(aoTex.r, uAOIntensity);
    } else {
      b = float(1.0);
    }

    return vec4(r, g, b, float(1.0));
  })();

  material.side = THREE.FrontSide;

  const tslMaterial = material as TSLPBRMaterial;
  tslMaterial.pbrUniforms = {
    roughness: uRoughness,
    metalness: uMetalness,
    aoMapIntensity: uAOIntensity,
  };

  return tslMaterial;
}

/**
 * Renderer interface that works with WebGPURenderer (primary) and WebGLRenderer (fallback).
 * Uses loose typing to accommodate signature differences between renderers.
 *
 * Core methods (required for baking):
 * - setRenderTarget: Renders to off-screen texture
 * - setViewport/setScissor: Controls render region
 * - render: Renders scene to current target
 *
 * Note: WebGPU is the primary target. Debug pixel reading is not supported in WebGPU.
 */
export interface CompatibleRenderer {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getRenderTarget(): any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setRenderTarget(
    target: any,
    activeCubeFace?: number,
    activeMipmapLevel?: number,
  ): void;
  getViewport(target: THREE.Vector4): THREE.Vector4;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setViewport(...args: any[]): void;
  setScissorTest(enable: boolean): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setScissor(...args: any[]): void;
  setClearColor(color: THREE.ColorRepresentation, alpha?: number): void;
  clear(color?: boolean, depth?: boolean, stencil?: boolean): void;
  render(scene: THREE.Object3D, camera: THREE.Camera): void;
  // Async render for WebGPU - required for render targets to work properly
  renderAsync?(scene: THREE.Object3D, camera: THREE.Camera): Promise<void>;
  // Pixel ratio methods - critical for correct atlas rendering
  getPixelRatio(): number;
  setPixelRatio(value: number): void;
  // Tone mapping - available on both WebGL and WebGPU renderers
  toneMapping?: THREE.ToneMapping;
  toneMappingExposure?: number;
  // Color space - WebGPU returns string, WebGL returns ColorSpace
  outputColorSpace?: THREE.ColorSpace | string;
  // AutoClear control
  autoClear?: boolean;
  // Optional - for atlas export (sync version, WebGL only)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readRenderTargetPixels?(...args: unknown[]): void;
  // Optional - for atlas export (async version, works on both WebGL and WebGPU)
  // Signature differs between renderers, so use loose typing
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readRenderTargetPixelsAsync?(...args: unknown[]): Promise<unknown>;
}

/**
 * Default baking configuration
 *
 * gridSizeX/Y = 31 is the old default (GRID_SIZE = 31)
 * This creates 31x31 = 961 points and atlas cells
 */
export const DEFAULT_BAKE_CONFIG: ImpostorBakeConfig = {
  atlasWidth: 2048,
  atlasHeight: 2048,
  gridSizeX: 31,
  gridSizeY: 31,
  octType: OctahedronType.HEMI,
  backgroundColor: 0x000000,
  backgroundAlpha: 0,
  pbrMode: PBRBakeMode.STANDARD,
  depthNear: 0.001,
  depthFar: 10,
};

/**
 * ImpostorBaker - Bakes 3D meshes into octahedral impostor atlases
 *
 * The baker renders the source mesh from multiple view angles and
 * composites them into a single atlas texture using octahedral mapping.
 *
 * WebGPU only.
 */
export class ImpostorBaker {
  private renderer: CompatibleRenderer;
  private renderScene: THREE.Scene;
  private renderCamera: THREE.OrthographicCamera;
  private ambientLight: THREE.AmbientLight;
  private directionalLight: THREE.DirectionalLight;

  constructor(renderer: CompatibleRenderer) {
    this.renderer = renderer;

    // Create isolated render scene
    this.renderScene = new THREE.Scene();

    // Create orthographic camera for atlas rendering
    const orthoSize = 0.5;
    this.renderCamera = new THREE.OrthographicCamera(
      -orthoSize,
      orthoSize,
      orthoSize,
      -orthoSize,
      0.001,
      10,
    );

    // Setup lighting
    this.ambientLight = new THREE.AmbientLight(0xffffff, 2.6);
    this.directionalLight = new THREE.DirectionalLight(0xffffff, 3.8);
    this.directionalLight.position.set(5, 10, 7.5);

    this.renderScene.add(this.ambientLight);
    this.renderScene.add(this.directionalLight);
  }

  /**
   * Render helper - uses renderAsync for WebGPU render targets
   */
  private async doRender(
    scene: THREE.Object3D,
    camera: THREE.Camera,
  ): Promise<void> {
    if (this.renderer.renderAsync) {
      await this.renderer.renderAsync(scene, camera);
    } else {
      this.renderer.render(scene, camera);
    }
  }

  private configureAtlasRenderTarget(
    target: THREE.RenderTarget,
    colorSpace: THREE.ColorSpace | string,
  ): void {
    target.texture.colorSpace = colorSpace as THREE.ColorSpace;
    target.texture.minFilter = THREE.LinearFilter;
    target.texture.magFilter = THREE.LinearFilter;
    target.texture.wrapS = THREE.ClampToEdgeWrapping;
    target.texture.wrapT = THREE.ClampToEdgeWrapping;
    target.texture.generateMipmaps = false;
    target.texture.flipY = false;
  }

  /**
   * Compute bounding box for a mesh or group without modifying it.
   * Handles both regular meshes and InstancedMesh.
   */
  private computeBoundingBox(source: THREE.Object3D): THREE.Box3 {
    const box = new THREE.Box3();
    const tempBox = new THREE.Box3();
    const tempMatrix = new THREE.Matrix4();
    const combinedMatrix = new THREE.Matrix4();
    const tempPos = new THREE.Vector3();
    const tempScale = new THREE.Vector3();
    const tempQuat = new THREE.Quaternion();
    const rotQuat = new THREE.Quaternion();
    const rotMatrix = new THREE.Matrix4();
    const scaleMatrix = new THREE.Matrix4();
    const translateMatrix = new THREE.Matrix4();

    // Ensure world matrices are up to date
    source.updateWorldMatrix(true, true);

    source.traverse((node) => {
      if (node instanceof THREE.InstancedMesh) {
        // For InstancedMesh, compute bounds from all instances
        // Must apply both instance matrix AND node's world matrix
        const geometry = node.geometry;
        geometry.computeBoundingBox();
        const baseBox = geometry.boundingBox!;
        const orientationAttr = geometry.attributes.instanceOrientation as
          | THREE.BufferAttribute
          | undefined;

        for (let i = 0; i < node.count; i++) {
          node.getMatrixAt(i, tempMatrix);
          tempMatrix.decompose(tempPos, tempQuat, tempScale);

          if (orientationAttr) {
            rotQuat.set(
              orientationAttr.getX(i),
              orientationAttr.getY(i),
              orientationAttr.getZ(i),
              orientationAttr.getW(i),
            );
          } else {
            rotQuat.copy(tempQuat);
          }

          rotMatrix.makeRotationFromQuaternion(rotQuat);
          scaleMatrix.makeScale(tempScale.x, tempScale.y, tempScale.z);
          translateMatrix.makeTranslation(tempPos.x, tempPos.y, tempPos.z);

          combinedMatrix
            .copy(node.matrixWorld)
            .multiply(translateMatrix)
            .multiply(scaleMatrix)
            .multiply(rotMatrix);
          tempBox.copy(baseBox).applyMatrix4(combinedMatrix);
          box.union(tempBox);
        }
      } else if (node instanceof THREE.Mesh && node.geometry) {
        node.geometry.computeBoundingBox();
        if (node.geometry.boundingBox) {
          tempBox.copy(node.geometry.boundingBox);
          // Apply node's world transform
          tempBox.applyMatrix4(node.matrixWorld);
          box.union(tempBox);
        }
      }
    });

    return box;
  }

  /**
   * Extract color from a material (handles single materials)
   */
  private extractColorFromMaterial(
    mat: THREE.Material,
    defaultColor: THREE.Color,
  ): THREE.Color {
    console.log(
      "[extractColorFromMaterial] Material type:",
      mat.type,
      mat.constructor.name,
    );

    // Check for TSL leaf materials with leafUniforms first
    const matWithLeafUniforms = mat as MeshBasicNodeMaterial & {
      leafUniforms?: { color?: { value?: THREE.Color } };
    };
    if (matWithLeafUniforms.leafUniforms?.color?.value) {
      console.log(
        "[extractColorFromMaterial] Extracted TSL leaf color:",
        matWithLeafUniforms.leafUniforms.color.value.getHexString(),
      );
      return matWithLeafUniforms.leafUniforms.color.value.clone();
    }

    // WebGPU node materials
    if (
      mat instanceof MeshBasicNodeMaterial ||
      mat instanceof MeshStandardNodeMaterial
    ) {
      console.log(
        "[extractColorFromMaterial] Extracted color:",
        mat.color.getHexString(),
      );
      return mat.color.clone();
    }
    // WebGL materials
    if (
      mat instanceof THREE.MeshStandardMaterial ||
      mat instanceof THREE.MeshBasicMaterial
    ) {
      console.log(
        "[extractColorFromMaterial] Extracted color:",
        mat.color.getHexString(),
      );
      return mat.color.clone();
    }
    // ShaderMaterial with color uniforms
    if (mat instanceof THREE.ShaderMaterial) {
      if (mat.uniforms?.leafColor) {
        return mat.uniforms.leafColor.value;
      }
      if (mat.uniforms?.uColor) {
        return mat.uniforms.uColor.value;
      }
    }
    console.log(
      "[extractColorFromMaterial] Using default color:",
      defaultColor.getHexString(),
    );
    return defaultColor.clone();
  }

  /**
   * Clone a material for baking, preserving its type for proper rendering.
   * Uses standard Three.js materials which work with both WebGL and WebGPU.
   */
  private cloneMaterialForBaking(mat: THREE.Material): THREE.Material {
    console.log(
      "[cloneMaterialForBaking] Material type:",
      mat.type,
      mat.constructor.name,
    );

    // Check for TSL leaf materials with leafUniforms (from procgen package)
    // These have custom colorNode shaders, so we need to extract the base color
    const matWithLeafUniforms = mat as MeshBasicNodeMaterial & {
      leafUniforms?: { color?: { value?: THREE.Color } };
    };
    if (
      mat instanceof MeshBasicNodeMaterial &&
      matWithLeafUniforms.leafUniforms?.color?.value
    ) {
      const leafColor = matWithLeafUniforms.leafUniforms.color.value;
      console.log(
        "[cloneMaterialForBaking] Detected TSL leaf material, color:",
        leafColor.getHexString(),
      );
      // Create a simple material with the leaf color for baking
      // The procedural alpha cutout won't work during baking, so we use solid color
      const newMat = new MeshBasicNodeMaterial();
      newMat.color = leafColor.clone();
      newMat.side = mat.side;
      newMat.transparent = false; // Solid for baking
      newMat.opacity = 1.0;
      return newMat;
    }

    // Check for WebGPU node materials first (using instanceof)
    if (mat instanceof MeshBasicNodeMaterial) {
      const basicMat = mat;
      console.log(
        "[cloneMaterialForBaking] Detected MeshBasicNodeMaterial, color:",
        basicMat.color.getHexString(),
      );
      const newMat = new MeshBasicNodeMaterial();
      newMat.color = basicMat.color.clone();
      newMat.side = basicMat.side;
      newMat.transparent = basicMat.transparent;
      newMat.opacity = basicMat.opacity;
      newMat.alphaTest = basicMat.alphaTest;
      newMat.map = basicMat.map ?? null;
      return newMat;
    }

    if (mat instanceof MeshStandardNodeMaterial) {
      const stdMat = mat;
      const newMat = new MeshStandardNodeMaterial();
      newMat.color = stdMat.color.clone();
      newMat.side = stdMat.side;
      newMat.roughness = stdMat.roughness;
      newMat.metalness = stdMat.metalness;
      newMat.transparent = stdMat.transparent;
      newMat.opacity = stdMat.opacity;
      newMat.alphaTest = stdMat.alphaTest;
      newMat.map = stdMat.map ?? null;
      newMat.roughnessMap = stdMat.roughnessMap ?? null;
      newMat.metalnessMap = stdMat.metalnessMap ?? null;
      newMat.aoMap = stdMat.aoMap ?? null;
      newMat.aoMapIntensity = stdMat.aoMapIntensity;
      return newMat;
    }

    // Convert WebGL materials to Node materials
    if (mat instanceof THREE.MeshBasicMaterial) {
      const basicMat = mat;
      const newMat = new MeshBasicNodeMaterial();
      newMat.color = basicMat.color.clone();
      newMat.side = basicMat.side;
      newMat.transparent = basicMat.transparent;
      newMat.opacity = basicMat.opacity;
      newMat.alphaTest = basicMat.alphaTest;
      newMat.map = basicMat.map ?? null;
      return newMat;
    }

    if (mat instanceof THREE.MeshStandardMaterial) {
      const stdMat = mat;
      const newMat = new MeshStandardNodeMaterial();
      newMat.color = stdMat.color.clone();
      newMat.side = stdMat.side;
      newMat.roughness = stdMat.roughness;
      newMat.metalness = stdMat.metalness;
      newMat.transparent = stdMat.transparent;
      newMat.opacity = stdMat.opacity;
      newMat.alphaTest = stdMat.alphaTest;
      newMat.map = stdMat.map ?? null;
      newMat.roughnessMap = stdMat.roughnessMap ?? null;
      newMat.metalnessMap = stdMat.metalnessMap ?? null;
      newMat.aoMap = stdMat.aoMap ?? null;
      newMat.aoMapIntensity = stdMat.aoMapIntensity;
      return newMat;
    }

    // For ShaderMaterial, extract color and create a standard node material
    if (mat instanceof THREE.ShaderMaterial) {
      const color = this.extractColorFromMaterial(
        mat,
        new THREE.Color(0x888888),
      );
      const newMat = new MeshStandardNodeMaterial();
      newMat.color = color;
      newMat.side = mat.side;
      newMat.roughness = 0.8;
      return newMat;
    }

    // Default: create a standard material with gray color
    console.warn(
      "[ImpostorBaker] Unknown material type, using gray default:",
      mat.type,
      mat,
    );
    const defaultMat = new MeshStandardNodeMaterial();
    defaultMat.color = new THREE.Color(0x888888);
    defaultMat.side = mat.side ?? THREE.FrontSide;
    defaultMat.roughness = 0.8;
    return defaultMat;
  }

  /**
   * Deep clone an object, properly handling InstancedMesh.
   * Converts InstancedMesh to regular merged geometry for rendering.
   * Preserves material types for proper rendering (e.g., MeshBasicMaterial doesn't need lighting).
   */
  private cloneForRendering(source: THREE.Object3D): THREE.Group {
    const result = new THREE.Group();

    // Ensure world matrices are up to date
    source.updateWorldMatrix(true, true);

    source.traverse((node) => {
      if (node instanceof THREE.InstancedMesh) {
        // Flatten InstancedMesh into merged geometry
        const baseGeo = node.geometry;
        const instanceCount = node.count;

        const posAttr = baseGeo.attributes.position;
        const normAttr = baseGeo.attributes.normal;
        const indexAttr = baseGeo.index;

        if (!posAttr) return;

        const mergedPositions: number[] = [];
        const mergedNormals: number[] = [];
        const mergedIndices: number[] = [];

        const tempMatrix = new THREE.Matrix4();
        const tempPos = new THREE.Vector3();
        const tempNorm = new THREE.Vector3();
        const normalMatrix = new THREE.Matrix3();

        // Check for instanceOrientation attribute (used by instanced leaves)
        const orientationAttr = baseGeo.attributes.instanceOrientation as
          | THREE.BufferAttribute
          | undefined;

        for (let i = 0; i < instanceCount; i++) {
          node.getMatrixAt(i, tempMatrix);

          // Get instance position from matrix
          const instancePos = new THREE.Vector3();
          const instanceScale = new THREE.Vector3();
          const instanceQuat = new THREE.Quaternion();
          tempMatrix.decompose(instancePos, instanceQuat, instanceScale);

          // Get rotation from instanceOrientation attribute if present
          let rotQuat = new THREE.Quaternion();
          if (orientationAttr) {
            const qx = orientationAttr.getX(i);
            const qy = orientationAttr.getY(i);
            const qz = orientationAttr.getZ(i);
            const qw = orientationAttr.getW(i);
            rotQuat.set(qx, qy, qz, qw);
          }

          // Build transform: rotate vertex by quaternion, then scale, then translate
          const rotMatrix = new THREE.Matrix4().makeRotationFromQuaternion(
            rotQuat,
          );
          const scaleMatrix = new THREE.Matrix4().makeScale(
            instanceScale.x,
            instanceScale.y,
            instanceScale.z,
          );
          const translateMatrix = new THREE.Matrix4().makeTranslation(
            instancePos.x,
            instancePos.y,
            instancePos.z,
          );
          // Apply instance transform, then node's world matrix
          const finalMatrix = new THREE.Matrix4()
            .copy(node.matrixWorld)
            .multiply(translateMatrix)
            .multiply(scaleMatrix)
            .multiply(rotMatrix);

          normalMatrix.getNormalMatrix(finalMatrix);

          const vertexOffset = mergedPositions.length / 3;

          // Transform and add vertices
          for (let v = 0; v < posAttr.count; v++) {
            tempPos.fromBufferAttribute(posAttr, v);
            tempPos.applyMatrix4(finalMatrix);
            mergedPositions.push(tempPos.x, tempPos.y, tempPos.z);

            if (normAttr) {
              tempNorm.fromBufferAttribute(normAttr, v);
              tempNorm.applyMatrix3(normalMatrix).normalize();
              mergedNormals.push(tempNorm.x, tempNorm.y, tempNorm.z);
            }
          }

          // Add indices with offset
          if (indexAttr) {
            for (let idx = 0; idx < indexAttr.count; idx++) {
              mergedIndices.push(indexAttr.getX(idx) + vertexOffset);
            }
          }
        }

        // Create merged geometry
        const mergedGeo = new THREE.BufferGeometry();
        mergedGeo.setAttribute(
          "position",
          new THREE.Float32BufferAttribute(mergedPositions, 3),
        );
        if (mergedNormals.length > 0) {
          mergedGeo.setAttribute(
            "normal",
            new THREE.Float32BufferAttribute(mergedNormals, 3),
          );
        }
        if (mergedIndices.length > 0) {
          mergedGeo.setIndex(mergedIndices);
        }

        // Get color from material (handles single material only for InstancedMesh)
        const mat = node.material;
        const singleMat = Array.isArray(mat) ? mat[0] : mat;
        const color = this.extractColorFromMaterial(
          singleMat,
          new THREE.Color(0x228b22),
        );

        const bakeMaterial = new MeshStandardNodeMaterial();
        bakeMaterial.color = color;
        bakeMaterial.side = THREE.DoubleSide;
        bakeMaterial.roughness = 0.8;

        const bakedMesh = new THREE.Mesh(mergedGeo, bakeMaterial);
        result.add(bakedMesh);
      } else if (node instanceof THREE.Mesh && node.geometry) {
        // Regular mesh - clone geometry and preserve material type
        const clonedGeo = node.geometry.clone();

        // Apply world transform to geometry so we can center everything
        node.updateWorldMatrix(true, false);
        clonedGeo.applyMatrix4(node.matrixWorld);

        // Handle material arrays (like colored cube with 6 face materials)
        const mat = node.material;
        let clonedMaterial: THREE.Material | THREE.Material[];

        if (Array.isArray(mat)) {
          // Clone each material in the array, preserving types
          clonedMaterial = mat.map((m) => this.cloneMaterialForBaking(m));
        } else {
          // Single material - clone preserving type
          clonedMaterial = this.cloneMaterialForBaking(mat);
        }

        const clonedMesh = new THREE.Mesh(clonedGeo, clonedMaterial);
        result.add(clonedMesh);
      }
    });

    return result;
  }

  /**
   * Create a flattened baking source for debugging/export.
   *
   * This clones the source object and flattens InstancedMesh into
   * regular geometry. Caller is responsible for disposing the
   * returned meshes/materials when done.
   */
  createBakingSource(source: THREE.Object3D): THREE.Group {
    return this.cloneForRendering(source);
  }

  /**
   * Bake a mesh into an octahedral impostor atlas
   *
   * Convention:
   * - gridSizeX/Y represents the number of points/cells per axis
   * - buildOctahedronMesh(gridSize) creates gridSize points per axis
   * - Atlas is divided into gridSize x gridSize cells
   * - Shader divides by gridSize
   *
   * Example with gridSizeX=31 (default):
   * - buildOctahedronMesh(31) → 31x31 = 961 points
   * - Atlas has 31x31 cells
   * - Each cell is 1/31 of the atlas width/height
   *
   * @param source - The source mesh or group to bake
   * @param config - Baking configuration (merged with defaults)
   * @returns The bake result containing the atlas texture and metadata
   */
  async bake(
    source: THREE.Object3D,
    config: Partial<ImpostorBakeConfig> = {},
  ): Promise<ImpostorBakeResult> {
    const finalConfig: ImpostorBakeConfig = {
      ...DEFAULT_BAKE_CONFIG,
      ...config,
    };
    const {
      atlasWidth,
      atlasHeight,
      gridSizeX,
      octType,
      backgroundColor,
      backgroundAlpha,
      verticalPacking = 1,
    } = finalConfig;

    // Apply vertical packing ratio to gridSizeY
    const effectiveGridSizeY = Math.max(
      1,
      Math.round(gridSizeX * verticalPacking),
    );

    console.log(
      `[ImpostorBaker] Starting WebGPU atlas: gridX=${gridSizeX}, gridY=${effectiveGridSizeY} (packing=${verticalPacking})`,
    );

    // CRITICAL: Save and reset pixel ratio for atlas rendering
    const originalPixelRatio = this.renderer.getPixelRatio();
    this.renderer.setPixelRatio(1);

    // Compute bounding box from original (does NOT modify source)
    const boundingBox = this.computeBoundingBox(source);
    const boundingSphere = new THREE.Sphere();
    boundingBox.getBoundingSphere(boundingSphere);

    // Build octahedron mesh to get view directions
    // Uses effectiveGridSizeY for vertical packing
    const octMeshData = buildOctahedronMesh(
      octType,
      gridSizeX,
      effectiveGridSizeY,
      [0, 0, 0],
      false,
    );
    const viewPoints = octMeshData.octPoints;

    // Pre-morph the geometry to octahedron shape for consistent raycasting
    lerpOctahedronGeometry(octMeshData, 1.0);
    octMeshData.filledMesh.geometry.computeBoundingSphere();
    octMeshData.filledMesh.geometry.computeBoundingBox();
    octMeshData.wireframeMesh.geometry.computeBoundingSphere();
    octMeshData.wireframeMesh.geometry.computeBoundingBox();

    // Clone source for rendering
    const sourceCopy = this.cloneForRendering(source);
    this.renderScene.add(sourceCopy);

    // Debug: log what's in the render scene
    let meshCount = 0;
    sourceCopy.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        meshCount++;
        console.log(
          `[ImpostorBaker] Mesh ${meshCount}: geometry vertices=${node.geometry.attributes.position?.count ?? 0}, material=${node.material.constructor.name}`,
        );
      }
    });
    console.log(`[ImpostorBaker] Total meshes in render scene: ${meshCount}`);

    // Center and scale the mesh to fit in camera view
    // Scale so mesh fills most of the cell (orthoSize is 0.5, view is 1.0x1.0)
    const center = boundingSphere.center.clone();
    sourceCopy.position.set(-center.x, -center.y, -center.z);

    // Scale to fit in camera view: orthoSize is 0.5, camera captures 1.0x1.0
    // scaleFactor = 0.5 / radius makes diameter fill view
    // Using 1.15 margin (15%) to prevent edge clipping on trees with foliage
    // The 5% margin was too tight and clipped tree leaves
    const radius = boundingSphere.radius * 1.15;
    const scaleFactor = 0.5 / radius;
    sourceCopy.scale.setScalar(scaleFactor);
    sourceCopy.position.multiplyScalar(scaleFactor);

    // =========================================================================
    // WEBGPU ATLAS GENERATION - Cell-by-cell blit approach
    // Render each cell to small target, then blit to atlas position
    // =========================================================================

    // Cell counts for X and Y axes (may differ with vertical packing)
    const numCellsX = gridSizeX;
    const numCellsY = effectiveGridSizeY;
    const cellSizeX = Math.floor(atlasWidth / numCellsX);
    const cellSizeY = Math.floor(atlasHeight / numCellsY);
    const cellSize = Math.min(cellSizeX, cellSizeY); // For square cell render target

    // Save original state
    const originalRenderTarget = this.renderer.getRenderTarget();

    // Disable tone mapping during baking
    const renderer = this.renderer as CompatibleRenderer;
    const originalToneMapping = renderer.toneMapping;
    const originalToneMappingExposure = renderer.toneMappingExposure;
    if (renderer.toneMapping !== undefined) {
      renderer.toneMapping = THREE.NoToneMapping;
    }
    if (renderer.toneMappingExposure !== undefined) {
      renderer.toneMappingExposure = 1.0;
    }

    // Create full-size render target for atlas
    const renderTarget = new THREE_WEBGPU.RenderTarget(
      atlasWidth,
      atlasHeight,
      {
        format: THREE.RGBAFormat,
        type: THREE.UnsignedByteType,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        generateMipmaps: false,
      },
    );
    // CRITICAL: Configure color space for proper texture sampling in TSL material
    this.configureAtlasRenderTarget(renderTarget, THREE.SRGBColorSpace);

    // Create cell-sized render target for individual views
    const cellRenderTarget = new THREE_WEBGPU.RenderTarget(cellSize, cellSize, {
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: false,
    });
    // Configure cell render target for sRGB color
    this.configureAtlasRenderTarget(cellRenderTarget, THREE.SRGBColorSpace);

    console.log(
      `[ImpostorBaker] Starting WebGPU atlas: ${numCellsX}x${numCellsY} cells, cell render=${cellSize}px`,
    );

    const webgpuRenderer = this.renderer as THREE_WEBGPU.WebGPURenderer;

    // Clear atlas first
    webgpuRenderer.setRenderTarget(renderTarget);
    webgpuRenderer.setClearColor(
      backgroundColor ?? 0x000000,
      backgroundAlpha ?? 0,
    );
    webgpuRenderer.clear();

    // Create blit geometry and material with transparency support
    const blitGeo = new THREE.PlaneGeometry(2, 2);
    const blitMat = new THREE_WEBGPU.MeshBasicNodeMaterial();
    const cellTex = cellRenderTarget.texture;
    blitMat.colorNode = THREE_WEBGPU.TSL.texture(cellTex);
    blitMat.opacityNode = THREE_WEBGPU.TSL.texture(cellTex).a;
    blitMat.transparent = true;
    blitMat.depthTest = false;
    blitMat.depthWrite = false;
    const blitMesh = new THREE.Mesh(blitGeo, blitMat);
    const blitScene = new THREE.Scene();
    blitScene.add(blitMesh);
    const blitCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    // Save autoClear state and disable it for blitting
    const originalAutoClear = webgpuRenderer.autoClear;
    webgpuRenderer.autoClear = false;

    let renderedCells = 0;
    for (let rowIdx = 0; rowIdx <= numCellsY; rowIdx++) {
      for (let colIdx = 0; colIdx <= numCellsX; colIdx++) {
        // Use numCellsX for row stride to index into view points array
        const flatIdx = rowIdx * numCellsX + colIdx;
        if (flatIdx * 3 + 2 >= viewPoints.length) continue;

        const px = viewPoints[flatIdx * 3];
        const py = viewPoints[flatIdx * 3 + 1];
        const pz = viewPoints[flatIdx * 3 + 2];

        const viewDir = new THREE.Vector3(px, py, pz).normalize();

        // Position camera
        this.renderCamera.position.copy(viewDir.clone().multiplyScalar(1.1));
        this.renderCamera.lookAt(0, 0, 0);

        // Render to cell render target (with clear)
        webgpuRenderer.setRenderTarget(cellRenderTarget);
        webgpuRenderer.setClearColor(
          backgroundColor ?? 0x000000,
          backgroundAlpha ?? 0,
        );
        webgpuRenderer.clear();
        webgpuRenderer.render(this.renderScene, this.renderCamera);

        // Calculate cell position in atlas
        // Cell dimensions in NDC (atlas spans -1 to 1 = 2 units)
        // Cells stretch to fill the atlas based on X and Y counts
        const cellW = 2 / numCellsX;
        const cellH = 2 / numCellsY;

        // Cell center position in NDC
        // Flip Y: rowIdx=0 should be at TOP (NDC Y = 1), not bottom
        // This matches how the impostor material samples the atlas
        const ndcX = -1 + (colIdx + 0.5) * cellW;
        const ndcY = 1 - (rowIdx + 0.5) * cellH; // Flipped Y

        blitMesh.position.set(ndcX, ndcY, 0);
        blitMesh.scale.set(cellW / 2, cellH / 2, 1); // PlaneGeometry is 2x2, so scale by half

        // Blit cell to atlas (no clear!)
        webgpuRenderer.setRenderTarget(renderTarget);
        webgpuRenderer.render(blitScene, blitCam);

        renderedCells++;
      }
    }

    // Restore autoClear
    webgpuRenderer.autoClear = originalAutoClear;

    console.log(`[ImpostorBaker] Rendered ${renderedCells} cells to atlas`);

    // Cleanup blit resources
    blitGeo.dispose();
    blitMat.dispose();
    cellRenderTarget.dispose();

    // Restore tone mapping
    if (originalToneMapping !== undefined) {
      renderer.toneMapping = originalToneMapping;
    }
    if (originalToneMappingExposure !== undefined) {
      renderer.toneMappingExposure = originalToneMappingExposure;
    }

    // Restore renderer state
    this.renderer.setRenderTarget(originalRenderTarget);
    this.renderer.setPixelRatio(originalPixelRatio);

    // Clean up render scene
    this.renderScene.remove(sourceCopy);
    sourceCopy.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        node.geometry?.dispose();
        if (node.material instanceof THREE.Material) {
          node.material.dispose();
        }
      }
    });

    console.log("[ImpostorBaker] Atlas generated using WebGPU RenderTarget:", {
      width: atlasWidth,
      height: atlasHeight,
      gridSize: `${gridSizeX}x${effectiveGridSizeY}`,
    });

    return {
      atlasTexture: renderTarget.texture,
      renderTarget,
      gridSizeX,
      gridSizeY: effectiveGridSizeY,
      octType,
      boundingSphere,
      boundingBox,
      octMeshData,
    };
  }

  /**
   * Bake both color and normal atlases for dynamic lighting.
   *
   * The normal atlas captures world-space normals from each viewing angle,
   * enabling real-time lighting calculations on the impostor.
   *
   * @param source - The source mesh or group to bake
   * @param config - Baking configuration
   * @returns Result containing both color and normal atlases
   */
  async bakeWithNormals(
    source: THREE.Object3D,
    config: Partial<ImpostorBakeConfig> = {},
  ): Promise<ImpostorBakeResult> {
    const finalConfig: ImpostorBakeConfig = {
      ...DEFAULT_BAKE_CONFIG,
      ...config,
    };
    const {
      atlasWidth,
      atlasHeight,
      gridSizeX,
      gridSizeY,
      octType,
      backgroundColor,
      backgroundAlpha,
    } = finalConfig;

    // CRITICAL: Save and reset pixel ratio for atlas rendering
    const originalPixelRatio = this.renderer.getPixelRatio();
    this.renderer.setPixelRatio(1);

    // Compute bounding box from original (does NOT modify source)
    const boundingBox = this.computeBoundingBox(source);
    const boundingSphere = new THREE.Sphere();
    boundingBox.getBoundingSphere(boundingSphere);

    // Build octahedron mesh to get view directions
    const octMeshData = buildOctahedronMesh(
      octType,
      gridSizeX,
      gridSizeY,
      [0, 0, 0],
      false,
    );
    const viewPoints = octMeshData.octPoints;

    // Pre-morph the geometry for raycasting
    lerpOctahedronGeometry(octMeshData, 1.0);
    octMeshData.filledMesh.geometry.computeBoundingSphere();
    octMeshData.filledMesh.geometry.computeBoundingBox();
    octMeshData.wireframeMesh.geometry.computeBoundingSphere();
    octMeshData.wireframeMesh.geometry.computeBoundingBox();

    // Clone source for rendering
    const sourceCopy = this.cloneForRendering(source);
    this.renderScene.add(sourceCopy);

    // Center and scale the cloned mesh
    const center = boundingSphere.center.clone();
    sourceCopy.position.set(-center.x, -center.y, -center.z);

    // Scale to fit in camera view (same as bake())
    const radius = boundingSphere.radius * 1.15;
    const scaleFactor = 0.5 / radius;
    sourceCopy.scale.setScalar(scaleFactor);
    sourceCopy.position.multiplyScalar(scaleFactor);

    // Cell counts and sizes
    const numCellsX = gridSizeX;
    const numCellsY = gridSizeY;
    const cellSizeX = Math.floor(atlasWidth / numCellsX);
    const cellSizeY = Math.floor(atlasHeight / numCellsY);
    const cellSize = Math.min(cellSizeX, cellSizeY);

    // Save original state
    const originalRenderTarget = this.renderer.getRenderTarget();

    // Disable tone mapping during baking
    const renderer = this.renderer as CompatibleRenderer;
    const originalToneMapping = renderer.toneMapping;
    const originalToneMappingExposure = renderer.toneMappingExposure;
    if (renderer.toneMapping !== undefined) {
      renderer.toneMapping = THREE.NoToneMapping;
    }
    if (renderer.toneMappingExposure !== undefined) {
      renderer.toneMappingExposure = 1.0;
    }

    // Create full-size render targets for atlases
    const colorRenderTarget = new THREE_WEBGPU.RenderTarget(
      atlasWidth,
      atlasHeight,
      {
        format: THREE.RGBAFormat,
        type: THREE.UnsignedByteType,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        generateMipmaps: false,
      },
    );
    // CRITICAL: Configure color render target for sRGB color space
    this.configureAtlasRenderTarget(colorRenderTarget, THREE.SRGBColorSpace);

    const normalRenderTarget = new THREE_WEBGPU.RenderTarget(
      atlasWidth,
      atlasHeight,
      {
        format: THREE.RGBAFormat,
        type: THREE.UnsignedByteType,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        generateMipmaps: false,
      },
    );
    // Configure normal render target for linear color space (raw data, no gamma)
    this.configureAtlasRenderTarget(
      normalRenderTarget,
      THREE.LinearSRGBColorSpace,
    );

    // Create cell-sized render targets for individual views
    const colorCellTarget = new THREE_WEBGPU.RenderTarget(cellSize, cellSize, {
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: false,
    });
    // Configure color cell target for sRGB
    this.configureAtlasRenderTarget(colorCellTarget, THREE.SRGBColorSpace);

    const normalCellTarget = new THREE_WEBGPU.RenderTarget(cellSize, cellSize, {
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: false,
    });
    // Configure normal cell target for linear color space
    this.configureAtlasRenderTarget(
      normalCellTarget,
      THREE.LinearSRGBColorSpace,
    );

    const webgpuRenderer = this.renderer as THREE_WEBGPU.WebGPURenderer;

    // Clear atlases first
    webgpuRenderer.setRenderTarget(colorRenderTarget);
    webgpuRenderer.setClearColor(
      backgroundColor ?? 0x000000,
      backgroundAlpha ?? 0,
    );
    webgpuRenderer.clear();
    webgpuRenderer.setRenderTarget(normalRenderTarget);
    webgpuRenderer.setClearColor(0x8080ff, 1); // Neutral normal: (0,0,1) facing camera
    webgpuRenderer.clear();

    // Create blit geometry and materials for color
    const blitGeo = new THREE.PlaneGeometry(2, 2);
    const colorBlitMat = new THREE_WEBGPU.MeshBasicNodeMaterial();
    colorBlitMat.colorNode = THREE_WEBGPU.TSL.texture(colorCellTarget.texture);
    colorBlitMat.opacityNode = THREE_WEBGPU.TSL.texture(
      colorCellTarget.texture,
    ).a;
    colorBlitMat.transparent = true;
    colorBlitMat.depthTest = false;
    colorBlitMat.depthWrite = false;
    const colorBlitMesh = new THREE.Mesh(blitGeo, colorBlitMat);

    // Create blit material for normals
    const normalBlitMat = new THREE_WEBGPU.MeshBasicNodeMaterial();
    normalBlitMat.colorNode = THREE_WEBGPU.TSL.texture(
      normalCellTarget.texture,
    );
    normalBlitMat.opacityNode = THREE_WEBGPU.TSL.texture(
      normalCellTarget.texture,
    ).a;
    normalBlitMat.transparent = true;
    normalBlitMat.depthTest = false;
    normalBlitMat.depthWrite = false;
    const normalBlitMesh = new THREE.Mesh(blitGeo.clone(), normalBlitMat);

    const blitScene = new THREE.Scene();
    blitScene.add(colorBlitMesh);
    const normalBlitScene = new THREE.Scene();
    normalBlitScene.add(normalBlitMesh);
    const blitCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    // Normal material for normal pass
    const normalMaterial = new THREE.MeshNormalMaterial({
      side: THREE.DoubleSide,
      flatShading: false,
    });

    // Store original materials
    const originalMaterials = new Map<
      THREE.Mesh,
      THREE.Material | THREE.Material[]
    >();
    sourceCopy.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        originalMaterials.set(node, node.material);
        node.frustumCulled = false;
        if (!node.geometry.hasAttribute("normal")) {
          node.geometry.computeVertexNormals();
        }
      }
    });

    // Create UNLIT materials for the color pass
    // Handle both single materials and material arrays (like colored cube with 6 face materials)
    const unlitMaterials = new Map<
      THREE.Mesh,
      THREE.Material | THREE.Material[]
    >();
    sourceCopy.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        const originalMat = node.material;

        if (Array.isArray(originalMat)) {
          // Handle material arrays - create unlit version for each
          const unlitMats = originalMat.map((mat) => {
            const color = this.extractColorFromMaterial(
              mat,
              new THREE.Color(0x888888),
            );
            const isStdMat =
              mat instanceof THREE.MeshStandardMaterial ||
              mat instanceof MeshStandardNodeMaterial;
            const hasMap = isStdMat && (mat as THREE.MeshStandardMaterial).map;

            const unlitMat = new MeshBasicNodeMaterial();
            unlitMat.color = new THREE.Color(hasMap ? 0xffffff : color);
            if (hasMap) {
              unlitMat.map = (mat as THREE.MeshStandardMaterial).map;
            }
            unlitMat.side = mat.side ?? THREE.FrontSide;
            unlitMat.transparent = mat.transparent;
            unlitMat.alphaTest = mat.alphaTest;
            unlitMat.opacity = mat.opacity;
            return unlitMat;
          });
          unlitMaterials.set(node, unlitMats);
        } else {
          // Single material
          const color = this.extractColorFromMaterial(
            originalMat,
            new THREE.Color(0x888888),
          );
          const isStdMat =
            originalMat instanceof THREE.MeshStandardMaterial ||
            originalMat instanceof MeshStandardNodeMaterial;
          const hasMap =
            isStdMat && (originalMat as THREE.MeshStandardMaterial).map;

          const unlitMat = new MeshBasicNodeMaterial();
          unlitMat.color = new THREE.Color(hasMap ? 0xffffff : color);
          if (hasMap) {
            unlitMat.map = (originalMat as THREE.MeshStandardMaterial).map;
          }
          unlitMat.side = originalMat.side ?? THREE.FrontSide;
          unlitMat.transparent = originalMat.transparent;
          unlitMat.alphaTest = originalMat.alphaTest;
          unlitMat.opacity = originalMat.opacity;

          unlitMaterials.set(node, unlitMat);
        }
      }
    });

    // Remove scene lights for unlit baking
    this.renderScene.remove(this.ambientLight);
    this.renderScene.remove(this.directionalLight);

    // Save autoClear state and disable it for blitting
    const originalAutoClear = webgpuRenderer.autoClear;
    webgpuRenderer.autoClear = false;

    // Render each cell using blit approach
    for (let rowIdx = 0; rowIdx <= numCellsY; rowIdx++) {
      for (let colIdx = 0; colIdx <= numCellsX; colIdx++) {
        const flatIdx = rowIdx * numCellsX + colIdx;
        if (flatIdx * 3 + 2 >= viewPoints.length) continue;

        const px = viewPoints[flatIdx * 3];
        const py = viewPoints[flatIdx * 3 + 1];
        const pz = viewPoints[flatIdx * 3 + 2];

        const viewDir = new THREE.Vector3(px, py, pz).normalize();
        this.renderCamera.position.copy(viewDir.clone().multiplyScalar(1.1));
        this.renderCamera.lookAt(0, 0, 0);

        // === COLOR PASS ===
        // Swap to unlit materials
        sourceCopy.traverse((node) => {
          if (node instanceof THREE.Mesh && unlitMaterials.has(node)) {
            node.material = unlitMaterials.get(node)!;
          }
        });

        // Render color to cell target
        webgpuRenderer.setRenderTarget(colorCellTarget);
        webgpuRenderer.setClearColor(
          backgroundColor ?? 0x000000,
          backgroundAlpha ?? 0,
        );
        webgpuRenderer.clear();
        webgpuRenderer.render(this.renderScene, this.renderCamera);

        // Calculate cell position in atlas (NDC)
        const cellW = 2 / numCellsX;
        const cellH = 2 / numCellsY;
        const ndcX = -1 + (colIdx + 0.5) * cellW;
        const ndcY = 1 - (rowIdx + 0.5) * cellH; // Flipped Y

        // Blit color cell to atlas
        colorBlitMesh.position.set(ndcX, ndcY, 0);
        colorBlitMesh.scale.set(cellW / 2, cellH / 2, 1);
        webgpuRenderer.setRenderTarget(colorRenderTarget);
        webgpuRenderer.render(blitScene, blitCam);

        // === NORMAL PASS ===
        // Swap to normal material
        sourceCopy.traverse((node) => {
          if (node instanceof THREE.Mesh) {
            node.material = normalMaterial;
          }
        });

        // Render normals to cell target
        webgpuRenderer.setRenderTarget(normalCellTarget);
        webgpuRenderer.setClearColor(0x8080ff, 1);
        webgpuRenderer.clear();
        webgpuRenderer.render(this.renderScene, this.renderCamera);

        // Blit normal cell to atlas
        normalBlitMesh.position.set(ndcX, ndcY, 0);
        normalBlitMesh.scale.set(cellW / 2, cellH / 2, 1);
        webgpuRenderer.setRenderTarget(normalRenderTarget);
        webgpuRenderer.render(normalBlitScene, blitCam);
      }
    }

    // Restore autoClear
    webgpuRenderer.autoClear = originalAutoClear;

    // Restore scene lights
    this.renderScene.add(this.ambientLight);
    this.renderScene.add(this.directionalLight);

    // Restore tone mapping
    if (originalToneMapping !== undefined) {
      renderer.toneMapping = originalToneMapping;
    }
    if (originalToneMappingExposure !== undefined) {
      renderer.toneMappingExposure = originalToneMappingExposure;
    }

    // Restore renderer state
    this.renderer.setRenderTarget(originalRenderTarget);
    this.renderer.setPixelRatio(originalPixelRatio);

    // Clean up
    this.renderScene.remove(sourceCopy);
    sourceCopy.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        node.geometry?.dispose();
      }
    });
    normalMaterial.dispose();
    unlitMaterials.forEach((matOrArray: THREE.Material | THREE.Material[]) => {
      if (Array.isArray(matOrArray)) {
        matOrArray.forEach((m) => m.dispose());
      } else {
        matOrArray.dispose();
      }
    });
    colorCellTarget.dispose();
    normalCellTarget.dispose();
    colorBlitMat.dispose();
    normalBlitMat.dispose();
    blitGeo.dispose();

    // Ensure GPU operations complete
    this.renderer.setRenderTarget(null);
    if (this.renderer.renderAsync) {
      await this.renderer.renderAsync(new THREE.Scene(), this.renderCamera);
    }

    return {
      atlasTexture: colorRenderTarget.texture,
      renderTarget: colorRenderTarget,
      normalAtlasTexture: normalRenderTarget.texture,
      normalRenderTarget,
      gridSizeX,
      gridSizeY,
      octType,
      boundingSphere,
      boundingBox,
      octMeshData,
    };
  }

  /**
   * Bake with custom lighting setup
   */
  async bakeWithLighting(
    source: THREE.Object3D,
    config: Partial<ImpostorBakeConfig> = {},
    lightingSetup: {
      ambient?: { color: number; intensity: number };
      directional?: {
        color: number;
        intensity: number;
        position: THREE.Vector3;
      };
    } = {},
  ): Promise<ImpostorBakeResult> {
    // Apply custom lighting
    if (lightingSetup.ambient) {
      this.ambientLight.color.setHex(lightingSetup.ambient.color);
      this.ambientLight.intensity = lightingSetup.ambient.intensity;
    }
    if (lightingSetup.directional) {
      this.directionalLight.color.setHex(lightingSetup.directional.color);
      this.directionalLight.intensity = lightingSetup.directional.intensity;
      this.directionalLight.position.copy(lightingSetup.directional.position);
    }

    const result = await this.bake(source, config);

    // Restore default lighting
    this.ambientLight.color.setHex(0xffffff);
    this.ambientLight.intensity = 2.6;
    this.directionalLight.color.setHex(0xffffff);
    this.directionalLight.intensity = 3.8;
    this.directionalLight.position.set(5, 10, 7.5);

    return result;
  }

  /**
   * Export the baked atlas as a data URL (sync version).
   * Note: Only works with WebGLRenderer sync readRenderTargetPixels.
   * For WebGPU, use exportAtlasAsDataURLAsync instead.
   * @returns The data URL, or empty string if export is not supported
   */
  exportAtlasAsDataURL(
    result: ImpostorBakeResult,
    format: "png" | "jpeg" = "png",
  ): string {
    if (!this.renderer.readRenderTargetPixels) {
      console.warn(
        "[ImpostorBaker] Sync export not supported: use exportAtlasAsDataURLAsync for WebGPU",
      );
      return "";
    }

    const { renderTarget } = result;
    const { width, height } = renderTarget;

    // Read pixels from render target
    const pixels = new Uint8Array(width * height * 4);
    this.renderer.readRenderTargetPixels(
      renderTarget,
      0,
      0,
      width,
      height,
      pixels,
    );

    return this.pixelsToDataURL(pixels, width, height, format);
  }

  /**
   * Export the baked atlas as a data URL (async version).
   * Works with both WebGLRenderer and WebGPURenderer.
   * @returns Promise resolving to the data URL, or empty string if export is not supported
   */
  async exportAtlasAsDataURLAsync(
    result: ImpostorBakeResult,
    format: "png" | "jpeg" = "png",
  ): Promise<string> {
    const { renderTarget } = result;
    const { width, height } = renderTarget;
    let pixels: Uint8Array | null = null;

    // Use async read for WebGPU
    if (this.renderer.readRenderTargetPixelsAsync) {
      try {
        const pixelResult = await this.renderer.readRenderTargetPixelsAsync(
          renderTarget,
          0,
          0,
          width,
          height,
        );
        // Convert to Uint8Array if needed (result could be Float32Array for HDR targets)
        if (pixelResult instanceof Uint8Array) {
          pixels = pixelResult;
        } else if (pixelResult instanceof Float32Array) {
          // Convert float values (0-1) to uint8 (0-255)
          pixels = new Uint8Array(pixelResult.length);
          for (let i = 0; i < pixelResult.length; i++) {
            pixels[i] = Math.min(
              255,
              Math.max(0, Math.round(pixelResult[i] * 255)),
            );
          }
        }
      } catch (err) {
        console.warn("[ImpostorBaker] Async pixel read failed:", err);
      }
    }

    // Fallback to sync method (WebGL only)
    if (!pixels && this.renderer.readRenderTargetPixels) {
      pixels = new Uint8Array(width * height * 4);
      this.renderer.readRenderTargetPixels(
        renderTarget,
        0,
        0,
        width,
        height,
        pixels,
      );
    }

    if (!pixels) {
      console.warn(
        "[ImpostorBaker] Export not supported: no pixel read method available",
      );
      return "";
    }

    return this.pixelsToDataURL(pixels, width, height, format);
  }

  /**
   * Convert raw pixels to a data URL
   */
  private pixelsToDataURL(
    pixels: Uint8Array,
    width: number,
    height: number,
    format: "png" | "jpeg",
  ): string {
    // Create canvas and draw pixels
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d")!;
    const imageData = ctx.createImageData(width, height);

    // Flip Y axis (WebGL/WebGPU renders upside down)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const srcIdx = ((height - y - 1) * width + x) * 4;
        const dstIdx = (y * width + x) * 4;
        imageData.data[dstIdx] = pixels[srcIdx];
        imageData.data[dstIdx + 1] = pixels[srcIdx + 1];
        imageData.data[dstIdx + 2] = pixels[srcIdx + 2];
        imageData.data[dstIdx + 3] = pixels[srcIdx + 3];
      }
    }

    ctx.putImageData(imageData, 0, 0);
    return canvas.toDataURL(`image/${format}`);
  }

  /**
   * Export the baked atlas as a Blob (async)
   */
  async exportAtlasAsBlob(
    result: ImpostorBakeResult,
    format: "png" | "jpeg" = "png",
  ): Promise<Blob> {
    const dataUrl = await this.exportAtlasAsDataURLAsync(result, format);
    if (!dataUrl) {
      throw new Error("Failed to export atlas: pixel reading not supported");
    }
    const response = await fetch(dataUrl);
    return response.blob();
  }

  /**
   * Hybrid bake: uses standard bake() for colors, separate pass for normals.
   * This combines the correct color output from bake() with proper normal maps.
   *
   * The color atlas will have scene lighting baked in (same as regular bake).
   * The normal atlas provides surface detail for additional dynamic lighting.
   */
  async bakeHybrid(
    source: THREE.Object3D,
    config: Partial<ImpostorBakeConfig> = {},
    options: {
      backgroundColor?: number;
      backgroundAlpha?: number;
      alphaTest?: number;
    } = {},
  ): Promise<
    ImpostorBakeResult & {
      normalAtlasTexture: THREE.Texture;
      normalRenderTarget: THREE.RenderTarget;
    }
  > {
    const { backgroundColor, backgroundAlpha } = options;

    // Step 1: Use regular bake() for color atlas (this works correctly)
    // Merge background options into config
    const bakeConfig = {
      ...config,
      backgroundColor,
      backgroundAlpha,
    };
    const colorResult = await this.bake(source, bakeConfig);

    // Step 2: Bake normals separately using same grid settings from colorResult
    const gridSizeX = colorResult.gridSizeX;
    const gridSizeY = colorResult.gridSizeY;

    // Get atlas dimensions from color render target
    const atlasWidth = colorResult.renderTarget.width;
    const atlasHeight = colorResult.renderTarget.height;
    const cellWidth = Math.floor(atlasWidth / gridSizeX);
    const cellHeight = Math.floor(atlasHeight / gridSizeY);

    // Create normal render target - WebGPU only
    const normalRenderTarget = new THREE_WEBGPU.RenderTarget(
      atlasWidth,
      atlasHeight,
    );
    this.configureAtlasRenderTarget(
      normalRenderTarget,
      THREE.LinearSRGBColorSpace,
    );

    // Clone source for normal rendering
    const sourceCopy = this.cloneForRendering(source);
    this.renderScene.add(sourceCopy);

    // Center and scale - MUST match bake() scale exactly
    // bake() uses: scaleFactor = 0.5 / (boundingSphere.radius * 1.15)
    const center = colorResult.boundingSphere.center.clone();
    sourceCopy.position.set(-center.x, -center.y, -center.z);
    const radius = colorResult.boundingSphere.radius * 1.15;
    const scaleFactor = 0.5 / radius;
    sourceCopy.scale.setScalar(scaleFactor);
    sourceCopy.position.multiplyScalar(scaleFactor);

    // Store original render state
    const originalRenderTarget = this.renderer.getRenderTarget();
    const originalViewport = new THREE.Vector4();
    this.renderer.getViewport(originalViewport);
    const originalPixelRatio = this.renderer.getPixelRatio();
    this.renderer.setPixelRatio(1);

    // Normal material - uses Three.js built-in MeshNormalMaterial
    // WebGPU/TSL compatible - works with both renderers
    const normalMaterial = new THREE.MeshNormalMaterial({
      side: THREE.DoubleSide,
      flatShading: false,
    });

    // Store original materials
    const originalMaterials = new Map<
      THREE.Mesh,
      THREE.Material | THREE.Material[]
    >();
    sourceCopy.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        originalMaterials.set(node, node.material);
        node.frustumCulled = false;
        if (!node.geometry.hasAttribute("normal")) {
          node.geometry.computeVertexNormals();
        }
      }
    });

    // Switch to linear output for normal pass
    const renderer = this.renderer as CompatibleRenderer;
    const originalColorSpace = renderer.outputColorSpace;
    if (renderer.outputColorSpace !== undefined) {
      renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    }

    // Use BLIT APPROACH for WebGPU compatibility (same fix as bakeWithNormals and bakeFull)
    // Create a cell render target for rendering each view
    const normalCellTarget = new THREE_WEBGPU.RenderTarget(
      cellWidth,
      cellHeight,
    );
    this.configureAtlasRenderTarget(
      normalCellTarget,
      THREE.LinearSRGBColorSpace,
    );

    // CRITICAL: Clear the full normal atlas to neutral normal color before rendering cells
    this.renderer.setRenderTarget(normalRenderTarget);
    this.renderer.setScissorTest(false);
    this.renderer.setViewport(0, 0, atlasWidth, atlasHeight);
    this.renderer.setClearColor(0x8080ff, 1); // Neutral normal facing camera
    this.renderer.clear();

    // Create blit scene for copying cell to atlas
    const blitScene = new THREE.Scene();
    const blitCam = new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 0.1, 10);
    blitCam.position.z = 1;
    const blitPlaneGeom = new THREE.PlaneGeometry(1, 1);
    const blitNormalMat = new MeshBasicNodeMaterial();
    blitNormalMat.side = THREE.DoubleSide;
    const blitNormalPlane = new THREE.Mesh(blitPlaneGeom, blitNormalMat);
    blitScene.add(blitNormalPlane);

    console.log(
      `[bakeHybrid] Rendering ${gridSizeX}x${gridSizeY} normal atlas cells`,
    );

    // Render normals for each cell using blit approach
    const viewPoints = colorResult.octMeshData!.octPoints;

    for (let rowIdx = 0; rowIdx < gridSizeY; rowIdx++) {
      for (let colIdx = 0; colIdx < gridSizeX; colIdx++) {
        const flatIdx = rowIdx * gridSizeX + colIdx;

        const px = viewPoints[flatIdx * 3];
        const py = viewPoints[flatIdx * 3 + 1];
        const pz = viewPoints[flatIdx * 3 + 2];
        const viewDir = new THREE.Vector3(px, py, pz).normalize();

        this.renderCamera.position.copy(viewDir.clone().multiplyScalar(1.1));
        this.renderCamera.lookAt(0, 0, 0);

        // Swap to normal material
        sourceCopy.traverse((node) => {
          if (node instanceof THREE.Mesh) {
            node.material = normalMaterial;
          }
        });

        // 1. Render to cell target
        this.renderer.setRenderTarget(normalCellTarget);
        this.renderer.setScissorTest(false);
        this.renderer.setViewport(0, 0, cellWidth, cellHeight);
        this.renderer.setClearColor(0x8080ff, 1); // Neutral normal facing camera
        this.renderer.clear();
        await this.doRender(this.renderScene, this.renderCamera);

        // 2. Blit cell to atlas at correct position
        const pixelX = Math.floor((colIdx / gridSizeX) * atlasWidth);
        const pixelY = Math.floor((rowIdx / gridSizeY) * atlasHeight);

        blitNormalMat.map = normalCellTarget.texture;
        blitNormalMat.needsUpdate = true;

        this.renderer.setRenderTarget(normalRenderTarget);
        this.renderer.setScissorTest(true);
        this.renderer.setScissor(pixelX, pixelY, cellWidth, cellHeight);
        this.renderer.setViewport(pixelX, pixelY, cellWidth, cellHeight);
        // Don't clear - just overdraw
        await this.doRender(blitScene, blitCam);
      }
    }

    // Restore renderer state
    renderer.outputColorSpace = originalColorSpace;
    this.renderer.setScissorTest(false);
    this.renderer.setRenderTarget(originalRenderTarget);
    this.renderer.setViewport(originalViewport);
    this.renderer.setPixelRatio(originalPixelRatio);

    // Clean up
    this.renderScene.remove(sourceCopy);
    sourceCopy.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        node.geometry?.dispose();
      }
    });
    normalMaterial.dispose();
    normalCellTarget.dispose();
    blitPlaneGeom.dispose();
    blitNormalMat.dispose();

    return {
      ...colorResult,
      normalAtlasTexture: normalRenderTarget.texture,
      normalRenderTarget,
    };
  }

  /**
   * AAA-quality full bake: albedo + normals + depth + optional PBR channels.
   * Uses blit approach for WebGPU compatibility.
   *
   * @param source - The source mesh or group to bake
   * @param config - Baking configuration
   * @returns Complete bake result with all atlas textures
   */
  async bakeFull(
    source: THREE.Object3D,
    config: Partial<ImpostorBakeConfig> = {},
  ): Promise<ImpostorBakeResult> {
    const finalConfig: ImpostorBakeConfig = {
      ...DEFAULT_BAKE_CONFIG,
      ...config,
    };
    const {
      atlasWidth,
      atlasHeight,
      gridSizeX,
      gridSizeY,
      octType,
      backgroundColor,
      backgroundAlpha,
      pbrMode,
      depthNear,
      depthFar,
    } = finalConfig;

    const nearPlane = depthNear ?? 0.001;
    const farPlane = depthFar ?? 10;

    // CRITICAL: Save and reset pixel ratio for atlas rendering
    const originalPixelRatio = this.renderer.getPixelRatio();
    this.renderer.setPixelRatio(1);

    // Compute bounding box from original (does NOT modify source)
    const boundingBox = this.computeBoundingBox(source);
    const boundingSphere = new THREE.Sphere();
    boundingBox.getBoundingSphere(boundingSphere);

    // Build octahedron mesh to get view directions
    const octMeshData = buildOctahedronMesh(
      octType,
      gridSizeX,
      gridSizeY,
      [0, 0, 0],
      false,
    );
    const viewPoints = octMeshData.octPoints;

    // Pre-morph the geometry for raycasting
    lerpOctahedronGeometry(octMeshData, 1.0);
    octMeshData.filledMesh.geometry.computeBoundingSphere();
    octMeshData.filledMesh.geometry.computeBoundingBox();
    octMeshData.wireframeMesh.geometry.computeBoundingSphere();
    octMeshData.wireframeMesh.geometry.computeBoundingBox();

    // Clone source for rendering
    const sourceCopy = this.cloneForRendering(source);
    this.renderScene.add(sourceCopy);

    // Center and scale the cloned mesh (same as bake())
    const center = boundingSphere.center.clone();
    sourceCopy.position.set(-center.x, -center.y, -center.z);
    const radius = boundingSphere.radius * 1.15;
    const scaleFactor = 0.5 / radius;
    sourceCopy.scale.setScalar(scaleFactor);
    sourceCopy.position.multiplyScalar(scaleFactor);

    // Cell counts and sizes
    const numCellsX = gridSizeX;
    const numCellsY = gridSizeY;
    const cellSizeX = Math.floor(atlasWidth / numCellsX);
    const cellSizeY = Math.floor(atlasHeight / numCellsY);
    const cellSize = Math.min(cellSizeX, cellSizeY);

    // Save original state
    const originalRenderTarget = this.renderer.getRenderTarget();

    // Disable tone mapping during baking
    const renderer = this.renderer as CompatibleRenderer;
    const originalToneMapping = renderer.toneMapping;
    const originalToneMappingExposure = renderer.toneMappingExposure;
    if (renderer.toneMapping !== undefined) {
      renderer.toneMapping = THREE.NoToneMapping;
    }
    if (renderer.toneMappingExposure !== undefined) {
      renderer.toneMappingExposure = 1.0;
    }

    // Create full-size render targets for atlases
    const colorRenderTarget = new THREE_WEBGPU.RenderTarget(
      atlasWidth,
      atlasHeight,
      {
        format: THREE.RGBAFormat,
        type: THREE.UnsignedByteType,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        generateMipmaps: false,
      },
    );
    // CRITICAL: Configure color render target for sRGB color space
    this.configureAtlasRenderTarget(colorRenderTarget, THREE.SRGBColorSpace);

    const normalRenderTarget = new THREE_WEBGPU.RenderTarget(
      atlasWidth,
      atlasHeight,
      {
        format: THREE.RGBAFormat,
        type: THREE.UnsignedByteType,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        generateMipmaps: false,
      },
    );
    // Configure normal render target for linear color space (raw data, no gamma)
    this.configureAtlasRenderTarget(
      normalRenderTarget,
      THREE.LinearSRGBColorSpace,
    );

    const depthRenderTarget = new THREE_WEBGPU.RenderTarget(
      atlasWidth,
      atlasHeight,
      {
        format: THREE.RGBAFormat,
        type: THREE.UnsignedByteType,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        generateMipmaps: false,
      },
    );
    // Configure depth render target for linear color space (raw depth values)
    this.configureAtlasRenderTarget(
      depthRenderTarget,
      THREE.LinearSRGBColorSpace,
    );

    // PBR atlas - only create if COMPLETE mode
    let pbrRenderTarget: THREE_WEBGPU.RenderTarget | undefined;
    if (pbrMode === PBRBakeMode.COMPLETE) {
      pbrRenderTarget = new THREE_WEBGPU.RenderTarget(atlasWidth, atlasHeight, {
        format: THREE.RGBAFormat,
        type: THREE.UnsignedByteType,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        generateMipmaps: false,
      });
      // Configure PBR render target for linear color space
      this.configureAtlasRenderTarget(
        pbrRenderTarget,
        THREE.LinearSRGBColorSpace,
      );
    }

    // Create cell-sized render targets for individual views
    const colorCellTarget = new THREE_WEBGPU.RenderTarget(cellSize, cellSize, {
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: false,
    });
    // Configure color cell target for sRGB
    this.configureAtlasRenderTarget(colorCellTarget, THREE.SRGBColorSpace);

    const normalCellTarget = new THREE_WEBGPU.RenderTarget(cellSize, cellSize, {
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: false,
    });
    // Configure normal cell target for linear color space
    this.configureAtlasRenderTarget(
      normalCellTarget,
      THREE.LinearSRGBColorSpace,
    );

    const depthCellTarget = new THREE_WEBGPU.RenderTarget(cellSize, cellSize, {
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: false,
    });
    // Configure depth cell target for linear color space
    this.configureAtlasRenderTarget(
      depthCellTarget,
      THREE.LinearSRGBColorSpace,
    );

    let pbrCellTarget: THREE_WEBGPU.RenderTarget | undefined;
    if (pbrMode === PBRBakeMode.COMPLETE) {
      pbrCellTarget = new THREE_WEBGPU.RenderTarget(cellSize, cellSize, {
        format: THREE.RGBAFormat,
        type: THREE.UnsignedByteType,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        generateMipmaps: false,
      });
      // Configure PBR cell target for linear color space
      this.configureAtlasRenderTarget(
        pbrCellTarget,
        THREE.LinearSRGBColorSpace,
      );
    }

    const webgpuRenderer = this.renderer as THREE_WEBGPU.WebGPURenderer;

    // Clear atlases first
    webgpuRenderer.setRenderTarget(colorRenderTarget);
    webgpuRenderer.setClearColor(
      backgroundColor ?? 0x000000,
      backgroundAlpha ?? 0,
    );
    webgpuRenderer.clear();
    webgpuRenderer.setRenderTarget(normalRenderTarget);
    webgpuRenderer.setClearColor(0x8080ff, 1);
    webgpuRenderer.clear();
    webgpuRenderer.setRenderTarget(depthRenderTarget);
    webgpuRenderer.setClearColor(0xffffff, 0);
    webgpuRenderer.clear();
    if (pbrRenderTarget) {
      webgpuRenderer.setRenderTarget(pbrRenderTarget);
      webgpuRenderer.setClearColor(0xcc00ff, 0);
      webgpuRenderer.clear();
    }

    // Create blit geometry and materials
    const blitGeo = new THREE.PlaneGeometry(2, 2);
    const createBlitMat = (tex: THREE.Texture) => {
      const mat = new THREE_WEBGPU.MeshBasicNodeMaterial();
      mat.colorNode = THREE_WEBGPU.TSL.texture(tex);
      mat.opacityNode = THREE_WEBGPU.TSL.texture(tex).a;
      mat.transparent = true;
      mat.depthTest = false;
      mat.depthWrite = false;
      return mat;
    };

    const colorBlitMat = createBlitMat(colorCellTarget.texture);
    const normalBlitMat = createBlitMat(normalCellTarget.texture);
    const depthBlitMat = createBlitMat(depthCellTarget.texture);
    let pbrBlitMat: THREE_WEBGPU.MeshBasicNodeMaterial | undefined;
    if (pbrCellTarget) {
      pbrBlitMat = createBlitMat(pbrCellTarget.texture);
    }

    const colorBlitMesh = new THREE.Mesh(blitGeo, colorBlitMat);
    const normalBlitMesh = new THREE.Mesh(blitGeo.clone(), normalBlitMat);
    const depthBlitMesh = new THREE.Mesh(blitGeo.clone(), depthBlitMat);
    let pbrBlitMesh: THREE.Mesh | undefined;
    if (pbrBlitMat) {
      pbrBlitMesh = new THREE.Mesh(blitGeo.clone(), pbrBlitMat);
    }

    const colorBlitScene = new THREE.Scene();
    colorBlitScene.add(colorBlitMesh);
    const normalBlitScene = new THREE.Scene();
    normalBlitScene.add(normalBlitMesh);
    const depthBlitScene = new THREE.Scene();
    depthBlitScene.add(depthBlitMesh);
    let pbrBlitScene: THREE.Scene | undefined;
    if (pbrBlitMesh) {
      pbrBlitScene = new THREE.Scene();
      pbrBlitScene.add(pbrBlitMesh);
    }
    const blitCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    // Store original materials and create specialized materials
    const originalMaterials = new Map<
      THREE.Mesh,
      THREE.Material | THREE.Material[]
    >();
    sourceCopy.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        originalMaterials.set(node, node.material);
        node.frustumCulled = false;
        if (!node.geometry.hasAttribute("normal")) {
          node.geometry.computeVertexNormals();
        }
      }
    });

    // Unlit materials for albedo pass
    // Handle both single materials and material arrays (like colored cube with 6 face materials)
    const unlitMaterials = new Map<
      THREE.Mesh,
      THREE.Material | THREE.Material[]
    >();
    sourceCopy.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        const originalMat = node.material;

        if (Array.isArray(originalMat)) {
          // Handle material arrays - create unlit version for each
          const unlitMats = originalMat.map((mat) => {
            const color = this.extractColorFromMaterial(
              mat,
              new THREE.Color(0x888888),
            );
            const isStdMat =
              mat instanceof THREE.MeshStandardMaterial ||
              mat instanceof MeshStandardNodeMaterial;
            const hasMap = isStdMat && (mat as THREE.MeshStandardMaterial).map;

            const unlitMat = new MeshBasicNodeMaterial();
            unlitMat.color = new THREE.Color(hasMap ? 0xffffff : color);
            if (hasMap) unlitMat.map = (mat as THREE.MeshStandardMaterial).map;
            unlitMat.side = mat.side ?? THREE.FrontSide;
            unlitMat.transparent = mat.transparent;
            unlitMat.alphaTest = mat.alphaTest;
            unlitMat.opacity = mat.opacity;
            return unlitMat;
          });
          unlitMaterials.set(node, unlitMats);
        } else {
          // Single material
          const color = this.extractColorFromMaterial(
            originalMat,
            new THREE.Color(0x888888),
          );
          const isStdMat =
            originalMat instanceof THREE.MeshStandardMaterial ||
            originalMat instanceof MeshStandardNodeMaterial;
          const hasMap =
            isStdMat && (originalMat as THREE.MeshStandardMaterial).map;

          const unlitMat = new MeshBasicNodeMaterial();
          unlitMat.color = new THREE.Color(hasMap ? 0xffffff : color);
          if (hasMap)
            unlitMat.map = (originalMat as THREE.MeshStandardMaterial).map;
          unlitMat.side = originalMat.side ?? THREE.FrontSide;
          unlitMat.transparent = originalMat.transparent;
          unlitMat.alphaTest = originalMat.alphaTest;
          unlitMat.opacity = originalMat.opacity;

          unlitMaterials.set(node, unlitMat);
        }
      }
    });

    // Normal material
    const normalMaterial = new THREE.MeshNormalMaterial({
      side: THREE.DoubleSide,
      flatShading: false,
    });

    // Depth material - TSL for WebGPU
    const depthMaterial = createTSLDepthMaterial(nearPlane, farPlane);

    // PBR materials
    let pbrMaterials: Map<THREE.Mesh, THREE.Material> | undefined;
    if (pbrMode === PBRBakeMode.COMPLETE) {
      pbrMaterials = new Map();
      sourceCopy.traverse((node) => {
        if (node instanceof THREE.Mesh) {
          const originalMat = node.material;
          const singleMat = Array.isArray(originalMat)
            ? originalMat[0]
            : originalMat;
          let roughness = 0.8,
            metalness = 0.0,
            aoMapIntensity = 1.0;
          let roughnessMap: THREE.Texture | null = null,
            metalnessMap: THREE.Texture | null = null,
            aoMap: THREE.Texture | null = null;
          if (singleMat instanceof THREE.MeshStandardMaterial) {
            roughness = singleMat.roughness;
            metalness = singleMat.metalness;
            aoMapIntensity = singleMat.aoMapIntensity;
            roughnessMap = singleMat.roughnessMap;
            metalnessMap = singleMat.metalnessMap;
            aoMap = singleMat.aoMap;
          }
          const pbrMaterial = createTSLPBRMaterial(
            roughness,
            metalness,
            aoMapIntensity,
            roughnessMap,
            metalnessMap,
            aoMap,
          );
          pbrMaterial.side = singleMat.side ?? THREE.FrontSide;
          pbrMaterials!.set(node, pbrMaterial);
        }
      });
    }

    // Remove scene lights for albedo pass
    this.renderScene.remove(this.ambientLight);
    this.renderScene.remove(this.directionalLight);

    // Save autoClear state and disable it for blitting
    const originalAutoClear = webgpuRenderer.autoClear;
    webgpuRenderer.autoClear = false;

    // Render each cell using blit approach
    for (let rowIdx = 0; rowIdx <= numCellsY; rowIdx++) {
      for (let colIdx = 0; colIdx <= numCellsX; colIdx++) {
        const flatIdx = rowIdx * numCellsX + colIdx;
        if (flatIdx * 3 + 2 >= viewPoints.length) continue;

        const px = viewPoints[flatIdx * 3];
        const py = viewPoints[flatIdx * 3 + 1];
        const pz = viewPoints[flatIdx * 3 + 2];

        const viewDir = new THREE.Vector3(px, py, pz).normalize();
        this.renderCamera.position.copy(viewDir.clone().multiplyScalar(1.1));
        this.renderCamera.lookAt(0, 0, 0);
        this.renderCamera.near = nearPlane;
        this.renderCamera.far = farPlane;
        this.renderCamera.updateProjectionMatrix();

        // Calculate cell position in atlas (NDC)
        const cellW = 2 / numCellsX;
        const cellH = 2 / numCellsY;
        const ndcX = -1 + (colIdx + 0.5) * cellW;
        const ndcY = 1 - (rowIdx + 0.5) * cellH;

        // === ALBEDO PASS ===
        sourceCopy.traverse((node) => {
          if (node instanceof THREE.Mesh && unlitMaterials.has(node))
            node.material = unlitMaterials.get(node)!;
        });
        webgpuRenderer.setRenderTarget(colorCellTarget);
        webgpuRenderer.setClearColor(
          backgroundColor ?? 0x000000,
          backgroundAlpha ?? 0,
        );
        webgpuRenderer.clear();
        webgpuRenderer.render(this.renderScene, this.renderCamera);
        colorBlitMesh.position.set(ndcX, ndcY, 0);
        colorBlitMesh.scale.set(cellW / 2, cellH / 2, 1);
        webgpuRenderer.setRenderTarget(colorRenderTarget);
        webgpuRenderer.render(colorBlitScene, blitCam);

        // === NORMAL PASS ===
        sourceCopy.traverse((node) => {
          if (node instanceof THREE.Mesh) node.material = normalMaterial;
        });
        webgpuRenderer.setRenderTarget(normalCellTarget);
        webgpuRenderer.setClearColor(0x8080ff, 1);
        webgpuRenderer.clear();
        webgpuRenderer.render(this.renderScene, this.renderCamera);
        normalBlitMesh.position.set(ndcX, ndcY, 0);
        normalBlitMesh.scale.set(cellW / 2, cellH / 2, 1);
        webgpuRenderer.setRenderTarget(normalRenderTarget);
        webgpuRenderer.render(normalBlitScene, blitCam);

        // === DEPTH PASS ===
        sourceCopy.traverse((node) => {
          if (node instanceof THREE.Mesh) node.material = depthMaterial;
        });
        webgpuRenderer.setRenderTarget(depthCellTarget);
        webgpuRenderer.setClearColor(0xffffff, 0);
        webgpuRenderer.clear();
        webgpuRenderer.render(this.renderScene, this.renderCamera);
        depthBlitMesh.position.set(ndcX, ndcY, 0);
        depthBlitMesh.scale.set(cellW / 2, cellH / 2, 1);
        webgpuRenderer.setRenderTarget(depthRenderTarget);
        webgpuRenderer.render(depthBlitScene, blitCam);

        // === PBR PASS (if COMPLETE mode) ===
        if (
          pbrMaterials &&
          pbrCellTarget &&
          pbrBlitMesh &&
          pbrBlitScene &&
          pbrRenderTarget
        ) {
          sourceCopy.traverse((node) => {
            if (node instanceof THREE.Mesh && pbrMaterials!.has(node))
              node.material = pbrMaterials!.get(node)!;
          });
          webgpuRenderer.setRenderTarget(pbrCellTarget);
          webgpuRenderer.setClearColor(0xcc00ff, 0);
          webgpuRenderer.clear();
          webgpuRenderer.render(this.renderScene, this.renderCamera);
          pbrBlitMesh.position.set(ndcX, ndcY, 0);
          pbrBlitMesh.scale.set(cellW / 2, cellH / 2, 1);
          webgpuRenderer.setRenderTarget(pbrRenderTarget);
          webgpuRenderer.render(pbrBlitScene, blitCam);
        }
      }
    }

    // Restore autoClear
    webgpuRenderer.autoClear = originalAutoClear;

    // Restore scene lights
    this.renderScene.add(this.ambientLight);
    this.renderScene.add(this.directionalLight);

    // Restore tone mapping
    if (originalToneMapping !== undefined)
      renderer.toneMapping = originalToneMapping;
    if (originalToneMappingExposure !== undefined)
      renderer.toneMappingExposure = originalToneMappingExposure;

    // Restore renderer state
    this.renderer.setRenderTarget(originalRenderTarget);
    this.renderer.setPixelRatio(originalPixelRatio);

    // Clean up
    this.renderScene.remove(sourceCopy);
    sourceCopy.traverse((node) => {
      if (node instanceof THREE.Mesh) node.geometry?.dispose();
    });
    normalMaterial.dispose();
    depthMaterial.dispose();
    unlitMaterials.forEach((matOrArray: THREE.Material | THREE.Material[]) => {
      if (Array.isArray(matOrArray)) {
        matOrArray.forEach((m) => m.dispose());
      } else {
        matOrArray.dispose();
      }
    });
    pbrMaterials?.forEach((mat) => mat.dispose());
    colorCellTarget.dispose();
    normalCellTarget.dispose();
    depthCellTarget.dispose();
    pbrCellTarget?.dispose();
    colorBlitMat.dispose();
    normalBlitMat.dispose();
    depthBlitMat.dispose();
    pbrBlitMat?.dispose();
    blitGeo.dispose();

    // Ensure GPU operations complete
    this.renderer.setRenderTarget(null);
    if (this.renderer.renderAsync) {
      await this.renderer.renderAsync(new THREE.Scene(), this.renderCamera);
    }

    return {
      atlasTexture: colorRenderTarget.texture,
      renderTarget: colorRenderTarget,
      normalAtlasTexture: normalRenderTarget.texture,
      normalRenderTarget,
      depthAtlasTexture: depthRenderTarget.texture,
      depthRenderTarget,
      pbrAtlasTexture: pbrRenderTarget?.texture,
      pbrRenderTarget,
      gridSizeX,
      gridSizeY,
      octType,
      boundingSphere,
      boundingBox,
      octMeshData,
      depthNear: nearPlane,
      depthFar: farPlane,
      pbrMode,
    };
  }

  /**
   * Dispose of baker resources
   */
  dispose(): void {
    this.ambientLight.dispose();
    this.directionalLight.dispose();
  }
}
