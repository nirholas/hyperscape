import THREE from "../../extras/three/three";

export interface CSMOptions {
  mode?: string;
  maxCascades?: number;
  maxFar?: number;
  lightDirection?: THREE.Vector3;
  fade?: boolean;
  parent?: THREE.Scene;
  camera?: THREE.Camera;
  cascades?: number;
  shadowMapSize?: number;
  castShadow?: boolean;
  lightIntensity?: number;
  shadowBias?: number;
  shadowNormalBias?: number;
  lightNear?: number;
  lightFar?: number;
  lightMargin?: number;
  noLastCascadeCutOff?: boolean;
}

/**
 * Cascaded Shadow Maps (CSM) Implementation
 *
 * A simplified CSM implementation for Hyperscape that provides
 * basic shadow mapping functionality.
 */
export class CSM {
  public lightDirection: THREE.Vector3;
  public lights: THREE.DirectionalLight[] = [];

  private scene: THREE.Scene;
  private camera: THREE.Camera;
  private options: CSMOptions;
  private shadowCascades: number;
  private shadowMapSize: number;
  private maxFar: number;
  // Pre-allocated Vector3 for update() to avoid per-frame allocation
  private _cameraPosition = new THREE.Vector3();
  // Cached cascade distances - only recalculated when maxFar changes
  private _cascadeDistances: number[] = [];

  constructor(options: CSMOptions) {
    this.options = options;
    this.scene = options.parent || new THREE.Scene();
    this.camera = options.camera || new THREE.PerspectiveCamera();
    this.lightDirection = options.lightDirection || new THREE.Vector3(0, -1, 0);
    this.shadowCascades = options.cascades || 3;
    this.shadowMapSize = options.shadowMapSize || 2048;
    this.maxFar = options.maxFar || 100;
    // Calculate and cache distances once at construction
    this._cascadeDistances = this.calculateCascadeDistances();

    this.initializeLights();
  }

  private initializeLights(): void {
    // Get initial camera position for light placement
    const cameraPosition = new THREE.Vector3();
    this.camera.getWorldPosition(cameraPosition);

    // Create directional lights for shadow cascades
    for (let i = 0; i < this.shadowCascades; i++) {
      const light = new THREE.DirectionalLight(
        0xffffff,
        this.options.lightIntensity || 1,
      );

      // Get this cascade's coverage distance (using cached distances)
      const cascadeFar = this._cascadeDistances[i];

      // Configure shadow properties
      light.castShadow = this.options.castShadow ?? true;
      light.shadow.mapSize.width = this.shadowMapSize;
      light.shadow.mapSize.height = this.shadowMapSize;
      light.shadow.camera.near = this.options.lightNear || 0.1;
      light.shadow.camera.far = cascadeFar * 2; // Extra range for light height
      light.shadow.bias = this.options.shadowBias || -0.0001;
      light.shadow.normalBias = this.options.shadowNormalBias || 0.001;

      // Set light position relative to camera - height based on cascade size
      const lightHeight = cascadeFar;
      light.position
        .copy(this.lightDirection)
        .multiplyScalar(-lightHeight)
        .add(cameraPosition);
      light.target.position.copy(cameraPosition);

      // Configure shadow camera frustum based on cascade coverage
      // Use cascade distance to determine frustum size
      const d = cascadeFar * 0.8; // 80% of cascade distance for frustum half-width
      light.shadow.camera.left = -d;
      light.shadow.camera.right = d;
      light.shadow.camera.top = d;
      light.shadow.camera.bottom = -d;

      this.lights.push(light);
      this.scene.add(light);
      this.scene.add(light.target);
    }
  }

  /**
   * Calculate cascade split distances using practical split scheme
   * Each cascade covers progressively larger area
   */
  private calculateCascadeDistances(): number[] {
    const distances: number[] = [];
    const near = 0.5;
    const far = this.maxFar;
    const lambda = 0.5; // Blend between logarithmic and uniform split

    for (let i = 1; i <= this.shadowCascades; i++) {
      const ratio = i / this.shadowCascades;
      // Logarithmic split
      const logSplit = near * Math.pow(far / near, ratio);
      // Uniform split
      const uniformSplit = near + (far - near) * ratio;
      // Practical split (blend)
      const practicalSplit = lambda * logSplit + (1 - lambda) * uniformSplit;
      distances.push(practicalSplit);
    }

    return distances;
  }

  /**
   * Get the calculated cascade distances (for testing/debugging)
   */
  public get cascadeDistances(): readonly number[] {
    return this._cascadeDistances;
  }

  public update(): void {
    // Update light positions and shadow cameras to follow the camera
    // This ensures shadows are cast in the visible area around the player
    // Uses pre-allocated Vector3 to avoid per-frame allocation
    this.camera.getWorldPosition(this._cameraPosition);

    // Use cached cascade distances (recalculated only when maxFar changes)
    for (let i = 0; i < this.lights.length; i++) {
      const light = this.lights[i];
      if (light.castShadow) {
        // Position light above the camera position, offset in the light direction
        // Height based on cascade distance
        const cascadeFar = this._cascadeDistances[i];
        light.position
          .copy(this.lightDirection)
          .multiplyScalar(-cascadeFar)
          .add(this._cameraPosition);

        // Make light target follow camera too
        light.target.position.copy(this._cameraPosition);

        light.shadow.camera.updateProjectionMatrix();
      }
    }
  }

  public updateCascades(cascades: number): void {
    if (cascades === this.shadowCascades) return;

    // Remove existing lights
    this.dispose();

    // Update cascade count, recalculate distances, and recreate lights
    this.shadowCascades = cascades;
    this._cascadeDistances = this.calculateCascadeDistances();
    this.lights = [];
    this.initializeLights();
  }

  public updateShadowMapSize(size: number): void {
    if (size === this.shadowMapSize) return;

    this.shadowMapSize = size;

    for (const light of this.lights) {
      light.shadow.mapSize.width = size;
      light.shadow.mapSize.height = size;

      // Force shadow map regeneration
      if (light.shadow.map) {
        light.shadow.map.dispose();
        // NOTE: Don't set shadow.map = null - let Three.js handle it
        // Setting it to null causes WebGPU texture cache corruption
        // with dual-renderer setup (main + minimap share scene)
      }
    }
  }

  public updateFrustums(): void {
    // Update shadow camera frustums based on main camera
    for (const light of this.lights) {
      light.shadow.camera.updateProjectionMatrix();
    }
  }

  public setupMaterial(material: THREE.Material): void {
    // This would normally set up CSM-specific shader uniforms
    // For now, just ensure the material can receive shadows
    (material as THREE.Material & { shadowSide: THREE.Side }).shadowSide =
      THREE.BackSide;
  }

  public dispose(): void {
    for (const light of this.lights) {
      if (light.shadow.map) {
        light.shadow.map.dispose();
      }
      this.scene.remove(light);
      this.scene.remove(light.target);
    }
    this.lights = [];
  }
}
