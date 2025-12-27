/**
 * GrassSystem - Instanced grass rendering with TSL Node Materials
 */

import THREE, {
  MeshBasicNodeMaterial,
  texture,
  uv,
  positionLocal,
  positionWorld,
  uniform,
  float,
  vec3,
  vec4,
  sin,
  add,
  sub,
  mul,
  mix,
  clamp,
  smoothstep,
  Fn,
} from "../../../extras/three/three";
import type { World } from "../../../types";
import type { TerrainTile } from "../../../types/world/terrain";

type UniformRef<T> = { value: T };

export type GrassUniforms = {
  time: UniformRef<number>;
};

export class GrassSystem {
  private world: World;
  private grassMaterial?: THREE.Material;
  private grassTexture?: THREE.Texture;
  private uniforms: GrassUniforms | null = null;

  constructor(world: World) {
    this.world = world;
  }

  get grassUniforms(): GrassUniforms | null {
    return this.uniforms;
  }

  async init(): Promise<void> {
    if (this.world.isServer) return;

    const loader = new THREE.TextureLoader();
    this.grassTexture = await new Promise<THREE.Texture>((resolve) => {
      loader.load(
        "/textures/terrain-grass.png",
        (tex) => {
          tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.needsUpdate = true;
          resolve(tex);
        },
        undefined,
        (err) => {
          console.warn("[GrassSystem] Using placeholder texture:", err);
          const canvas = document.createElement("canvas");
          canvas.width = canvas.height = 2;
          const ctx = canvas.getContext("2d")!;
          ctx.fillStyle = "#4a7c23";
          ctx.fillRect(0, 0, 2, 2);
          resolve(new THREE.CanvasTexture(canvas));
        },
      );
    });

    this.grassMaterial = this.createGrassMaterial();
  }

  private createGrassMaterial(): THREE.Material {
    const uTime = uniform(float(0));
    this.uniforms = { time: uTime };

    const material = new MeshBasicNodeMaterial();
    material.side = THREE.DoubleSide;
    material.transparent = true;
    material.depthWrite = false;

    material.positionNode = Fn(() => {
      const pos = positionLocal;
      const uvY = uv().y;
      const movingLerp = smoothstep(
        float(0.1),
        float(2.0),
        sub(float(1.0), uvY),
      );
      const windOffset = sin(
        add(mul(uTime, float(2.0)), mul(positionWorld.x, float(0.5))),
      );
      const windX = mul(mul(windOffset, float(0.3)), movingLerp);
      return vec3(add(pos.x, windX), pos.y, pos.z);
    })();

    material.colorNode = Fn(() => {
      const uvCoord = uv();
      const grassTex = this.grassTexture
        ? texture(this.grassTexture, uvCoord)
        : vec4(0.3, 0.5, 0.1, 1.0);
      const colorLerp = smoothstep(
        float(0.2),
        float(1.8),
        sub(float(1.0), uvCoord.y),
      );

      const darkGreen = vec3(0.25, 0.45, 0.02);
      const lightGreen = vec3(0.45, 0.65, 0.08);
      let color = mix(darkGreen, lightGreen, colorLerp);
      color = mul(color, mul(grassTex.rgb, float(1.4)));

      const waveValue = sin(mul(add(uTime, positionWorld.x), float(3.0)));
      const waveBrightness = mul(
        clamp(sub(waveValue, float(0.3)), float(0.0), float(1.0)),
        float(0.3),
      );
      color = add(
        color,
        mul(vec3(waveBrightness, waveBrightness, waveBrightness), colorLerp),
      );

      return vec4(color, grassTex.a);
    })();

    material.opacityNode = Fn(() => {
      const grassTex = this.grassTexture
        ? texture(this.grassTexture, uv())
        : vec4(0.3, 0.5, 0.1, 1.0);
      return sub(float(1.0), grassTex.a);
    })();

    return material;
  }

  generateGrassForTile(
    tile: TerrainTile,
    getHeightAt: (x: number, z: number) => number,
    getNormalAt: (x: number, z: number) => THREE.Vector3,
    calculateSlope: (x: number, z: number) => number,
    waterThreshold: number,
    tileSize: number,
    createTileRng: (x: number, z: number, salt: string) => () => number,
  ): THREE.InstancedMesh | null {
    if (!this.grassMaterial) return null;

    const biomeName = tile.biome as string;
    const densityMul =
      biomeName === "plains" ? 1.2 : biomeName === "forest" ? 0.8 : 1.0;
    const targetCount = Math.min(
      3000,
      Math.floor(tileSize * tileSize * 0.3 * densityMul),
    );
    const rng = createTileRng(tile.x, tile.z, "grass");

    const positions: number[] = [];
    const slopes: number[] = [];

    for (let i = 0; i < targetCount; i++) {
      const localX = (rng() - 0.5) * tileSize * 0.95;
      const localZ = (rng() - 0.5) * tileSize * 0.95;
      const worldX = tile.x * tileSize + localX;
      const worldZ = tile.z * tileSize + localZ;
      const height = getHeightAt(worldX, worldZ);

      if (height < waterThreshold || calculateSlope(worldX, worldZ) > 0.6)
        continue;

      positions.push(worldX, height + 0.02, worldZ);
      const normal = getNormalAt(worldX, worldZ);
      slopes.push(normal.x, normal.y, normal.z);
    }

    const count = positions.length / 3;
    if (count === 0) return null;

    const baseGeom = new THREE.PlaneGeometry(0.6, 1.5, 1, 1);
    baseGeom.translate(0, 0.75, 0);

    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", baseGeom.attributes.position);
    geom.setAttribute("normal", baseGeom.attributes.normal);
    geom.setAttribute("uv", baseGeom.attributes.uv);
    geom.setIndex(baseGeom.index);
    geom.setAttribute(
      "positions",
      new THREE.InstancedBufferAttribute(new Float32Array(positions), 3),
    );
    geom.setAttribute(
      "slopes",
      new THREE.InstancedBufferAttribute(new Float32Array(slopes), 3),
    );

    const mesh = new THREE.InstancedMesh(geom, this.grassMaterial, count);
    mesh.frustumCulled = false;
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.count = count;
    mesh.name = `Grass_${tile.key}`;

    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3(1, 1, 1);

    for (let i = 0; i < count; i++) {
      position.set(
        positions[i * 3],
        positions[i * 3 + 1],
        positions[i * 3 + 2],
      );
      matrix.compose(position, quaternion, scale);
      mesh.setMatrixAt(i, matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;

    return mesh;
  }

  update(deltaTime: number): void {
    const dt =
      typeof deltaTime === "number" && isFinite(deltaTime) ? deltaTime : 1 / 60;
    if (this.uniforms) {
      this.uniforms.time.value += dt;
    }
  }
}
