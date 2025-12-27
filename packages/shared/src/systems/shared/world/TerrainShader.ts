/**
 * TerrainShader - TSL Node Material for terrain rendering
 */

import THREE, {
  MeshStandardNodeMaterial,
  texture,
  positionWorld,
  normalWorld,
  cameraPosition,
  uniform,
  float,
  vec2,
  vec3,
  abs,
  pow,
  add,
  sub,
  mul,
  div,
  mix,
  smoothstep,
  dot,
  normalize,
  length,
  Fn,
} from "../../../extras/three/three";

export const TERRAIN_CONSTANTS = {
  TRIPLANAR_SCALE: 0.02,
  SNOW_HEIGHT: 50.0,
  FOG_NEAR: 200.0,
  FOG_FAR: 500.0,
};

const triplanarSample = Fn(
  ([tex, worldPos, normal, scale]: [
    THREE.Texture,
    ReturnType<typeof positionWorld>,
    ReturnType<typeof normalWorld>,
    ReturnType<typeof float>,
  ]) => {
    const scaledPos = mul(worldPos, scale);
    const blendWeights = pow(abs(normal), vec3(4.0));
    const weightSum = add(add(blendWeights.x, blendWeights.y), blendWeights.z);
    const weights = div(blendWeights, weightSum);

    const xSample = texture(tex, vec2(scaledPos.y, scaledPos.z)).rgb;
    const ySample = texture(tex, vec2(scaledPos.x, scaledPos.z)).rgb;
    const zSample = texture(tex, vec2(scaledPos.x, scaledPos.y)).rgb;

    return add(
      add(mul(xSample, weights.x), mul(ySample, weights.y)),
      mul(zSample, weights.z),
    );
  },
);

function createPlaceholderTexture(color: number): THREE.Texture {
  if (typeof document === "undefined") {
    const data = new Uint8Array([
      (color >> 16) & 0xff,
      (color >> 8) & 0xff,
      color & 0xff,
      255,
    ]);
    const tex = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.needsUpdate = true;
    return tex;
  }
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 2;
  const ctx = canvas.getContext("2d")!;
  const c = new THREE.Color(color);
  ctx.fillStyle = `rgb(${c.r * 255}, ${c.g * 255}, ${c.b * 255})`;
  ctx.fillRect(0, 0, 2, 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

export type TerrainUniforms = {
  sunPosition: { value: THREE.Vector3 };
};

export function createTerrainMaterial(
  textures: Map<string, THREE.Texture>,
): THREE.Material & { terrainUniforms: TerrainUniforms } {
  const placeholders = {
    grass: createPlaceholderTexture(0x5a9216),
    dirt: createPlaceholderTexture(0x6b4423),
    rock: createPlaceholderTexture(0x7a7265),
    sand: createPlaceholderTexture(0xc2b280),
    snow: createPlaceholderTexture(0xf0f8ff),
  };

  const grassTex = textures.get("grass") || placeholders.grass;
  const dirtTex = textures.get("dirt") || placeholders.dirt;
  const rockTex = textures.get("rock") || placeholders.rock;
  const sandTex = textures.get("sand") || placeholders.sand;
  const snowTex = textures.get("snow") || placeholders.snow;

  const sunPositionUniform = uniform(vec3(100, 100, 100));
  const triplanarScale = uniform(float(TERRAIN_CONSTANTS.TRIPLANAR_SCALE));

  const worldPos = positionWorld;
  const worldNormal = normalWorld;

  const grassColor = triplanarSample(
    grassTex,
    worldPos,
    worldNormal,
    triplanarScale,
  );
  const dirtColor = triplanarSample(
    dirtTex,
    worldPos,
    worldNormal,
    triplanarScale,
  );
  const rockColor = triplanarSample(
    rockTex,
    worldPos,
    worldNormal,
    triplanarScale,
  );
  const sandColor = triplanarSample(
    sandTex,
    worldPos,
    worldNormal,
    triplanarScale,
  );
  const snowColor = triplanarSample(
    snowTex,
    worldPos,
    worldNormal,
    triplanarScale,
  );

  const height = worldPos.y;
  const slope = sub(float(1.0), abs(worldNormal.y));

  let blendedColor = grassColor;
  blendedColor = mix(
    blendedColor,
    dirtColor,
    mul(smoothstep(float(0.3), float(0.5), slope), float(0.4)),
  );
  blendedColor = mix(
    blendedColor,
    rockColor,
    smoothstep(float(0.6), float(0.75), slope),
  );
  blendedColor = mix(
    blendedColor,
    snowColor,
    smoothstep(float(TERRAIN_CONSTANTS.SNOW_HEIGHT), float(60.0), height),
  );
  const sandBlend = mul(
    smoothstep(float(5.0), float(0.0), height),
    smoothstep(float(0.3), float(0.0), slope),
  );
  blendedColor = mix(blendedColor, sandColor, sandBlend);

  const N = normalize(worldNormal);
  const sunDir = normalize(sunPositionUniform);
  const NdotL = dot(N, sunDir);
  const halfLambert = add(mul(NdotL, float(0.5)), float(0.5));
  const diffuse = mul(halfLambert, halfLambert);

  const skyColor = vec3(0.6, 0.7, 0.9);
  const skyLight = add(mul(N.y, float(0.5)), float(0.5));
  const ambient = mul(mul(skyColor, skyLight), float(0.3));
  const sunColor = vec3(1.0, 0.98, 0.95);
  const diffuseLight = mul(mul(sunColor, diffuse), float(0.8));
  const litColor = mul(blendedColor, add(ambient, diffuseLight));

  const dist = length(sub(worldPos, cameraPosition));
  const fogFactor = smoothstep(
    float(TERRAIN_CONSTANTS.FOG_NEAR),
    float(TERRAIN_CONSTANTS.FOG_FAR),
    dist,
  );
  const fogColor = vec3(0.7, 0.8, 0.9);
  const finalColor = mix(litColor, fogColor, fogFactor);

  const material = new MeshStandardNodeMaterial();
  material.colorNode = finalColor;
  material.roughness = 0.9;
  material.metalness = 0.0;
  material.side = THREE.FrontSide;
  material.transparent = false;
  material.depthWrite = true;
  material.depthTest = true;

  const terrainUniforms: TerrainUniforms = { sunPosition: sunPositionUniform };
  const result = material as typeof material & {
    terrainUniforms: TerrainUniforms;
  };
  result.terrainUniforms = terrainUniforms;
  return result;
}
