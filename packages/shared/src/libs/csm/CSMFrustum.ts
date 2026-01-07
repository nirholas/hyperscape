import { Vector3, Matrix4 } from "three";

const inverseProjectionMatrix = new Matrix4();

export interface CSMFrustumData {
  webGL?: boolean;
  projectionMatrix?: Matrix4;
  maxFar?: number;
}

export interface FrustumVertices {
  near: [Vector3, Vector3, Vector3, Vector3];
  far: [Vector3, Vector3, Vector3, Vector3];
}

/**
 * Represents the frustum of a CSM instance.
 */
export class CSMFrustum {
  /**
   * The zNear value. This value depends on whether the CSM
   * is used with WebGL or WebGPU. Both API use different
   * conventions for their projection matrices.
   */
  public zNear: number;

  /**
   * An object representing the vertices of the near and
   * far plane in view space.
   */
  public vertices: FrustumVertices;

  /**
   * Constructs a new CSM frustum.
   *
   * @param data - The CSM data.
   */
  constructor(data?: CSMFrustumData) {
    data = data || {};

    this.zNear = data.webGL === true ? -1 : 0;

    this.vertices = {
      near: [new Vector3(), new Vector3(), new Vector3(), new Vector3()],
      far: [new Vector3(), new Vector3(), new Vector3(), new Vector3()],
    };

    if (data.projectionMatrix !== undefined) {
      this.setFromProjectionMatrix(data.projectionMatrix, data.maxFar || 10000);
    }
  }

  /**
   * Setups this CSM frustum from the given projection matrix and max far value.
   *
   * @param projectionMatrix - The projection matrix, usually of the scene's camera.
   * @param maxFar - The maximum far value.
   * @returns An object representing the vertices of the near and far plane in view space.
   */
  setFromProjectionMatrix(
    projectionMatrix: Matrix4,
    maxFar: number,
  ): FrustumVertices {
    const zNear = this.zNear;
    const isOrthographic = projectionMatrix.elements[2 * 4 + 3] === 0;

    inverseProjectionMatrix.copy(projectionMatrix).invert();

    // 3 --- 0  vertices.near/far order
    // |     |
    // 2 --- 1
    // clip space spans from [-1, 1]

    this.vertices.near[0].set(1, 1, zNear);
    this.vertices.near[1].set(1, -1, zNear);
    this.vertices.near[2].set(-1, -1, zNear);
    this.vertices.near[3].set(-1, 1, zNear);

    this.vertices.near.forEach(function (v) {
      v.applyMatrix4(inverseProjectionMatrix);
    });

    this.vertices.far[0].set(1, 1, 1);
    this.vertices.far[1].set(1, -1, 1);
    this.vertices.far[2].set(-1, -1, 1);
    this.vertices.far[3].set(-1, 1, 1);

    this.vertices.far.forEach(function (v) {
      v.applyMatrix4(inverseProjectionMatrix);

      const absZ = Math.abs(v.z);
      if (isOrthographic) {
        v.z *= Math.min(maxFar / absZ, 1.0);
      } else {
        v.multiplyScalar(Math.min(maxFar / absZ, 1.0));
      }
    });

    return this.vertices;
  }

  /**
   * Splits the CSM frustum by the given array. The new CSM frustums are pushed into the given
   * target array.
   *
   * @param breaks - An array of numbers in the range `[0,1]` that defines how the
   * CSM frustum should be split up.
   * @param target - The target array that holds the new CSM frustums.
   */
  split(breaks: number[], target: CSMFrustum[]): void {
    while (breaks.length > target.length) {
      target.push(new CSMFrustum());
    }

    target.length = breaks.length;

    for (let i = 0; i < breaks.length; i++) {
      const cascade = target[i];

      if (i === 0) {
        for (let j = 0; j < 4; j++) {
          cascade.vertices.near[j].copy(this.vertices.near[j]);
        }
      } else {
        for (let j = 0; j < 4; j++) {
          cascade.vertices.near[j].lerpVectors(
            this.vertices.near[j],
            this.vertices.far[j],
            breaks[i - 1],
          );
        }
      }

      if (i === breaks.length - 1) {
        for (let j = 0; j < 4; j++) {
          cascade.vertices.far[j].copy(this.vertices.far[j]);
        }
      } else {
        for (let j = 0; j < 4; j++) {
          cascade.vertices.far[j].lerpVectors(
            this.vertices.near[j],
            this.vertices.far[j],
            breaks[i],
          );
        }
      }
    }
  }

  /**
   * Transforms the given target CSM frustum into the different coordinate system defined by the
   * given camera matrix.
   *
   * @param cameraMatrix - The matrix that defines the new coordinate system.
   * @param target - The CSM to convert.
   */
  toSpace(cameraMatrix: Matrix4, target: CSMFrustum): void {
    for (let i = 0; i < 4; i++) {
      target.vertices.near[i]
        .copy(this.vertices.near[i])
        .applyMatrix4(cameraMatrix);

      target.vertices.far[i]
        .copy(this.vertices.far[i])
        .applyMatrix4(cameraMatrix);
    }
  }
}
