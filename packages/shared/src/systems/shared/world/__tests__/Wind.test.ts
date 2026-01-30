import { describe, it, expect, beforeEach } from "vitest";
import * as THREE from "three";
import { Wind } from "../Wind";
import type { World } from "../../../../types";

function createMockWorld(): World {
  return {} as World;
}

describe("Wind System", () => {
  let wind: Wind;

  beforeEach(() => {
    wind = new Wind(createMockWorld());
  });

  describe("constructor", () => {
    it("initializes with defaults", () => {
      expect(wind.uniforms.time.value).toBe(0);
      expect(wind.uniforms.windStrength.value).toBe(1.0);
      const dir = wind.uniforms.windDirection.value;
      expect(dir.x).toBe(1);
      expect(dir.y).toBe(0);
      expect(dir.z).toBe(0);
    });
  });

  describe("setStrength / getStrength", () => {
    it("sets and gets strength", () => {
      wind.setStrength(2.5);
      expect(wind.getStrength()).toBe(2.5);
    });

    it("clamps negative to 0", () => {
      wind.setStrength(-5);
      expect(wind.getStrength()).toBe(0);
    });
  });

  describe("setDirection / getDirection", () => {
    it("normalizes direction", () => {
      wind.setDirection(new THREE.Vector3(10, 0, 0));
      expect(wind.getDirection().length()).toBeCloseTo(1.0);

      wind.setDirection(new THREE.Vector3(1, 0, 1));
      expect(wind.getDirection().x).toBeCloseTo(Math.SQRT1_2);
    });

    it("returns clone", () => {
      expect(wind.getDirection()).not.toBe(wind.getDirection());
    });
  });

  describe("setDirectionFromAngle", () => {
    it("converts degrees to direction", () => {
      wind.setDirectionFromAngle(0); // East
      expect(wind.getDirection().x).toBeCloseTo(1);

      wind.setDirectionFromAngle(90); // North
      expect(wind.getDirection().z).toBeCloseTo(1);

      wind.setDirectionFromAngle(180); // West
      expect(wind.getDirection().x).toBeCloseTo(-1);
    });

    it("produces horizontal wind (y=0)", () => {
      wind.setDirectionFromAngle(45);
      expect(wind.getDirection().y).toBe(0);
    });
  });

  describe("update", () => {
    it("accumulates time", () => {
      wind.update(0.5);
      wind.update(0.25);
      expect(wind.uniforms.time.value).toBeCloseTo(0.75);
    });
  });

  describe("uniforms", () => {
    it("work with Three.js ShaderMaterial", () => {
      const material = new THREE.ShaderMaterial({
        uniforms: {
          time: wind.uniforms.time,
          windStrength: wind.uniforms.windStrength,
          windDirection: wind.uniforms.windDirection,
        },
        vertexShader: "void main() { gl_Position = vec4(0.0); }",
        fragmentShader: "void main() { gl_FragColor = vec4(1.0); }",
      });
      expect(material.uniforms.windStrength.value).toBe(1.0);
    });
  });
});
