import THREE from "../../extras/three/three";
import { CSMShadowNode } from "three/addons/csm/CSMShadowNode.js";

export interface CSMOptions {
  mode?: "practical" | "uniform" | "logarithmic" | "custom";
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
 * Uses Three.js's official CSMShadowNode for WebGPU which provides:
 * - True cascaded shadow maps with 3 cascades by default
 * - High resolution shadows near the camera, lower resolution far away
 * - Shader-level cascade selection (no banding between cascades)
 * - Optional fade blending between cascades for smooth transitions
 *
 * This is the proper solution for outdoor MMO games with a main sun directional light.
 */
export class CSM {
  public lightDirection: THREE.Vector3;
  public lights: THREE.DirectionalLight[] = [];

  /** The main directional light (sun) - provides illumination */
  public mainLight: THREE.DirectionalLight;

  /** The CSMShadowNode that handles cascaded shadow maps */
  public shadowNode: CSMShadowNode | null = null;

  private scene: THREE.Scene;
  private camera: THREE.Camera;
  private options: CSMOptions;
  private shadowCascades: number;
  private shadowMapSize: number;
  private maxFar: number;
  // Pre-allocated Vector3 for update() to avoid per-frame allocation
  private _cameraPosition = new THREE.Vector3();

  constructor(options: CSMOptions) {
    this.options = options;
    this.scene = options.parent || new THREE.Scene();
    this.camera = options.camera || new THREE.PerspectiveCamera();
    this.lightDirection = options.lightDirection || new THREE.Vector3(0, -1, 0);
    this.shadowCascades = options.cascades || 3;
    this.shadowMapSize = options.shadowMapSize || 2048;
    this.maxFar = options.maxFar || 100;

    // Create the main directional light first
    this.mainLight = this.createMainLight();

    this.initializeCSM();
  }

  /**
   * Create the main directional light (sun) for illumination
   */
  private createMainLight(): THREE.DirectionalLight {
    const cameraPosition = new THREE.Vector3();
    this.camera.getWorldPosition(cameraPosition);

    const light = new THREE.DirectionalLight(
      0xffffff,
      this.options.lightIntensity || 1,
    );

    // Position light based on direction
    const lightHeight = this.maxFar;
    light.position
      .copy(this.lightDirection)
      .multiplyScalar(-lightHeight)
      .add(cameraPosition);
    light.target.position.copy(cameraPosition);

    // Basic shadow settings (CSMShadowNode will override shadow behavior)
    light.castShadow = this.options.castShadow ?? true;

    this.scene.add(light);
    this.scene.add(light.target);
    this.lights.push(light);

    return light;
  }

  /**
   * Initialize CSMShadowNode for proper cascaded shadows
   */
  private initializeCSM(): void {
    if (!this.mainLight.castShadow) return;

    // Create CSMShadowNode attached to the main light
    // This provides true cascaded shadow maps with shader-level selection
    this.shadowNode = new CSMShadowNode(this.mainLight, {
      cascades: this.shadowCascades,
      maxFar: this.maxFar,
      mode:
        (this.options.mode as "practical" | "uniform" | "logarithmic") ||
        "practical",
      lightMargin: this.options.lightMargin || 200,
    });

    // Enable fade blending between cascades for smooth transitions
    this.shadowNode.fade = this.options.fade ?? true;

    // Configure the main light's shadow settings
    // CSMShadowNode will use these as a base for cascade shadows
    this.mainLight.shadow.mapSize.width = this.shadowMapSize;
    this.mainLight.shadow.mapSize.height = this.shadowMapSize;
    this.mainLight.shadow.bias = this.options.shadowBias ?? -0.0001;
    this.mainLight.shadow.normalBias = this.options.shadowNormalBias ?? 0.5;

    // Assign the CSM shadow node to the main light's shadow.shadowNode
    // This is the correct property for custom shadow nodes in WebGPU/TSL
    // The AnalyticLightNode checks light.shadow.shadowNode for custom shadow implementations
    (
      this.mainLight.shadow as THREE.DirectionalLightShadow & {
        shadowNode: CSMShadowNode;
      }
    ).shadowNode = this.shadowNode;
  }

  /**
   * Get the cascade lights (from CSMShadowNode's internal lights)
   */
  public get cascadeLights(): THREE.DirectionalLight[] {
    if (this.shadowNode && this.shadowNode.lights) {
      return this.shadowNode.lights as THREE.DirectionalLight[];
    }
    return this.lights;
  }

  public update(): void {
    // Update main light position to follow the camera
    this.camera.getWorldPosition(this._cameraPosition);

    const lightHeight = this.maxFar;
    this.mainLight.position
      .copy(this.lightDirection)
      .multiplyScalar(-lightHeight)
      .add(this._cameraPosition);
    this.mainLight.target.position.copy(this._cameraPosition);

    // CSMShadowNode handles cascade frustum updates automatically in updateBefore()
  }

  public updateCascades(cascades: number): void {
    if (cascades === this.shadowCascades) return;

    // Dispose and recreate CSM with new cascade count
    this.disposeCSM();
    this.shadowCascades = cascades;
    this.initializeCSM();
  }

  public updateShadowMapSize(size: number): void {
    if (size === this.shadowMapSize) return;
    this.shadowMapSize = size;

    // Update shadow map size on main light (CSMShadowNode clones this for cascades)
    this.mainLight.shadow.mapSize.width = size;
    this.mainLight.shadow.mapSize.height = size;

    if (this.mainLight.shadow.map) {
      this.mainLight.shadow.map.dispose();
    }

    // If cascade lights have been initialized, update them too
    if (this.shadowNode && this.shadowNode.lights) {
      for (const cascadeLight of this.shadowNode.lights) {
        const shadow = cascadeLight.shadow;
        if (shadow) {
          shadow.mapSize.width = size;
          shadow.mapSize.height = size;

          if (shadow.map) {
            shadow.map.dispose();
          }
        }
      }
    }
  }

  public updateFrustums(): void {
    // CSMShadowNode handles this automatically via updateBefore()
  }

  public setupMaterial(material: THREE.Material): void {
    // For WebGPU with CSMShadowNode, shadow integration is automatic
    // Just ensure material can receive shadows
    (material as THREE.Material & { shadowSide: THREE.Side }).shadowSide =
      THREE.BackSide;
  }

  private disposeCSM(): void {
    if (this.shadowNode) {
      this.shadowNode.dispose();
      this.shadowNode = null;
    }
  }

  public dispose(): void {
    this.disposeCSM();

    // Remove main light
    if (this.mainLight.shadow.map) {
      this.mainLight.shadow.map.dispose();
    }
    this.scene.remove(this.mainLight);
    this.scene.remove(this.mainLight.target);

    this.lights = [];
  }
}
