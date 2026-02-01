/**
 * Wind system - provides uniforms for shader-based vegetation animation.
 * Used by: ProceduralGrassSystem, WaterSystem
 *
 * Exposes both traditional uniforms and TSL uniforms for GPU compute shaders.
 * The TSL uniforms (uDirection, uIntensity) match Revo Realms WindManager.
 */

import THREE, { uniform } from "../../../extras/three/three";
import { System } from "../infrastructure/System";
import type { World } from "../../../types";

export interface WindUniforms {
  time: { value: number };
  windDirection: { value: THREE.Vector3 };
  windStrength: { value: number };
}

/**
 * TSL uniforms for GPU shaders - matches Revo Realms WindManager interface
 * These can be imported and used directly in TSL shader code
 */
const tslUniforms = {
  /** Wind direction as vec2 (XZ plane) */
  uDirection: uniform(new THREE.Vector2(0, -1)),
  /** Wind intensity (0 = ambient, 1 = max) */
  uIntensity: uniform(0.1),
};

/**
 * WindManager-compatible interface for vegetation systems
 * Can be imported by grass/flower systems for TSL uniform access
 */
export const windManager = {
  get uDirection() {
    return tslUniforms.uDirection;
  },
  get uIntensity() {
    return tslUniforms.uIntensity;
  },
};

export class Wind extends System {
  uniforms: WindUniforms;

  /** Ambient intensity when wind is calm */
  private readonly AMBIENT_INTENSITY = 0.1;

  constructor(world: World) {
    super(world);
    this.uniforms = {
      time: { value: 0 },
      windStrength: { value: 1.0 },
      windDirection: { value: new THREE.Vector3(1, 0, 0) },
    };

    // Sync initial direction to TSL uniform
    this.syncDirectionToTSL();
  }

  /** Sync the traditional direction uniform to the TSL uniform */
  private syncDirectionToTSL(): void {
    const dir = this.uniforms.windDirection.value;
    tslUniforms.uDirection.value.set(dir.x, dir.z);
  }

  /** @param strength 0 = calm, 1 = normal, 2+ = stormy */
  setStrength(strength: number): void {
    this.uniforms.windStrength.value = Math.max(0, strength);
    // Map strength to TSL intensity (0-1 range)
    tslUniforms.uIntensity.value = Math.min(
      this.AMBIENT_INTENSITY + strength * 0.3,
      1.0,
    );
  }

  getStrength(): number {
    return this.uniforms.windStrength.value;
  }

  /** Direction is normalized internally */
  setDirection(direction: THREE.Vector3): void {
    this.uniforms.windDirection.value.copy(direction).normalize();
    this.syncDirectionToTSL();
  }

  getDirection(): THREE.Vector3 {
    return this.uniforms.windDirection.value.clone();
  }

  /** @param angleDegrees 0 = East, 90 = North */
  setDirectionFromAngle(angleDegrees: number): void {
    const rad = (angleDegrees * Math.PI) / 180;
    this.uniforms.windDirection.value.set(Math.cos(rad), 0, Math.sin(rad));
    this.syncDirectionToTSL();
  }

  /**
   * Set wind intensity directly (TSL uniform)
   * @param intensity 0 = ambient, 1 = max
   */
  setIntensity(intensity: number): void {
    tslUniforms.uIntensity.value = Math.max(
      this.AMBIENT_INTENSITY,
      Math.min(1, intensity),
    );
  }

  getIntensity(): number {
    return tslUniforms.uIntensity.value;
  }

  /**
   * Get TSL uniforms for direct use in shaders
   */
  getTSLUniforms(): typeof tslUniforms {
    return tslUniforms;
  }

  update(delta: number): void {
    this.uniforms.time.value += delta;
  }
}
