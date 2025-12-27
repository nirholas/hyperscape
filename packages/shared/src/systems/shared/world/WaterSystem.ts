/**
 * WaterSystem - Water rendering with TSL Node Materials
 */

import THREE, {
  MeshStandardNodeMaterial,
  texture,
  uv,
  positionWorld,
  cameraPosition,
  uniform,
  float,
  vec2,
  vec3,
  sin,
  cos,
  pow,
  add,
  sub,
  mul,
  mix,
  dot,
  normalize,
  max,
  Fn,
} from "../../../extras/three/three";
import type { World } from "../../../types";
import type { TerrainTile } from "../../../types/world/terrain";

type UniformRef<T> = { value: T };

export type WaterUniforms = {
  time: UniformRef<number>;
  waveScale: UniformRef<number>;
  waveSpeed: UniformRef<number>;
  distortion: UniformRef<number>;
  fresnelPower: UniformRef<number>;
  opacity: UniformRef<number>;
};

export class WaterSystem {
  private world: World;
  private waterNormal?: THREE.Texture;
  private waterNormalRepeat = 16;
  private waterTime = 0;
  private waterMaterial?: THREE.Material;
  private uniforms: WaterUniforms | null = null;

  constructor(world: World) {
    this.world = world;
  }

  get waterUniforms(): WaterUniforms | null {
    return this.uniforms;
  }

  async init(): Promise<void> {
    if (this.world.isServer) return;

    const loader = new THREE.TextureLoader();
    this.waterNormal = await new Promise<THREE.Texture>((resolve) => {
      loader.load(
        "/textures/waterNormal.png",
        (tex) => resolve(tex),
        undefined,
        (err) => {
          console.warn("[WaterSystem] Using placeholder normal map:", err);
          const canvas = document.createElement("canvas");
          canvas.width = canvas.height = 2;
          const ctx = canvas.getContext("2d")!;
          ctx.fillStyle = "#8080ff";
          ctx.fillRect(0, 0, 2, 2);
          resolve(new THREE.CanvasTexture(canvas));
        },
      );
    });

    this.waterNormal.wrapS = this.waterNormal.wrapT = THREE.RepeatWrapping;
    this.waterNormal.repeat.set(this.waterNormalRepeat, this.waterNormalRepeat);
    this.waterMaterial = this.createWaterMaterial();
  }

  private createWaterMaterial(): THREE.Material {
    const uTime = uniform(float(0));
    const uWaveScale = uniform(float(0.08));
    const uWaveSpeed = uniform(float(0.6));
    const uDistortion = uniform(float(0.06));
    const uFresnelPower = uniform(float(5.0));
    const uOpacity = uniform(float(0.65));

    this.uniforms = {
      time: uTime,
      waveScale: uWaveScale,
      waveSpeed: uWaveSpeed,
      distortion: uDistortion,
      fresnelPower: uFresnelPower,
      opacity: uOpacity,
    };

    const material = new MeshStandardNodeMaterial();
    material.transparent = true;
    material.depthWrite = false;
    material.side = THREE.FrontSide;
    material.roughness = 0.2;
    material.metalness = 0.02;

    const waveTilt = Fn(
      ([xz, t, scale, speed, dist]: [
        ReturnType<typeof vec2>,
        ReturnType<typeof float>,
        ReturnType<typeof float>,
        ReturnType<typeof float>,
        ReturnType<typeof float>,
      ]) => {
        const time = mul(t, speed);
        const waveX = mul(xz.x, mul(float(6.2831), scale));
        const waveZ = mul(xz.y, mul(mul(float(6.2831), scale), float(1.3)));
        return mul(
          vec2(sin(add(waveX, time)), cos(sub(waveZ, mul(time, float(0.85))))),
          dist,
        );
      },
    );

    material.colorNode = Fn(() => {
      const worldPos = positionWorld;
      const V = normalize(sub(cameraPosition, worldPos));
      const tilt = waveTilt(
        vec2(worldPos.x, worldPos.z),
        uTime,
        uWaveScale,
        uWaveSpeed,
        uDistortion,
      );
      const N = normalize(vec3(tilt.x, float(1.0), tilt.y));
      const NdotV = max(dot(N, V), float(0.0));
      const F = pow(sub(float(1.0), NdotV), uFresnelPower);

      const shallowColor = vec3(0.25, 0.72, 0.83);
      const deepColor = vec3(0.06, 0.24, 0.35);
      const baseColor = vec3(0.118, 0.42, 0.66);
      return mix(baseColor, mix(deepColor, shallowColor, F), float(0.85));
    })();

    material.opacityNode = uOpacity;

    if (this.waterNormal) {
      material.normalNode = Fn(() => {
        const baseUv = uv();
        const timeOffset = mul(uTime, float(0.02));
        const animatedUv = vec2(
          add(baseUv.x, timeOffset),
          add(baseUv.y, mul(timeOffset, float(0.65))),
        );
        const normalSample = texture(this.waterNormal!, animatedUv).rgb;
        const normalValue = sub(mul(normalSample, float(2.0)), float(1.0));
        return normalize(
          vec3(
            mul(normalValue.x, float(0.8)),
            normalValue.y,
            mul(normalValue.z, float(0.8)),
          ),
        );
      })();
    }

    return material;
  }

  generateWaterMesh(
    tile: TerrainTile,
    waterThreshold: number,
    tileSize: number,
    getHeightAt?: (worldX: number, worldZ: number) => number,
  ): THREE.Mesh | null {
    if (!getHeightAt) {
      const geom = new THREE.PlaneGeometry(tileSize, tileSize);
      geom.rotateX(-Math.PI / 2);
      return this.createMesh(geom, tile, waterThreshold);
    }

    const resolution = 32;
    const tileOriginX = tile.x * tileSize;
    const tileOriginZ = tile.z * tileSize;

    const heights: number[][] = [];
    for (let i = 0; i <= resolution; i++) {
      heights[i] = [];
      for (let j = 0; j <= resolution; j++) {
        const worldX = tileOriginX + (i / resolution - 0.5) * tileSize;
        const worldZ = tileOriginZ + (j / resolution - 0.5) * tileSize;
        heights[i][j] = getHeightAt(worldX, worldZ);
      }
    }

    const vertices: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    const vertexMap = new Map<string, number>();
    let vertexIdx = 0;

    for (let i = 0; i < resolution; i++) {
      for (let j = 0; j < resolution; j++) {
        const h = [
          heights[i][j],
          heights[i + 1][j],
          heights[i][j + 1],
          heights[i + 1][j + 1],
        ];
        if (!h.some((h) => h < waterThreshold)) continue;

        const corners = [
          [i, j],
          [i + 1, j],
          [i, j + 1],
          [i + 1, j + 1],
        ];
        const quadIdx: number[] = [];

        for (const [ci, cj] of corners) {
          const key = `${ci},${cj}`;
          if (!vertexMap.has(key)) {
            const localX = (ci / resolution - 0.5) * tileSize;
            const localZ = (cj / resolution - 0.5) * tileSize;
            vertices.push(localX, 0, localZ);
            uvs.push(ci / resolution, cj / resolution);
            vertexMap.set(key, vertexIdx++);
          }
          quadIdx.push(vertexMap.get(key)!);
        }

        indices.push(
          quadIdx[0],
          quadIdx[2],
          quadIdx[1],
          quadIdx[1],
          quadIdx[2],
          quadIdx[3],
        );
      }
    }

    if (vertices.length === 0) return null;

    const geom = new THREE.BufferGeometry();
    geom.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(vertices, 3),
    );
    geom.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geom.setIndex(indices);
    geom.computeVertexNormals();

    return this.createMesh(geom, tile, waterThreshold);
  }

  private createMesh(
    geom: THREE.BufferGeometry,
    tile: TerrainTile,
    waterThreshold: number,
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(
      geom,
      this.waterMaterial || this.createWaterMaterial(),
    );
    mesh.position.y = waterThreshold;
    mesh.name = `Water_${tile.key}`;
    mesh.userData = { type: "water", walkable: false, clickable: false };
    return mesh;
  }

  update(deltaTime: number, _waterMeshes: THREE.Mesh[]): void {
    const dt =
      typeof deltaTime === "number" && isFinite(deltaTime) ? deltaTime : 1 / 60;
    this.waterTime += dt;

    if (this.uniforms) {
      this.uniforms.time.value = this.waterTime;
    }

    if (this.waterNormal) {
      this.waterNormal.offset.x += 0.02 * dt;
      this.waterNormal.offset.y += 0.013 * dt;
    }
  }
}
