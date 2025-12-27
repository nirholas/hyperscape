/**
 * ZoneVisualsSystem
 *
 * Client-side system for zone visual indicators and warnings.
 * - Adds dark ground planes for PvP/wilderness zones
 * - Shows chat warnings when entering/leaving dangerous zones
 *
 * @see ZoneDetectionSystem for zone logic
 */

import THREE from "../../extras/three/three";
import { SystemBase } from "../shared";
import type { World } from "../../types";
import { ZoneDetectionSystem } from "../shared/death/ZoneDetectionSystem";
import { Chat } from "../shared/presentation/Chat";
import { ALL_WORLD_AREAS } from "../../data/world-areas";
import type { WorldArea } from "../../types/core/core";

// Zone visual colors - brighter for visibility
const ZONE_COLORS = {
  PVP: 0x8b0000, // Dark red for PvP zones (more visible)
  WILDERNESS: 0x4a4a4a, // Medium grey for wilderness
  SAFE: 0x228b22, // Forest green for safe zones (not rendered)
} as const;

/**
 * Zone visual mesh handle
 */
interface ZoneVisualHandle {
  mesh: THREE.Mesh;
  area: WorldArea;
}

export class ZoneVisualsSystem extends SystemBase {
  private zoneVisuals: Map<string, ZoneVisualHandle> = new Map();
  private lastZoneType: "safe" | "pvp" | "wilderness" | null = null;
  private lastZoneName: string | null = null;
  private checkInterval = 0.5; // Check position every 0.5 seconds
  private timeSinceLastCheck = 0;

  constructor(world: World) {
    super(world, {
      name: "zone-visuals",
      dependencies: {
        required: ["stage", "zone-detection"],
        optional: ["chat"],
      },
      autoCleanup: true,
    });
  }

  async init(): Promise<void> {
    console.log("[ZoneVisualsSystem] init() called");
  }

  start(): void {
    console.log("[ZoneVisualsSystem] start() called, creating zone meshes...");
    // Create zone visual meshes (moved from init to ensure scene is ready)
    this.createZoneMeshes();
    // Initialize player zone state
    this.updatePlayerZoneState();
  }

  /**
   * Create visual ground meshes for dangerous zones
   */
  private createZoneMeshes(): void {
    const areas = Object.values(ALL_WORLD_AREAS) as WorldArea[];
    console.log(
      `[ZoneVisualsSystem] Creating zone meshes. Total areas: ${areas.length}`,
      areas.map((a) => ({
        id: a.id,
        safeZone: a.safeZone,
        pvpEnabled: a.pvpEnabled,
        bounds: a.bounds, // Log bounds to debug positioning
      })),
    );

    for (const area of areas) {
      // Only create visuals for non-safe zones
      if (area.safeZone) continue;

      // Create ground mesh for the zone
      const width = area.bounds.maxX - area.bounds.minX;
      const height = area.bounds.maxZ - area.bounds.minZ;
      const centerX = (area.bounds.minX + area.bounds.maxX) / 2;
      const centerZ = (area.bounds.minZ + area.bounds.maxZ) / 2;

      const geometry = new THREE.PlaneGeometry(width, height);
      const color = area.pvpEnabled ? ZONE_COLORS.PVP : ZONE_COLORS.WILDERNESS;

      // Use MeshBasicMaterial - doesn't require lighting, always visible
      const material = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.5,
        side: THREE.DoubleSide,
        depthWrite: false, // Don't write to depth buffer (renders on top)
      });

      // Get terrain height at center of zone
      let terrainY = 0;
      const terrain = this.world.getSystem("terrain") as {
        getHeightAt?: (x: number, z: number) => number;
      } | null;
      if (terrain?.getHeightAt) {
        terrainY = terrain.getHeightAt(centerX, centerZ);
      }

      const mesh = new THREE.Mesh(geometry, material);
      mesh.rotation.x = -Math.PI / 2; // Lay flat
      mesh.position.set(centerX, terrainY + 0.15, centerZ); // Above terrain
      mesh.renderOrder = 999; // Render on top of terrain

      console.log(
        `[ZoneVisualsSystem] Zone "${area.name}" terrain height: ${terrainY.toFixed(2)}, mesh Y: ${(terrainY + 0.15).toFixed(2)}`,
      );
      mesh.receiveShadow = true;
      mesh.name = `zone-visual-${area.id}`;

      // Prevent click-to-move targeting this mesh
      mesh.userData.ignoreClickMove = true;
      mesh.userData.zoneId = area.id;
      mesh.userData.zoneName = area.name;

      // Add to scene
      if (this.world.stage?.scene) {
        this.world.stage.scene.add(mesh);
        console.log(
          `[ZoneVisualsSystem] ✅ Added zone mesh for "${area.name}" at (${centerX}, 0.02, ${centerZ}), size: ${width}x${height}`,
        );
      } else {
        console.warn(
          `[ZoneVisualsSystem] ⚠️ No stage/scene available for zone mesh`,
        );
      }

      this.zoneVisuals.set(area.id, { mesh, area });
      this.logger.info(`Created zone visual for ${area.name}`);
    }
  }

  /**
   * Check player position and update zone warnings
   */
  update(dt: number): void {
    this.timeSinceLastCheck += dt;
    if (this.timeSinceLastCheck < this.checkInterval) return;
    this.timeSinceLastCheck = 0;

    this.updatePlayerZoneState();
  }

  /**
   * Update player's zone state and show warnings
   */
  private updatePlayerZoneState(): void {
    const player = this.world.entities?.player;
    if (!player) return;

    const position = player.position;
    if (!position) return;

    const zoneSystem =
      this.world.getSystem<ZoneDetectionSystem>("zone-detection");
    if (!zoneSystem) return;

    const zoneProps = zoneSystem.getZoneProperties({
      x: position.x,
      z: position.z,
    });

    // Determine current zone type
    let currentType: "safe" | "pvp" | "wilderness";
    if (zoneProps.isPvPEnabled) {
      currentType = "pvp";
    } else if (zoneProps.isSafe) {
      currentType = "safe";
    } else {
      currentType = "wilderness";
    }

    // Check for zone transition
    if (this.lastZoneType !== null && this.lastZoneType !== currentType) {
      this.showZoneTransitionWarning(
        this.lastZoneType,
        currentType,
        zoneProps.name,
      );
    }

    this.lastZoneType = currentType;
    this.lastZoneName = zoneProps.name;
  }

  /**
   * Show zone transition warning in chat
   */
  private showZoneTransitionWarning(
    from: "safe" | "pvp" | "wilderness",
    to: "safe" | "pvp" | "wilderness",
    zoneName: string,
  ): void {
    const chat = this.world.getSystem<Chat>("chat");
    if (!chat) return;

    let message = "";

    if (to === "pvp") {
      // Entering PvP zone - RED warning
      message = `[WARNING] Entering ${zoneName} - PvP enabled! Other players can attack you here.`;
    } else if (to === "wilderness") {
      // Entering wilderness - YELLOW warning
      message = `[CAUTION] Entering ${zoneName} - Dangerous area!`;
    } else if (from === "pvp" && to === "safe") {
      // Leaving PvP zone - GREEN message
      message = `[SAFE] You have left the PvP zone and entered a safe area.`;
    } else if (from === "wilderness" && to === "safe") {
      // Leaving wilderness - GREEN message
      message = `[SAFE] You have returned to a safe area.`;
    }

    if (message) {
      chat.add({
        id: `zone-warning-${Date.now()}`,
        from: "System",
        fromId: "system",
        body: message,
        text: message,
        timestamp: Date.now(),
        createdAt: new Date().toISOString(),
      });
    }
  }

  /**
   * Cleanup zone meshes
   */
  destroy(): void {
    for (const [, handle] of this.zoneVisuals) {
      handle.mesh.geometry.dispose();
      (handle.mesh.material as THREE.Material).dispose();
      this.world.stage?.scene.remove(handle.mesh);
    }
    this.zoneVisuals.clear();
  }
}
