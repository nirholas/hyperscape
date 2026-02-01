/**
 * Instanced Animated Impostor (WebGPU)
 *
 * GPU-instanced rendering of animated octahedral impostors.
 * Supports multiple mob variants in a single draw call using the global mob atlas.
 *
 * Features:
 * - Single draw call for all mob impostors
 * - Per-instance: position, yaw, animation offset, variant, scale
 * - GPU-side billboarding and sprite selection via TSL
 * - Support for mixed mob types via variant index
 */

import {
  InstancedMesh,
  PlaneGeometry,
  MeshStandardNodeMaterial,
  Vector3,
  Matrix4,
} from "three/webgpu";
import {
  texture as textureNode,
  uniform,
  Fn,
  positionLocal,
  uv,
  cameraPosition,
  vec3,
  vec2,
  vec4,
  float,
  dot,
  normalize,
  cross,
  mix,
  step,
  floor,
  abs,
  sign,
  min,
  round,
  clamp,
  Discard,
  If,
  varying,
  storage,
  instanceIndex,
  sin,
  cos,
} from "three/tsl";
import { StorageInstancedBufferAttribute } from "three/webgpu";
import type { GlobalMobAtlas, MobVariantConfig } from "./types";

/**
 * Per-instance data for the instanced renderer
 */
export interface MobInstanceData {
  /** World position */
  position: Vector3;
  /** Yaw rotation in radians */
  yaw: number;
  /** Animation phase offset (0 to frameCount, for desync) */
  animationOffset: number;
  /** Variant index (which mob type) */
  variantIndex: number;
  /** Scale multiplier */
  scale: number;
  /** Whether this instance is visible */
  visible: boolean;
}

/**
 * Configuration for InstancedAnimatedImpostor
 */
export interface InstancedAnimatedImpostorConfig {
  /** Maximum number of instances */
  maxInstances: number;
  /** Global mob atlas containing all variants */
  atlas: GlobalMobAtlas;
  /** Base billboard scale (default: 1.0) */
  scale?: number;
  /** Alpha clamp threshold (default: 0.05) */
  alphaClamp?: number;
  /** Sprites per side in the atlas */
  spritesPerSide?: number;
  /** Use hemi-octahedron mapping */
  useHemiOctahedron?: boolean;
}

/**
 * Uniforms exposed by the instanced material
 */
export interface InstancedAnimatedUniforms {
  frameIndex: { value: number };
  globalScale: { value: number };
  alphaClamp: { value: number };
  spritesPerSide: { value: number };
}

const PLANE_GEOMETRY = new PlaneGeometry();

/**
 * InstancedAnimatedImpostor - GPU-instanced animated impostor rendering
 *
 * Uses WebGPU TSL with StorageInstancedBufferAttribute for efficient
 * crowd rendering with a single draw call.
 */
export class InstancedAnimatedImpostor extends InstancedMesh<
  PlaneGeometry,
  MeshStandardNodeMaterial
> {
  private _instanceStateStorage!: ReturnType<typeof storage>;
  private _instanceOffsetStorage!: ReturnType<typeof storage>;
  private _instanceVariantStorage!: ReturnType<typeof storage>;
  private _instanceFlagsStorage!: ReturnType<typeof storage>;
  private _variants: MobVariantConfig[];
  private _maxInstances: number;
  private _activeCount: number = 0;

  constructor(config: InstancedAnimatedImpostorConfig) {
    const material = new MeshStandardNodeMaterial();
    super(PLANE_GEOMETRY, material, config.maxInstances);

    this._maxInstances = config.maxInstances;
    // Convert Map to array for indexed access
    this._variants = Array.from(config.atlas.variants.values());

    // Create the TSL material with storage buffers
    this._setupMaterial(config);
    this.frustumCulled = false;
  }

  private _setupMaterial(config: InstancedAnimatedImpostorConfig): void {
    const material = this.material;
    material.transparent = true;
    material.metalness = 0.0;
    material.roughness = 0.7;

    const arrayTexture = config.atlas.atlasArray;
    const spritesPerSide = config.spritesPerSide ?? 16;
    const useHemiOct = config.useHemiOctahedron ?? true;

    // Uniforms
    const spritesPerSideUniform = uniform(spritesPerSide);
    const alphaClamp = uniform(config.alphaClamp ?? 0.05);
    const useHemiOctahedron = uniform(useHemiOct ? 1 : 0);
    const frameIndex = uniform(0);
    const globalScale = uniform(config.scale ?? 1);
    const flipYFlag = uniform(0);
    const yawSpriteOffset = uniform(0.0);

    // Build variant lookup arrays (inline constants like Horde does)
    const variantCounts: number[] = [];
    const variantBases: number[] = [];
    let baseFrame = 0;
    for (const v of this._variants) {
      variantCounts.push(v.frameCount);
      variantBases.push(baseFrame);
      baseFrame += v.frameCount;
    }

    // Storage buffers for per-instance state
    // State: vec4(x, y, z, yaw)
    this._instanceStateStorage = storage(
      new StorageInstancedBufferAttribute(this._maxInstances, 4),
    );
    // Animation offset: float
    this._instanceOffsetStorage = storage(
      new StorageInstancedBufferAttribute(
        new Float32Array(this._maxInstances),
        1,
      ),
    );
    // Variant: float (index into variants array)
    this._instanceVariantStorage = storage(
      new StorageInstancedBufferAttribute(
        new Float32Array(this._maxInstances),
        1,
      ),
    );
    // Flags: float (0 = visible, >=2 = hidden)
    this._instanceFlagsStorage = storage(
      new StorageInstancedBufferAttribute(
        new Float32Array(this._maxInstances),
        1,
      ),
    );

    // Varyings
    const vSprite = varying(vec2(), "vSprite");
    const vSpriteUV = varying(vec2(), "vSpriteUV");
    const vVariantIdx = varying(float(), "vVariantIdx");

    // Vertex: billboarding + octahedral sprite selection per instance
    material.positionNode = Fn(() => {
      const spritesMinusOne = vec2(spritesPerSideUniform.sub(1.0));

      // Read per-instance state
      const state = this._instanceStateStorage.element(instanceIndex);
      const instanceCenter = state.xyz;
      const yaw = state.w.add(yawSpriteOffset);
      const cameraPosWorldSpace = cameraPosition.sub(instanceCenter);

      // Transform camera to instance local space (inverse yaw)
      const cosYaw = cos(yaw);
      const sinYaw = sin(yaw);
      const camLocalX = cosYaw
        .mul(cameraPosWorldSpace.x)
        .add(sinYaw.mul(cameraPosWorldSpace.z));
      const camLocalZ = sinYaw
        .mul(-1.0)
        .mul(cameraPosWorldSpace.x)
        .add(cosYaw.mul(cameraPosWorldSpace.z));
      const cameraPosLocal = vec3(camLocalX, cameraPosWorldSpace.y, camLocalZ);

      const cameraDir = normalize(
        vec3(cameraPosLocal.x, cameraPosLocal.y, cameraPosLocal.z),
      );

      const up = vec3(0.0, 1.0, 0.0).toVar();
      If(useHemiOctahedron, () => {
        up.assign(mix(up, vec3(-1.0, 0.0, 0.0), step(0.999, cameraDir.y)));
      }).Else(() => {
        up.assign(mix(up, vec3(-1.0, 0.0, 0.0), step(0.999, cameraDir.y)));
        up.assign(mix(up, vec3(1.0, 0.0, 0.0), step(cameraDir.y, -0.999)));
      });

      // Billboard in world space
      const cameraDirWorld = normalize(
        vec3(
          cameraPosWorldSpace.x,
          cameraPosWorldSpace.y,
          cameraPosWorldSpace.z,
        ),
      );
      const tangent = normalize(cross(up, cameraDirWorld));
      const bitangent = cross(cameraDirWorld, tangent);

      // Get per-variant scale from variant storage (simplified: use globalScale)
      const varIdx = clamp(
        this._instanceVariantStorage.element(instanceIndex).x,
        float(0.0),
        float(this._variants.length - 1),
      );
      vVariantIdx.assign(varIdx);

      const finalScale = globalScale;
      const projectedVertex = tangent
        .mul(positionLocal.x.mul(finalScale))
        .add(bitangent.mul(positionLocal.y.mul(finalScale)))
        .add(instanceCenter);

      // Octahedral grid calculation
      const grid = vec2().toVar();
      If(useHemiOctahedron, () => {
        const octahedron = cameraDir.div(dot(cameraDir, sign(cameraDir)));
        grid.assign(
          vec2(octahedron.x.add(octahedron.z), octahedron.z.sub(octahedron.x))
            .add(1.0)
            .mul(0.5),
        );
      }).Else(() => {
        const dir = cameraDir.div(dot(abs(cameraDir), vec3(1.0))).toVar();
        If(dir.y.lessThan(0.0), () => {
          const signNotZero = mix(vec2(1.0), sign(dir.xz), step(0.0, dir.xz));
          const oldX = dir.x;
          dir.x.assign(float(1.0).sub(abs(dir.z)).mul(signNotZero.x));
          dir.z.assign(float(1.0).sub(abs(oldX)).mul(signNotZero.y));
        });
        grid.assign(dir.xz.mul(0.5).add(0.5));
      });

      const spriteGrid = grid.mul(spritesMinusOne);
      vSprite.assign(min(round(spriteGrid), spritesMinusOne));
      vSpriteUV.assign(uv());

      return vec4(projectedVertex, 1.0);
    })();

    // Fragment: sample array layer based on variant and frame
    material.colorNode = Fn(() => {
      // Check if hidden
      const flagVal = this._instanceFlagsStorage.element(instanceIndex).x;
      If(flagVal.greaterThanEqual(2.0), () => {
        Discard();
      });

      const frameSize = float(1.0).div(spritesPerSideUniform);
      const uvY = mix(vSpriteUV.y, float(1.0).sub(vSpriteUV.y), flipYFlag);
      const localUV = vec2(vSpriteUV.x, uvY);
      const spriteUV = frameSize.mul(
        vSprite.add(clamp(localUV, vec2(0), vec2(1))),
      );

      // Get animation offset and variant
      const instOff = this._instanceOffsetStorage.element(instanceIndex).x;
      const baseIdx = floor(frameIndex.add(instOff));
      const variantIdx = clamp(
        vVariantIdx,
        float(0.0),
        float(this._variants.length - 1),
      ).toInt();

      // Compute frame count and base for this variant (using conditional chains like Horde)
      const vCountSel = float(variantCounts[0] || 1).toVar();
      const vBaseSel = float(variantBases[0] || 0).toVar();

      for (let i = 1; i < this._variants.length; i++) {
        If(abs(float(i).sub(variantIdx)).lessThan(0.5), () => {
          vCountSel.assign(float(variantCounts[i] || 1));
          vBaseSel.assign(float(variantBases[i] || 0));
        });
      }

      // Wrap frame index within variant's frame count
      const divF = baseIdx.div(vCountSel);
      const fracF = divF.sub(floor(divF));
      const localIdx = floor(fracF.mul(vCountSel)).toInt();
      const finalIdx = vBaseSel.toInt().add(localIdx);

      // Sample texture array at computed layer
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sampleNode = (textureNode as any)(arrayTexture, spriteUV).depth(
        finalIdx,
      );
      const spriteColor = sampleNode;

      If(spriteColor.a.lessThanEqual(alphaClamp), () => {
        Discard();
      });

      return spriteColor;
    })();

    // Store uniforms for runtime updates
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (material as any).instancedAnimatedUniforms = {
      frameIndex,
      globalScale,
      alphaClamp,
      spritesPerSide: spritesPerSideUniform,
      yawSpriteOffset,
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (material as any).instanceStateStorage = this._instanceStateStorage;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (material as any).instanceOffsetStorage = this._instanceOffsetStorage;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (material as any).instanceVariantStorage = this._instanceVariantStorage;
  }

  /**
   * Set the current animation frame index
   */
  setFrame(value: number): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const uniforms = (this.material as any).instancedAnimatedUniforms;
    if (uniforms) {
      uniforms.frameIndex.value = value | 0;
    }
  }

  /**
   * Set the global scale multiplier
   */
  setScale(value: number): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const uniforms = (this.material as any).instancedAnimatedUniforms;
    if (uniforms) {
      uniforms.globalScale.value = value;
    }
  }

  /**
   * Set the alpha clamp threshold
   */
  setAlphaClamp(value: number): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const uniforms = (this.material as any).instancedAnimatedUniforms;
    if (uniforms) {
      uniforms.alphaClamp.value = value;
    }
  }

  /**
   * Set all instance data at once
   */
  setInstances(instances: MobInstanceData[]): void {
    const stateArr = this._instanceStateStorage.value.array as Float32Array;
    const offsetArr = this._instanceOffsetStorage.value.array as Float32Array;
    const variantArr = this._instanceVariantStorage.value.array as Float32Array;
    const flagsArr = this._instanceFlagsStorage.value.array as Float32Array;
    const identity = new Matrix4();

    const count = Math.min(instances.length, this._maxInstances);
    this._activeCount = count;

    for (let i = 0; i < count; i++) {
      const inst = instances[i];
      const idx = i * 4;

      stateArr[idx + 0] = inst.position.x;
      stateArr[idx + 1] = inst.position.y;
      stateArr[idx + 2] = inst.position.z;
      stateArr[idx + 3] = inst.yaw;

      offsetArr[i] = inst.animationOffset;
      variantArr[i] = inst.variantIndex;
      flagsArr[i] = inst.visible ? 0 : 2;

      // Identity matrix since GPU handles transforms
      this.setMatrixAt(i, identity);
    }

    // Mark remaining as hidden
    for (let i = count; i < this._maxInstances; i++) {
      flagsArr[i] = 2;
    }

    this._instanceStateStorage.value.needsUpdate = true;
    this._instanceOffsetStorage.value.needsUpdate = true;
    this._instanceVariantStorage.value.needsUpdate = true;
    this._instanceFlagsStorage.value.needsUpdate = true;
    this.instanceMatrix.needsUpdate = true;
  }

  /**
   * Update a single instance by index
   * @returns The index if successful, -1 if invalid
   */
  updateInstance(
    indexOrEntityId: number | string,
    data: Partial<MobInstanceData>,
  ): number {
    // Handle entityId (string) by looking up the index
    let index: number;
    if (typeof indexOrEntityId === "string") {
      const foundIndex = this._entityToIndex.get(indexOrEntityId);
      if (foundIndex === undefined) return -1;
      index = foundIndex;
    } else {
      index = indexOrEntityId;
    }

    if (index < 0 || index >= this._maxInstances) return -1;

    const stateArr = this._instanceStateStorage.value.array as Float32Array;
    const offsetArr = this._instanceOffsetStorage.value.array as Float32Array;
    const variantArr = this._instanceVariantStorage.value.array as Float32Array;
    const flagsArr = this._instanceFlagsStorage.value.array as Float32Array;

    const idx = index * 4;
    if (data.position) {
      stateArr[idx + 0] = data.position.x;
      stateArr[idx + 1] = data.position.y;
      stateArr[idx + 2] = data.position.z;
    }
    if (data.yaw !== undefined) {
      stateArr[idx + 3] = data.yaw;
    }
    if (data.animationOffset !== undefined) {
      offsetArr[index] = data.animationOffset;
    }
    if (data.variantIndex !== undefined) {
      variantArr[index] = data.variantIndex;
    }
    if (data.visible !== undefined) {
      flagsArr[index] = data.visible ? 0 : 2;
    }

    this._instanceStateStorage.value.needsUpdate = true;
    this._instanceOffsetStorage.value.needsUpdate = true;
    this._instanceVariantStorage.value.needsUpdate = true;
    this._instanceFlagsStorage.value.needsUpdate = true;
    return index;
  }

  /**
   * Randomize animation offsets to desync instances
   */
  randomizeAnimationOffsets(): void {
    const offsetArr = this._instanceOffsetStorage.value.array as Float32Array;
    const variantArr = this._instanceVariantStorage.value.array as Float32Array;

    for (let i = 0; i < this._maxInstances; i++) {
      const varIdx = Math.floor(variantArr[i]);
      const variant = this._variants[varIdx] || this._variants[0];
      const frameCount = variant?.frameCount ?? 1;
      offsetArr[i] = Math.floor(Math.random() * frameCount);
    }

    this._instanceOffsetStorage.value.needsUpdate = true;
  }

  /**
   * Get the number of active (visible) instances
   */
  get activeCount(): number {
    return this._activeCount;
  }

  /**
   * Alias for activeCount for API compatibility
   */
  get activeInstanceCount(): number {
    return this._activeCount;
  }

  /**
   * Get the maximum instance count
   */
  get maxInstances(): number {
    return this._maxInstances;
  }

  /**
   * Get the variants configuration
   */
  get variants(): MobVariantConfig[] {
    return this._variants;
  }

  // ============================================================================
  // INSTANCE MANAGEMENT API (for AnimatedImpostorManager compatibility)
  // ============================================================================

  /** Tracks entity ID to instance index mapping */
  private _entityToIndex: Map<string, number> = new Map();
  /** Next available instance index */
  private _nextFreeIndex: number = 0;

  /**
   * Add a new instance and return its slot index
   * @param entityId - Unique entity identifier
   * @param data - Instance data
   * @returns Slot index, or -1 if pool is full
   */
  addInstance(entityId: string, data: MobInstanceData): number {
    if (this._nextFreeIndex >= this._maxInstances) {
      return -1; // Pool full
    }

    const index = this._nextFreeIndex++;
    this._entityToIndex.set(entityId, index);
    this.updateInstance(index, data);
    this._activeCount++;
    return index;
  }

  /**
   * Remove an instance by entity ID
   * @param entityId - Entity identifier to remove
   * @returns true if removed, false if not found
   */
  removeInstance(entityId: string): boolean {
    const index = this._entityToIndex.get(entityId);
    if (index === undefined) return false;

    // Mark as hidden
    const flagsArr = this._instanceFlagsStorage.value.array as Float32Array;
    flagsArr[index] = 2;
    this._instanceFlagsStorage.value.needsUpdate = true;

    this._entityToIndex.delete(entityId);
    this._activeCount = Math.max(0, this._activeCount - 1);
    return true;
  }

  /**
   * Check if an instance exists for the given entity ID
   */
  hasInstance(entityId: string): boolean {
    return this._entityToIndex.has(entityId);
  }

  /**
   * Get instance index for an entity ID
   */
  getInstanceIndex(entityId: string): number | undefined {
    return this._entityToIndex.get(entityId);
  }
}
