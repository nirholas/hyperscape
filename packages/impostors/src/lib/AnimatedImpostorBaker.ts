/**
 * Animated Impostor Baker (WebGPU)
 *
 * Bakes animated meshes (walk cycles, etc.) into texture arrays for
 * low-overhead animation rendering at distance.
 *
 * Each animation frame is baked as a layer in a DataArrayTexture,
 * with the full octahedral sprite grid captured per frame.
 */

import * as THREE from "three/webgpu";
import type { AnimatedBakeConfig, AnimatedBakeResult } from "./types";
import { DEFAULT_ANIMATED_BAKE_CONFIG } from "./types";

/**
 * Renderer interface compatible with WebGPU renderer.
 * Uses loose typing for readRenderTargetPixelsAsync due to signature differences.
 */
export interface WebGPUCompatibleRenderer {
  render(scene: THREE.Scene, camera: THREE.Camera): void;
  setRenderTarget(target: THREE.RenderTarget | null): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getRenderTarget(): any;
  clear(color?: boolean, depth?: boolean, stencil?: boolean): void;
  setClearColor(color: THREE.ColorRepresentation, alpha?: number): void;
  // Pixel ratio methods
  getPixelRatio(): number;
  setPixelRatio(value: number): void;
  // Async pixel reading - signature varies, use loose typing
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readRenderTargetPixelsAsync(...args: unknown[]): Promise<unknown>;
  toneMapping?: number;
  toneMappingExposure?: number;
  autoClear?: boolean;
  outputColorSpace?: string;
}

/**
 * AnimatedImpostorBaker - Bakes animated meshes into texture arrays
 *
 * For each animation frame:
 * 1. Seek the animation to the target time
 * 2. Render the mesh from all octahedral view directions
 * 3. Store the result as a layer in the output DataArrayTexture
 *
 * The result can be used with AnimatedOctahedralImpostor or
 * InstancedAnimatedImpostor for efficient crowd rendering.
 */
export class AnimatedImpostorBaker {
  private renderer: WebGPUCompatibleRenderer;
  private renderScene: THREE.Scene;
  private renderCamera: THREE.OrthographicCamera;
  private ambientLight: THREE.AmbientLight;
  private directionalLight: THREE.DirectionalLight;

  constructor(renderer: WebGPUCompatibleRenderer) {
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

    // Setup lighting - brighter for good visibility
    this.ambientLight = new THREE.AmbientLight(0xffffff, 2.6);
    this.directionalLight = new THREE.DirectionalLight(0xffffff, 3.8);
    this.directionalLight.position.set(5, 10, 7.5);

    this.renderScene.add(this.ambientLight);
    this.renderScene.add(this.directionalLight);
  }

  /**
   * Generate octahedral view directions for hemisphere mapping
   * Returns array of normalized direction vectors
   */
  private generateOctahedralDirections(
    spritesPerSide: number,
    hemisphere: boolean,
  ): THREE.Vector3[] {
    const directions: THREE.Vector3[] = [];

    for (let row = 0; row < spritesPerSide; row++) {
      for (let col = 0; col < spritesPerSide; col++) {
        // Convert grid position to normalized coordinates [0, 1]
        const u = (col + 0.5) / spritesPerSide;
        const v = (row + 0.5) / spritesPerSide;

        let dir: THREE.Vector3;

        if (hemisphere) {
          // Hemisphere mapping: u,v in [0,1] maps to upper hemisphere
          // Convert to octahedral coordinates
          const ox = u * 2 - 1; // [-1, 1]
          const oz = v * 2 - 1; // [-1, 1]

          // Inverse hemisphere octahedral mapping
          const x = (ox + oz) * 0.5;
          const z = (oz - ox) * 0.5;
          const y = 1 - Math.abs(x) - Math.abs(z);

          dir = new THREE.Vector3(x, Math.max(0.001, y), z).normalize();
        } else {
          // Full sphere mapping
          const ox = u * 2 - 1;
          const oz = v * 2 - 1;

          let x = ox;
          let z = oz;
          let y = 1 - Math.abs(x) - Math.abs(z);

          if (y < 0) {
            // Lower hemisphere
            const signX = x >= 0 ? 1 : -1;
            const signZ = z >= 0 ? 1 : -1;
            x = (1 - Math.abs(oz)) * signX;
            z = (1 - Math.abs(ox)) * signZ;
          }

          dir = new THREE.Vector3(x, y, z).normalize();
        }

        directions.push(dir);
      }
    }

    return directions;
  }

  /**
   * Compute bounding box for a mesh or group, properly handling skinned meshes.
   * For SkinnedMesh, computes bounds from actual deformed vertex positions.
   */
  private computeBoundingBox(source: THREE.Object3D): THREE.Box3 {
    const box = new THREE.Box3();
    const tempBox = new THREE.Box3();
    const tempVec = new THREE.Vector3();

    source.updateWorldMatrix(true, true);

    source.traverse((node) => {
      if (node instanceof THREE.SkinnedMesh && node.geometry) {
        // For skinned meshes, compute bounding box from actual deformed vertices
        // This accounts for skeleton pose, not just bind pose
        const positionAttr = node.geometry.getAttribute("position");
        if (positionAttr) {
          // Update skeleton to ensure bones are in current pose
          if (node.skeleton) {
            node.skeleton.update();
          }

          // Sample vertices to compute deformed bounding box
          const skinnedVertex = new THREE.Vector3();
          tempBox.makeEmpty();

          for (let i = 0; i < positionAttr.count; i++) {
            tempVec.fromBufferAttribute(positionAttr, i);
            // Apply skinning to get the deformed position
            node.applyBoneTransform(i, skinnedVertex.copy(tempVec));
            // Apply world matrix
            skinnedVertex.applyMatrix4(node.matrixWorld);
            tempBox.expandByPoint(skinnedVertex);
          }

          if (!tempBox.isEmpty()) {
            box.union(tempBox);
          }
        }
      } else if (node instanceof THREE.Mesh && node.geometry) {
        // Regular mesh - use geometry bounding box
        node.geometry.computeBoundingBox();
        if (node.geometry.boundingBox) {
          tempBox.copy(node.geometry.boundingBox);
          tempBox.applyMatrix4(node.matrixWorld);
          box.union(tempBox);
        }
      }
    });

    // If box is still empty, fall back to default
    if (box.isEmpty()) {
      box.setFromCenterAndSize(
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(1, 1, 1),
      );
      console.warn(
        "[AnimatedImpostorBaker] Could not compute bounding box, using default",
      );
    }

    return box;
  }

  /**
   * Clone a material for baking (WebGL compatible)
   */
  private cloneMaterialForBaking(mat: THREE.Material): THREE.Material {
    if (mat instanceof THREE.MeshBasicMaterial) {
      const newMat = new THREE.MeshBasicMaterial();
      newMat.color = mat.color.clone();
      newMat.side = mat.side;
      newMat.transparent = mat.transparent;
      newMat.opacity = mat.opacity;
      newMat.alphaTest = mat.alphaTest;
      newMat.map = mat.map ?? null;
      return newMat;
    }

    if (mat instanceof THREE.MeshStandardMaterial) {
      const newMat = new THREE.MeshStandardMaterial();
      newMat.color = mat.color.clone();
      newMat.side = mat.side;
      newMat.roughness = mat.roughness;
      newMat.metalness = mat.metalness;
      newMat.transparent = mat.transparent;
      newMat.opacity = mat.opacity;
      newMat.alphaTest = mat.alphaTest;
      newMat.map = mat.map ?? null;
      return newMat;
    }

    // Default: gray standard material
    const defaultMat = new THREE.MeshStandardMaterial();
    defaultMat.color = new THREE.Color(0x888888);
    defaultMat.side = mat.side ?? THREE.FrontSide;
    defaultMat.roughness = 0.8;
    return defaultMat;
  }

  /**
   * Bake a walk cycle animation into a texture array
   *
   * @param source - The animated mesh (must have skeleton and AnimationMixer)
   * @param mixer - AnimationMixer controlling the animation
   * @param clip - AnimationClip for the walk cycle
   * @param modelId - Unique identifier for caching
   * @param config - Baking configuration
   * @returns AnimatedBakeResult with texture array
   */
  async bakeWalkCycle(
    source: THREE.Object3D,
    mixer: THREE.AnimationMixer,
    clip: THREE.AnimationClip,
    modelId: string,
    config: Partial<AnimatedBakeConfig> = {},
  ): Promise<AnimatedBakeResult> {
    const finalConfig: AnimatedBakeConfig = {
      ...DEFAULT_ANIMATED_BAKE_CONFIG,
      ...config,
      animationDuration: clip.duration,
    };

    const {
      atlasSize,
      spritesPerSide,
      animationFPS,
      animationDuration,
      hemisphere,
      backgroundColor,
      backgroundAlpha,
    } = finalConfig;

    // Calculate frame count from duration and FPS
    const frameCount = Math.max(1, Math.ceil(animationDuration * animationFPS));

    console.log(
      `[AnimatedImpostorBaker] Baking ${modelId}: ${frameCount} frames @ ${animationFPS}fps, ${spritesPerSide}x${spritesPerSide} sprites, ${atlasSize}px atlas`,
    );

    // Local alias for renderer - use type assertion for property access
    const renderer = this.renderer as WebGPUCompatibleRenderer & {
      toneMapping: number;
      toneMappingExposure: number;
    };

    // Save renderer state
    const originalPixelRatio = renderer.getPixelRatio();
    renderer.setPixelRatio(1);
    const originalRenderTarget = renderer.getRenderTarget();

    // Disable tone mapping for accurate color baking
    const originalToneMapping = renderer.toneMapping;
    const originalToneMappingExposure = renderer.toneMappingExposure;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.toneMappingExposure = 1.0;

    // Compute bounding box and sphere
    const boundingBox = this.computeBoundingBox(source);
    const boundingSphere = new THREE.Sphere();
    boundingBox.getBoundingSphere(boundingSphere);

    // Generate view directions
    const viewDirections = this.generateOctahedralDirections(
      spritesPerSide,
      hemisphere,
    );

    // Create WebGL render targets
    const cellSize = Math.floor(atlasSize / spritesPerSide);
    const cellRenderTarget = new THREE.RenderTarget(cellSize, cellSize, {
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      generateMipmaps: false,
    });

    const frameRenderTarget = new THREE.RenderTarget(atlasSize, atlasSize, {
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      generateMipmaps: false,
    });

    // Prepare blit material for copying cells to frame atlas
    const blitGeo = new THREE.PlaneGeometry(2, 2);
    const blitMat = new THREE.MeshBasicMaterial({
      map: cellRenderTarget.texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const blitMesh = new THREE.Mesh(blitGeo, blitMat);
    const blitScene = new THREE.Scene();
    blitScene.add(blitMesh);
    const blitCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    // Create an empty scene for initializing render targets
    // WebGPU requires render targets to go through render() to be properly registered
    const emptyScene = new THREE.Scene();
    const initCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    // Initialize render targets with a render pass (required for WebGPU)
    renderer.setRenderTarget(cellRenderTarget);
    renderer.setClearColor(0x000000, 0);
    renderer.render(emptyScene, initCam);
    renderer.setRenderTarget(frameRenderTarget);
    renderer.render(emptyScene, initCam);
    renderer.setRenderTarget(null);

    const originalAutoClear = renderer.autoClear;

    // Clone materials to avoid modifying originals
    const originalMaterials = new Map<
      THREE.Mesh,
      THREE.Material | THREE.Material[]
    >();
    source.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        originalMaterials.set(node, node.material);
        const mat = node.material;
        if (Array.isArray(mat)) {
          node.material = mat.map((m) => this.cloneMaterialForBaking(m));
        } else {
          node.material = this.cloneMaterialForBaking(mat);
        }
        node.frustumCulled = false;
      }
    });

    this.renderScene.add(source);

    // Center and scale source
    const center = boundingSphere.center.clone();
    const originalPosition = source.position.clone();
    const originalScale = source.scale.clone();

    source.position.set(-center.x, -center.y, -center.z);
    const radius = boundingSphere.radius * 1.5;
    const scaleFactor = 0.5 / radius;
    source.scale.multiplyScalar(scaleFactor);
    source.position.multiplyScalar(scaleFactor);

    // Create animation action
    const action = mixer.clipAction(clip);
    action.play();
    action.paused = true;

    // Storage for all frame data
    const frameDataArray: Uint8Array[] = [];

    // Bake each frame
    for (let frameIdx = 0; frameIdx < frameCount; frameIdx++) {
      // Seek animation to this frame's time
      const time = (frameIdx / frameCount) * animationDuration;
      action.time = time;
      mixer.setTime(time);
      mixer.update(0);

      // Force skeleton update
      source.traverse((node) => {
        if (node instanceof THREE.SkinnedMesh && node.skeleton) {
          node.skeleton.update();
        }
      });

      // Clear frame render target
      renderer.setRenderTarget(frameRenderTarget);
      renderer.setClearColor(backgroundColor ?? 0x000000, backgroundAlpha ?? 0);
      renderer.clear();

      renderer.autoClear = false;

      // Render each cell (view direction)
      for (let dirIdx = 0; dirIdx < viewDirections.length; dirIdx++) {
        const viewDir = viewDirections[dirIdx];
        const row = Math.floor(dirIdx / spritesPerSide);
        const col = dirIdx % spritesPerSide;

        // Position camera
        this.renderCamera.position.copy(viewDir.clone().multiplyScalar(1.1));
        this.renderCamera.lookAt(0, 0, 0);

        // Render to cell target
        renderer.setRenderTarget(cellRenderTarget);
        renderer.setClearColor(
          backgroundColor ?? 0x000000,
          backgroundAlpha ?? 0,
        );
        renderer.clear();
        renderer.render(this.renderScene, this.renderCamera);

        // Blit cell to frame atlas at correct position
        const cellW = 2 / spritesPerSide;
        const cellH = 2 / spritesPerSide;
        const ndcX = -1 + (col + 0.5) * cellW;
        const ndcY = 1 - (row + 0.5) * cellH; // Flip Y

        blitMesh.position.set(ndcX, ndcY, 0);
        blitMesh.scale.set(cellW / 2, cellH / 2, 1);

        renderer.setRenderTarget(frameRenderTarget);
        renderer.render(blitScene, blitCam);
      }

      // Read frame pixels (async for WebGPU)
      // WebGPU's readRenderTargetPixelsAsync returns the data directly (no buffer param)
      const pixelResult = await renderer.readRenderTargetPixelsAsync(
        frameRenderTarget,
        0,
        0,
        atlasSize,
        atlasSize,
      );

      // Convert result to Uint8Array (could be Float32Array for HDR targets)
      let pixels: Uint8Array;
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
      } else if (ArrayBuffer.isView(pixelResult)) {
        // Handle other typed arrays
        pixels = new Uint8Array((pixelResult as ArrayBufferView).buffer);
      } else {
        throw new Error(
          `[AnimatedImpostorBaker] Unexpected pixel result type: ${typeof pixelResult}`,
        );
      }
      frameDataArray.push(pixels);

      console.log(
        `[AnimatedImpostorBaker] Baked frame ${frameIdx + 1}/${frameCount}`,
      );
    }

    // Restore autoClear
    renderer.autoClear = originalAutoClear;

    // Create DataArrayTexture from frame data
    const totalPixels = atlasSize * atlasSize * 4 * frameCount;
    const mergedData = new Uint8Array(totalPixels);

    for (let i = 0; i < frameCount; i++) {
      const frameData = frameDataArray[i];
      const offset = i * atlasSize * atlasSize * 4;
      mergedData.set(frameData, offset);
    }

    // DataArrayTexture constructor accepts TypedArray
    const atlasArray = new THREE.DataArrayTexture(
      mergedData,
      atlasSize,
      atlasSize,
      frameCount,
    );
    atlasArray.format = THREE.RGBAFormat;
    atlasArray.type = THREE.UnsignedByteType;
    // Use LinearFilter to allow TSL to generate textureSample instead of textureLoad
    // This is required because WGSL textureLoad for texture_2d_array needs 4 params
    atlasArray.minFilter = THREE.LinearFilter;
    atlasArray.magFilter = THREE.LinearFilter;
    atlasArray.wrapS = THREE.ClampToEdgeWrapping;
    atlasArray.wrapT = THREE.ClampToEdgeWrapping;
    atlasArray.generateMipmaps = false;
    atlasArray.needsUpdate = true;

    // Cleanup
    action.stop();
    this.renderScene.remove(source);

    // Restore source state
    source.position.copy(originalPosition);
    source.scale.copy(originalScale);

    // Restore original materials
    source.traverse((node) => {
      if (node instanceof THREE.Mesh && originalMaterials.has(node)) {
        const clonedMat = node.material;
        node.material = originalMaterials.get(node)!;
        // Dispose cloned materials
        if (Array.isArray(clonedMat)) {
          clonedMat.forEach((m) => m.dispose());
        } else if (clonedMat instanceof THREE.Material) {
          clonedMat.dispose();
        }
      }
    });

    // Restore renderer state FIRST to flush GPU commands
    renderer.toneMapping = originalToneMapping;
    renderer.toneMappingExposure = originalToneMappingExposure;
    this.renderer.setRenderTarget(originalRenderTarget);
    this.renderer.setPixelRatio(originalPixelRatio);

    // Clear material references before disposing
    blitMat.map = null;
    blitMat.needsUpdate = true;

    // Now safe to dispose render resources
    blitGeo.dispose();
    blitMat.dispose();
    cellRenderTarget.dispose();
    frameRenderTarget.dispose();

    console.log(
      `[AnimatedImpostorBaker] Completed ${modelId}: ${frameCount} frames baked`,
    );

    return {
      atlasArray,
      frameCount,
      spritesPerSide,
      animationDuration,
      animationFPS,
      boundingSphere,
      modelId,
      hemisphere,
    };
  }

  /**
   * Bake a static idle frame (frame 0 of animation or T-pose)
   * This is used as the default display when not animating
   *
   * @param source - The mesh to bake
   * @param modelId - Unique identifier
   * @param config - Baking configuration
   * @returns AnimatedBakeResult with single frame
   */
  async bakeIdleFrame(
    source: THREE.Object3D,
    modelId: string,
    config: Partial<AnimatedBakeConfig> = {},
  ): Promise<AnimatedBakeResult> {
    const finalConfig: AnimatedBakeConfig = {
      ...DEFAULT_ANIMATED_BAKE_CONFIG,
      ...config,
      animationDuration: 0,
    };

    const {
      atlasSize,
      spritesPerSide,
      hemisphere,
      backgroundColor,
      backgroundAlpha,
    } = finalConfig;

    console.log(
      `[AnimatedImpostorBaker] Baking idle frame for ${modelId}: ${spritesPerSide}x${spritesPerSide} sprites, ${atlasSize}px atlas`,
    );

    // Local alias for renderer - use type assertion for property access
    const renderer = this.renderer as WebGPUCompatibleRenderer & {
      toneMapping: number;
      toneMappingExposure: number;
    };

    // Save renderer state
    const originalPixelRatio = renderer.getPixelRatio();
    renderer.setPixelRatio(1);
    const originalRenderTarget = renderer.getRenderTarget();

    // Disable tone mapping for accurate color baking
    const originalToneMapping = renderer.toneMapping;
    const originalToneMappingExposure = renderer.toneMappingExposure;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.toneMappingExposure = 1.0;

    // Compute bounding box and sphere
    const boundingBox = this.computeBoundingBox(source);
    const boundingSphere = new THREE.Sphere();
    boundingBox.getBoundingSphere(boundingSphere);

    // Generate view directions
    const viewDirections = this.generateOctahedralDirections(
      spritesPerSide,
      hemisphere,
    );

    // Create render targets
    const cellSize = Math.floor(atlasSize / spritesPerSide);
    const cellRenderTarget = new THREE.RenderTarget(cellSize, cellSize, {
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      generateMipmaps: false,
    });

    const frameRenderTarget = new THREE.RenderTarget(atlasSize, atlasSize, {
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      generateMipmaps: false,
    });

    // Prepare blit material
    const blitGeo = new THREE.PlaneGeometry(2, 2);
    const blitMat = new THREE.MeshBasicMaterial({
      map: cellRenderTarget.texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const blitMesh = new THREE.Mesh(blitGeo, blitMat);
    const blitScene = new THREE.Scene();
    blitScene.add(blitMesh);
    const blitCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    // Create an empty scene for initializing render targets
    // WebGPU requires render targets to go through render() to be properly registered
    const emptyScene = new THREE.Scene();
    const initCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    // Initialize render targets with a render pass (required for WebGPU)
    renderer.setRenderTarget(cellRenderTarget);
    renderer.setClearColor(0x000000, 0);
    renderer.render(emptyScene, initCam);
    renderer.setRenderTarget(frameRenderTarget);
    renderer.render(emptyScene, initCam);
    renderer.setRenderTarget(null);

    const originalAutoClear = renderer.autoClear;

    // Clone materials
    const originalMaterials = new Map<
      THREE.Mesh,
      THREE.Material | THREE.Material[]
    >();
    source.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        originalMaterials.set(node, node.material);
        const mat = node.material;
        if (Array.isArray(mat)) {
          node.material = mat.map((m) => this.cloneMaterialForBaking(m));
        } else {
          node.material = this.cloneMaterialForBaking(mat);
        }
        node.frustumCulled = false;
      }
    });

    this.renderScene.add(source);

    // Center and scale
    const center = boundingSphere.center.clone();
    const originalPosition = source.position.clone();
    const originalScale = source.scale.clone();

    source.position.set(-center.x, -center.y, -center.z);
    const scaleRadius = boundingSphere.radius * 1.5;
    const scaleFactor = 0.5 / scaleRadius;
    source.scale.multiplyScalar(scaleFactor);
    source.position.multiplyScalar(scaleFactor);

    // Clear frame render target
    renderer.setRenderTarget(frameRenderTarget);
    renderer.setClearColor(backgroundColor ?? 0x000000, backgroundAlpha ?? 0);
    renderer.clear();

    renderer.autoClear = false;

    // Render each cell
    for (let dirIdx = 0; dirIdx < viewDirections.length; dirIdx++) {
      const viewDir = viewDirections[dirIdx];
      const row = Math.floor(dirIdx / spritesPerSide);
      const col = dirIdx % spritesPerSide;

      this.renderCamera.position.copy(viewDir.clone().multiplyScalar(1.1));
      this.renderCamera.lookAt(0, 0, 0);

      renderer.setRenderTarget(cellRenderTarget);
      renderer.setClearColor(backgroundColor ?? 0x000000, backgroundAlpha ?? 0);
      renderer.clear();
      renderer.render(this.renderScene, this.renderCamera);

      const cellW = 2 / spritesPerSide;
      const cellH = 2 / spritesPerSide;
      const ndcX = -1 + (col + 0.5) * cellW;
      const ndcY = 1 - (row + 0.5) * cellH;

      blitMesh.position.set(ndcX, ndcY, 0);
      blitMesh.scale.set(cellW / 2, cellH / 2, 1);

      renderer.setRenderTarget(frameRenderTarget);
      renderer.render(blitScene, blitCam);
    }

    renderer.autoClear = originalAutoClear;

    // Read frame pixels (async for WebGPU)
    // WebGPU's readRenderTargetPixelsAsync returns the data directly (no buffer param)
    const pixelResult = await renderer.readRenderTargetPixelsAsync(
      frameRenderTarget,
      0,
      0,
      atlasSize,
      atlasSize,
    );

    // Convert result to Uint8Array (could be Float32Array for HDR targets)
    let frameData: Uint8Array;
    if (pixelResult instanceof Uint8Array) {
      // Copy to ensure we have a standard ArrayBuffer (not SharedArrayBuffer)
      frameData = new Uint8Array(pixelResult);
    } else if (pixelResult instanceof Float32Array) {
      // Convert float values (0-1) to uint8 (0-255)
      frameData = new Uint8Array(pixelResult.length);
      for (let i = 0; i < pixelResult.length; i++) {
        frameData[i] = Math.min(
          255,
          Math.max(0, Math.round(pixelResult[i] * 255)),
        );
      }
    } else if (ArrayBuffer.isView(pixelResult)) {
      // Handle other typed arrays - copy to new Uint8Array with standard ArrayBuffer
      const view = pixelResult as ArrayBufferView;
      frameData = new Uint8Array(view.byteLength);
      new Uint8Array(view.buffer, view.byteOffset, view.byteLength).forEach(
        (v, i) => {
          frameData[i] = v;
        },
      );
    } else {
      throw new Error(
        `[AnimatedImpostorBaker] Unexpected pixel result type: ${typeof pixelResult}`,
      );
    }

    // Create DataArrayTexture with single frame
    // Cast to BufferSource to satisfy TypeScript - we know this is a standard ArrayBuffer
    const atlasArray = new THREE.DataArrayTexture(
      frameData.buffer as ArrayBuffer,
      atlasSize,
      atlasSize,
      1,
    );
    atlasArray.format = THREE.RGBAFormat;
    atlasArray.type = THREE.UnsignedByteType;
    // Use LinearFilter to allow TSL to generate textureSample instead of textureLoad
    atlasArray.minFilter = THREE.LinearFilter;
    atlasArray.magFilter = THREE.LinearFilter;
    atlasArray.wrapS = THREE.ClampToEdgeWrapping;
    atlasArray.wrapT = THREE.ClampToEdgeWrapping;
    atlasArray.generateMipmaps = false;
    atlasArray.needsUpdate = true;

    // Cleanup
    this.renderScene.remove(source);
    source.position.copy(originalPosition);
    source.scale.copy(originalScale);

    source.traverse((node) => {
      if (node instanceof THREE.Mesh && originalMaterials.has(node)) {
        const clonedMat = node.material;
        node.material = originalMaterials.get(node)!;
        if (Array.isArray(clonedMat)) {
          clonedMat.forEach((m) => m.dispose());
        } else if (clonedMat instanceof THREE.Material) {
          clonedMat.dispose();
        }
      }
    });

    // Restore renderer state FIRST to flush GPU commands
    renderer.toneMapping = originalToneMapping;
    renderer.toneMappingExposure = originalToneMappingExposure;
    this.renderer.setRenderTarget(originalRenderTarget);
    this.renderer.setPixelRatio(originalPixelRatio);

    // Clear material references before disposing
    blitMat.map = null;
    blitMat.needsUpdate = true;

    // Now safe to dispose resources
    blitGeo.dispose();
    blitMat.dispose();
    cellRenderTarget.dispose();
    frameRenderTarget.dispose();

    return {
      atlasArray,
      frameCount: 1,
      spritesPerSide,
      animationDuration: 0,
      animationFPS: finalConfig.animationFPS,
      boundingSphere,
      modelId,
      hemisphere,
    };
  }

  /**
   * Dispose of resources
   */
  dispose(): void {
    this.renderScene.clear();
    this.ambientLight.dispose();
    this.directionalLight.dispose();
  }
}
