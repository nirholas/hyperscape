import THREE from "../extras/three/three";

/**
 * TriplanarTerrainMaterial - Stylized terrain with painterly blending
 *
 * Features:
 * - 6-way material blending (grass, dirt, rock, snow, sand, cobblestone)
 * - Stochastic sampling to reduce visible tiling patterns
 * - Normal map support for surface detail
 * - Stylized directional lighting with warm/cool bias
 * - Height-based detail variation for organic transitions
 * - Planar XZ projection optimized for terrain
 * 
 * Material indices:
 * 0 = Grass, 1 = Dirt, 2 = Rock, 3 = Snow, 4 = Sand, 5 = Cobblestone
 */
export class TriplanarTerrainMaterial extends THREE.ShaderMaterial {
  declare uniforms: {
    uDiffMap: { value: THREE.Texture };
    uNormalMap: { value: THREE.Texture };
    uNoiseTexture: { value: THREE.Texture };
    uTextureScales: { value: number[] };
    uSunDirection: { value: THREE.Vector3 };
    uSunColor: { value: THREE.Color };
    uAmbientColor: { value: THREE.Color };
    uNormalStrength: { value: number };
    uTime: { value: number };
  };

  constructor(
    diffuseAtlas: THREE.Texture,
    normalAtlas: THREE.Texture,
    noiseTexture: THREE.Texture,
    textureScales: number[],
  ) {
    super({
      uniforms: {
        uDiffMap: { value: diffuseAtlas },
        uNormalMap: { value: normalAtlas },
        uNoiseTexture: { value: noiseTexture },
        uTextureScales: { value: textureScales },
        // Lighting uniforms - warm sunlight with cool shadows for stylized look
        uSunDirection: { value: new THREE.Vector3(0.4, 0.7, 0.5).normalize() },
        uSunColor: { value: new THREE.Color(1.0, 0.95, 0.85) },
        uAmbientColor: { value: new THREE.Color(0.25, 0.28, 0.35) },
        uNormalStrength: { value: 0.7 },
        uTime: { value: 0.0 },
      },
      // Use vec4 for materials instead of ivec4 for WebGL compatibility
      vertexShader: /* glsl */ `
        attribute vec4 materials;
        attribute vec4 materialsWeights;
        
        varying vec4 vMaterials;
        varying vec4 vMaterialsWeights;
        varying vec3 vPosition;
        varying vec3 vWorldPosition;
        varying vec3 vWorldNormal;
        varying float vHeight;
        
        void main() {
          vMaterials = materials;
          vMaterialsWeights = materialsWeights;
          vPosition = position;
          vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
          vWorldNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
          vHeight = position.y;
          
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        
        uniform sampler2D uDiffMap;
        uniform sampler2D uNormalMap;
        uniform sampler2D uNoiseTexture;
        uniform float uTextureScales[6];
        uniform vec3 uSunDirection;
        uniform vec3 uSunColor;
        uniform vec3 uAmbientColor;
        uniform float uNormalStrength;
        uniform float uTime;
        
        varying vec4 vMaterials;
        varying vec4 vMaterialsWeights;
        varying vec3 vPosition;
        varying vec3 vWorldPosition;
        varying vec3 vWorldNormal;
        varying float vHeight;
        
        const float TEXTURE_SCALE = 40.0;
        // 3x2 atlas grid: 3 columns, 2 rows
        const float ATLAS_COLS = 3.0;
        const float ATLAS_ROWS = 2.0;
        const float TEXTURE_WIDTH = 1.0 / ATLAS_COLS;
        const float TEXTURE_HEIGHT = 1.0 / ATLAS_ROWS;
        
        // Hash function for stochastic sampling
        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }
        
        vec2 getSubTextureOffset(int textureIndex) {
          float idx = float(textureIndex);
          float ax = mod(idx, ATLAS_COLS);
          float ay = floor(idx / ATLAS_COLS);
          return vec2(ax * TEXTURE_WIDTH, ay * TEXTURE_HEIGHT);
        }
        
        vec4 subTexture2D(sampler2D tex, vec2 tileUv, vec2 textureOffset) {
          vec2 subUv = fract(tileUv) * vec2(TEXTURE_WIDTH, TEXTURE_HEIGHT) + textureOffset;
          return texture2D(tex, subUv);
        }
        
        float getTextureScale(int idx) {
          if (idx == 0) return uTextureScales[0];
          if (idx == 1) return uTextureScales[1];
          if (idx == 2) return uTextureScales[2];
          if (idx == 3) return uTextureScales[3];
          if (idx == 4) return uTextureScales[4];
          if (idx == 5) return uTextureScales[5];
          return uTextureScales[0];
        }
        
        // Enhanced stochastic sampling with better anti-tiling
        vec4 textureNoTile(sampler2D tex, int textureIndex, vec2 inputUv, float noiseVal) {
          float UV_SCALE = getTextureScale(textureIndex);
          vec2 uv = inputUv * (1.0 / UV_SCALE);
          
          // Improved stochastic offset using noise texture
          vec2 noiseUv = inputUv * 0.01;
          float n1 = texture2D(uNoiseTexture, noiseUv).r;
          float n2 = texture2D(uNoiseTexture, noiseUv + vec2(0.5, 0.5)).r;
          
          // Create smooth offset that varies across the terrain
          float angle = n1 * 6.28318;
          vec2 offset = vec2(cos(angle), sin(angle)) * n2 * 0.5;
          
          // Add height-based variation for organic look
          offset += vec2(hash(floor(uv * 4.0))) * 0.25;
          
          vec2 textureOffset = getSubTextureOffset(textureIndex);
          return subTexture2D(tex, uv + offset, textureOffset);
        }
        
        // Blend materials with height-based detail variation
        vec4 blendMaterials(sampler2D tex, vec2 uv, float noiseVal) {
          vec4 result = vec4(0.0);
          float weightSum = 0.0;
          
          // Sample with noise-based anti-tiling
          if(vMaterialsWeights.x > 0.01) {
            int matIdx = int(vMaterials.x + 0.5);
            result += textureNoTile(tex, matIdx, uv, noiseVal) * vMaterialsWeights.x;
            weightSum += vMaterialsWeights.x;
          }
          if(vMaterialsWeights.y > 0.01) {
            int matIdx = int(vMaterials.y + 0.5);
            result += textureNoTile(tex, matIdx, uv, noiseVal) * vMaterialsWeights.y;
            weightSum += vMaterialsWeights.y;
          }
          if(vMaterialsWeights.z > 0.01) {
            int matIdx = int(vMaterials.z + 0.5);
            result += textureNoTile(tex, matIdx, uv, noiseVal) * vMaterialsWeights.z;
            weightSum += vMaterialsWeights.z;
          }
          if(vMaterialsWeights.w > 0.01) {
            int matIdx = int(vMaterials.w + 0.5);
            result += textureNoTile(tex, matIdx, uv, noiseVal) * vMaterialsWeights.w;
            weightSum += vMaterialsWeights.w;
          }
          
          return weightSum > 0.001 ? result / weightSum : result;
        }
        
        vec3 perturbNormal(vec3 normalMapSample, vec3 surfaceNormal) {
          vec3 mapNormal = normalMapSample * 2.0 - 1.0;
          mapNormal.xy *= uNormalStrength;
          
          vec3 up = abs(surfaceNormal.y) < 0.999 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
          vec3 tangent = normalize(cross(up, surfaceNormal));
          vec3 bitangent = cross(surfaceNormal, tangent);
          
          mat3 TBN = mat3(tangent, bitangent, surfaceNormal);
          return normalize(TBN * mapNormal);
        }
        
        void main() {
          vec2 textureUv = vPosition.xz * (1.0 / TEXTURE_SCALE);
          
          // Sample noise for anti-tiling
          float noiseVal = texture2D(uNoiseTexture, textureUv * 0.005).r;
          
          // Sample diffuse and normal maps
          vec4 diffMapColor = blendMaterials(uDiffMap, textureUv, noiseVal);
          vec4 normalMapSample = blendMaterials(uNormalMap, textureUv, noiseVal);
          
          // Calculate perturbed normal
          vec3 normal = perturbNormal(normalMapSample.rgb, normalize(vWorldNormal));
          
          // Stylized lighting with warm/cool bias
          float NdotL = max(dot(normal, uSunDirection), 0.0);
          
          // Soft wrap lighting for painterly look
          float wrapLight = NdotL * 0.5 + 0.5;
          wrapLight = pow(wrapLight, 1.5);
          
          // Warm light in direct sun, cool in shadow
          vec3 warmLight = uSunColor * wrapLight;
          vec3 coolShadow = uAmbientColor * (1.0 - NdotL * 0.5);
          
          vec3 finalColor = diffMapColor.rgb * (warmLight + coolShadow);
          
          // Subtle height-based color variation (atmospheric perspective)
          float heightFog = smoothstep(0.0, 60.0, vHeight);
          vec3 atmosphereColor = vec3(0.7, 0.8, 0.95);
          finalColor = mix(finalColor, finalColor * atmosphereColor, heightFog * 0.15);
          
          // Stylized contrast boost
          finalColor = pow(finalColor, vec3(0.95));
          
          // Gamma correction
          finalColor = pow(finalColor, vec3(1.0 / 2.2));
          
          gl_FragColor = vec4(finalColor, 1.0);
        }
      `,
      side: THREE.FrontSide,
      transparent: false,
      depthWrite: true,
      depthTest: true,
    });
  }

  /**
   * Update time uniform for animated effects
   */
  setTime(time: number): void {
    this.uniforms.uTime.value = time;
  }

  /**
   * Update sun direction for lighting
   */
  setSunDirection(direction: THREE.Vector3): void {
    this.uniforms.uSunDirection.value.copy(direction.normalize());
  }

  /**
   * Update sun color
   */
  setSunColor(color: THREE.Color): void {
    this.uniforms.uSunColor.value.copy(color);
  }

  /**
   * Update ambient light color
   */
  setAmbientColor(color: THREE.Color): void {
    this.uniforms.uAmbientColor.value.copy(color);
  }

  /**
   * Set normal map strength (0-1)
   */
  setNormalStrength(strength: number): void {
    this.uniforms.uNormalStrength.value = Math.max(0, Math.min(1, strength));
  }
}
