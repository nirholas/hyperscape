/**
 * Interior Lighting System
 *
 * Generates interior light fixtures (candelabras, wall sconces, chandeliers)
 * and bakes vertex lighting for cheap runtime performance.
 *
 * Old-school medieval/fantasy vibe with warm candlelight.
 */

import * as THREE from "three";
import type { BuildingLayout, Room, FloorPlan } from "./types";
import { CELL_SIZE, WALL_THICKNESS, FLOOR_HEIGHT } from "./constants";

// ============================================================================
// INTERIOR LIGHTING CONSTANTS
// ============================================================================

/** Multiplier for effective light radius (lights reach beyond nominal radius) */
const LIGHT_RADIUS_MULTIPLIER = 1.5;

/** Minimum diffuse contribution for surfaces facing away from light (ambient bounce simulation) */
const MIN_DIFFUSE_CONTRIBUTION = 0.15;

/** Margin for interior bounds checking (prevents edge artifacts) - used in bakeVertexLighting */
const INTERIOR_BOUNDS_MARGIN = 0.1;

/** Threshold for interior-facing normal detection (dot product with center direction) - used in bakeVertexLighting */
const INTERIOR_NORMAL_THRESHOLD = -0.1;

/** Maximum overbright value for lit areas */
const MAX_OVERBRIGHT = 1.8;

/** Light position offset from ceiling (how far below ceiling the light hangs) */
const CEILING_LIGHT_OFFSET = 0.3;

/** Multiplier for room diagonal to get light radius coverage */
const ROOM_DIAGONAL_RADIUS_FACTOR = 0.75;

/** Base value for intensity scaling calculation */
const INTENSITY_SCALE_BASE = 1.0;

/** Room area divisor for intensity scaling */
const INTENSITY_SCALE_AREA_DIVISOR = 20;

/** Maximum intensity scale multiplier */
const MAX_INTENSITY_SCALE = 2.0;

// ============================================================================
// TYPES
// ============================================================================

/** Light fixture type */
export type LightFixtureType =
  | "wall-sconce" // Single candle on wall bracket
  | "candelabra" // Multi-candle standing fixture
  | "chandelier" // Hanging multi-light fixture
  | "fireplace" // Large warm light source
  | "lantern"; // Hanging lantern

/** Interior light source */
export interface InteriorLight {
  /** World position of the light */
  position: THREE.Vector3;
  /** Light color (warm candlelight default) */
  color: THREE.Color;
  /** Light intensity (0-1) */
  intensity: number;
  /** Light radius/falloff distance */
  radius: number;
  /** Type of fixture for mesh generation */
  fixtureType: LightFixtureType;
  /** Room this light belongs to */
  roomId: number;
  /** Floor level */
  floor: number;
}

/** Configuration for interior lighting */
export interface InteriorLightingConfig {
  /** Enable interior lighting */
  enabled: boolean;
  /** Lights per room (approximate) - only used in detailed mode */
  lightsPerRoom: number;
  /** Base light intensity */
  baseIntensity: number;
  /** Light color (warm candlelight) */
  lightColor: THREE.Color;
  /** Light radius in meters */
  lightRadius: number;
  /** Include chandeliers for large rooms */
  useChandeliers: boolean;
  /** Minimum room area for chandelier */
  chandelierMinArea: number;
  /** Include fireplace in inn/tavern main rooms */
  useFireplaces: boolean;
  /** Use simplified room center lights (one per room at ceiling) */
  useRoomCenterLights: boolean;
  /** Ambient light level for interior (0-1) */
  interiorAmbient: number;
}

/** Default lighting configuration */
export const DEFAULT_LIGHTING_CONFIG: InteriorLightingConfig = {
  enabled: true,
  lightsPerRoom: 2,
  baseIntensity: 1.2, // Increased for better interior illumination
  lightColor: new THREE.Color(1.0, 0.9, 0.75), // Slightly brighter warm light
  lightRadius: 6.0, // Increased radius to cover rooms better
  useChandeliers: true,
  chandelierMinArea: 12, // Square meters
  useFireplaces: true,
  useRoomCenterLights: true, // Default to simple room center lights
  interiorAmbient: 0.25, // Ambient light for interior surfaces
};

// ============================================================================
// LIGHT PLACEMENT
// ============================================================================

/**
 * Generate interior lights for a building
 */
export function generateInteriorLights(
  layout: BuildingLayout,
  buildingPosition: THREE.Vector3,
  config: Partial<InteriorLightingConfig> = {},
): InteriorLight[] {
  const cfg = { ...DEFAULT_LIGHTING_CONFIG, ...config };
  if (!cfg.enabled) return [];

  const lights: InteriorLight[] = [];

  // Process each floor
  for (let floorIdx = 0; floorIdx < layout.floorPlans.length; floorIdx++) {
    const floorPlan = layout.floorPlans[floorIdx];
    const floorY = floorIdx * FLOOR_HEIGHT;

    // Place lights in each room
    for (const room of floorPlan.rooms) {
      if (cfg.useRoomCenterLights) {
        // Simplified mode: one light at top center of each room
        const roomLight = placeRoomCenterLight(
          room,
          floorIdx,
          floorY,
          buildingPosition,
          cfg,
        );
        lights.push(roomLight);
      } else {
        // Detailed mode: chandeliers and wall sconces
        const roomLights = placeRoomLights(
          room,
          floorPlan,
          floorIdx,
          floorY,
          buildingPosition,
          cfg,
        );
        lights.push(...roomLights);
      }
    }
  }

  return lights;
}

/**
 * Place a single light at the top center of a room (ceiling light)
 * This provides simple, even illumination for interior surfaces
 */
function placeRoomCenterLight(
  room: Room,
  floorIdx: number,
  floorY: number,
  buildingPosition: THREE.Vector3,
  config: InteriorLightingConfig,
): InteriorLight {
  // Calculate room center in world space
  const roomCenterCol = (room.bounds.minCol + room.bounds.maxCol + 1) / 2;
  const roomCenterRow = (room.bounds.minRow + room.bounds.maxRow + 1) / 2;
  const roomCenterX = buildingPosition.x + roomCenterCol * CELL_SIZE;
  const roomCenterZ = buildingPosition.z + roomCenterRow * CELL_SIZE;

  // Calculate room dimensions for appropriate light radius
  const roomWidth = (room.bounds.maxCol - room.bounds.minCol + 1) * CELL_SIZE;
  const roomDepth = (room.bounds.maxRow - room.bounds.minRow + 1) * CELL_SIZE;
  const roomDiagonal = Math.sqrt(roomWidth * roomWidth + roomDepth * roomDepth);

  // Light radius should cover the entire room plus some margin
  const lightRadius = Math.max(
    config.lightRadius,
    roomDiagonal * ROOM_DIAGONAL_RADIUS_FACTOR,
  );

  // Scale intensity based on room size (larger rooms need more light)
  const roomArea = room.area * CELL_SIZE * CELL_SIZE;
  const intensityScale = Math.min(
    MAX_INTENSITY_SCALE,
    INTENSITY_SCALE_BASE + roomArea / INTENSITY_SCALE_AREA_DIVISOR,
  );

  return {
    position: new THREE.Vector3(
      roomCenterX,
      // Position at ceiling level (just below ceiling surface)
      buildingPosition.y + floorY + FLOOR_HEIGHT - CEILING_LIGHT_OFFSET,
      roomCenterZ,
    ),
    color: config.lightColor.clone(),
    intensity: config.baseIntensity * intensityScale,
    radius: lightRadius,
    fixtureType: "chandelier", // Visual representation
    roomId: room.id,
    floor: floorIdx,
  };
}

/**
 * Place multiple lights in a single room (detailed mode).
 *
 * NOTE: This function is currently NOT CALLED because the default config uses
 * `useRoomCenterLights: true`, which uses placeRoomCenterLight() instead.
 * This detailed mode places chandeliers in large rooms and wall sconces along walls,
 * which provides more realistic lighting but is more expensive to compute.
 *
 * To enable: Set `useRoomCenterLights: false` in the lighting config.
 *
 * @param room - The room to place lights in
 * @param floorPlan - The floor plan containing the room
 * @param floorIdx - Index of the floor (0-based)
 * @param floorY - Y position of the floor
 * @param buildingPosition - World position of the building origin
 * @param config - Lighting configuration
 * @returns Array of interior lights for this room
 */
function placeRoomLights(
  room: Room,
  floorPlan: FloorPlan,
  floorIdx: number,
  floorY: number,
  buildingPosition: THREE.Vector3,
  config: InteriorLightingConfig,
): InteriorLight[] {
  const lights: InteriorLight[] = [];

  // Calculate room center in world space
  const roomCenterCol = (room.bounds.minCol + room.bounds.maxCol + 1) / 2;
  const roomCenterRow = (room.bounds.minRow + room.bounds.maxRow + 1) / 2;
  const roomCenterX = buildingPosition.x + roomCenterCol * CELL_SIZE;
  const roomCenterZ = buildingPosition.z + roomCenterRow * CELL_SIZE;

  // Room area for determining fixture types
  const roomArea = room.area * CELL_SIZE * CELL_SIZE;

  // Determine fixture types based on room size
  const isLargeRoom = roomArea >= config.chandelierMinArea;

  if (isLargeRoom && config.useChandeliers) {
    // Large room gets a central chandelier
    lights.push({
      position: new THREE.Vector3(
        roomCenterX,
        buildingPosition.y + floorY + FLOOR_HEIGHT - 0.5, // Hang from ceiling
        roomCenterZ,
      ),
      color: config.lightColor.clone(),
      intensity: config.baseIntensity * 1.5, // Brighter
      radius: config.lightRadius * 1.5,
      fixtureType: "chandelier",
      roomId: room.id,
      floor: floorIdx,
    });
  }

  // Add wall sconces along walls
  const sconcesToPlace = Math.min(
    config.lightsPerRoom,
    Math.ceil(room.cells.length / 2),
  );
  const wallPositions = findWallPositions(room, floorPlan);

  for (let i = 0; i < Math.min(sconcesToPlace, wallPositions.length); i++) {
    const wallPos = wallPositions[i];
    const worldX =
      buildingPosition.x + (wallPos.col + 0.5) * CELL_SIZE + wallPos.offsetX;
    const worldZ =
      buildingPosition.z + (wallPos.row + 0.5) * CELL_SIZE + wallPos.offsetZ;

    lights.push({
      position: new THREE.Vector3(
        worldX,
        buildingPosition.y + floorY + FLOOR_HEIGHT * 0.7, // Wall height
        worldZ,
      ),
      color: config.lightColor.clone(),
      intensity: config.baseIntensity,
      radius: config.lightRadius,
      fixtureType: "wall-sconce",
      roomId: room.id,
      floor: floorIdx,
    });
  }

  return lights;
}

interface WallPosition {
  col: number;
  row: number;
  offsetX: number;
  offsetZ: number;
  side: "north" | "south" | "east" | "west";
}

/**
 * Find wall positions suitable for sconces
 */
function findWallPositions(room: Room, _floorPlan: FloorPlan): WallPosition[] {
  const positions: WallPosition[] = [];
  const halfCell = CELL_SIZE / 2 - WALL_THICKNESS / 2 - 0.1;

  for (const cell of room.cells) {
    const { col, row } = cell;

    // Check each direction for walls (edge of room or building)
    // North wall (row - 1)
    if (row === room.bounds.minRow || !isInRoom(room, col, row - 1)) {
      positions.push({
        col,
        row,
        offsetX: 0,
        offsetZ: -halfCell,
        side: "north",
      });
    }
    // South wall (row + 1)
    if (row === room.bounds.maxRow || !isInRoom(room, col, row + 1)) {
      positions.push({
        col,
        row,
        offsetX: 0,
        offsetZ: halfCell,
        side: "south",
      });
    }
    // West wall (col - 1)
    if (col === room.bounds.minCol || !isInRoom(room, col - 1, row)) {
      positions.push({
        col,
        row,
        offsetX: -halfCell,
        offsetZ: 0,
        side: "west",
      });
    }
    // East wall (col + 1)
    if (col === room.bounds.maxCol || !isInRoom(room, col + 1, row)) {
      positions.push({ col, row, offsetX: halfCell, offsetZ: 0, side: "east" });
    }
  }

  // Shuffle deterministically using room ID as seed to avoid clustering
  // while maintaining consistent placement across runs
  return shuffleArrayDeterministic(positions, room.id);
}

function isInRoom(room: Room, col: number, row: number): boolean {
  return room.cells.some((c) => c.col === col && c.row === row);
}

/**
 * Simple seeded random number generator for deterministic shuffle.
 * Uses a simple LCG (Linear Congruential Generator).
 */
function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    // LCG parameters from Numerical Recipes
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

/**
 * Deterministic shuffle using a seed value.
 * This ensures consistent light placement across runs.
 *
 * @param array - Array to shuffle
 * @param seed - Seed for deterministic randomness (e.g., room ID)
 */
function shuffleArrayDeterministic<T>(array: T[], seed: number): T[] {
  const result = [...array];
  const random = seededRandom(seed);
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// ============================================================================
// VERTEX LIGHTING
// ============================================================================

/**
 * Bake interior lighting into vertex colors
 *
 * This is a cheap way to add interior lighting without runtime lights.
 * Each vertex gets lit based on its distance to interior light sources.
 *
 * Interior-facing surfaces (walls, floors, ceilings inside rooms) receive
 * illumination from room center lights at the ceiling.
 *
 * @param geometry - The geometry to bake lighting into
 * @param lights - Array of interior lights to bake
 * @param ambientLevel - Ambient light level (0-1), defaults to DEFAULT_LIGHTING_CONFIG.interiorAmbient
 */
export function bakeVertexLighting(
  geometry: THREE.BufferGeometry,
  lights: InteriorLight[],
  ambientLevel: number = DEFAULT_LIGHTING_CONFIG.interiorAmbient,
): void {
  // Convert ambient level to warm-tinted color (slightly warmer than pure grey)
  const ambientLight = new THREE.Color(
    ambientLevel,
    ambientLevel * 0.88,
    ambientLevel * 0.72,
  );
  const positions = geometry.getAttribute("position");
  const normals = geometry.getAttribute("normal");

  if (!positions) {
    throw new Error(
      "[bakeVertexLighting] Geometry missing position attribute - cannot bake lighting",
    );
  }

  if (!normals) {
    throw new Error(
      "[bakeVertexLighting] Geometry missing normal attribute - cannot compute lighting without normals",
    );
  }

  if (positions.count === 0) {
    // Empty geometry - nothing to do
    return;
  }

  if (lights.length === 0) {
    // No lights - only ambient will be applied (this is valid)
    console.debug(
      "[bakeVertexLighting] No lights provided, only ambient lighting will be applied",
    );
  }

  // Get or create color attribute
  let colors = geometry.getAttribute("color");
  if (!colors) {
    const colorArray = new Float32Array(positions.count * 3);
    // Initialize to white
    for (let i = 0; i < colorArray.length; i++) {
      colorArray[i] = 1.0;
    }
    colors = new THREE.BufferAttribute(colorArray, 3);
    geometry.setAttribute("color", colors);
  }

  const vertex = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const toLight = new THREE.Vector3();
  const accumColor = new THREE.Color();

  for (let i = 0; i < positions.count; i++) {
    vertex.fromBufferAttribute(positions, i);
    normal.fromBufferAttribute(normals, i);

    // Start with ambient light for interior surfaces
    accumColor.copy(ambientLight);

    // Add contribution from each light
    for (const light of lights) {
      toLight.subVectors(light.position, vertex);
      const distance = toLight.length();

      // Extended range for interior lighting (lights should reach far corners)
      const effectiveRadius = light.radius * 1.5;
      if (distance > effectiveRadius) continue;

      toLight.normalize();

      // Half-Lambert (wrapped) diffuse for softer interior lighting
      // This gives a softer falloff and lights surfaces facing away slightly
      const NdotL = normal.dot(toLight);
      // Half-Lambert: (NdotL * 0.5 + 0.5)^2 gives softer shadows
      const halfLambert = Math.pow(NdotL * 0.5 + 0.5, 2);

      // Also add a small amount for surfaces facing away (ambient bounce simulation)
      // This helps interior-facing surfaces that might face away from the light
      const wrappedDiffuse = Math.max(halfLambert, 0.15);

      // Smooth distance falloff (less harsh than inverse square)
      // Use smoothstep-like falloff for more even lighting
      const normalizedDist = distance / effectiveRadius;
      const attenuation = 1.0 - normalizedDist * normalizedDist;

      // Add light contribution
      const contribution = wrappedDiffuse * attenuation * light.intensity;
      accumColor.r += light.color.r * contribution;
      accumColor.g += light.color.g * contribution;
      accumColor.b += light.color.b * contribution;
    }

    // Get existing vertex color
    const existingR = colors.getX(i);
    const existingG = colors.getY(i);
    const existingB = colors.getZ(i);

    // Apply lighting as a multiplier to existing vertex color
    // Clamp to reasonable range (allow slight overbright for lit areas)
    colors.setXYZ(
      i,
      Math.min(1.8, existingR * accumColor.r),
      Math.min(1.8, existingG * accumColor.g),
      Math.min(1.8, existingB * accumColor.b),
    );
  }

  colors.needsUpdate = true;
}

/**
 * Bake interior lighting for interior-facing surfaces only
 *
 * This version checks if a vertex is likely interior-facing based on
 * whether it's inside the building bounds and has a normal pointing inward.
 *
 * @param geometry - The geometry to bake lighting into
 * @param lights - Array of interior lights to bake
 * @param buildingBounds - AABB bounds of the building in world space
 * @param ambientLevel - Ambient light level (0-1), defaults to DEFAULT_LIGHTING_CONFIG.interiorAmbient
 */
export function bakeInteriorVertexLighting(
  geometry: THREE.BufferGeometry,
  lights: InteriorLight[],
  buildingBounds: {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    minZ: number;
    maxZ: number;
  },
  ambientLevel: number = DEFAULT_LIGHTING_CONFIG.interiorAmbient,
): void {
  // Convert ambient level to warm-tinted color
  const ambientLight = new THREE.Color(
    ambientLevel,
    ambientLevel * 0.88,
    ambientLevel * 0.72,
  );
  const positions = geometry.getAttribute("position");
  const normals = geometry.getAttribute("normal");

  if (!positions) {
    throw new Error(
      "[bakeInteriorVertexLighting] Geometry missing position attribute",
    );
  }

  if (!normals) {
    throw new Error(
      "[bakeInteriorVertexLighting] Geometry missing normal attribute",
    );
  }

  if (positions.count === 0) {
    return; // Empty geometry - nothing to do
  }

  // Get or create color attribute
  let colors = geometry.getAttribute("color");
  if (!colors) {
    const colorArray = new Float32Array(positions.count * 3);
    for (let i = 0; i < colorArray.length; i++) {
      colorArray[i] = 1.0;
    }
    colors = new THREE.BufferAttribute(colorArray, 3);
    geometry.setAttribute("color", colors);
  }

  const vertex = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const toLight = new THREE.Vector3();
  const toCenter = new THREE.Vector3();
  const accumColor = new THREE.Color();

  // Building center for interior detection
  const centerX = (buildingBounds.minX + buildingBounds.maxX) / 2;
  const centerZ = (buildingBounds.minZ + buildingBounds.maxZ) / 2;

  for (let i = 0; i < positions.count; i++) {
    vertex.fromBufferAttribute(positions, i);
    normal.fromBufferAttribute(normals, i);

    // Check if this vertex is inside the building bounds (with small margin to avoid edge artifacts)
    const isInsideX =
      vertex.x > buildingBounds.minX - INTERIOR_BOUNDS_MARGIN &&
      vertex.x < buildingBounds.maxX + INTERIOR_BOUNDS_MARGIN;
    const isInsideY =
      vertex.y > buildingBounds.minY - INTERIOR_BOUNDS_MARGIN &&
      vertex.y < buildingBounds.maxY + INTERIOR_BOUNDS_MARGIN;
    const isInsideZ =
      vertex.z > buildingBounds.minZ - INTERIOR_BOUNDS_MARGIN &&
      vertex.z < buildingBounds.maxZ + INTERIOR_BOUNDS_MARGIN;
    const isInside = isInsideX && isInsideY && isInsideZ;

    // Check if normal points toward building center (interior-facing)
    toCenter.set(centerX - vertex.x, 0, centerZ - vertex.z).normalize();
    const normalDotCenter = normal.x * toCenter.x + normal.z * toCenter.z;
    const isInteriorFacing = normalDotCenter > INTERIOR_NORMAL_THRESHOLD; // Allows for surfaces parallel to walls

    // Only apply interior lighting to interior-facing surfaces inside the building
    if (!isInside || !isInteriorFacing) {
      continue;
    }

    // Start with ambient
    accumColor.copy(ambientLight);

    // Add contribution from each light
    for (const light of lights) {
      toLight.subVectors(light.position, vertex);
      const distance = toLight.length();

      const effectiveRadius = light.radius * LIGHT_RADIUS_MULTIPLIER;
      if (distance > effectiveRadius) continue;

      toLight.normalize();

      // Half-Lambert diffuse
      const NdotL = normal.dot(toLight);
      const halfLambert = Math.pow(NdotL * 0.5 + 0.5, 2);
      const wrappedDiffuse = Math.max(halfLambert, MIN_DIFFUSE_CONTRIBUTION);

      // Smooth falloff
      const normalizedDist = distance / effectiveRadius;
      const attenuation = 1.0 - normalizedDist * normalizedDist;

      const contribution = wrappedDiffuse * attenuation * light.intensity;
      accumColor.r += light.color.r * contribution;
      accumColor.g += light.color.g * contribution;
      accumColor.b += light.color.b * contribution;
    }

    const existingR = colors.getX(i);
    const existingG = colors.getY(i);
    const existingB = colors.getZ(i);

    colors.setXYZ(
      i,
      Math.min(MAX_OVERBRIGHT, existingR * accumColor.r),
      Math.min(MAX_OVERBRIGHT, existingG * accumColor.g),
      Math.min(MAX_OVERBRIGHT, existingB * accumColor.b),
    );
  }

  colors.needsUpdate = true;
}

// ============================================================================
// LIGHT FIXTURE GEOMETRY
// ============================================================================

/**
 * Create geometry for a wall sconce fixture
 */
export function createWallSconceGeometry(): THREE.BufferGeometry {
  const group = new THREE.Group();

  // Bracket (small box)
  const bracket = new THREE.BoxGeometry(0.08, 0.15, 0.12);
  const bracketMesh = new THREE.Mesh(bracket);
  bracketMesh.position.set(0, 0, 0.06);
  group.add(bracketMesh);

  // Candle holder (cylinder)
  const holder = new THREE.CylinderGeometry(0.03, 0.04, 0.05, 8);
  const holderMesh = new THREE.Mesh(holder);
  holderMesh.position.set(0, 0.08, 0);
  group.add(holderMesh);

  // Candle (cylinder)
  const candle = new THREE.CylinderGeometry(0.015, 0.02, 0.12, 8);
  const candleMesh = new THREE.Mesh(candle);
  candleMesh.position.set(0, 0.16, 0);
  group.add(candleMesh);

  // Merge into single geometry
  return mergeGroupToGeometry(group);
}

/**
 * Create geometry for a chandelier fixture
 */
export function createChandelierGeometry(
  armCount: number = 6,
): THREE.BufferGeometry {
  const group = new THREE.Group();

  // Central ring
  const ring = new THREE.TorusGeometry(0.25, 0.02, 8, 16);
  const ringMesh = new THREE.Mesh(ring);
  ringMesh.rotation.x = Math.PI / 2;
  group.add(ringMesh);

  // Chain to ceiling (simple cylinder)
  const chain = new THREE.CylinderGeometry(0.01, 0.01, 0.4, 6);
  const chainMesh = new THREE.Mesh(chain);
  chainMesh.position.y = 0.2;
  group.add(chainMesh);

  // Arms with candles
  for (let i = 0; i < armCount; i++) {
    const angle = (i / armCount) * Math.PI * 2;
    const armX = Math.cos(angle) * 0.25;
    const armZ = Math.sin(angle) * 0.25;

    // Arm
    const arm = new THREE.CylinderGeometry(0.015, 0.015, 0.15, 6);
    const armMesh = new THREE.Mesh(arm);
    armMesh.rotation.z = Math.PI / 2;
    armMesh.rotation.y = -angle;
    armMesh.position.set(armX * 0.5, -0.05, armZ * 0.5);
    group.add(armMesh);

    // Candle holder
    const holder = new THREE.CylinderGeometry(0.025, 0.03, 0.04, 8);
    const holderMesh = new THREE.Mesh(holder);
    holderMesh.position.set(armX, -0.05, armZ);
    group.add(holderMesh);

    // Candle
    const candle = new THREE.CylinderGeometry(0.012, 0.015, 0.1, 8);
    const candleMesh = new THREE.Mesh(candle);
    candleMesh.position.set(armX, 0.02, armZ);
    group.add(candleMesh);
  }

  return mergeGroupToGeometry(group);
}

/**
 * Create geometry for a lantern
 */
export function createLanternGeometry(): THREE.BufferGeometry {
  const group = new THREE.Group();

  // Frame (octagonal prism approximated with box)
  const frame = new THREE.BoxGeometry(0.15, 0.25, 0.15);
  const frameMesh = new THREE.Mesh(frame);
  group.add(frameMesh);

  // Top cap
  const topCap = new THREE.ConeGeometry(0.1, 0.08, 4);
  const topCapMesh = new THREE.Mesh(topCap);
  topCapMesh.position.y = 0.16;
  topCapMesh.rotation.y = Math.PI / 4;
  group.add(topCapMesh);

  // Hook
  const hook = new THREE.TorusGeometry(0.03, 0.008, 6, 12, Math.PI);
  const hookMesh = new THREE.Mesh(hook);
  hookMesh.position.y = 0.22;
  hookMesh.rotation.x = Math.PI;
  group.add(hookMesh);

  return mergeGroupToGeometry(group);
}

/**
 * Merge a group of meshes into a single BufferGeometry
 *
 * @param group - THREE.Group containing meshes to merge
 * @returns Merged BufferGeometry, or empty geometry if group has no meshes
 * @throws Error if merge fails due to invalid geometry
 */
function mergeGroupToGeometry(group: THREE.Group): THREE.BufferGeometry {
  const geometries: THREE.BufferGeometry[] = [];

  // Update world matrices before extracting geometry
  group.updateMatrixWorld(true);

  group.traverse((child) => {
    if (child instanceof THREE.Mesh && child.geometry) {
      const geo = child.geometry.clone();
      geo.applyMatrix4(child.matrixWorld);
      geometries.push(geo);
    }
  });

  if (geometries.length === 0) {
    // This is valid - group might be empty
    console.debug(
      "[mergeGroupToGeometry] Group contains no meshes, returning empty geometry",
    );
    return new THREE.BufferGeometry();
  }

  if (geometries.length === 1) {
    return geometries[0];
  }

  // Manual merge
  const merged = mergeBufferGeometries(geometries);
  geometries.forEach((g) => g.dispose());
  return merged;
}

/**
 * Simple buffer geometry merge
 */
function mergeBufferGeometries(
  geometries: THREE.BufferGeometry[],
): THREE.BufferGeometry {
  let totalVertices = 0;
  let totalIndices = 0;

  for (const geo of geometries) {
    totalVertices += geo.getAttribute("position").count;
    if (geo.index) {
      totalIndices += geo.index.count;
    } else {
      totalIndices += geo.getAttribute("position").count;
    }
  }

  const positions = new Float32Array(totalVertices * 3);
  const normals = new Float32Array(totalVertices * 3);
  const indices = new Uint32Array(totalIndices);

  let vertexOffset = 0;
  let indexOffset = 0;

  for (const geo of geometries) {
    const pos = geo.getAttribute("position");
    const norm = geo.getAttribute("normal");

    for (let i = 0; i < pos.count; i++) {
      positions[(vertexOffset + i) * 3] = pos.getX(i);
      positions[(vertexOffset + i) * 3 + 1] = pos.getY(i);
      positions[(vertexOffset + i) * 3 + 2] = pos.getZ(i);

      if (norm) {
        normals[(vertexOffset + i) * 3] = norm.getX(i);
        normals[(vertexOffset + i) * 3 + 1] = norm.getY(i);
        normals[(vertexOffset + i) * 3 + 2] = norm.getZ(i);
      } else {
        normals[(vertexOffset + i) * 3] = 0;
        normals[(vertexOffset + i) * 3 + 1] = 1;
        normals[(vertexOffset + i) * 3 + 2] = 0;
      }
    }

    if (geo.index) {
      for (let i = 0; i < geo.index.count; i++) {
        indices[indexOffset + i] = geo.index.getX(i) + vertexOffset;
      }
      indexOffset += geo.index.count;
    } else {
      for (let i = 0; i < pos.count; i++) {
        indices[indexOffset + i] = vertexOffset + i;
      }
      indexOffset += pos.count;
    }

    vertexOffset += pos.count;
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  merged.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  merged.setIndex(new THREE.BufferAttribute(indices, 1));

  return merged;
}

// ============================================================================
// FIXTURE MATERIALS
// ============================================================================

/** Color palette for light fixtures */
export const FIXTURE_COLORS = {
  iron: new THREE.Color(0x3a3a3a), // Dark iron for brackets/chains
  brass: new THREE.Color(0xb5a642), // Brass for holders
  candle: new THREE.Color(0xfff8e7), // Cream/ivory candle
  flame: new THREE.Color(0xffaa33), // Flame color (for emissive)
  glass: new THREE.Color(0xccccaa), // Lantern glass
};

/**
 * Create materials for light fixtures
 */
export function createFixtureMaterials(): {
  metal: THREE.MeshStandardMaterial;
  candle: THREE.MeshStandardMaterial;
  flame: THREE.MeshStandardMaterial;
} {
  return {
    metal: new THREE.MeshStandardMaterial({
      color: FIXTURE_COLORS.iron,
      roughness: 0.7,
      metalness: 0.8,
    }),
    candle: new THREE.MeshStandardMaterial({
      color: FIXTURE_COLORS.candle,
      roughness: 0.9,
      metalness: 0.0,
    }),
    flame: new THREE.MeshStandardMaterial({
      color: FIXTURE_COLORS.flame,
      emissive: FIXTURE_COLORS.flame,
      emissiveIntensity: 2.0,
      roughness: 1.0,
      metalness: 0.0,
    }),
  };
}

// Functions are exported at their declarations above
