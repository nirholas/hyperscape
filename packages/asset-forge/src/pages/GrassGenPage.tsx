/**
 * GrassGenPage
 * Page for procedural grass generation with wind animation preview
 *
 * Features:
 * - Real-time grass rendering with GLSL wind shaders
 * - Wind animation controls
 * - Biome density presets
 * - Performance statistics
 * - Export grass configuration
 *
 * NOTE: This preview page uses GLSL ShaderMaterial for the grass visualization.
 * This is intentional for the asset-forge tooling environment which may run
 * in WebGL contexts. The actual game engine uses TSL/WebGPU for grass rendering
 * via the VegetationSystem and GPUVegetation systems in packages/shared.
 *
 * For WebGPU-compatible grass rendering at runtime, see:
 * - packages/shared/src/systems/shared/world/VegetationSystem.ts
 * - packages/shared/src/systems/shared/world/GPUVegetation.ts
 */

import {
  Leaf,
  RefreshCw,
  Settings2,
  Wind,
  Gauge,
  Sun,
  Moon,
  Palette,
  Download,
} from "lucide-react";
import React, { useRef, useEffect, useState, useCallback } from "react";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { MeshStandardNodeMaterial } from "three/webgpu";

import { notify } from "@/utils/notify";
import {
  THREE,
  createWebGPURenderer,
  type AssetForgeRenderer,
} from "@/utils/webgpu-renderer";

// ============================================================================
// GRASS CONFIGURATION
// ============================================================================

interface GrassConfig {
  bladeHeight: number;
  bladeWidth: number;
  bladeSegments: number;
  density: number;
  patchSize: number;
  windSpeed: number;
  windStrength: number;
  gustSpeed: number;
  flutterIntensity: number;
  baseColor: string;
  tipColor: string;
  dryColorMix: number;
}

const DEFAULT_CONFIG: GrassConfig = {
  bladeHeight: 0.4,
  bladeWidth: 0.04,
  bladeSegments: 4,
  density: 8,
  patchSize: 20,
  windSpeed: 1.2,
  windStrength: 1.0,
  gustSpeed: 0.4,
  flutterIntensity: 0.15,
  // Colors matched to TerrainShader.ts grassGreen (0.3, 0.55, 0.15)
  baseColor: "#4d8c26", // rgb(77, 140, 38) ≈ (0.3, 0.55, 0.15)
  tipColor: "#619e38", // Slightly lighter tip (0.38, 0.62, 0.22)
  dryColorMix: 0.2,
};

// Biome presets - colors matched to TerrainShader.ts
const BIOME_PRESETS: Record<string, Partial<GrassConfig>> = {
  plains: {
    density: 10,
    bladeHeight: 0.45,
    windStrength: 1.2,
    baseColor: "#4d8c26", // Matches terrain grassGreen
    tipColor: "#619e38",
    dryColorMix: 0.15,
  },
  forest: {
    density: 5,
    bladeHeight: 0.35,
    windStrength: 0.6,
    baseColor: "#386b1a", // Matches terrain grassDark
    tipColor: "#4d8c26",
    dryColorMix: 0.1,
  },
  hills: {
    density: 7,
    bladeHeight: 0.38,
    windStrength: 1.5,
    baseColor: "#4d8c26",
    tipColor: "#619e38",
    dryColorMix: 0.25,
  },
  swamp: {
    density: 6,
    bladeHeight: 0.55,
    windStrength: 0.4,
    baseColor: "#386b1a", // Darker, wetter grass
    tipColor: "#4d8c26",
    dryColorMix: 0.05,
  },
  savanna: {
    density: 4,
    bladeHeight: 0.7,
    windStrength: 1.8,
    baseColor: "#6b8c3b", // Yellower for dry savanna
    tipColor: "#8ca852",
    dryColorMix: 0.4,
  },
};

// ============================================================================
// GRASS SHADERS (GLSL)
// ============================================================================

const GRASS_VERTEX_SHADER = `
  uniform float time;
  uniform float windStrength;
  uniform float windSpeed;
  uniform float gustSpeed;
  uniform float flutterIntensity;
  uniform vec3 windDirection;
  uniform float bladeHeight;
  uniform float bladeWidth;

  attribute vec4 instancePosition;
  attribute vec4 instanceVariation;

  varying vec2 vUv;
  varying float vColorVar;

  void main() {
    vUv = uv;

    // Instance data
    vec3 worldPos = instancePosition.xyz;
    float heightScale = instancePosition.w;
    float rotation = instanceVariation.x;
    float widthScale = instanceVariation.y;
    vColorVar = instanceVariation.z;
    float phaseOffset = instanceVariation.w;

    // Scale blade
    float scaledHeight = bladeHeight * heightScale;
    float scaledWidth = bladeWidth * widthScale;

    // Height along blade (0 at base, 1 at tip)
    float heightT = position.y;

    // Wind animation
    float spatialPhase = worldPos.x * 0.1 + worldPos.z * 0.13;
    float primaryWave = sin(time * windSpeed + spatialPhase + phaseOffset);
    float gustWave = sin(time * gustSpeed + spatialPhase * 0.7);
    float flutterWave = sin(time * 4.0 + phaseOffset * 10.0);

    // Height-based influence (more bend at top)
    float heightInfluence = heightT * heightT;
    float tipInfluence = heightT * heightT * heightT;

    float windBend = (primaryWave * 0.7 + gustWave * 0.3) * heightInfluence * windStrength * 0.5;
    float flutter = flutterWave * tipInfluence * flutterIntensity * windStrength;

    // Apply transformations
    float scaledX = position.x * scaledWidth;
    float scaledY = position.y * scaledHeight;

    // Rotate around Y axis
    float cosR = cos(rotation);
    float sinR = sin(rotation);
    float rotatedX = scaledX * cosR;
    float rotatedZ = scaledX * sinR;

    // Apply wind
    float windOffsetX = windBend * windDirection.x * scaledHeight;
    float windOffsetZ = windBend * windDirection.z * scaledHeight;
    float flutterOffsetX = flutter * (-windDirection.z);
    float flutterOffsetZ = flutter * windDirection.x;

    // Final position
    vec3 finalPos;
    finalPos.x = worldPos.x + rotatedX + windOffsetX + flutterOffsetX;
    finalPos.y = worldPos.y + scaledY;
    finalPos.z = worldPos.z + rotatedZ + windOffsetZ + flutterOffsetZ;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(finalPos, 1.0);
  }
`;

const GRASS_FRAGMENT_SHADER = `
  uniform vec3 baseColor;
  uniform vec3 tipColor;
  uniform vec3 darkColor;
  uniform float dryColorMix;

  varying vec2 vUv;
  varying float vColorVar;

  void main() {
    // Subtle gradient from base to tip (darker at base, lighter at tip)
    vec3 gradientColor = mix(baseColor, tipColor, vUv.y * 0.6);

    // Mix in darker color for natural variety (like terrain grass variation)
    vec3 finalColor = mix(gradientColor, darkColor, vColorVar * dryColorMix);

    // Simple AO at base for grounding effect
    float ao = smoothstep(0.0, 0.25, vUv.y);
    finalColor *= 0.65 + 0.35 * ao;

    gl_FragColor = vec4(finalColor, 1.0);
  }
`;

// ============================================================================
// GRASS GEOMETRY GENERATION
// ============================================================================

function createGrassBladeGeometry(segments: number): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  const vertexCount = (segments + 1) * 2;
  const positions = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const normals = new Float32Array(vertexCount * 3);

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const y = t;
    const width = 1.0 - t * 0.7;

    const leftIdx = i * 2;
    positions[leftIdx * 3 + 0] = -0.5 * width;
    positions[leftIdx * 3 + 1] = y;
    positions[leftIdx * 3 + 2] = 0;
    uvs[leftIdx * 2 + 0] = 0;
    uvs[leftIdx * 2 + 1] = t;
    normals[leftIdx * 3 + 0] = 0;
    normals[leftIdx * 3 + 1] = 0;
    normals[leftIdx * 3 + 2] = 1;

    const rightIdx = i * 2 + 1;
    positions[rightIdx * 3 + 0] = 0.5 * width;
    positions[rightIdx * 3 + 1] = y;
    positions[rightIdx * 3 + 2] = 0;
    uvs[rightIdx * 2 + 0] = 1;
    uvs[rightIdx * 2 + 1] = t;
    normals[rightIdx * 3 + 0] = 0;
    normals[rightIdx * 3 + 1] = 0;
    normals[rightIdx * 3 + 2] = 1;
  }

  const triangleCount = segments * 2;
  const indices = new Uint16Array(triangleCount * 3);
  let idx = 0;

  for (let i = 0; i < segments; i++) {
    const base = i * 2;
    indices[idx++] = base;
    indices[idx++] = base + 1;
    indices[idx++] = base + 2;
    indices[idx++] = base + 1;
    indices[idx++] = base + 3;
    indices[idx++] = base + 2;
  }

  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));

  return geometry;
}

// ============================================================================
// GRASS PATCH GENERATION
// ============================================================================

function generateGrassPatch(
  geometry: THREE.BufferGeometry,
  config: GrassConfig,
): { mesh: THREE.InstancedMesh; uniforms: Record<string, THREE.Uniform> } {
  const { density, patchSize } = config;
  const instanceCount = Math.floor(patchSize * patchSize * density);

  // Create uniforms
  const uniforms: Record<string, THREE.Uniform> = {
    time: new THREE.Uniform(0.0),
    windStrength: new THREE.Uniform(config.windStrength),
    windSpeed: new THREE.Uniform(config.windSpeed),
    gustSpeed: new THREE.Uniform(config.gustSpeed),
    flutterIntensity: new THREE.Uniform(config.flutterIntensity),
    windDirection: new THREE.Uniform(new THREE.Vector3(1, 0, 0.3).normalize()),
    bladeHeight: new THREE.Uniform(config.bladeHeight),
    bladeWidth: new THREE.Uniform(config.bladeWidth),
    baseColor: new THREE.Uniform(new THREE.Color(config.baseColor)),
    tipColor: new THREE.Uniform(new THREE.Color(config.tipColor)),
    darkColor: new THREE.Uniform(new THREE.Color(0.22, 0.42, 0.1)), // Matches terrain grassDark
    dryColorMix: new THREE.Uniform(config.dryColorMix),
  };

  // Create shader material
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: GRASS_VERTEX_SHADER,
    fragmentShader: GRASS_FRAGMENT_SHADER,
    side: THREE.DoubleSide,
  });

  // Create instance attributes
  const instancePosition = new THREE.InstancedBufferAttribute(
    new Float32Array(instanceCount * 4),
    4,
  );
  const instanceVariation = new THREE.InstancedBufferAttribute(
    new Float32Array(instanceCount * 4),
    4,
  );

  // Seeded random
  let seed = 12345;
  const random = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };

  const halfSize = patchSize / 2;
  const spacing = Math.sqrt(1 / density);

  let count = 0;
  for (let gx = 0; gx < patchSize && count < instanceCount; gx += spacing) {
    for (let gz = 0; gz < patchSize && count < instanceCount; gz += spacing) {
      const jitterX = (random() - 0.5) * spacing * 0.8;
      const jitterZ = (random() - 0.5) * spacing * 0.8;

      const x = gx - halfSize + jitterX;
      const z = gz - halfSize + jitterZ;
      const y = 0;

      const heightScale = 0.7 + random() * 0.6;
      const rotation = random() * Math.PI * 2;
      const widthScale = 0.8 + random() * 0.4;
      const colorVar = random();
      const phaseOffset = random() * Math.PI * 2;

      instancePosition.setXYZW(count, x, y, z, heightScale);
      instanceVariation.setXYZW(
        count,
        rotation,
        widthScale,
        colorVar,
        phaseOffset,
      );

      count++;
    }
  }

  const clonedGeometry = geometry.clone();
  clonedGeometry.setAttribute("instancePosition", instancePosition);
  clonedGeometry.setAttribute("instanceVariation", instanceVariation);

  const mesh = new THREE.InstancedMesh(clonedGeometry, material, count);
  mesh.count = count;
  mesh.frustumCulled = false;

  return { mesh, uniforms };
}

// ============================================================================
// COMPONENT
// ============================================================================

export const GrassGenPage: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<AssetForgeRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const grassMeshRef = useRef<THREE.InstancedMesh | null>(null);
  const uniformsRef = useRef<Record<string, THREE.Uniform> | null>(null);
  const animationRef = useRef<number>(0);
  const clockRef = useRef<THREE.Clock>(new THREE.Clock());
  const generateGrassRef = useRef<(() => void) | null>(null);

  const [config, setConfig] = useState<GrassConfig>(DEFAULT_CONFIG);
  const [selectedBiome, setSelectedBiome] = useState<string>("plains");
  const [stats, setStats] = useState<{
    instances: number;
    fps: number;
    triangles: number;
  } | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(true);

  // Initialize scene with WebGPU
  useEffect(() => {
    if (!containerRef.current) return;

    let mounted = true;
    const container = containerRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;

    // Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(isDarkMode ? 0x1a1a2e : 0x87ceeb);
    sceneRef.current = scene;

    // Camera
    const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 1000);
    camera.position.set(8, 5, 8);
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    // Lighting (can add before renderer)
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0);
    directionalLight.position.set(5, 10, 5);
    directionalLight.castShadow = true;
    scene.add(directionalLight);

    // Hemisphere light for better outdoor lighting
    const hemiLight = new THREE.HemisphereLight(0x87ceeb, 0x3d5a2c, 0.4);
    scene.add(hemiLight);

    // Ground plane
    const groundGeometry = new THREE.PlaneGeometry(50, 50);
    const groundMaterial = new MeshStandardNodeMaterial();
    groundMaterial.color = new THREE.Color(isDarkMode ? 0x2d4a1c : 0x3d5a2c);
    groundMaterial.roughness = 1;
    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.01;
    ground.receiveShadow = true;
    scene.add(ground);

    // Grid helper
    const gridHelper = new THREE.GridHelper(50, 50, 0x444444, 0x333333);
    gridHelper.position.y = 0.01;
    scene.add(gridHelper);

    // Async WebGPU renderer initialization
    const initRenderer = async () => {
      const renderer = await createWebGPURenderer({
        antialias: true,
        alpha: true,
      });

      if (!mounted) {
        renderer.dispose();
        return;
      }

      renderer.setSize(width, height);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      container.appendChild(renderer.domElement);
      rendererRef.current = renderer;

      // Controls (need renderer.domElement)
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.05;
      controls.target.set(0, 0.5, 0);
      controls.update();
      controlsRef.current = controls;

      // Generate initial grass (after renderer is ready)
      // Use ref to avoid dependency on generateGrass callback
      generateGrassRef.current?.();

      // Animation loop
      let frameCount = 0;
      let fpsAccumulator = 0;

      const animate = () => {
        if (!mounted) return;
        animationRef.current = requestAnimationFrame(animate);

        const delta = clockRef.current.getDelta();
        const elapsed = clockRef.current.getElapsedTime();

        // Update wind uniforms
        if (uniformsRef.current) {
          uniformsRef.current.time.value = elapsed;
        }

        controls.update();
        renderer.render(scene, camera);

        // FPS calculation
        frameCount++;
        fpsAccumulator += delta;
        if (fpsAccumulator >= 1.0) {
          const fps = Math.round(frameCount / fpsAccumulator);
          setStats((prev) => (prev ? { ...prev, fps } : null));
          frameCount = 0;
          fpsAccumulator = 0;
        }
      };

      animate();
    };

    initRenderer();

    // Resize handler
    const handleResize = () => {
      if (!container || !rendererRef.current) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      rendererRef.current.setSize(w, h);
    };

    window.addEventListener("resize", handleResize);

    return () => {
      mounted = false;
      window.removeEventListener("resize", handleResize);
      cancelAnimationFrame(animationRef.current);

      // Dispose WebGPU renderer
      if (rendererRef.current) {
        if (container.contains(rendererRef.current.domElement)) {
          container.removeChild(rendererRef.current.domElement);
        }
        rendererRef.current.dispose();
        rendererRef.current = null;
      }

      controlsRef.current?.dispose();
    };
  }, [isDarkMode]);

  // Generate grass
  const generateGrass = useCallback(() => {
    if (!sceneRef.current) return;

    setIsGenerating(true);

    // Remove existing grass
    if (grassMeshRef.current) {
      sceneRef.current.remove(grassMeshRef.current);
      grassMeshRef.current.geometry.dispose();
      if (grassMeshRef.current.material instanceof THREE.Material) {
        grassMeshRef.current.material.dispose();
      }
    }

    try {
      const geometry = createGrassBladeGeometry(config.bladeSegments);
      const { mesh, uniforms } = generateGrassPatch(geometry, config);

      sceneRef.current.add(mesh);
      grassMeshRef.current = mesh;
      uniformsRef.current = uniforms;

      const triangles = mesh.count * config.bladeSegments * 2;
      setStats({
        instances: mesh.count,
        fps: 0, // Will be updated by animation loop
        triangles,
      });

      notify.success(`Generated ${mesh.count.toLocaleString()} grass blades`);
    } catch (error) {
      console.error("Failed to generate grass:", error);
      notify.error("Failed to generate grass");
    }

    setIsGenerating(false);
  }, [config]);

  // Keep ref updated for initialization effect
  useEffect(() => {
    generateGrassRef.current = generateGrass;
  }, [generateGrass]);

  // Apply biome preset
  const applyBiomePreset = (biomeName: string) => {
    const preset = BIOME_PRESETS[biomeName];
    if (preset) {
      setConfig((prev) => ({ ...prev, ...preset }));
      setSelectedBiome(biomeName);
    }
  };

  // Update config handler
  const updateConfig = <K extends keyof GrassConfig>(
    key: K,
    value: GrassConfig[K],
  ) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
  };

  // Export config
  const exportConfig = () => {
    const configJson = JSON.stringify(config, null, 2);
    const blob = new Blob([configJson], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `grass-config-${selectedBiome}.json`;
    a.click();
    URL.revokeObjectURL(url);
    notify.success("Configuration exported");
  };

  return (
    <div className="flex h-[calc(100vh-60px)]">
      {/* Sidebar Controls */}
      <div className="w-80 bg-bg-secondary border-r border-border-primary overflow-y-auto">
        <div className="p-4 space-y-6">
          {/* Header */}
          <div className="flex items-center gap-3">
            <Leaf className="text-green-500" size={24} />
            <h1 className="text-lg font-semibold text-text-primary">
              Grass Generator
            </h1>
          </div>

          {/* Info Box */}
          <div className="bg-bg-tertiary rounded-md p-3 text-xs text-text-secondary">
            <p>
              <strong>WebGPU Preview:</strong> This preview uses WebGL shaders.
              In the game engine, grass renders with optimized WebGPU TSL
              shaders for better performance with millions of blades.
            </p>
          </div>

          {/* Biome Presets */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-text-secondary flex items-center gap-2">
              <Palette size={14} />
              Biome Preset
            </label>
            <select
              value={selectedBiome}
              onChange={(e) => applyBiomePreset(e.target.value)}
              className="w-full bg-bg-tertiary border border-border-primary rounded-md px-3 py-2 text-sm text-text-primary"
            >
              {Object.keys(BIOME_PRESETS).map((biome) => (
                <option key={biome} value={biome}>
                  {biome.charAt(0).toUpperCase() + biome.slice(1)}
                </option>
              ))}
            </select>
          </div>

          {/* Grass Settings */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-text-secondary flex items-center gap-2">
              <Settings2 size={14} />
              Grass Settings
            </h3>

            <div className="space-y-3">
              <div>
                <label className="text-xs text-text-tertiary">
                  Blade Height: {config.bladeHeight.toFixed(2)}m
                </label>
                <input
                  type="range"
                  min="0.1"
                  max="1.0"
                  step="0.05"
                  value={config.bladeHeight}
                  onChange={(e) =>
                    updateConfig("bladeHeight", parseFloat(e.target.value))
                  }
                  className="w-full"
                />
              </div>

              <div>
                <label className="text-xs text-text-tertiary">
                  Density: {config.density} per m²
                </label>
                <input
                  type="range"
                  min="1"
                  max="20"
                  step="1"
                  value={config.density}
                  onChange={(e) =>
                    updateConfig("density", parseInt(e.target.value))
                  }
                  className="w-full"
                />
              </div>

              <div>
                <label className="text-xs text-text-tertiary">
                  Patch Size: {config.patchSize}m
                </label>
                <input
                  type="range"
                  min="5"
                  max="50"
                  step="5"
                  value={config.patchSize}
                  onChange={(e) =>
                    updateConfig("patchSize", parseInt(e.target.value))
                  }
                  className="w-full"
                />
              </div>
            </div>
          </div>

          {/* Wind Settings */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-text-secondary flex items-center gap-2">
              <Wind size={14} />
              Wind Animation
            </h3>

            <div className="space-y-3">
              <div>
                <label className="text-xs text-text-tertiary">
                  Wind Strength: {config.windStrength.toFixed(1)}
                </label>
                <input
                  type="range"
                  min="0"
                  max="3"
                  step="0.1"
                  value={config.windStrength}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    updateConfig("windStrength", val);
                    if (uniformsRef.current) {
                      uniformsRef.current.windStrength.value = val;
                    }
                  }}
                  className="w-full"
                />
              </div>

              <div>
                <label className="text-xs text-text-tertiary">
                  Wind Speed: {config.windSpeed.toFixed(1)}
                </label>
                <input
                  type="range"
                  min="0.1"
                  max="3"
                  step="0.1"
                  value={config.windSpeed}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    updateConfig("windSpeed", val);
                    if (uniformsRef.current) {
                      uniformsRef.current.windSpeed.value = val;
                    }
                  }}
                  className="w-full"
                />
              </div>

              <div>
                <label className="text-xs text-text-tertiary">
                  Flutter Intensity: {config.flutterIntensity.toFixed(2)}
                </label>
                <input
                  type="range"
                  min="0"
                  max="0.5"
                  step="0.05"
                  value={config.flutterIntensity}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    updateConfig("flutterIntensity", val);
                    if (uniformsRef.current) {
                      uniformsRef.current.flutterIntensity.value = val;
                    }
                  }}
                  className="w-full"
                />
              </div>
            </div>
          </div>

          {/* Color Settings */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-text-secondary flex items-center gap-2">
              <Palette size={14} />
              Colors
            </h3>

            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <label className="text-xs text-text-tertiary w-20">Base</label>
                <input
                  type="color"
                  value={config.baseColor}
                  onChange={(e) => updateConfig("baseColor", e.target.value)}
                  className="w-10 h-8 rounded cursor-pointer"
                />
                <span className="text-xs text-text-tertiary">
                  {config.baseColor}
                </span>
              </div>

              <div className="flex items-center gap-3">
                <label className="text-xs text-text-tertiary w-20">Tip</label>
                <input
                  type="color"
                  value={config.tipColor}
                  onChange={(e) => updateConfig("tipColor", e.target.value)}
                  className="w-10 h-8 rounded cursor-pointer"
                />
                <span className="text-xs text-text-tertiary">
                  {config.tipColor}
                </span>
              </div>

              <div>
                <label className="text-xs text-text-tertiary">
                  Dry Color Mix: {(config.dryColorMix * 100).toFixed(0)}%
                </label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={config.dryColorMix}
                  onChange={(e) =>
                    updateConfig("dryColorMix", parseFloat(e.target.value))
                  }
                  className="w-full"
                />
              </div>
            </div>
          </div>

          {/* Generate Button */}
          <button
            onClick={generateGrass}
            disabled={isGenerating}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-green-600 hover:bg-green-700 text-white rounded-md font-medium transition-colors disabled:opacity-50"
          >
            <RefreshCw
              size={18}
              className={isGenerating ? "animate-spin" : ""}
            />
            {isGenerating ? "Generating..." : "Regenerate Grass"}
          </button>

          {/* Export Button */}
          <button
            onClick={exportConfig}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-bg-tertiary hover:bg-bg-primary text-text-secondary rounded-md text-sm transition-colors"
          >
            <Download size={16} />
            Export Configuration
          </button>

          {/* Stats */}
          {stats && (
            <div className="bg-bg-tertiary rounded-md p-3 space-y-2">
              <h3 className="text-sm font-medium text-text-secondary flex items-center gap-2">
                <Gauge size={14} />
                Statistics
              </h3>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-text-tertiary">Instances:</span>
                  <span className="text-text-primary ml-2">
                    {stats.instances.toLocaleString()}
                  </span>
                </div>
                <div>
                  <span className="text-text-tertiary">Triangles:</span>
                  <span className="text-text-primary ml-2">
                    {stats.triangles.toLocaleString()}
                  </span>
                </div>
                <div>
                  <span className="text-text-tertiary">FPS:</span>
                  <span className="text-text-primary ml-2">{stats.fps}</span>
                </div>
              </div>
            </div>
          )}

          {/* Theme Toggle */}
          <button
            onClick={() => setIsDarkMode(!isDarkMode)}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-bg-tertiary hover:bg-bg-primary text-text-secondary rounded-md text-sm transition-colors"
          >
            {isDarkMode ? <Sun size={16} /> : <Moon size={16} />}
            {isDarkMode ? "Light Mode" : "Dark Mode"}
          </button>
        </div>
      </div>

      {/* 3D Viewport */}
      <div className="flex-1 relative">
        <div ref={containerRef} className="w-full h-full" />
      </div>
    </div>
  );
};
