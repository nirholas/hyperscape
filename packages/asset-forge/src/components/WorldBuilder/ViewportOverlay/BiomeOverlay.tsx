/**
 * BiomeOverlay
 *
 * Three.js overlay component for visualizing biome boundaries,
 * selection highlights, and world markers on the terrain.
 */

import React, { useEffect, useRef } from "react";
import * as THREE from "three";

import type {
  GeneratedBiome,
  GeneratedTown,
  WorldPosition,
  ViewportOverlays,
} from "../types";

// ============== BIOME COLORS ==============

const BIOME_COLORS: Record<string, number> = {
  plains: 0x7cba5f,
  forest: 0x2f7d32,
  valley: 0x5a8a4f,
  mountains: 0x808080,
  tundra: 0xb0c4de,
  desert: 0xdaa520,
  lakes: 0x4682b4,
  swamp: 0x556b2f,
};

// ============== MARKER CREATION ==============

/**
 * Create a marker mesh for a town location
 */
function createTownMarker(
  position: WorldPosition,
  size: "hamlet" | "village" | "town",
): THREE.Mesh {
  const sizeMap = { hamlet: 15, village: 25, town: 40 };
  const colorMap = { hamlet: 0x22c55e, village: 0xeab308, town: 0xf97316 };

  const radius = sizeMap[size];
  const color = colorMap[size];

  // Create a ring geometry for the town marker
  const geometry = new THREE.RingGeometry(radius * 0.8, radius, 32);
  const material = new THREE.MeshBasicMaterial({
    color,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.6,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(position.x, position.y + 1, position.z);

  return mesh;
}

/**
 * Create a selection highlight ring
 */
function createSelectionHighlight(
  position: WorldPosition,
  radius: number,
  color: number = 0x00ff00,
): THREE.Line {
  const segments = 64;
  const points: THREE.Vector3[] = [];

  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    points.push(
      new THREE.Vector3(
        position.x + Math.cos(angle) * radius,
        position.y + 2,
        position.z + Math.sin(angle) * radius,
      ),
    );
  }

  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = new THREE.LineBasicMaterial({
    color,
    linewidth: 2,
  });

  return new THREE.Line(geometry, material);
}

/**
 * Create a biome boundary visualization
 */
function createBiomeBoundary(
  center: WorldPosition,
  radius: number,
  color: number,
): THREE.Line {
  const segments = 48;
  const points: THREE.Vector3[] = [];

  // Create irregular boundary using noise
  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    // Add some variation to make it look more organic
    const variation = 0.9 + Math.sin(angle * 5) * 0.1;
    const r = radius * variation;
    points.push(
      new THREE.Vector3(
        center.x + Math.cos(angle) * r,
        center.y + 1,
        center.z + Math.sin(angle) * r,
      ),
    );
  }

  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = new THREE.LineDashedMaterial({
    color,
    dashSize: 20,
    gapSize: 10,
    transparent: true,
    opacity: 0.5,
  });

  const line = new THREE.Line(geometry, material);
  line.computeLineDistances();

  return line;
}

/**
 * Create an NPC marker
 */
function createNPCMarker(position: WorldPosition): THREE.Mesh {
  // Simple cylinder for NPC
  const geometry = new THREE.CylinderGeometry(2, 2, 8, 8);
  const material = new THREE.MeshBasicMaterial({
    color: 0x00d4ff,
    transparent: true,
    opacity: 0.7,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(position.x, position.y + 4, position.z);

  return mesh;
}

/**
 * Create a boss marker
 */
function createBossMarker(
  position: WorldPosition,
  arenaRadius: number,
): THREE.Group {
  const group = new THREE.Group();

  // Boss position marker (skull-like shape using cones)
  const skullGeometry = new THREE.ConeGeometry(5, 10, 4);
  const skullMaterial = new THREE.MeshBasicMaterial({
    color: 0xff0000,
    transparent: true,
    opacity: 0.8,
  });
  const skull = new THREE.Mesh(skullGeometry, skullMaterial);
  skull.position.set(position.x, position.y + 8, position.z);
  skull.rotation.x = Math.PI;
  group.add(skull);

  // Arena boundary
  const arenaRing = createSelectionHighlight(position, arenaRadius, 0xff4444);
  group.add(arenaRing);

  return group;
}

// ============== MAIN OVERLAY MANAGER ==============

interface OverlayManagerProps {
  scene: THREE.Scene;
  biomes: GeneratedBiome[];
  towns: GeneratedTown[];
  npcs: Array<{ id: string; position: WorldPosition }>;
  bosses: Array<{
    id: string;
    position: WorldPosition;
    arenaBounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  }>;
  selectedId: string | null;
  selectedType: string | null;
  overlays: ViewportOverlays;
  worldCenterOffset?: { x: number; z: number };
}

/**
 * Manages overlay objects in a Three.js scene
 */
export class OverlayManager {
  private scene: THREE.Scene;
  private overlayGroup: THREE.Group;
  private biomeLines: THREE.Line[] = [];
  private townMarkers: THREE.Mesh[] = [];
  private npcMarkers: THREE.Mesh[] = [];
  private bossMarkers: THREE.Group[] = [];
  private selectionHighlight: THREE.Line | null = null;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.overlayGroup = new THREE.Group();
    this.overlayGroup.name = "world-overlays";
    this.scene.add(this.overlayGroup);
  }

  /**
   * Update all overlays based on current state
   */
  update(props: Omit<OverlayManagerProps, "scene">): void {
    const {
      biomes,
      towns,
      npcs,
      bosses,
      selectedId,
      selectedType,
      overlays,
      worldCenterOffset,
    } = props;
    const offset = worldCenterOffset || { x: 0, z: 0 };

    // Clear existing overlays
    this.clear();

    // Add biome boundaries
    if (overlays.biomes) {
      biomes.forEach((biome) => {
        const adjustedCenter = {
          x: biome.center.x - offset.x,
          y: biome.center.y,
          z: biome.center.z - offset.z,
        };
        const color = BIOME_COLORS[biome.type] || 0x888888;
        const line = createBiomeBoundary(
          adjustedCenter,
          biome.influenceRadius,
          color,
        );
        this.biomeLines.push(line);
        this.overlayGroup.add(line);
      });
    }

    // Add town markers
    if (overlays.towns) {
      towns.forEach((town) => {
        const adjustedPos = {
          x: town.position.x - offset.x,
          y: town.position.y,
          z: town.position.z - offset.z,
        };
        const marker = createTownMarker(adjustedPos, town.size);
        this.townMarkers.push(marker);
        this.overlayGroup.add(marker);
      });
    }

    // Add NPC markers
    if (overlays.npcs) {
      npcs.forEach((npc) => {
        const adjustedPos = {
          x: npc.position.x - offset.x,
          y: npc.position.y,
          z: npc.position.z - offset.z,
        };
        const marker = createNPCMarker(adjustedPos);
        this.npcMarkers.push(marker);
        this.overlayGroup.add(marker);
      });
    }

    // Add boss markers
    if (overlays.bosses) {
      bosses.forEach((boss) => {
        const adjustedPos = {
          x: boss.position.x - offset.x,
          y: boss.position.y,
          z: boss.position.z - offset.z,
        };
        const arenaRadius = (boss.arenaBounds.maxX - boss.arenaBounds.minX) / 2;
        const marker = createBossMarker(adjustedPos, arenaRadius);
        this.bossMarkers.push(marker);
        this.overlayGroup.add(marker);
      });
    }

    // Add selection highlight
    if (selectedId && selectedType) {
      let selectedPosition: WorldPosition | null = null;
      let selectionRadius = 50;
      let selectionColor = 0x00ff00;

      if (selectedType === "biome") {
        const biome = biomes.find((b) => b.id === selectedId);
        if (biome) {
          selectedPosition = {
            x: biome.center.x - offset.x,
            y: biome.center.y,
            z: biome.center.z - offset.z,
          };
          selectionRadius = biome.influenceRadius;
          selectionColor = 0x00ffff;
        }
      } else if (selectedType === "town") {
        const town = towns.find((t) => t.id === selectedId);
        if (town) {
          selectedPosition = {
            x: town.position.x - offset.x,
            y: town.position.y,
            z: town.position.z - offset.z,
          };
          selectionRadius =
            town.size === "town" ? 80 : town.size === "village" ? 50 : 30;
          selectionColor = 0xffff00;
        }
      } else if (selectedType === "npc") {
        const npc = npcs.find((n) => n.id === selectedId);
        if (npc) {
          selectedPosition = {
            x: npc.position.x - offset.x,
            y: npc.position.y,
            z: npc.position.z - offset.z,
          };
          selectionRadius = 10;
          selectionColor = 0x00ffff;
        }
      } else if (selectedType === "boss") {
        const boss = bosses.find((b) => b.id === selectedId);
        if (boss) {
          selectedPosition = {
            x: boss.position.x - offset.x,
            y: boss.position.y,
            z: boss.position.z - offset.z,
          };
          selectionRadius =
            (boss.arenaBounds.maxX - boss.arenaBounds.minX) / 2 + 10;
          selectionColor = 0xff4444;
        }
      }

      if (selectedPosition) {
        this.selectionHighlight = createSelectionHighlight(
          selectedPosition,
          selectionRadius,
          selectionColor,
        );
        this.overlayGroup.add(this.selectionHighlight);
      }
    }
  }

  /**
   * Clear all overlay objects
   */
  clear(): void {
    this.biomeLines.forEach((line) => {
      this.overlayGroup.remove(line);
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
    });
    this.biomeLines = [];

    this.townMarkers.forEach((marker) => {
      this.overlayGroup.remove(marker);
      marker.geometry.dispose();
      (marker.material as THREE.Material).dispose();
    });
    this.townMarkers = [];

    this.npcMarkers.forEach((marker) => {
      this.overlayGroup.remove(marker);
      marker.geometry.dispose();
      (marker.material as THREE.Material).dispose();
    });
    this.npcMarkers = [];

    this.bossMarkers.forEach((group) => {
      this.overlayGroup.remove(group);
      group.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          (obj.material as THREE.Material).dispose();
        } else if (obj instanceof THREE.Line) {
          obj.geometry.dispose();
          (obj.material as THREE.Material).dispose();
        }
      });
    });
    this.bossMarkers = [];

    if (this.selectionHighlight) {
      this.overlayGroup.remove(this.selectionHighlight);
      this.selectionHighlight.geometry.dispose();
      (this.selectionHighlight.material as THREE.Material).dispose();
      this.selectionHighlight = null;
    }
  }

  /**
   * Dispose of all resources
   */
  dispose(): void {
    this.clear();
    this.scene.remove(this.overlayGroup);
  }
}

// ============== REACT HOOK ==============

/**
 * React hook for managing viewport overlays
 */
export function useViewportOverlays(
  sceneRef: React.RefObject<THREE.Scene | null>,
  props: Omit<OverlayManagerProps, "scene">,
): void {
  const managerRef = useRef<OverlayManager | null>(null);

  // Initialize manager when scene becomes available
  useEffect(() => {
    if (sceneRef.current && !managerRef.current) {
      managerRef.current = new OverlayManager(sceneRef.current);
    }

    return () => {
      if (managerRef.current) {
        managerRef.current.dispose();
        managerRef.current = null;
      }
    };
  }, [sceneRef]);

  // Update overlays when props change
  useEffect(() => {
    if (managerRef.current) {
      managerRef.current.update(props);
    }
  }, [props]);
}

export default OverlayManager;
