/**
 * GPU Culling Manager
 *
 * Provides GPU-accelerated frustum and distance culling for instanced rendering.
 * Designed to work alongside InstancedMeshManager, providing an optional GPU path
 * when WebGPU is available.
 *
 * ## Architecture
 * - CPU uploads instance matrices to GPU storage buffer (on add/remove only)
 * - GPU compute shader performs culling each frame
 * - GPU writes visible indices to output buffer
 * - Indirect draw uses GPU-generated instance count
 *
 * ## Integration
 * ```typescript
 * const cullingManager = new GPUCullingManager();
 * cullingManager.initializeFromRenderer(renderer);
 *
 * // Register instances (once per instance add/remove)
 * cullingManager.registerInstanceGroup('trees', matrices, boundingRadius);
 *
 * // Each frame
 * cullingManager.updateFrustum(camera);
 * cullingManager.cull('trees', cameraPosition, cullDistance);
 *
 * // Use indirect draw
 * mesh.geometry.setAttribute('instanceMatrix', cullingManager.getVisibleMatrixAttribute('trees'));
 * renderer.renderIndirect(scene, camera, cullingManager.getIndirectBuffer('trees'));
 * ```
 */

import THREE from "../../extras/three/three";
import {
  RuntimeComputeContext,
  isWebGPUAvailable,
} from "./RuntimeComputeContext";
import {
  CULLING_SIMD_SHADER,
  RESET_DRAW_PARAMS_SHADER,
} from "./shaders/culling.wgsl";

// ============================================================================
// TYPES
// ============================================================================

export interface CullingGroupConfig {
  /** Maximum number of instances */
  maxInstances: number;
  /** Bounding radius for frustum culling */
  boundingRadius: number;
  /** Cull distance (meters) */
  cullDistance: number;
  /** Uncull distance for hysteresis (optional, defaults to cullDistance * 0.9) */
  uncullDistance?: number;
}

export interface CullingGroup {
  config: CullingGroupConfig;
  /** All instance matrices (CPU side) */
  matrices: Float32Array;
  /** Current instance count */
  instanceCount: number;
  /** GPU instance buffer */
  instanceBuffer: GPUBuffer | null;
  /** GPU visible indices buffer */
  visibleIndicesBuffer: GPUBuffer | null;
  /** GPU indirect draw buffer */
  indirectBuffer: GPUBuffer | null;
  /** GPU uniform buffer for params */
  paramsBuffer: GPUBuffer | null;
  /** Whether GPU buffers need sync */
  dirty: boolean;
  /** Bind group for culling */
  bindGroup: GPUBindGroup | null;
}

export interface FrustumData {
  planes: Float32Array; // 6 planes × 4 floats = 24 floats
}

// ============================================================================
// GPU CULLING MANAGER
// ============================================================================

/**
 * Manages GPU-accelerated culling for multiple instance groups.
 */
export class GPUCullingManager {
  private context: RuntimeComputeContext;
  private groups: Map<string, CullingGroup> = new Map();
  private cullingPipeline: GPUComputePipeline | null = null;
  private resetPipeline: GPUComputePipeline | null = null;
  private frustumBuffer: GPUBuffer | null = null;
  private frustumData: Float32Array = new Float32Array(24);
  private paramsData: Float32Array = new Float32Array(16); // CullParams struct
  private initialized = false;

  // Pre-allocated matrices for frustum extraction
  private _projScreenMatrix = new THREE.Matrix4();
  private _frustum = new THREE.Frustum();

  constructor() {
    this.context = new RuntimeComputeContext();
  }

  // ==========================================================================
  // INITIALIZATION
  // ==========================================================================

  /**
   * Initialize from Three.js WebGPU renderer.
   * Returns false if WebGPU is not available.
   */
  initializeFromRenderer(renderer: THREE.WebGPURenderer): boolean {
    if (!this.context.initializeFromRenderer(renderer)) {
      console.warn(
        "[GPUCullingManager] WebGPU not available, using CPU fallback",
      );
      return false;
    }

    // Create pipelines
    // Use SIMD-optimized culling shader for better performance
    this.cullingPipeline = this.context.createPipeline({
      label: "InstanceCullingSIMD",
      code: CULLING_SIMD_SHADER,
      entryPoint: "main",
    });

    this.resetPipeline = this.context.createPipeline({
      label: "ResetDrawParams",
      code: RESET_DRAW_PARAMS_SHADER,
      entryPoint: "main",
    });

    // Create frustum planes buffer
    this.frustumBuffer = this.context.createBuffer({
      label: "FrustumPlanes",
      size: 24 * 4, // 6 planes × 4 floats × 4 bytes
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.initialized =
      this.cullingPipeline !== null && this.resetPipeline !== null;
    return this.initialized;
  }

  /**
   * Check if GPU culling is available.
   */
  isAvailable(): boolean {
    return this.initialized && this.context.isReady();
  }

  // ==========================================================================
  // GROUP MANAGEMENT
  // ==========================================================================

  /**
   * Register a new instance group for GPU culling.
   */
  registerGroup(name: string, config: CullingGroupConfig): void {
    if (this.groups.has(name)) {
      console.warn(`[GPUCullingManager] Group "${name}" already registered`);
      return;
    }

    const group: CullingGroup = {
      config: {
        ...config,
        uncullDistance: config.uncullDistance ?? config.cullDistance * 0.9,
      },
      matrices: new Float32Array(config.maxInstances * 16), // mat4 = 16 floats
      instanceCount: 0,
      instanceBuffer: null,
      visibleIndicesBuffer: null,
      indirectBuffer: null,
      paramsBuffer: null,
      dirty: true,
      bindGroup: null,
    };

    // Create GPU buffers if initialized
    if (this.initialized) {
      this.createGroupBuffers(name, group);
    }

    this.groups.set(name, group);
  }

  /**
   * Create GPU buffers for a group.
   */
  private createGroupBuffers(name: string, group: CullingGroup): void {
    const device = this.context.getDevice();
    if (!device) return;

    const maxInstances = group.config.maxInstances;

    // Instance transforms buffer (mat4 per instance)
    group.instanceBuffer = this.context.createBuffer({
      label: `${name}_instances`,
      size: maxInstances * 16 * 4, // mat4 = 16 floats × 4 bytes
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    // Visible indices buffer
    group.visibleIndicesBuffer = this.context.createBuffer({
      label: `${name}_visibleIndices`,
      size: maxInstances * 4, // u32 per instance
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });

    // Indirect draw buffer (DrawIndirectParams struct)
    group.indirectBuffer = this.context.createBuffer({
      label: `${name}_indirect`,
      size: 16, // 4 × u32
      usage:
        GPUBufferUsage.INDIRECT |
        GPUBufferUsage.STORAGE |
        GPUBufferUsage.COPY_DST,
    });

    // Parameters uniform buffer (CullParams struct)
    group.paramsBuffer = this.context.createBuffer({
      label: `${name}_params`,
      size: 64, // CullParams struct with padding
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
  }

  /**
   * Unregister a group and free GPU resources.
   */
  unregisterGroup(name: string): void {
    const group = this.groups.get(name);
    if (!group) return;

    group.instanceBuffer?.destroy();
    group.visibleIndicesBuffer?.destroy();
    group.indirectBuffer?.destroy();
    group.paramsBuffer?.destroy();

    this.groups.delete(name);
  }

  // ==========================================================================
  // INSTANCE MANAGEMENT
  // ==========================================================================

  /**
   * Set instance matrices for a group.
   * Call this when instances are added/removed or transforms change.
   */
  setInstances(name: string, matrices: Float32Array, count: number): void {
    const group = this.groups.get(name);
    if (!group) {
      console.warn(`[GPUCullingManager] Group "${name}" not found`);
      return;
    }

    // Copy matrices to group
    group.matrices.set(
      matrices.subarray(0, Math.min(count * 16, group.matrices.length)),
    );
    group.instanceCount = count;
    group.dirty = true;
  }

  /**
   * Update a single instance matrix.
   */
  updateInstance(name: string, index: number, matrix: THREE.Matrix4): void {
    const group = this.groups.get(name);
    if (!group || index >= group.config.maxInstances) return;

    matrix.toArray(group.matrices, index * 16);
    group.dirty = true;
  }

  /**
   * Sync dirty instance buffers to GPU.
   */
  private syncBuffers(name: string): void {
    const group = this.groups.get(name);
    if (!group || !group.dirty || !group.instanceBuffer) return;

    this.context.uploadToBuffer(
      group.instanceBuffer,
      group.matrices.subarray(0, group.instanceCount * 16),
    );
    group.dirty = false;
  }

  // ==========================================================================
  // CULLING OPERATIONS
  // ==========================================================================

  /**
   * Update frustum planes from camera.
   * Call once per frame before culling.
   */
  updateFrustum(camera: THREE.Camera): void {
    // Ensure camera matrices are up to date
    camera.updateMatrixWorld();
    (camera as THREE.PerspectiveCamera).updateProjectionMatrix?.();

    // Extract frustum from projection-view matrix
    this._projScreenMatrix.multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse,
    );
    this._frustum.setFromProjectionMatrix(this._projScreenMatrix);

    // Copy frustum planes to buffer
    for (let i = 0; i < 6; i++) {
      const plane = this._frustum.planes[i];
      this.frustumData[i * 4 + 0] = plane.normal.x;
      this.frustumData[i * 4 + 1] = plane.normal.y;
      this.frustumData[i * 4 + 2] = plane.normal.z;
      this.frustumData[i * 4 + 3] = plane.constant;
    }

    // Upload to GPU
    if (this.frustumBuffer) {
      this.context.uploadToBuffer(this.frustumBuffer, this.frustumData);
    }
  }

  /**
   * Prepare a group for culling (upload params, ensure bind group exists).
   * Returns the bind group if ready, null otherwise.
   */
  private prepareGroupForCulling(
    name: string,
    group: CullingGroup,
    cameraPosition: THREE.Vector3,
  ): GPUBindGroup | null {
    if (!group.instanceBuffer || !group.indirectBuffer || !group.paramsBuffer)
      return null;
    if (group.instanceCount === 0) return null;

    // Sync any dirty buffers
    this.syncBuffers(name);

    // Update parameters
    const params = this.paramsData;
    params[0] = cameraPosition.x;
    params[1] = cameraPosition.y;
    params[2] = cameraPosition.z;
    params[3] = 0; // padding

    params[4] = group.config.cullDistance * group.config.cullDistance;
    params[5] =
      (group.config.uncullDistance ?? group.config.cullDistance * 0.9) ** 2;
    params[6] = group.config.boundingRadius;
    const dataView = new DataView(params.buffer);
    dataView.setUint32(7 * 4, group.instanceCount, true);

    this.context.uploadToBuffer(group.paramsBuffer, params);

    // Reset indirect draw params
    this.resetIndirectBuffer(group);

    // Create bind group if needed
    if (!group.bindGroup && this.cullingPipeline && this.frustumBuffer) {
      group.bindGroup = this.context.createBindGroup(
        this.cullingPipeline,
        [
          { binding: 0, resource: { buffer: group.instanceBuffer } },
          { binding: 1, resource: { buffer: this.frustumBuffer } },
          { binding: 2, resource: { buffer: group.paramsBuffer } },
          { binding: 3, resource: { buffer: group.visibleIndicesBuffer! } },
          { binding: 4, resource: { buffer: group.indirectBuffer } },
        ],
        `${name}_cullBindGroup`,
      );
    }

    return group.bindGroup;
  }

  /**
   * Perform GPU culling for a group.
   * Returns immediately; GPU work runs asynchronously.
   */
  cull(name: string, cameraPosition: THREE.Vector3): void {
    const group = this.groups.get(name);
    if (!group || !this.initialized) return;

    const bindGroup = this.prepareGroupForCulling(name, group, cameraPosition);
    if (!bindGroup || !this.cullingPipeline) return;

    this.context.dispatch({
      pipeline: this.cullingPipeline,
      bindGroup,
      workgroupCount: this.context.calculateWorkgroupCount(
        group.instanceCount,
        64,
      ),
    });
  }

  /**
   * Perform GPU culling for all registered groups in a single command buffer.
   * More efficient than calling cull() for each group separately.
   */
  cullAll(cameraPosition: THREE.Vector3): void {
    if (!this.initialized || !this.cullingPipeline) return;

    const device = this.context.getDevice();
    if (!device) return;

    // Collect dispatch configs for all groups
    const dispatches: Array<{
      bindGroup: GPUBindGroup;
      workgroupCount: number;
    }> = [];

    for (const [name, group] of this.groups) {
      const bindGroup = this.prepareGroupForCulling(
        name,
        group,
        cameraPosition,
      );
      if (bindGroup && group.instanceCount > 0) {
        dispatches.push({
          bindGroup,
          workgroupCount: this.context.calculateWorkgroupCount(
            group.instanceCount,
            64,
          ),
        });
      }
    }

    if (dispatches.length === 0) return;

    // Single command buffer for all groups
    const encoder = device.createCommandEncoder({
      label: "CullAllGroups",
    });

    for (const { bindGroup, workgroupCount } of dispatches) {
      const pass = encoder.beginComputePass();
      pass.setPipeline(this.cullingPipeline);
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(workgroupCount);
      pass.end();
    }

    device.queue.submit([encoder.finish()]);
  }

  /**
   * Perform GPU culling for specific groups in a single command buffer.
   */
  cullGroups(groupNames: string[], cameraPosition: THREE.Vector3): void {
    if (!this.initialized || !this.cullingPipeline) return;

    const device = this.context.getDevice();
    if (!device) return;

    const dispatches: Array<{
      bindGroup: GPUBindGroup;
      workgroupCount: number;
    }> = [];

    for (const name of groupNames) {
      const group = this.groups.get(name);
      if (!group) continue;

      const bindGroup = this.prepareGroupForCulling(
        name,
        group,
        cameraPosition,
      );
      if (bindGroup && group.instanceCount > 0) {
        dispatches.push({
          bindGroup,
          workgroupCount: this.context.calculateWorkgroupCount(
            group.instanceCount,
            64,
          ),
        });
      }
    }

    if (dispatches.length === 0) return;

    const encoder = device.createCommandEncoder({
      label: "CullSelectedGroups",
    });

    for (const { bindGroup, workgroupCount } of dispatches) {
      const pass = encoder.beginComputePass();
      pass.setPipeline(this.cullingPipeline);
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(workgroupCount);
      pass.end();
    }

    device.queue.submit([encoder.finish()]);
  }

  /**
   * Reset indirect draw buffer before culling.
   */
  private resetIndirectBuffer(group: CullingGroup): void {
    if (!group.indirectBuffer) return;

    // Write initial values: [vertexCount=0, instanceCount=0, firstVertex=0, firstInstance=0]
    const resetData = new Uint32Array([0, 0, 0, 0]);
    this.context.uploadToBuffer(group.indirectBuffer, resetData);
  }

  // ==========================================================================
  // RESULT ACCESS
  // ==========================================================================

  /**
   * Get the indirect draw buffer for a group.
   * Use with renderer.renderIndirect() or pass to Three.js indirect draw.
   */
  getIndirectBuffer(name: string): GPUBuffer | null {
    return this.groups.get(name)?.indirectBuffer ?? null;
  }

  /**
   * Get the visible indices buffer for a group.
   * Contains indices of visible instances after culling.
   */
  getVisibleIndicesBuffer(name: string): GPUBuffer | null {
    return this.groups.get(name)?.visibleIndicesBuffer ?? null;
  }

  /**
   * Get the instance buffer for a group.
   * Contains all instance matrices.
   */
  getInstanceBuffer(name: string): GPUBuffer | null {
    return this.groups.get(name)?.instanceBuffer ?? null;
  }

  /**
   * Read back visible instance count (async, for debugging).
   * In production, use indirect draw instead.
   */
  async getVisibleCount(name: string): Promise<number> {
    const group = this.groups.get(name);
    if (!group?.indirectBuffer) return 0;

    const data = await this.context.readUint32Buffer(group.indirectBuffer, 4);
    return data[1]; // instanceCount is at index 1
  }

  // ==========================================================================
  // CLEANUP
  // ==========================================================================

  /**
   * Destroy all resources.
   */
  destroy(): void {
    for (const name of this.groups.keys()) {
      this.unregisterGroup(name);
    }
    this.groups.clear();

    this.frustumBuffer?.destroy();
    this.frustumBuffer = null;

    this.context.destroy();
    this.initialized = false;
  }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Check if GPU culling should be used.
 * Returns true if WebGPU is available and the renderer supports it.
 */
export function shouldUseGPUCulling(renderer: THREE.Renderer): boolean {
  if (!isWebGPUAvailable()) return false;

  // Check if renderer is WebGPU
  const rendererAny = renderer as THREE.WebGPURenderer & {
    isWebGPURenderer?: boolean;
  };
  return rendererAny.isWebGPURenderer === true;
}

/**
 * Convert Three.js Matrix4 array to Float32Array for GPU upload.
 */
export function matricesToFloat32Array(
  matrices: THREE.Matrix4[],
  output?: Float32Array,
): Float32Array {
  const result = output ?? new Float32Array(matrices.length * 16);
  for (let i = 0; i < matrices.length; i++) {
    matrices[i].toArray(result, i * 16);
  }
  return result;
}

/**
 * Create a culling manager singleton for the world.
 */
let globalCullingManager: GPUCullingManager | null = null;

export function getGlobalCullingManager(): GPUCullingManager {
  if (!globalCullingManager) {
    globalCullingManager = new GPUCullingManager();
  }
  return globalCullingManager;
}
