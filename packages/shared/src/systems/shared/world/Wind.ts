/**
 * Wind system - provides uniforms for shader-based vegetation animation.
 * Used by: ProceduralGrassSystem, WaterSystem
 */

import THREE from "../../../extras/three/three";
import { System } from "../infrastructure/System";
import type { World } from "../../../types";

export interface WindUniforms {
  time: { value: number };
  windDirection: { value: THREE.Vector3 };
  windStrength: { value: number };
}

export class Wind extends System {
  uniforms: WindUniforms;

  constructor(world: World) {
    super(world);
    this.uniforms = {
      time: { value: 0 },
      windStrength: { value: 1.0 },
      windDirection: { value: new THREE.Vector3(1, 0, 0) },
    };
  }

  /** @param strength 0 = calm, 1 = normal, 2+ = stormy */
  setStrength(strength: number): void {
    this.uniforms.windStrength.value = Math.max(0, strength);
  }

  getStrength(): number {
    return this.uniforms.windStrength.value;
  }

  /** Direction is normalized internally */
  setDirection(direction: THREE.Vector3): void {
    this.uniforms.windDirection.value.copy(direction).normalize();
  }

  getDirection(): THREE.Vector3 {
    return this.uniforms.windDirection.value.clone();
  }

  /** @param angleDegrees 0 = East, 90 = North */
  setDirectionFromAngle(angleDegrees: number): void {
    const rad = (angleDegrees * Math.PI) / 180;
    this.uniforms.windDirection.value.set(Math.cos(rad), 0, Math.sin(rad));
  }

  update(delta: number): void {
    this.uniforms.time.value += delta;
  }
}
