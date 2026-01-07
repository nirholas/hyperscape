import {
  Vector2,
  Vector3,
  DirectionalLight,
  MathUtils,
  ShaderChunk,
  Matrix4,
  Box3,
  Camera,
  Object3D,
  Material,
  PerspectiveCamera,
  WebGLRenderTarget,
} from "three";

/**
 * Material with defines support (used by CSM)
 */
type CSMMaterial = Material & {
  defines?: Record<string, string | number>;
};
import { CSMFrustum } from "./CSMFrustum";
import { CSMShader } from "./CSMShader";

const _cameraToLightMatrix = new Matrix4();
const _lightSpaceFrustum = new CSMFrustum({ webGL: true });
const _center = new Vector3();
const _origin = new Vector3();
const _bbox = new Box3();
const _uniformArray: number[] = [];
const _logArray: number[] = [];
const _lightOrientationMatrix = new Matrix4();
const _lightOrientationMatrixInverse = new Matrix4();
const _up = new Vector3(0, 1, 0);

export interface CSMOptions {
  camera: Camera;
  parent: Object3D;
  cascades?: number;
  maxFar?: number;
  mode?: "practical" | "uniform" | "logarithmic" | "custom";
  customSplitsCallback?: (
    cascades: number,
    near: number,
    far: number,
    breaks: number[],
  ) => void;
  shadowMapSize?: number;
  shadowBias?: number;
  lightDirection?: Vector3;
  lightIntensity?: number;
  lightNear?: number;
  lightFar?: number;
  lightMargin?: number;
  // Legacy options for backwards compatibility
  castShadow?: boolean;
  shadowNormalBias?: number;
  noLastCascadeCutOff?: boolean;
  fade?: boolean;
}

interface CSMShaderInfo {
  uniforms: {
    CSM_cascades: { value: Vector2[] };
    cameraNear: { value: number };
    shadowFar: { value: number };
  };
}

/**
 * An implementation of Cascade Shadow Maps (CSM).
 *
 * This module can only be used with WebGLRenderer. When using WebGPURenderer,
 * use CSMShadowNode instead.
 */
export class CSM {
  /**
   * The scene's camera.
   */
  public camera: Camera;

  /**
   * The parent object, usually the scene.
   */
  public parent: Object3D;

  /**
   * The number of cascades.
   */
  public cascades: number;

  /**
   * The maximum far value.
   */
  public maxFar: number;

  /**
   * The frustum split mode.
   */
  public mode: "practical" | "uniform" | "logarithmic" | "custom";

  /**
   * The shadow map size.
   */
  public shadowMapSize: number;

  /**
   * The shadow bias.
   */
  public shadowBias: number;

  /**
   * The light direction.
   */
  public lightDirection: Vector3;

  /**
   * The light intensity.
   */
  public lightIntensity: number;

  /**
   * The light near value.
   */
  public lightNear: number;

  /**
   * The light far value.
   */
  public lightFar: number;

  /**
   * The light margin.
   */
  public lightMargin: number;

  /**
   * Custom split callback when using `mode='custom'`.
   */
  public customSplitsCallback?: (
    cascades: number,
    near: number,
    far: number,
    breaks: number[],
  ) => void;

  /**
   * Whether to fade between cascades or not.
   */
  public fade: boolean = false;

  /**
   * The main frustum.
   */
  public mainFrustum: CSMFrustum;

  /**
   * An array of frustums representing the cascades.
   */
  public frustums: CSMFrustum[] = [];

  /**
   * An array of numbers in the range `[0,1]` that defines how the
   * mainCSM frustum should be split up.
   */
  public breaks: number[] = [];

  /**
   * An array of directional lights which cast the shadows for
   * the different cascades. There is one directional light for each
   * cascade.
   */
  public lights: DirectionalLight[] = [];

  /**
   * A Map holding enhanced material shaders.
   */
  public shaders: Map<CSMMaterial, CSMShaderInfo | null> = new Map();

  /**
   * Computed cascade distances (absolute values for each cascade boundary).
   * This is derived from breaks and maxFar.
   */
  public get cascadeDistances(): number[] {
    const camera = this.camera as PerspectiveCamera;
    const near = camera.near || 0.1;
    const far = Math.min(camera.far || 1000, this.maxFar);
    return this.breaks.map((b) => near + (far - near) * b);
  }

  /**
   * Constructs a new CSM instance.
   *
   * @param data - The CSM data.
   */
  constructor(data: CSMOptions) {
    this.camera = data.camera;
    this.parent = data.parent;
    this.cascades = data.cascades || 3;
    this.maxFar = data.maxFar || 100000;
    this.mode = data.mode || "practical";
    this.shadowMapSize = data.shadowMapSize || 2048;
    this.shadowBias = data.shadowBias || 0.000001;
    this.lightDirection =
      data.lightDirection || new Vector3(1, -1, 1).normalize();
    this.lightIntensity = data.lightIntensity || 3;
    this.lightNear = data.lightNear || 1;
    this.lightFar = data.lightFar || 2000;
    this.lightMargin = data.lightMargin || 200;
    this.customSplitsCallback = data.customSplitsCallback;
    this.fade = data.fade ?? false;

    this.mainFrustum = new CSMFrustum({ webGL: true });

    this._createLights(data.castShadow, data.shadowNormalBias);
    this.updateFrustums();
    this._injectInclude();
  }

  /**
   * Creates the directional lights of this CSM instance.
   *
   * @private
   */
  private _createLights(
    castShadow: boolean = true,
    shadowNormalBias?: number,
  ): void {
    for (let i = 0; i < this.cascades; i++) {
      const light = new DirectionalLight(0xffffff, this.lightIntensity);
      light.castShadow = castShadow;
      light.shadow.mapSize.width = this.shadowMapSize;
      light.shadow.mapSize.height = this.shadowMapSize;
      light.shadow.camera.near = this.lightNear;
      light.shadow.camera.far = this.lightFar;
      light.shadow.bias = this.shadowBias;

      if (shadowNormalBias !== undefined) {
        light.shadow.normalBias = shadowNormalBias;
      }

      this.parent.add(light);
      this.parent.add(light.target);

      this.lights.push(light);
    }
  }

  /**
   * Inits the cascades according to the scene's camera and breaks configuration.
   *
   * @private
   */
  private _initCascades(): void {
    const camera = this.camera as PerspectiveCamera;
    camera.updateProjectionMatrix();
    this.mainFrustum.setFromProjectionMatrix(
      camera.projectionMatrix,
      this.maxFar,
    );
    this.mainFrustum.split(this.breaks, this.frustums);
  }

  /**
   * Updates the shadow bounds of this CSM instance.
   *
   * @private
   */
  private _updateShadowBounds(): void {
    const frustums = this.frustums;
    for (let i = 0; i < frustums.length; i++) {
      const light = this.lights[i];
      const shadowCam = light.shadow.camera;
      const frustum = this.frustums[i];

      // Get the two points that represent the furthest points on the frustum assuming
      // that's either the diagonal across the far plane or the diagonal across the whole
      // frustum itself.
      const nearVerts = frustum.vertices.near;
      const farVerts = frustum.vertices.far;
      const point1 = farVerts[0];
      let point2: Vector3;

      if (point1.distanceTo(farVerts[2]) > point1.distanceTo(nearVerts[2])) {
        point2 = farVerts[2];
      } else {
        point2 = nearVerts[2];
      }

      let squaredBBWidth = point1.distanceTo(point2);

      if (this.fade) {
        // expand the shadow extents by the fade margin if fade is enabled.
        const camera = this.camera as PerspectiveCamera;
        const far = Math.max(camera.far, this.maxFar);
        const linearDepth = frustum.vertices.far[0].z / (far - camera.near);
        const margin = 0.25 * Math.pow(linearDepth, 2.0) * (far - camera.near);

        squaredBBWidth += margin;
      }

      shadowCam.left = -squaredBBWidth / 2;
      shadowCam.right = squaredBBWidth / 2;
      shadowCam.top = squaredBBWidth / 2;
      shadowCam.bottom = -squaredBBWidth / 2;
      shadowCam.updateProjectionMatrix();
    }
  }

  /**
   * Computes the breaks of this CSM instance based on the scene's camera, number of cascades
   * and the selected split mode.
   *
   * @private
   */
  private _getBreaks(): void {
    const camera = this.camera as PerspectiveCamera;
    const far = Math.min(camera.far, this.maxFar);

    this.breaks.length = 0;

    switch (this.mode) {
      case "uniform":
        uniformSplit(this.cascades, camera.near, far, this.breaks);
        break;

      case "logarithmic":
        logarithmicSplit(this.cascades, camera.near, far, this.breaks);
        break;

      case "practical":
        practicalSplit(this.cascades, camera.near, far, 0.5, this.breaks);
        break;

      case "custom":
        if (this.customSplitsCallback === undefined) {
          console.error("CSM: Custom split scheme callback not defined.");
        } else {
          this.customSplitsCallback(
            this.cascades,
            camera.near,
            far,
            this.breaks,
          );
        }
        break;
    }

    function uniformSplit(
      amount: number,
      near: number,
      far: number,
      target: number[],
    ): void {
      for (let i = 1; i < amount; i++) {
        target.push((near + ((far - near) * i) / amount) / far);
      }
      target.push(1);
    }

    function logarithmicSplit(
      amount: number,
      near: number,
      far: number,
      target: number[],
    ): void {
      for (let i = 1; i < amount; i++) {
        target.push((near * (far / near) ** (i / amount)) / far);
      }
      target.push(1);
    }

    function practicalSplit(
      amount: number,
      near: number,
      far: number,
      lambda: number,
      target: number[],
    ): void {
      _uniformArray.length = 0;
      _logArray.length = 0;
      logarithmicSplit(amount, near, far, _logArray);
      uniformSplit(amount, near, far, _uniformArray);

      for (let i = 1; i < amount; i++) {
        target.push(
          MathUtils.lerp(_uniformArray[i - 1], _logArray[i - 1], lambda),
        );
      }
      target.push(1);
    }
  }

  /**
   * Updates the CSM. This method must be called in your animation loop before
   * calling `renderer.render()`.
   */
  update(): void {
    const camera = this.camera as PerspectiveCamera;
    const frustums = this.frustums;

    // for each frustum we need to find its min-max box aligned with the light orientation
    // the position in _lightOrientationMatrix does not matter, as we transform there and back

    _lightOrientationMatrix.lookAt(_origin, this.lightDirection, _up);
    _lightOrientationMatrixInverse.copy(_lightOrientationMatrix).invert();

    for (let i = 0; i < frustums.length; i++) {
      const light = this.lights[i];
      const shadowCam = light.shadow.camera;
      const texelWidth =
        (shadowCam.right - shadowCam.left) / this.shadowMapSize;
      const texelHeight =
        (shadowCam.top - shadowCam.bottom) / this.shadowMapSize;
      _cameraToLightMatrix.multiplyMatrices(
        _lightOrientationMatrixInverse,
        camera.matrixWorld,
      );
      frustums[i].toSpace(_cameraToLightMatrix, _lightSpaceFrustum);

      const nearVerts = _lightSpaceFrustum.vertices.near;
      const farVerts = _lightSpaceFrustum.vertices.far;
      _bbox.makeEmpty();

      for (let j = 0; j < 4; j++) {
        _bbox.expandByPoint(nearVerts[j]);
        _bbox.expandByPoint(farVerts[j]);
      }

      _bbox.getCenter(_center);
      _center.z = _bbox.max.z + this.lightMargin;
      _center.x = Math.floor(_center.x / texelWidth) * texelWidth;
      _center.y = Math.floor(_center.y / texelHeight) * texelHeight;
      _center.applyMatrix4(_lightOrientationMatrix);

      light.position.copy(_center);
      light.target.position.copy(_center);

      light.target.position.x += this.lightDirection.x;
      light.target.position.y += this.lightDirection.y;
      light.target.position.z += this.lightDirection.z;
    }
  }

  /**
   * Injects the CSM shader enhancements into the built-in materials.
   *
   * @private
   */
  private _injectInclude(): void {
    ShaderChunk.lights_fragment_begin = CSMShader.lights_fragment_begin;
    ShaderChunk.lights_pars_begin = CSMShader.lights_pars_begin;
  }

  /**
   * Applications must call this method for all materials that should be affected by CSM.
   *
   * @param material - The material to setup for CSM support.
   */
  setupMaterial(material: CSMMaterial): void {
    material.defines = material.defines || {};
    material.defines.USE_CSM = 1;
    material.defines.CSM_CASCADES = this.cascades;

    if (this.fade) {
      material.defines.CSM_FADE = "";
    }

    const breaksVec2: Vector2[] = [];
    const scope = this;
    const shaders = this.shaders;

    material.onBeforeCompile = function (shader) {
      const far = Math.min(
        (scope.camera as PerspectiveCamera).far,
        scope.maxFar,
      );
      scope._getExtendedBreaks(breaksVec2);

      shader.uniforms.CSM_cascades = { value: breaksVec2 };
      shader.uniforms.cameraNear = {
        value: (scope.camera as PerspectiveCamera).near,
      };
      shader.uniforms.shadowFar = { value: far };

      shaders.set(material, {
        uniforms: {
          CSM_cascades: shader.uniforms.CSM_cascades as { value: Vector2[] },
          cameraNear: shader.uniforms.cameraNear as { value: number },
          shadowFar: shader.uniforms.shadowFar as { value: number },
        },
      });
    };

    shaders.set(material, null);
  }

  /**
   * Updates the CSM uniforms.
   *
   * @private
   */
  private _updateUniforms(): void {
    const far = Math.min((this.camera as PerspectiveCamera).far, this.maxFar);
    const shaders = this.shaders;

    shaders.forEach((shader, material) => {
      if (shader !== null) {
        const uniforms = shader.uniforms;
        this._getExtendedBreaks(uniforms.CSM_cascades.value);
        uniforms.cameraNear.value = (this.camera as PerspectiveCamera).near;
        uniforms.shadowFar.value = far;
      }

      if (material.defines) {
        if (!this.fade && "CSM_FADE" in material.defines) {
          delete material.defines.CSM_FADE;
          material.needsUpdate = true;
        } else if (this.fade && !("CSM_FADE" in material.defines)) {
          material.defines.CSM_FADE = "";
          material.needsUpdate = true;
        }
      }
    });
  }

  /**
   * Computes the extended breaks for the CSM uniforms.
   *
   * @private
   * @param target - The target array that holds the extended breaks.
   */
  private _getExtendedBreaks(target: Vector2[]): void {
    while (target.length < this.breaks.length) {
      target.push(new Vector2());
    }

    target.length = this.breaks.length;

    for (let i = 0; i < this.cascades; i++) {
      const amount = this.breaks[i];
      const prev = this.breaks[i - 1] || 0;
      target[i].x = prev;
      target[i].y = amount;
    }
  }

  /**
   * Applications must call this method every time they change camera or CSM settings.
   */
  updateFrustums(): void {
    this._getBreaks();
    this._initCascades();
    this._updateShadowBounds();
    this._updateUniforms();
  }

  /**
   * Updates the number of cascades, recreating lights as needed.
   *
   * @param cascades - The new number of cascades.
   */
  updateCascades(cascades: number): void {
    if (cascades === this.cascades) return;

    // Remove old lights
    this.remove();

    this.cascades = cascades;
    this.lights = [];
    this.frustums = [];
    this.breaks = [];

    this._createLights();
    this.updateFrustums();
  }

  /**
   * Updates the shadow map size for all cascade lights.
   *
   * @param size - The new shadow map size.
   */
  updateShadowMapSize(size: number): void {
    if (size === this.shadowMapSize) return;

    this.shadowMapSize = size;

    for (const light of this.lights) {
      light.shadow.mapSize.width = size;
      light.shadow.mapSize.height = size;

      if (light.shadow.map) {
        light.shadow.map.dispose();
        (light.shadow.map as WebGLRenderTarget | null) = null;
      }
    }
  }

  /**
   * Applications must call this method when they remove the CSM usage from their scene.
   */
  remove(): void {
    for (let i = 0; i < this.lights.length; i++) {
      this.parent.remove(this.lights[i].target);
      this.parent.remove(this.lights[i]);
    }
  }

  /**
   * Frees the GPU-related resources allocated by this instance. Call this
   * method whenever this instance is no longer used in your app.
   */
  dispose(): void {
    const shaders = this.shaders;

    shaders.forEach((shader, material) => {
      // Reset onBeforeCompile to empty function
      material.onBeforeCompile = () => {};

      // Clean up defines
      if (material.defines) {
        delete material.defines.USE_CSM;
        delete material.defines.CSM_CASCADES;
        delete material.defines.CSM_FADE;
      }

      if (shader !== null) {
        const uniforms = shader.uniforms as Record<
          string,
          { value: Vector2[] | number }
        >;
        delete uniforms.CSM_cascades;
        delete uniforms.cameraNear;
        delete uniforms.shadowFar;
      }

      material.needsUpdate = true;
    });

    shaders.clear();

    // Remove lights from scene
    this.remove();

    // Dispose shadow maps
    for (const light of this.lights) {
      if (light.shadow.map) {
        light.shadow.map.dispose();
      }
    }

    this.lights = [];
  }
}
