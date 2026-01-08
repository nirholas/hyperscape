/**
 * DevStats.ts - Development Performance Monitoring System
 *
 * Provides real-time performance telemetry in dev mode:
 * - FPS counter with frame time
 * - Memory usage (if available)
 * - Draw calls, triangles, textures
 * - Per-system timing breakdown
 *
 * Displays as a stylish overlay in the top-left corner.
 * Toggle with \ (backslash) key or world.devStats.toggle()
 *
 * @client-only
 */

import type { World } from "../../core/World";
import type { WorldOptions } from "../../types";
import { System } from "../shared";
import { BIOMES } from "../../data/world-structure";
import type { TerrainSystem } from "../shared/world/TerrainSystem";
import type { WaterSystem } from "../shared/world/WaterSystem";
import THREE from "../../extras/three/three";

/** Performance sample for rolling averages */
type FrameSample = {
  fps: number;
  frameTime: number;
  timestamp: number;
};

/** Per-system timing data */
type SystemTiming = {
  name: string;
  updateTime: number;
  fixedUpdateTime: number;
  samples: number[];
  avgTime: number;
};

/** Renderer info snapshot (matches WebGPURenderer.info structure) */
type RenderInfo = {
  drawCalls: number;
  triangles: number;
  textures: number;
  geometries: number;
};

/**
 * DevStats System
 *
 * Lightweight performance monitoring for development.
 * Attaches to the renderer and tracks frame timing.
 */
export class DevStats extends System {
  // UI Elements
  private container: HTMLDivElement | null = null;
  private fpsElement: HTMLElement | null = null;
  private frameTimeElement: HTMLElement | null = null;
  private memoryElement: HTMLDivElement | null = null;
  private rendererElement: HTMLDivElement | null = null;
  private sceneElement: HTMLDivElement | null = null;
  private systemsElement: HTMLDivElement | null = null;
  private playerElement: HTMLDivElement | null = null;
  private biomeElement: HTMLDivElement | null = null;
  private timingElement: HTMLDivElement | null = null;
  private waterElement: HTMLDivElement | null = null;

  // State
  private enabled = false;
  private visible = false;
  private lastFrameTime = 0;
  private frameCount = 0;
  private lastFpsUpdate = 0;
  private currentFps = 0;
  private currentFrameTime = 0;

  // Rolling samples for smooth display
  private frameSamples: FrameSample[] = [];
  private maxSamples = 60;

  // System timing
  private systemTimings = new Map<string, SystemTiming>();
  private measureSystems = false;
  private tickStartTime = 0;

  // Update frequency
  private updateInterval = 100; // ms
  private lastUIUpdate = 0;

  // Per-frame render stats (reset each frame for accurate counts)
  private frameDrawCalls = 0;
  private frameTriangles = 0;

  // CPU/Render timing
  private renderStartTime = 0;
  private lastRenderTime = 0;
  private lastCpuTime = 0;
  private renderTimeSamples: number[] = [];
  private cpuTimeSamples: number[] = [];

  constructor(world: World) {
    super(world);
  }

  getDependencies() {
    return {
      required: ["graphics"],
      optional: [],
    };
  }

  override async init(options: WorldOptions): Promise<void> {
    // Check if dev mode (from env or options)
    const enableByDefault =
      typeof window !== "undefined" &&
      (window.location.hostname === "localhost" ||
        window.location.hostname === "127.0.0.1" ||
        window.location.search.includes("devstats=true"));

    this.enabled = enableByDefault;

    if (this.enabled && typeof document !== "undefined") {
      this.createUI();
      this.setupKeyboardToggle();
      this.setupDevHotkeys();
    }

    await super.init(options);
  }

  override start(): void {
    // Auto-show stats in dev mode
    if (this.enabled) {
      this.show();
    }
    super.start();
  }

  /**
   * Create the stats UI overlay
   */
  private createUI(): void {
    // Container
    this.container = document.createElement("div");
    this.container.id = "hyperscape-dev-stats";
    this.container.style.cssText = `
      position: fixed;
      top: 12px;
      left: 12px;
      z-index: 99999;
      font-family: 'JetBrains Mono', 'Fira Code', 'SF Mono', 'Monaco', monospace;
      font-size: 11px;
      line-height: 1.4;
      color: #e0e0e0;
      background: linear-gradient(135deg, rgba(15, 15, 20, 0.92) 0%, rgba(25, 25, 35, 0.88) 100%);
      border: 1px solid rgba(100, 200, 255, 0.2);
      border-radius: 8px;
      padding: 10px 14px;
      min-width: 180px;
      backdrop-filter: blur(8px);
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.05);
      pointer-events: none;
      user-select: none;
      display: none;
      transition: opacity 0.15s ease;
    `;

    // Header with FPS
    const header = document.createElement("div");
    header.style.cssText = `
      display: flex;
      align-items: baseline;
      gap: 8px;
      margin-bottom: 8px;
      padding-bottom: 6px;
      border-bottom: 1px solid rgba(100, 200, 255, 0.15);
    `;

    this.fpsElement = document.createElement("span");
    this.fpsElement.style.cssText = `
      font-size: 20px;
      font-weight: 700;
      color: #4ade80;
      text-shadow: 0 0 10px rgba(74, 222, 128, 0.3);
    `;
    this.fpsElement.textContent = "-- ";

    const fpsLabel = document.createElement("span");
    fpsLabel.style.cssText = `color: #888; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px;`;
    fpsLabel.textContent = "FPS";

    this.frameTimeElement = document.createElement("span");
    this.frameTimeElement.style.cssText = `
      margin-left: auto;
      color: #94a3b8;
      font-size: 10px;
    `;
    this.frameTimeElement.textContent = "-- ms";

    header.appendChild(this.fpsElement);
    header.appendChild(fpsLabel);
    header.appendChild(this.frameTimeElement);
    this.container.appendChild(header);

    // Memory section
    this.memoryElement = document.createElement("div");
    this.memoryElement.style.cssText = `
      margin-bottom: 6px;
      color: #94a3b8;
      font-size: 10px;
    `;
    this.container.appendChild(this.memoryElement);

    // Renderer info section
    this.rendererElement = document.createElement("div");
    this.rendererElement.style.cssText = `
      margin-bottom: 6px;
      padding-top: 6px;
      border-top: 1px solid rgba(100, 200, 255, 0.1);
      color: #94a3b8;
      font-size: 10px;
    `;
    this.container.appendChild(this.rendererElement);

    // Scene stats section
    this.sceneElement = document.createElement("div");
    this.sceneElement.style.cssText = `
      margin-bottom: 6px;
      padding-top: 6px;
      border-top: 1px solid rgba(100, 200, 255, 0.1);
      color: #94a3b8;
      font-size: 10px;
    `;
    this.container.appendChild(this.sceneElement);

    // Player position section
    this.playerElement = document.createElement("div");
    this.playerElement.style.cssText = `
      margin-bottom: 6px;
      padding-top: 6px;
      border-top: 1px solid rgba(100, 200, 255, 0.1);
      color: #94a3b8;
      font-size: 10px;
    `;
    this.container.appendChild(this.playerElement);

    // Biome section
    this.biomeElement = document.createElement("div");
    this.biomeElement.style.cssText = `
      margin-bottom: 6px;
      color: #94a3b8;
      font-size: 10px;
    `;
    this.container.appendChild(this.biomeElement);

    // CPU/GPU timing section
    this.timingElement = document.createElement("div");
    this.timingElement.style.cssText = `
      margin-bottom: 6px;
      padding-top: 6px;
      border-top: 1px solid rgba(100, 200, 255, 0.1);
      color: #94a3b8;
      font-size: 10px;
    `;
    this.container.appendChild(this.timingElement);

    // Water/Reflection section
    this.waterElement = document.createElement("div");
    this.waterElement.style.cssText = `
      margin-bottom: 6px;
      padding-top: 6px;
      border-top: 1px solid rgba(100, 200, 255, 0.1);
      color: #94a3b8;
      font-size: 10px;
    `;
    this.container.appendChild(this.waterElement);

    // Systems section (initially hidden)
    this.systemsElement = document.createElement("div");
    this.systemsElement.style.cssText = `
      margin-top: 6px;
      padding-top: 6px;
      border-top: 1px solid rgba(100, 200, 255, 0.1);
      color: #94a3b8;
      font-size: 9px;
      display: none;
    `;
    this.container.appendChild(this.systemsElement);

    document.body.appendChild(this.container);
  }

  /**
   * Setup keyboard toggle (backslash key)
   */
  private setupKeyboardToggle(): void {
    document.addEventListener("keydown", (e) => {
      if (e.key === "\\" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // Prevent typing backslash in inputs
        if (
          e.target instanceof HTMLInputElement ||
          e.target instanceof HTMLTextAreaElement
        ) {
          return;
        }
        e.preventDefault();
        this.toggle();
      }
    });
  }

  /**
   * Setup dev hotkeys (only in dev mode)
   * - Delete: Teleport player to origin (0, 0, 0)
   */
  private setupDevHotkeys(): void {
    console.log("[DevStats] Setting up dev hotkeys");
    document.addEventListener("keydown", (e) => {
      // Skip if typing in input
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      // Delete key: Teleport to origin
      if (e.key === "Delete") {
        console.log("[DevStats] Delete key pressed - triggering teleport");
        e.preventDefault();
        this.teleportToOrigin();
      }
    });
  }

  /**
   * Teleport the local player to origin (0, 0, 0)
   * Sends a server command to perform the teleport authoritatively
   */
  private teleportToOrigin(): void {
    const player = this.world.getPlayer();
    if (!player) {
      console.warn("[DevStats] No player found to teleport");
      return;
    }

    console.log("[DevStats] Requesting server teleport to origin (0, 0, 0)");

    // Check if network is available
    const network = this.world.network;
    console.log("[DevStats] Network state:", {
      hasNetwork: !!network,
      isClient: network?.isClient,
      hasSend: !!(network as { send?: unknown })?.send,
    });

    // Send teleport command to server - server sends playerTeleport packet
    // which properly resets tile movement state on the client
    this.world.chat.command("/teleport 0 0 0");
    console.log("[DevStats] Command sent");
  }

  /**
   * Toggle stats visibility
   */
  toggle(): void {
    if (this.visible) {
      this.hide();
    } else {
      this.show();
    }
  }

  /**
   * Show stats overlay
   */
  show(): void {
    if (!this.container) {
      this.createUI();
    }
    if (this.container) {
      this.container.style.display = "block";
      this.visible = true;
    }
  }

  /**
   * Hide stats overlay
   */
  hide(): void {
    if (this.container) {
      this.container.style.display = "none";
      this.visible = false;
    }
  }

  /**
   * Enable system timing measurements (more detailed but slightly slower)
   */
  enableSystemTiming(): void {
    this.measureSystems = true;
    if (this.systemsElement) {
      this.systemsElement.style.display = "block";
    }
  }

  /**
   * Disable system timing measurements
   */
  disableSystemTiming(): void {
    this.measureSystems = false;
    if (this.systemsElement) {
      this.systemsElement.style.display = "none";
    }
  }

  private preCommitTime = 0;

  override preTick(): void {
    this.tickStartTime = performance.now();
  }

  override postLateUpdate(_delta: number): void {
    // Record time right before commit phase (render)
    this.preCommitTime = performance.now();
  }

  override postTick(): void {
    if (!this.enabled) return;

    const now = performance.now();
    const frameTime = now - this.tickStartTime;

    // Calculate CPU vs render time
    // CPU time = time from tick start until commit phase
    // Render time = time spent in commit phase (render submission)
    const cpuTime = this.preCommitTime - this.tickStartTime;
    const renderTime = now - this.preCommitTime;

    // Store samples for averaging
    this.cpuTimeSamples.push(cpuTime);
    this.renderTimeSamples.push(renderTime);
    if (this.cpuTimeSamples.length > this.maxSamples) {
      this.cpuTimeSamples.shift();
      this.renderTimeSamples.shift();
    }
    this.lastCpuTime = cpuTime;
    this.lastRenderTime = renderTime;

    // Update frame counter
    this.frameCount++;

    // Calculate FPS every second
    if (now - this.lastFpsUpdate >= 1000) {
      this.currentFps = Math.round(
        (this.frameCount * 1000) / (now - this.lastFpsUpdate),
      );
      this.frameCount = 0;
      this.lastFpsUpdate = now;
    }

    // Capture per-frame render stats and reset for next frame
    this.updatePerFrameRenderStats();

    // Store frame sample
    this.currentFrameTime = frameTime;
    this.frameSamples.push({
      fps: this.currentFps,
      frameTime,
      timestamp: now,
    });

    // Trim old samples
    if (this.frameSamples.length > this.maxSamples) {
      this.frameSamples.shift();
    }

    // Update UI at fixed interval
    if (this.visible && now - this.lastUIUpdate >= this.updateInterval) {
      this.updateUI();
      this.lastUIUpdate = now;
    }

    this.lastFrameTime = now;
  }

  /**
   * Capture per-frame render statistics and reset for next frame
   * Three.js renderer.info accumulates until reset() is called
   */
  private updatePerFrameRenderStats(): void {
    const graphics = this.world.graphics;
    if (!graphics?.renderer) return;

    const renderer = graphics.renderer as {
      info: {
        render: { triangles: number; calls: number };
        memory: { geometries: number; textures: number };
        reset?: () => void;
      };
    };

    const info = renderer.info;
    if (!info) return;

    // Capture this frame's stats (accumulated since last reset)
    this.frameDrawCalls = info.render.calls;
    this.frameTriangles = info.render.triangles;

    // Reset for next frame so values don't accumulate forever
    // Both WebGLRenderer and WebGPURenderer support info.reset()
    if (info.reset) {
      info.reset();
    }
  }

  /**
   * Update the UI elements with current stats
   */
  private updateUI(): void {
    if (!this.container) return;

    // FPS with color coding
    if (this.fpsElement) {
      const fps = this.currentFps;
      this.fpsElement.textContent = String(fps);

      // Color based on performance
      if (fps >= 55) {
        this.fpsElement.style.color = "#4ade80"; // Green
        this.fpsElement.style.textShadow = "0 0 10px rgba(74, 222, 128, 0.3)";
      } else if (fps >= 30) {
        this.fpsElement.style.color = "#fbbf24"; // Yellow
        this.fpsElement.style.textShadow = "0 0 10px rgba(251, 191, 36, 0.3)";
      } else {
        this.fpsElement.style.color = "#ef4444"; // Red
        this.fpsElement.style.textShadow = "0 0 10px rgba(239, 68, 68, 0.3)";
      }
    }

    // Frame time
    if (this.frameTimeElement) {
      const avgFrameTime = this.getAverageFrameTime();
      this.frameTimeElement.textContent = `${avgFrameTime.toFixed(1)} ms`;
    }

    // Memory info (if available)
    if (this.memoryElement) {
      const memory = this.getMemoryInfo();
      if (memory) {
        this.memoryElement.innerHTML = `
          <div style="display: flex; justify-content: space-between;">
            <span>Memory:</span>
            <span style="color: #e0e0e0;">${memory.usedMB.toFixed(0)} / ${memory.totalMB.toFixed(0)} MB</span>
          </div>
        `;
        this.memoryElement.style.display = "block";
      } else {
        this.memoryElement.style.display = "none";
      }
    }

    // Renderer info
    if (this.rendererElement) {
      const info = this.getRendererInfo();
      if (info) {
        this.rendererElement.innerHTML = `
          <div style="display: flex; justify-content: space-between;">
            <span>Draw calls:</span>
            <span style="color: #e0e0e0;">${info.drawCalls.toLocaleString()}</span>
          </div>
          <div style="display: flex; justify-content: space-between;">
            <span>Triangles:</span>
            <span style="color: #e0e0e0;">${this.formatNumber(info.triangles)}</span>
          </div>
          <div style="display: flex; justify-content: space-between;">
            <span>Textures:</span>
            <span style="color: #e0e0e0;">${info.textures}</span>
          </div>
          <div style="display: flex; justify-content: space-between;">
            <span>Geometries:</span>
            <span style="color: #e0e0e0;">${info.geometries}</span>
          </div>
        `;
      }
    }

    // Scene info
    if (this.sceneElement) {
      const sceneInfo = this.getSceneInfo();
      if (sceneInfo) {
        this.sceneElement.innerHTML = `
          <div style="display: flex; justify-content: space-between;">
            <span>Objects:</span>
            <span style="color: #e0e0e0;">${this.formatNumber(sceneInfo.totalObjects)}</span>
          </div>
          <div style="display: flex; justify-content: space-between;">
            <span>Lights:</span>
            <span style="color: #fbbf24;">${sceneInfo.lightCount}</span>
          </div>
          <div style="display: flex; justify-content: space-between;">
            <span>Entities:</span>
            <span style="color: #e0e0e0;">${sceneInfo.entityCount}</span>
          </div>
          <div style="display: flex; justify-content: space-between;">
            <span>Systems:</span>
            <span style="color: #e0e0e0;">${sceneInfo.systemCount}</span>
          </div>
        `;
      }
    }

    // Player position
    if (this.playerElement) {
      const player = this.world.getPlayer();
      if (player) {
        const pos = player.position;
        this.playerElement.innerHTML = `
          <div style="display: flex; justify-content: space-between;">
            <span>Position:</span>
            <span style="color: #60a5fa; font-family: monospace;">${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)}</span>
          </div>
        `;
        this.playerElement.style.display = "block";

        // Update biome based on player position
        if (this.biomeElement) {
          const biomeInfo = this.getBiomeInfo(pos.x, pos.z);
          if (biomeInfo) {
            this.biomeElement.innerHTML = `
              <div style="display: flex; justify-content: space-between;">
                <span>Biome:</span>
                <span style="color: ${biomeInfo.color};">${biomeInfo.name}</span>
              </div>
            `;
            this.biomeElement.style.display = "block";
          } else {
            this.biomeElement.style.display = "none";
          }
        }
      } else {
        this.playerElement.style.display = "none";
        if (this.biomeElement) {
          this.biomeElement.style.display = "none";
        }
      }
    }

    // CPU/Render timing
    if (this.timingElement) {
      const avgCpu = this.getAverageCpuTime();
      const avgRender = this.getAverageRenderTime();
      // Color coding: green < 8ms, yellow 8-16ms, red > 16ms
      const cpuColor =
        avgCpu < 8 ? "#4ade80" : avgCpu < 16 ? "#fbbf24" : "#ef4444";
      const renderColor =
        avgRender < 8 ? "#4ade80" : avgRender < 16 ? "#fbbf24" : "#ef4444";
      this.timingElement.innerHTML = `
        <div style="display: flex; justify-content: space-between;">
          <span>CPU:</span>
          <span style="color: ${cpuColor};">${avgCpu.toFixed(1)} ms</span>
        </div>
        <div style="display: flex; justify-content: space-between;">
          <span>Render:</span>
          <span style="color: ${renderColor};">${avgRender.toFixed(1)} ms</span>
        </div>
      `;
    }

    // Water/Reflection info
    if (this.waterElement) {
      const waterInfo = this.getWaterInfo();
      if (waterInfo) {
        const reflectionColor = waterInfo.reflectionActive
          ? "#4ade80"
          : "#ef4444";
        const reflectionStatus = waterInfo.reflectionActive ? "ON" : "OFF";
        this.waterElement.innerHTML = `
          <div style="display: flex; justify-content: space-between;">
            <span>Reflection Cameras:</span>
            <span style="color: ${reflectionColor};">${waterInfo.activeReflectionCameras}</span>
          </div>
          <div style="display: flex; justify-content: space-between;">
            <span>Reflection:</span>
            <span style="color: ${reflectionColor};">${reflectionStatus}</span>
          </div>
          <div style="display: flex; justify-content: space-between;">
            <span>Water Meshes:</span>
            <span style="color: #e0e0e0;">${waterInfo.visibleWaterMeshes} / ${waterInfo.totalWaterMeshes}</span>
          </div>
        `;
        this.waterElement.style.display = "block";
      } else {
        this.waterElement.style.display = "none";
      }
    }

    // System timings (if enabled)
    if (this.measureSystems && this.systemsElement) {
      this.updateSystemTimings();
    }
  }

  /**
   * Get average frame time from samples
   */
  private getAverageFrameTime(): number {
    if (this.frameSamples.length === 0) return 0;
    const sum = this.frameSamples.reduce((a, b) => a + b.frameTime, 0);
    return sum / this.frameSamples.length;
  }

  /**
   * Get average CPU time from samples
   */
  private getAverageCpuTime(): number {
    if (this.cpuTimeSamples.length === 0) return 0;
    const sum = this.cpuTimeSamples.reduce((a, b) => a + b, 0);
    return sum / this.cpuTimeSamples.length;
  }

  /**
   * Get average render time from samples
   * Note: This measures render submission time, not actual GPU execution time
   */
  private getAverageRenderTime(): number {
    if (this.renderTimeSamples.length === 0) return 0;
    const sum = this.renderTimeSamples.reduce((a, b) => a + b, 0);
    return sum / this.renderTimeSamples.length;
  }

  /**
   * Get memory usage info if available
   */
  private getMemoryInfo(): { usedMB: number; totalMB: number } | null {
    // Check for performance.memory (Chrome only)
    const perf = globalThis.performance as globalThis.Performance & {
      memory?: {
        usedJSHeapSize: number;
        totalJSHeapSize: number;
        jsHeapSizeLimit: number;
      };
    };

    if (perf.memory) {
      return {
        usedMB: perf.memory.usedJSHeapSize / 1024 / 1024,
        totalMB: perf.memory.totalJSHeapSize / 1024 / 1024,
      };
    }
    return null;
  }

  /**
   * Get renderer statistics
   * Draw calls and triangles are per-frame (reset each frame)
   * Textures and geometries are current allocations in GPU memory
   */
  private getRendererInfo(): RenderInfo | null {
    const graphics = this.world.graphics;
    if (!graphics?.renderer) return null;

    const renderer = graphics.renderer as {
      info: {
        render: { triangles: number; calls: number };
        memory: { geometries: number; textures: number };
      };
    };

    const info = renderer.info;
    if (!info) return null;

    // frameDrawCalls and frameTriangles are captured before reset in updatePerFrameRenderStats
    // memory.textures and memory.geometries are current GPU allocations
    return {
      drawCalls: this.frameDrawCalls,
      triangles: this.frameTriangles,
      textures: info.memory.textures,
      geometries: info.memory.geometries,
    };
  }

  /**
   * Get biome information at world position
   */
  private getBiomeInfo(
    x: number,
    z: number,
  ): { name: string; color: string } | null {
    const terrainSystem = this.world.getSystem<TerrainSystem>("terrain");
    if (!terrainSystem) return null;

    const biomeId = terrainSystem.getBiomeAtPosition(x, z);
    const biomeData = BIOMES[biomeId];

    if (!biomeData) {
      return { name: biomeId, color: "#94a3b8" };
    }

    return {
      name: biomeData.name,
      color: biomeData.colorScheme.primary,
    };
  }

  /**
   * Get scene and world statistics
   */
  private getSceneInfo(): {
    totalObjects: number;
    entityCount: number;
    systemCount: number;
    lightCount: number;
  } | null {
    const stage = this.world.stage;
    if (!stage?.scene) return null;

    // Count scene objects and lights
    let totalObjects = 0;
    let lightCount = 0;
    stage.scene.traverse((obj) => {
      totalObjects++;
      if (obj instanceof THREE.Light) {
        lightCount++;
      }
    });

    // Entity and system counts
    const entityCount = this.world.entities?.items?.size ?? 0;
    const systemCount = this.world.systems?.length ?? 0;

    return {
      totalObjects,
      entityCount,
      systemCount,
      lightCount,
    };
  }

  /**
   * Get water system and reflection camera statistics
   */
  private getWaterInfo(): {
    activeReflectionCameras: number;
    reflectionActive: boolean;
    totalWaterMeshes: number;
    visibleWaterMeshes: number;
  } | null {
    const waterSystem = this.world.getSystem<WaterSystem>("water");
    if (!waterSystem) return null;

    return {
      activeReflectionCameras: waterSystem.activeReflectionCameraCount,
      reflectionActive: waterSystem.isReflectionActive,
      totalWaterMeshes: waterSystem.waterMeshCount,
      visibleWaterMeshes: waterSystem.visibleWaterMeshCount,
    };
  }

  /**
   * Update system timing display
   */
  private updateSystemTimings(): void {
    if (!this.systemsElement) return;

    // Get top 5 slowest systems
    const sortedSystems = Array.from(this.systemTimings.values())
      .sort((a, b) => b.avgTime - a.avgTime)
      .slice(0, 5);

    if (sortedSystems.length === 0) {
      this.systemsElement.innerHTML =
        '<div style="color: #666;">No system data</div>';
      return;
    }

    let html =
      '<div style="font-weight: 600; margin-bottom: 4px;">Systems</div>';
    for (const sys of sortedSystems) {
      const barWidth = Math.min(100, (sys.avgTime / 5) * 100);
      html += `
        <div style="display: flex; align-items: center; gap: 4px; margin: 2px 0;">
          <span style="width: 70px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${sys.name}</span>
          <div style="flex: 1; height: 4px; background: rgba(255,255,255,0.1); border-radius: 2px; overflow: hidden;">
            <div style="width: ${barWidth}%; height: 100%; background: ${sys.avgTime > 2 ? "#ef4444" : sys.avgTime > 1 ? "#fbbf24" : "#4ade80"};"></div>
          </div>
          <span style="width: 35px; text-align: right;">${sys.avgTime.toFixed(1)}ms</span>
        </div>
      `;
    }
    this.systemsElement.innerHTML = html;
  }

  /**
   * Format large numbers with K/M suffixes
   */
  private formatNumber(num: number): string {
    if (num >= 1000000) {
      return (num / 1000000).toFixed(1) + "M";
    }
    if (num >= 1000) {
      return (num / 1000).toFixed(1) + "K";
    }
    return num.toString();
  }

  /**
   * Record timing for a specific system
   * Can be called by other systems to report their timing
   */
  recordSystemTime(systemName: string, timeMs: number): void {
    if (!this.measureSystems) return;

    let timing = this.systemTimings.get(systemName);
    if (!timing) {
      timing = {
        name: systemName,
        updateTime: 0,
        fixedUpdateTime: 0,
        samples: [],
        avgTime: 0,
      };
      this.systemTimings.set(systemName, timing);
    }

    timing.samples.push(timeMs);
    if (timing.samples.length > 30) {
      timing.samples.shift();
    }
    timing.avgTime =
      timing.samples.reduce((a, b) => a + b, 0) / timing.samples.length;
  }

  /**
   * Get current FPS
   */
  getFps(): number {
    return this.currentFps;
  }

  /**
   * Get current frame time in ms
   */
  getFrameTime(): number {
    return this.currentFrameTime;
  }

  /**
   * Check if stats are currently visible
   */
  isVisible(): boolean {
    return this.visible;
  }

  override destroy(): void {
    if (this.container && this.container.parentElement) {
      this.container.parentElement.removeChild(this.container);
    }
    this.container = null;
    this.fpsElement = null;
    this.frameTimeElement = null;
    this.memoryElement = null;
    this.rendererElement = null;
    this.sceneElement = null;
    this.systemsElement = null;
    this.playerElement = null;
    this.biomeElement = null;
    this.timingElement = null;
    this.waterElement = null;
    this.systemTimings.clear();
    super.destroy();
  }
}
