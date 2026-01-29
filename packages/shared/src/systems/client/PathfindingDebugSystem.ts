/**
 * PathfindingDebugSystem - Visual debugging for building navigation
 *
 * Displays an overlay showing:
 * - Walkable tiles (green)
 * - Non-walkable tiles inside buildings (red)
 * - Building boundaries (yellow outline)
 * - Door openings (cyan)
 * - Wall blocking (orange lines)
 * - Player's current floor level
 *
 * Toggle: Press 'P' to enable/disable
 * Console: world.pathfindingDebug.setEnabled(true)
 *
 * Additional commands:
 * - world.pathfindingDebug.logBuildingInfo() - Log all buildings
 * - world.pathfindingDebug.testClickAt(x, z) - Test raycast at tile
 * - world.pathfindingDebug.logClickTarget() - Log next click target
 *
 * This helps diagnose why players can't enter/navigate buildings.
 */

import * as THREE from "three";
import { System } from "../shared/infrastructure/System";
import type { World } from "../../core/World";
import type { TownSystem } from "../shared/world/TownSystem";
import type { BuildingCollisionService } from "../shared/world/BuildingCollisionService";
import type { RaycastService } from "./interaction/services/RaycastService";

// Debug visualization colors
const COLORS = {
  WALKABLE: 0x00ff00, // Green - can walk here
  NON_WALKABLE: 0xff0000, // Red - inside building but blocked
  BUILDING_BOUNDARY: 0xffff00, // Yellow - building edge
  DOOR: 0x00ffff, // Cyan - door opening
  WALL_NORTH: 0xff8800, // Orange variants for wall directions
  WALL_SOUTH: 0xff6600,
  WALL_EAST: 0xff4400,
  WALL_WEST: 0xff2200,
  STAIR: 0xff00ff, // Magenta - stair tile
  PLAYER_TILE: 0xffffff, // White - current player tile
};

// Tile size matches movement system
const TILE_SIZE = 1;

export class PathfindingDebugSystem extends System {
  private enabled = false; // Disabled by default - press 'P' to toggle
  private debugGroup: THREE.Group | null = null;
  private scene: THREE.Scene | null = null;
  private townSystem: TownSystem | null = null;
  private collisionService: BuildingCollisionService | null = null;

  // Shared geometries for performance
  private tileGeometry: THREE.PlaneGeometry | null = null;
  private wallGeometry: THREE.BoxGeometry | null = null;

  // Materials cache
  private materials: Map<number, THREE.MeshBasicMaterial> = new Map();

  // Debug info overlay
  private infoDiv: HTMLDivElement | null = null;

  // Update throttling
  private lastUpdateTime = 0;
  private updateInterval = 500; // ms

  // Click debugging
  private logNextClick = false;
  private lastClickPosition: THREE.Vector3 | null = null;
  private clickMarker: THREE.Mesh | null = null;

  constructor(world: World) {
    super(world);
  }

  async start(): Promise<void> {
    // Get scene reference
    this.scene = this.world.stage?.scene ?? null;

    // Get town system reference
    this.townSystem = this.world.getSystem("towns") as TownSystem | null;

    // Create shared geometries
    this.tileGeometry = new THREE.PlaneGeometry(
      TILE_SIZE * 0.9,
      TILE_SIZE * 0.9,
    );
    this.wallGeometry = new THREE.BoxGeometry(TILE_SIZE * 0.1, 0.5, TILE_SIZE);

    // Setup keyboard toggle
    if (typeof window !== "undefined") {
      window.addEventListener("keydown", this.handleKeyDown);
    }

    // Make accessible from console
    (
      this.world as { pathfindingDebug?: PathfindingDebugSystem }
    ).pathfindingDebug = this;

    console.log(
      "[PathfindingDebugSystem] Ready - Press 'P' to toggle debug view",
    );
  }

  async stop(): Promise<void> {
    if (typeof window !== "undefined") {
      window.removeEventListener("keydown", this.handleKeyDown);
    }
    this.clearVisualization();
    this.tileGeometry?.dispose();
    this.wallGeometry?.dispose();
    this.materials.forEach((m) => m.dispose());
    this.materials.clear();
    if (this.infoDiv) {
      this.infoDiv.remove();
      this.infoDiv = null;
    }
  }

  private handleKeyDown = (e: KeyboardEvent): void => {
    // Ignore if typing in input
    if (
      e.target instanceof HTMLInputElement ||
      e.target instanceof HTMLTextAreaElement
    ) {
      return;
    }

    if (e.key.toLowerCase() === "p") {
      e.preventDefault();
      this.toggle();
    }
  };

  /**
   * Toggle debug visualization
   */
  toggle(): void {
    this.setEnabled(!this.enabled);
  }

  /**
   * Enable or disable debug visualization
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    console.log(`[PathfindingDebugSystem] ${enabled ? "ENABLED" : "DISABLED"}`);

    if (enabled) {
      this.createInfoOverlay();
      this.updateVisualization();
    } else {
      this.clearVisualization();
      if (this.infoDiv) {
        this.infoDiv.style.display = "none";
      }
    }
  }

  /**
   * Check if debug is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  update(_deltaTime: number): void {
    if (!this.enabled) return;

    // Throttle updates
    const now = Date.now();
    if (now - this.lastUpdateTime < this.updateInterval) return;
    this.lastUpdateTime = now;

    this.updateVisualization();
    this.updateInfoOverlay();
  }

  /**
   * Create the info overlay div
   */
  private createInfoOverlay(): void {
    if (this.infoDiv) {
      this.infoDiv.style.display = "block";
      return;
    }

    this.infoDiv = document.createElement("div");
    this.infoDiv.id = "pathfinding-debug-info";
    this.infoDiv.style.cssText = `
      position: fixed;
      top: 10px;
      left: 10px;
      background: rgba(0, 0, 0, 0.8);
      color: #fff;
      padding: 10px;
      font-family: monospace;
      font-size: 12px;
      z-index: 9999;
      border-radius: 4px;
      max-width: 400px;
      pointer-events: none;
    `;
    document.body.appendChild(this.infoDiv);
  }

  /**
   * Update the info overlay with current state
   */
  private updateInfoOverlay(): void {
    if (!this.infoDiv) return;

    const player = this.world.getPlayer?.();
    if (!player) {
      this.infoDiv.innerHTML = "<b>Pathfinding Debug</b><br>No player found";
      return;
    }

    const playerPos = player.position || { x: 0, y: 0, z: 0 };
    const tileX = Math.floor(playerPos.x);
    const tileZ = Math.floor(playerPos.z);

    // Get collision service
    if (!this.collisionService && this.townSystem) {
      this.collisionService = this.townSystem.getCollisionService?.() ?? null;
    }

    let buildingInfo = "Not in building";
    let floorInfo = "Ground (0)";
    let walkableInfo = "Unknown";
    let wallInfo = "None";

    if (this.collisionService) {
      // Query collision at player tile
      const result = this.collisionService.queryCollision(tileX, tileZ, 0);

      if (result.isInsideBuilding) {
        buildingInfo = `Building: ${result.buildingId}`;
        floorInfo = `Floor: ${result.floorIndex}`;
        walkableInfo = result.isWalkable ? "YES (walkable)" : "NO (blocked)";

        const walls: string[] = [];
        if (result.wallBlocking.north) walls.push("N");
        if (result.wallBlocking.south) walls.push("S");
        if (result.wallBlocking.east) walls.push("E");
        if (result.wallBlocking.west) walls.push("W");
        wallInfo = walls.length > 0 ? walls.join(", ") : "None (open)";

        if (result.stairTile) {
          walkableInfo += ` [STAIR → Floor ${result.stairTile.toFloor}]`;
        }
      }
    }

    // Get registered building count
    const buildingCount = this.collisionService
      ? this.collisionService.getBuildingCount()
      : 0;

    // Check if in bounding box
    const inBoundingBox = this.collisionService
      ? this.collisionService.isTileInBuildingBoundingBox(tileX, tileZ)
      : null;

    // Check building walkability
    const buildingWalkable = this.collisionService
      ? this.collisionService.isTileWalkableInBuilding(tileX, tileZ, 0)
      : true;

    this.infoDiv.innerHTML = `
      <b>Pathfinding Debug (P to toggle)</b><br>
      <span style="color:#0f0">■</span> Walkable Floor
      <span style="color:#f00">■</span> Blocked Interior
      <span style="color:#0ff">■</span> Door Opening
      <span style="color:#f0f">■</span> Stair<br>
      <span style="color:#0f8">■</span> Approach Area
      <span style="color:#f80">■</span> Under Wall
      <span style="color:#08f">■</span> Water/Slope
      <span style="color:#888">■</span> Static Collision
      <br><br>
      <b>Player Position:</b><br>
      World: (${playerPos.x.toFixed(1)}, ${playerPos.y.toFixed(1)}, ${playerPos.z.toFixed(1)})<br>
      Tile: (${tileX}, ${tileZ})<br>
      <br>
      <b>Building Collision:</b><br>
      ${buildingInfo}<br>
      ${floorInfo}<br>
      Walkable: ${walkableInfo}<br>
      Walls: ${wallInfo}<br>
      In Bounding Box: ${inBoundingBox ? `Yes (${inBoundingBox})` : "No"}<br>
      isTileWalkableInBuilding: ${buildingWalkable ? "YES" : "NO"}<br>
      <br>
      <b>System Info:</b><br>
      Registered Buildings: ${buildingCount}<br>
    `;
  }

  /**
   * Clear all debug visualization
   */
  private clearVisualization(): void {
    if (this.debugGroup && this.scene) {
      this.scene.remove(this.debugGroup);
      this.debugGroup.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
        }
      });
      this.debugGroup = null;
    }
  }

  /**
   * Update the debug visualization
   */
  private updateVisualization(): void {
    if (!this.scene || !this.tileGeometry) return;

    // Clear previous
    this.clearVisualization();

    // Create new debug group
    this.debugGroup = new THREE.Group();
    this.debugGroup.name = "PathfindingDebug";

    // Get player position for centering visualization
    const player = this.world.getPlayer?.();
    if (!player) return;

    const playerPos = player.position || { x: 0, y: 0, z: 0 };
    const centerX = Math.floor(playerPos.x);
    const centerZ = Math.floor(playerPos.z);

    // Visualization radius (tiles around player)
    const radius = 20;

    // Get collision service
    if (!this.collisionService && this.townSystem) {
      this.collisionService = this.townSystem.getCollisionService?.() ?? null;
    }

    if (!this.collisionService) {
      console.warn("[PathfindingDebugSystem] No collision service available");
      return;
    }

    // Get terrain system for height lookups
    const terrain = this.world.getSystem("terrain") as {
      getHeightAt?: (x: number, z: number) => number | null;
      isPositionWalkable?: (x: number, z: number) => boolean;
    } | null;

    // Get collision matrix for static collision
    const collision = this.world.collision as {
      hasFlags?: (x: number, z: number, flags: number) => boolean;
    } | null;

    // Get player's current floor
    const playerFloor = 0; // Default to ground floor for now

    // Iterate through tiles around player
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) {
        const tileX = centerX + dx;
        const tileZ = centerZ + dz;

        // Get tile elevation
        let tileY = playerPos.y;
        if (terrain?.getHeightAt) {
          const height = terrain.getHeightAt(tileX + 0.5, tileZ + 0.5);
          if (height !== null && Number.isFinite(height)) {
            tileY = height;
          }
        }

        // Query building collision for this tile
        const buildingResult = this.collisionService.queryCollision(
          tileX,
          tileZ,
          playerFloor,
        );

        // Check if tile is walkable in building system
        const buildingWalkable = this.collisionService.isTileWalkableInBuilding(
          tileX,
          tileZ,
          playerFloor,
        );

        // Check if in bounding box
        const inBoundingBox = this.collisionService.isTileInBuildingBoundingBox(
          tileX,
          tileZ,
        );

        // Determine tile state and color
        let color: number;
        let showTile = false;

        if (buildingResult.isInsideBuilding) {
          // Inside a building (walkable floor tile)
          showTile = true;
          if (buildingResult.stairTile) {
            color = COLORS.STAIR;
            tileY = buildingResult.elevation ?? tileY;
          } else if (buildingResult.isWalkable) {
            color = COLORS.WALKABLE;
            tileY = buildingResult.elevation ?? tileY;
          } else {
            color = COLORS.NON_WALKABLE;
          }
        } else if (inBoundingBox) {
          // In bounding box but not walkable floor - approach area or under wall
          showTile = true;
          if (buildingWalkable) {
            // Approach tile (allowed)
            color = 0x00ff88; // Light green - approach area
          } else {
            // Blocked (under wall or interior)
            color = 0xff8800; // Orange - blocked by building
          }
        } else {
          // Outside building - only show if near player and for terrain debugging
          const distSq = dx * dx + dz * dz;
          if (distSq <= 100) {
            // Within 10 tiles
            showTile = true;
            // Check terrain walkability
            const terrainWalkable =
              terrain?.isPositionWalkable?.(tileX + 0.5, tileZ + 0.5) ?? true;
            // Check collision matrix
            const collisionBlocked =
              collision?.hasFlags?.(tileX, tileZ, 1) ?? false; // BLOCKED flag

            if (!terrainWalkable) {
              color = 0x0088ff; // Blue - water/slope
            } else if (collisionBlocked) {
              color = 0x888888; // Gray - static collision (rock, tree, etc)
            } else {
              color = 0x004400; // Dark green - walkable terrain
            }
          } else {
            continue; // Skip far tiles outside buildings
          }
        }

        if (!showTile) continue;

        // Create tile visualization
        const tileMesh = this.createTileMesh(tileX, tileZ, tileY + 0.02, color);
        this.debugGroup.add(tileMesh);

        // Add wall indicators for building tiles
        if (buildingResult.isInsideBuilding) {
          if (buildingResult.wallBlocking.north) {
            this.addWallIndicator(tileX, tileZ, tileY, "north", false);
          }
          if (buildingResult.wallBlocking.south) {
            this.addWallIndicator(tileX, tileZ, tileY, "south", false);
          }
          if (buildingResult.wallBlocking.east) {
            this.addWallIndicator(tileX, tileZ, tileY, "east", false);
          }
          if (buildingResult.wallBlocking.west) {
            this.addWallIndicator(tileX, tileZ, tileY, "west", false);
          }

          // Check for door openings (walls that DON'T block)
          this.addDoorIndicators(
            tileX,
            tileZ,
            tileY,
            buildingResult,
            playerFloor,
          );
        }
      }
    }

    // Add player position marker
    const playerTileMesh = this.createTileMesh(
      centerX,
      centerZ,
      playerPos.y + 0.1,
      COLORS.PLAYER_TILE,
    );
    playerTileMesh.scale.set(0.5, 0.5, 0.5);
    this.debugGroup.add(playerTileMesh);

    // Add to scene
    this.scene.add(this.debugGroup);
  }

  /**
   * Add door indicators (walls with openings shown in cyan)
   */
  private addDoorIndicators(
    tileX: number,
    tileZ: number,
    y: number,
    _result: {
      wallBlocking: {
        north: boolean;
        south: boolean;
        east: boolean;
        west: boolean;
      };
    },
    floorIndex: number,
  ): void {
    if (!this.collisionService || !this.debugGroup) return;

    // Get door/arch openings at this tile using the public method
    const openings = this.collisionService.getDoorOpeningsAtTile(
      tileX,
      tileZ,
      floorIndex,
    );

    // Add indicator for each opening
    for (const direction of openings) {
      this.addWallIndicator(tileX, tileZ, y, direction, true);
    }
  }

  /**
   * Create a tile visualization mesh
   */
  private createTileMesh(
    tileX: number,
    tileZ: number,
    y: number,
    color: number,
  ): THREE.Mesh {
    const material = this.getMaterial(color);
    const mesh = new THREE.Mesh(this.tileGeometry!, material);

    // Position at tile center, slightly above ground
    mesh.position.set(tileX + 0.5, y + 0.02, tileZ + 0.5);
    mesh.rotation.x = -Math.PI / 2; // Lay flat
    mesh.renderOrder = 999;

    return mesh;
  }

  /**
   * Add wall blocking indicator
   * @param isDoor - If true, shows as door opening (cyan) instead of blocking wall (orange)
   */
  private addWallIndicator(
    tileX: number,
    tileZ: number,
    y: number,
    direction: "north" | "south" | "east" | "west",
    isDoor: boolean = false,
  ): void {
    if (!this.debugGroup) return;

    // Use door color (cyan) or wall blocking colors (orange variants)
    let color: number;
    if (isDoor) {
      color = COLORS.DOOR;
    } else {
      const colorMap = {
        north: COLORS.WALL_NORTH,
        south: COLORS.WALL_SOUTH,
        east: COLORS.WALL_EAST,
        west: COLORS.WALL_WEST,
      };
      color = colorMap[direction];
    }

    const material = this.getMaterial(color);
    const mesh = new THREE.Mesh(this.wallGeometry!, material);

    // Position based on direction
    const offset = 0.45;
    let x = tileX + 0.5;
    let z = tileZ + 0.5;

    switch (direction) {
      case "north":
        z += offset;
        mesh.rotation.y = 0;
        break;
      case "south":
        z -= offset;
        mesh.rotation.y = 0;
        break;
      case "east":
        x += offset;
        mesh.rotation.y = Math.PI / 2;
        break;
      case "west":
        x -= offset;
        mesh.rotation.y = Math.PI / 2;
        break;
    }

    mesh.position.set(x, y + 0.25, z);
    mesh.renderOrder = 1000;
    this.debugGroup.add(mesh);
  }

  /**
   * Get or create material for color
   */
  private getMaterial(color: number): THREE.MeshBasicMaterial {
    if (!this.materials.has(color)) {
      const material = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.5,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      this.materials.set(color, material);
    }
    return this.materials.get(color)!;
  }

  /**
   * Force refresh visualization
   */
  refresh(): void {
    if (this.enabled) {
      this.updateVisualization();
      this.updateInfoOverlay();
    }
  }

  /**
   * Log detailed building collision info for debugging
   */
  logBuildingInfo(): void {
    if (!this.collisionService) {
      console.log("[PathfindingDebugSystem] No collision service");
      return;
    }

    const buildings = this.collisionService.getDebugBuildingInfo();

    if (buildings.length === 0) {
      console.log("[PathfindingDebugSystem] No buildings registered");
      return;
    }

    console.log(`[PathfindingDebugSystem] === BUILDING INFO ===`);
    console.log(`Total buildings: ${buildings.length}`);

    for (const building of buildings) {
      console.log(`\nBuilding: ${building.buildingId}`);
      console.log(`  Town: ${building.townId}`);
      console.log(
        `  Position: (${building.worldPosition.x.toFixed(1)}, ${building.worldPosition.y.toFixed(1)}, ${building.worldPosition.z.toFixed(1)})`,
      );
      console.log(`  Floors: ${building.floorCount}`);

      for (const floor of building.floors) {
        console.log(`  Floor ${floor.floorIndex}:`);
        console.log(`    Elevation: ${floor.elevation.toFixed(1)}m`);
        console.log(`    Walkable tiles: ${floor.walkableTileCount}`);
        console.log(`    Wall segments: ${floor.wallSegmentCount}`);
        console.log(`    Door openings: ${floor.doorCount}`);
        console.log(`    Stairs: ${floor.stairCount}`);
      }
    }
  }

  /**
   * Test collision at a specific world tile coordinate
   */
  testTileCollision(tileX: number, tileZ: number): void {
    if (!this.collisionService) {
      console.log("[PathfindingDebugSystem] No collision service");
      return;
    }

    console.log(`\n[PathfindingDebugSystem] === TILE COLLISION TEST ===`);
    console.log(`Testing tile: (${tileX}, ${tileZ})`);

    // Query collision at floor 0
    const result = this.collisionService.queryCollision(tileX, tileZ, 0);

    console.log(`Inside building: ${result.isInsideBuilding}`);
    console.log(`Building ID: ${result.buildingId ?? "N/A"}`);
    console.log(`Walkable: ${result.isWalkable}`);
    console.log(`Floor: ${result.floorIndex ?? "N/A"}`);
    console.log(`Elevation: ${result.elevation?.toFixed(2) ?? "N/A"}`);
    console.log(`Wall blocking:`, result.wallBlocking);
    console.log(`Stair tile:`, result.stairTile ?? "None");

    // Also check if the player can REACH this tile from adjacent tiles
    console.log(`\n--- Wall blocking from adjacent tiles ---`);
    const directions = [
      { name: "North", dx: 0, dz: 1 },
      { name: "South", dx: 0, dz: -1 },
      { name: "East", dx: 1, dz: 0 },
      { name: "West", dx: -1, dz: 0 },
    ];

    for (const dir of directions) {
      const fromX = tileX + dir.dx;
      const fromZ = tileZ + dir.dz;
      const blocked = this.collisionService.isWallBlocked(
        fromX,
        fromZ,
        tileX,
        tileZ,
        0,
      );
      console.log(
        `From ${dir.name} (${fromX}, ${fromZ}): ${blocked ? "BLOCKED" : "ok"}`,
      );
    }
  }

  /**
   * Enable logging of the next click position
   */
  logClickTarget(): void {
    console.log("[PathfindingDebugSystem] Next click will be logged...");
    this.logNextClick = true;

    // Add click listener
    const handleClick = (e: MouseEvent) => {
      if (!this.logNextClick) return;

      const stage = this.world.stage as {
        renderer?: { domElement: HTMLCanvasElement };
      } | null;
      const canvas = stage?.renderer?.domElement;
      if (!canvas) {
        console.log("[PathfindingDebugSystem] No canvas found");
        return;
      }

      // Get interaction system and its raycast service
      const interaction = this.world.getSystem("interaction") as {
        getRaycastService?: () => RaycastService;
      } | null;
      if (!interaction?.getRaycastService) {
        console.log("[PathfindingDebugSystem] No interaction system");
        return;
      }

      const raycastService = interaction.getRaycastService();
      const terrainPos = raycastService.getTerrainPosition(
        e.clientX,
        e.clientY,
        canvas,
      );

      console.log(`\n[PathfindingDebugSystem] === CLICK TARGET ===`);
      console.log(`Screen: (${e.clientX}, ${e.clientY})`);

      if (terrainPos) {
        this.lastClickPosition = terrainPos.clone();
        const tileX = Math.floor(terrainPos.x);
        const tileZ = Math.floor(terrainPos.z);

        console.log(
          `World: (${terrainPos.x.toFixed(2)}, ${terrainPos.y.toFixed(2)}, ${terrainPos.z.toFixed(2)})`,
        );
        console.log(`Tile: (${tileX}, ${tileZ})`);

        // Show marker
        this.showClickMarker(terrainPos);

        // Test collision at this tile
        this.testTileCollision(tileX, tileZ);
      } else {
        console.log("No terrain hit - raycast missed all walkable surfaces");
      }

      this.logNextClick = false;
      window.removeEventListener("click", handleClick);
    };

    window.addEventListener("click", handleClick);
  }

  /**
   * Show a visual marker at click position
   */
  private showClickMarker(position: THREE.Vector3): void {
    if (!this.scene) return;

    // Remove old marker
    if (this.clickMarker) {
      this.scene.remove(this.clickMarker);
      this.clickMarker.geometry.dispose();
    }

    // Create new marker
    const geometry = new THREE.SphereGeometry(0.3, 16, 16);
    const material = this.getMaterial(0xff00ff);
    this.clickMarker = new THREE.Mesh(geometry, material);
    this.clickMarker.position.copy(position);
    this.clickMarker.position.y += 0.5;
    this.clickMarker.renderOrder = 1001;
    this.scene.add(this.clickMarker);

    // Remove after 5 seconds
    setTimeout(() => {
      if (this.clickMarker && this.scene) {
        this.scene.remove(this.clickMarker);
        this.clickMarker.geometry.dispose();
        this.clickMarker = null;
      }
    }, 5000);
  }

  /**
   * List all raycastable floor meshes in the scene
   */
  listFloorMeshes(): void {
    if (!this.scene) {
      console.log("[PathfindingDebugSystem] No scene");
      return;
    }

    console.log(`\n[PathfindingDebugSystem] === FLOOR MESHES (Layer 2) ===`);

    let count = 0;
    this.scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        // Check if on layer 2
        if (obj.layers.isEnabled(2)) {
          count++;
          const userData = obj.userData;
          const geo = obj.geometry;
          const vertCount = geo.getAttribute("position")?.count ?? 0;

          console.log(`\n${count}. ${obj.name || "(unnamed)"}`);
          console.log(`   Type: ${userData?.type ?? "unknown"}`);
          console.log(`   Walkable: ${userData?.walkable ?? "unset"}`);
          console.log(`   Visible: ${obj.visible}`);
          console.log(`   Vertices: ${vertCount}`);
          console.log(
            `   Position: (${obj.position.x.toFixed(1)}, ${obj.position.y.toFixed(1)}, ${obj.position.z.toFixed(1)})`,
          );

          // Check bounding box
          if (geo.boundingBox) {
            const bb = geo.boundingBox;
            console.log(
              `   Bounds: X[${bb.min.x.toFixed(1)}, ${bb.max.x.toFixed(1)}] ` +
                `Z[${bb.min.z.toFixed(1)}, ${bb.max.z.toFixed(1)}]`,
            );
          }
        }
      }
    });

    if (count === 0) {
      console.log("No meshes found on layer 2!");
      console.log("This means click-to-move cannot target building floors.");
    } else {
      console.log(`\nTotal: ${count} floor meshes`);
    }
  }

  /**
   * Query server for building collision status
   * This is essential because buildings are only registered on the server!
   */
  queryServerBuildingStatus(tileX?: number, tileZ?: number): void {
    const network = this.world.getSystem("network") as {
      send?: (type: string, data: unknown) => void;
    } | null;

    if (!network?.send) {
      console.log("[PathfindingDebugSystem] No network system");
      return;
    }

    console.log(
      "[PathfindingDebugSystem] Querying server for building collision status...",
    );

    // Send request
    network.send("debugBuildingCollision", { tileX, tileZ });

    // Listen for response (one-time)
    const handleResult = (data: {
      error?: string;
      buildingCount: number;
      buildings?: Array<{
        buildingId: string;
        townId: string;
        worldPosition: { x: number; y: number; z: number };
        floorCount: number;
        floors: Array<{
          floorIndex: number;
          elevation: number;
          walkableTileCount: number;
          wallSegmentCount: number;
          doorCount: number;
          stairCount: number;
        }>;
      }>;
      tileInfo?: {
        isInsideBuilding: boolean;
        buildingId: string | null;
        isWalkable: boolean;
        floorIndex: number | null;
        elevation: number | null;
        wallBlocking: {
          north: boolean;
          south: boolean;
          east: boolean;
          west: boolean;
        };
        stairTile: unknown;
      };
    }) => {
      console.log("\n[PathfindingDebugSystem] === SERVER BUILDING STATUS ===");

      if (data.error) {
        console.log(`Error: ${data.error}`);
        return;
      }

      console.log(`Buildings registered on SERVER: ${data.buildingCount}`);

      if (data.buildings && data.buildings.length > 0) {
        console.log("\nBuildings (first 5):");
        for (const building of data.buildings) {
          console.log(
            `  ${building.buildingId} @ (${building.worldPosition.x.toFixed(0)}, ${building.worldPosition.z.toFixed(0)})`,
          );
          console.log(
            `    Town: ${building.townId}, Floors: ${building.floorCount}`,
          );
          for (const floor of building.floors) {
            console.log(
              `    Floor ${floor.floorIndex}: ${floor.walkableTileCount} walkable, ${floor.doorCount} doors`,
            );
          }
        }
      }

      if (data.tileInfo) {
        console.log(`\nTile collision at (${tileX}, ${tileZ}):`);
        console.log(`  Inside building: ${data.tileInfo.isInsideBuilding}`);
        console.log(`  Building ID: ${data.tileInfo.buildingId ?? "N/A"}`);
        console.log(`  Walkable: ${data.tileInfo.isWalkable}`);
        console.log(`  Floor: ${data.tileInfo.floorIndex ?? "N/A"}`);
        console.log(`  Wall blocking:`, data.tileInfo.wallBlocking);
      }

      // Remove listener after receiving
      this.world.off("debugBuildingCollisionResult", wrappedHandler);
    };

    const wrappedHandler = (...args: unknown[]) => {
      handleResult(args[0] as Parameters<typeof handleResult>[0]);
    };

    this.world.on("debugBuildingCollisionResult", wrappedHandler);
  }

  /**
   * Check the raycast layers setup
   */
  checkRaycastSetup(): void {
    console.log(`\n[PathfindingDebugSystem] === RAYCAST SETUP ===`);

    // Check camera layers
    const camera = this.world.camera;
    if (camera) {
      console.log(`Camera layers mask: ${camera.layers.mask}`);
      console.log(`  Layer 0 (terrain): ${camera.layers.isEnabled(0)}`);
      console.log(`  Layer 1 (entities): ${camera.layers.isEnabled(1)}`);
      console.log(`  Layer 2 (building floors): ${camera.layers.isEnabled(2)}`);
    } else {
      console.log("No camera found!");
    }

    // Count objects per layer
    let layer0 = 0;
    let layer1 = 0;
    let layer2 = 0;

    this.scene?.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        if (obj.layers.isEnabled(0)) layer0++;
        if (obj.layers.isEnabled(1)) layer1++;
        if (obj.layers.isEnabled(2)) layer2++;
      }
    });

    console.log(`\nMesh counts by layer:`);
    console.log(`  Layer 0 (terrain): ${layer0}`);
    console.log(`  Layer 1 (entities): ${layer1}`);
    console.log(`  Layer 2 (building floors): ${layer2}`);
  }

  /**
   * Enable/disable server-side walkability debug logging
   */
  setWalkabilityDebug(enabled: boolean): void {
    const network = this.world.getSystem("network") as {
      send?: (type: string, data: unknown) => void;
    } | null;

    if (!network?.send) {
      console.log("[PathfindingDebugSystem] No network system");
      return;
    }

    console.log(
      `[PathfindingDebugSystem] Setting walkability debug: ${enabled}`,
    );
    network.send("debugWalkability", { enabled });

    const handleResult = (data: { enabled: boolean; message: string }) => {
      console.log(`[PathfindingDebugSystem] ${data.message}`);
      this.world.off("debugWalkabilityResult", wrappedHandler);
    };

    const wrappedHandler = (...args: unknown[]) => {
      handleResult(args[0] as Parameters<typeof handleResult>[0]);
    };

    this.world.on("debugWalkabilityResult", wrappedHandler);
  }

  /**
   * Get door tiles for a building
   */
  queryDoorTiles(buildingIdOrTileX?: string | number, tileZ?: number): void {
    const network = this.world.getSystem("network") as {
      send?: (type: string, data: unknown) => void;
    } | null;

    if (!network?.send) {
      console.log("[PathfindingDebugSystem] No network system");
      return;
    }

    let payload: { buildingId?: string; tileX?: number; tileZ?: number };

    if (typeof buildingIdOrTileX === "string") {
      payload = { buildingId: buildingIdOrTileX };
    } else if (
      typeof buildingIdOrTileX === "number" &&
      typeof tileZ === "number"
    ) {
      payload = { tileX: buildingIdOrTileX, tileZ };
    } else {
      // Use player position
      const player = this.world.getPlayer();
      if (player) {
        const { tileX, tileZ: pTileZ } = this.getPlayerTile();
        payload = { tileX, tileZ: pTileZ };
      } else {
        console.log("[PathfindingDebugSystem] No player position available");
        return;
      }
    }

    console.log("[PathfindingDebugSystem] Querying door tiles...", payload);
    network.send("debugDoorTiles", payload);

    const handleResult = (data: {
      error?: string;
      buildingId?: string;
      doorTiles?: Array<{ tileX: number; tileZ: number; direction: string }>;
      message?: string;
    }) => {
      if (data.error) {
        console.log(`[PathfindingDebugSystem] Error: ${data.error}`);
      } else {
        console.log(`[PathfindingDebugSystem] Building: ${data.buildingId}`);
        console.log(`[PathfindingDebugSystem] ${data.message}`);
        if (data.doorTiles && data.doorTiles.length > 0) {
          console.log("[PathfindingDebugSystem] Door tiles:");
          for (const door of data.doorTiles) {
            console.log(
              `  (${door.tileX}, ${door.tileZ}) facing ${door.direction}`,
            );
          }
        }
      }
      this.world.off("debugDoorTilesResult", wrappedHandler);
    };

    const wrappedHandler = (...args: unknown[]) => {
      handleResult(args[0] as Parameters<typeof handleResult>[0]);
    };

    this.world.on("debugDoorTilesResult", wrappedHandler);
  }

  /**
   * Check wall blocking between two tiles (server-side)
   */
  queryWallBlocking(
    fromX: number,
    fromZ: number,
    toX: number,
    toZ: number,
    floor = 0,
  ): void {
    const network = this.world.getSystem("network") as {
      send?: (type: string, data: unknown) => void;
    } | null;

    if (!network?.send) {
      console.log("[PathfindingDebugSystem] No network system");
      return;
    }

    console.log(
      `[PathfindingDebugSystem] Checking wall blocking (${fromX},${fromZ}) -> (${toX},${toZ}) floor=${floor}`,
    );
    network.send("debugWallBlocking", { fromX, fromZ, toX, toZ, floor });

    const handleResult = (data: {
      error?: string;
      from?: { x: number; z: number; wallBlocking: Record<string, boolean> };
      to?: { x: number; z: number; wallBlocking: Record<string, boolean> };
      floor?: number;
      isBlocked?: boolean;
    }) => {
      if (data.error) {
        console.log(`[PathfindingDebugSystem] Error: ${data.error}`);
      } else {
        console.log(`[PathfindingDebugSystem] === WALL BLOCKING CHECK ===`);
        console.log(
          `From (${data.from?.x}, ${data.from?.z}):`,
          data.from?.wallBlocking,
        );
        console.log(
          `To (${data.to?.x}, ${data.to?.z}):`,
          data.to?.wallBlocking,
        );
        console.log(`Floor: ${data.floor}`);
        console.log(`Movement BLOCKED: ${data.isBlocked}`);
      }
      this.world.off("debugWallBlockingResult", wrappedHandler);
    };

    const wrappedHandler = (...args: unknown[]) => {
      handleResult(args[0] as Parameters<typeof handleResult>[0]);
    };

    this.world.on("debugWallBlockingResult", wrappedHandler);
  }

  /**
   * Quick helper to get current player tile coords
   */
  private getPlayerTile(): { tileX: number; tileZ: number } {
    const player = this.world.getPlayer();
    if (!player) return { tileX: 0, tileZ: 0 };
    const pos = player.position;
    // worldToTile conversion (assuming 1 tile = 1 world unit)
    return {
      tileX: Math.floor(pos.x),
      tileZ: Math.floor(pos.z),
    };
  }
}
