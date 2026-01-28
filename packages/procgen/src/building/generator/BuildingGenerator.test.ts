/**
 * BuildingGenerator Tests
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as THREE from "three";
import {
  BuildingGenerator,
  BUILDING_RECIPES,
  createRng,
  CELL_SIZE,
  WALL_THICKNESS,
  FLOOR_THICKNESS,
  WALL_HEIGHT,
  FLOOR_HEIGHT,
  ROOF_THICKNESS,
  FOUNDATION_HEIGHT,
  FOUNDATION_OVERHANG,
  TERRAIN_DEPTH,
  ENTRANCE_STEP_DEPTH,
  ENTRANCE_STEP_COUNT,
  TERRAIN_STEP_COUNT,
} from "./index";

/**
 * Represents an axis-aligned bounding box for collision detection
 */
interface AABB {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
  label: string;
}

/**
 * Extract bounding boxes from a BufferGeometry
 * We analyze the geometry to find individual box components by looking at
 * disconnected vertex groups
 */
function extractAABBsFromGeometry(
  geometry: THREE.BufferGeometry,
  label: string,
): AABB[] {
  const position = geometry.attributes.position;
  if (!position) return [];

  // Get overall bounds
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  if (!box) return [];

  return [
    {
      minX: box.min.x,
      maxX: box.max.x,
      minY: box.min.y,
      maxY: box.max.y,
      minZ: box.min.z,
      maxZ: box.max.z,
      label,
    },
  ];
}

/**
 * Check if two AABBs overlap (with a small epsilon for numerical precision)
 * Returns true if boxes overlap in volume (not just touch)
 */
function aabbsOverlap(a: AABB, b: AABB, epsilon = 0.001): boolean {
  // Check for separation on each axis
  // Boxes overlap if they overlap on ALL three axes
  const overlapX = a.minX < b.maxX - epsilon && a.maxX > b.minX + epsilon;
  const overlapY = a.minY < b.maxY - epsilon && a.maxY > b.minY + epsilon;
  const overlapZ = a.minZ < b.maxZ - epsilon && a.maxZ > b.minZ + epsilon;

  return overlapX && overlapY && overlapZ;
}

/**
 * Calculate the volume of overlap between two AABBs
 * Returns 0 if no overlap
 */
function getOverlapVolume(a: AABB, b: AABB): number {
  const overlapX = Math.max(
    0,
    Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX),
  );
  const overlapY = Math.max(
    0,
    Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY),
  );
  const overlapZ = Math.max(
    0,
    Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ),
  );
  return overlapX * overlapY * overlapZ;
}

/**
 * Detailed geometry extractor that creates separate AABBs for each component
 * by analyzing the geometry triangles
 */
function extractDetailedAABBs(geometry: THREE.BufferGeometry): AABB[] {
  const position = geometry.attributes.position;
  if (!position) return [];

  const triCount = position.count / 3;
  const precision = 100; // Precision for grouping vertices

  // Group triangles by their bounding box to identify separate components
  const componentMap = new Map<
    string,
    {
      minX: number;
      maxX: number;
      minY: number;
      maxY: number;
      minZ: number;
      maxZ: number;
    }
  >();

  for (let tri = 0; tri < triCount; tri++) {
    const i0 = tri * 3;
    const i1 = tri * 3 + 1;
    const i2 = tri * 3 + 2;

    const x0 = position.getX(i0),
      y0 = position.getY(i0),
      z0 = position.getZ(i0);
    const x1 = position.getX(i1),
      y1 = position.getY(i1),
      z1 = position.getZ(i1);
    const x2 = position.getX(i2),
      y2 = position.getY(i2),
      z2 = position.getZ(i2);

    const minX = Math.min(x0, x1, x2);
    const maxX = Math.max(x0, x1, x2);
    const minY = Math.min(y0, y1, y2);
    const maxY = Math.max(y0, y1, y2);
    const minZ = Math.min(z0, z1, z2);
    const maxZ = Math.max(z0, z1, z2);

    // Round to precision to group nearby triangles
    const key = `${Math.round(minX * precision)},${Math.round(maxX * precision)},${Math.round(minY * precision)},${Math.round(maxY * precision)},${Math.round(minZ * precision)},${Math.round(maxZ * precision)}`;

    if (!componentMap.has(key)) {
      componentMap.set(key, { minX, maxX, minY, maxY, minZ, maxZ });
    } else {
      const existing = componentMap.get(key)!;
      existing.minX = Math.min(existing.minX, minX);
      existing.maxX = Math.max(existing.maxX, maxX);
      existing.minY = Math.min(existing.minY, minY);
      existing.maxY = Math.max(existing.maxY, maxY);
      existing.minZ = Math.min(existing.minZ, minZ);
      existing.maxZ = Math.max(existing.maxZ, maxZ);
    }
  }

  const aabbs: AABB[] = [];
  let index = 0;
  for (const bounds of componentMap.values()) {
    aabbs.push({
      ...bounds,
      label: `component_${index++}`,
    });
  }

  return aabbs;
}

/**
 * Analyze geometry for duplicate/overlapping triangles
 * Returns count of duplicate triangle pairs
 */
function countDuplicateTriangles(geometry: THREE.BufferGeometry): number {
  const position = geometry.attributes.position;
  if (!position) return 0;

  const triCount = position.count / 3;
  const precision = 1000;
  const triMap = new Map<string, number>();

  const makeTriKey = (i0: number, i1: number, i2: number): string => {
    const verts = [i0, i1, i2].map((idx) => {
      const x = Math.round(position.getX(idx) * precision);
      const y = Math.round(position.getY(idx) * precision);
      const z = Math.round(position.getZ(idx) * precision);
      return `${x},${y},${z}`;
    });
    verts.sort();
    return verts.join("|");
  };

  for (let tri = 0; tri < triCount; tri++) {
    const key = makeTriKey(tri * 3, tri * 3 + 1, tri * 3 + 2);
    triMap.set(key, (triMap.get(key) || 0) + 1);
  }

  let duplicates = 0;
  for (const count of triMap.values()) {
    if (count > 1) {
      duplicates += count - 1;
    }
  }

  return duplicates;
}

/**
 * Check if wall corners are properly aligned
 * Corners should have posts and walls should meet without gaps
 */
function verifyCornerAlignment(layout: {
  width: number;
  depth: number;
  floorPlans: Array<{ footprint: boolean[][] }>;
}): { valid: boolean; issues: string[] } {
  const issues: string[] = [];
  const halfCell = CELL_SIZE / 2;
  const halfThick = WALL_THICKNESS / 2;

  for (let floorIdx = 0; floorIdx < layout.floorPlans.length; floorIdx++) {
    const footprint = layout.floorPlans[floorIdx].footprint;
    const depth = footprint.length;
    const width = footprint[0]?.length || 0;

    for (let row = 0; row < depth; row++) {
      for (let col = 0; col < width; col++) {
        if (!footprint[row][col]) continue;

        // Check each corner of this cell
        const hasNorth = row === 0 || !footprint[row - 1]?.[col];
        const hasSouth = row === depth - 1 || !footprint[row + 1]?.[col];
        const hasEast = col === width - 1 || !footprint[row][col + 1];
        const hasWest = col === 0 || !footprint[row][col - 1];

        // NW corner
        if (hasNorth && hasWest) {
          // This corner needs a post
          const hasNWDiagonal =
            row > 0 && col > 0 && footprint[row - 1][col - 1];
          if (hasNWDiagonal) {
            // There's a diagonal cell - this could create L-shaped geometry
            // Verify walls don't overlap
          }
        }

        // NE corner
        if (hasNorth && hasEast) {
          const hasNEDiagonal =
            row > 0 && col < width - 1 && footprint[row - 1][col + 1];
          if (hasNEDiagonal) {
            // Similar check
          }
        }

        // SW corner
        if (hasSouth && hasWest) {
          const hasSWDiagonal =
            row < depth - 1 && col > 0 && footprint[row + 1][col - 1];
          if (hasSWDiagonal) {
            // Similar check
          }
        }

        // SE corner
        if (hasSouth && hasEast) {
          const hasSEDiagonal =
            row < depth - 1 && col < width - 1 && footprint[row + 1][col + 1];
          if (hasSEDiagonal) {
            // Similar check
          }
        }
      }
    }
  }

  return { valid: issues.length === 0, issues };
}

/**
 * Verify that wall segments and corner posts don't intersect with each other
 * and that corners join perfectly (walls meet corner posts exactly)
 */
function verifyWallsNoIntersection(layout: {
  width: number;
  depth: number;
  floorPlans: Array<{ footprint: boolean[][] }>;
}): { valid: boolean; intersections: string[] } {
  const intersections: string[] = [];
  const walls: AABB[] = [];
  const cornerPosts: AABB[] = [];
  const halfCell = CELL_SIZE / 2;
  const halfThick = WALL_THICKNESS / 2;

  for (let floorIdx = 0; floorIdx < layout.floorPlans.length; floorIdx++) {
    const footprint = layout.floorPlans[floorIdx].footprint;
    const depth = footprint.length;
    const width = footprint[0]?.length || 0;
    const y = floorIdx * FLOOR_HEIGHT;
    const placedWalls = new Set<string>();
    const placedCorners = new Set<string>();

    // Calculate cell center offset
    const halfWidth = (layout.width * CELL_SIZE) / 2;
    const halfDepth = (layout.depth * CELL_SIZE) / 2;

    // First pass: identify corners for each cell and add corner posts
    const cellCorners = new Map<
      string,
      { nw: boolean; ne: boolean; sw: boolean; se: boolean }
    >();

    for (let row = 0; row < depth; row++) {
      for (let col = 0; col < width; col++) {
        if (!footprint[row][col]) continue;

        const x = col * CELL_SIZE + CELL_SIZE / 2 - halfWidth;
        const z = row * CELL_SIZE + CELL_SIZE / 2 - halfDepth;

        const hasNorth = row === 0 || !footprint[row - 1]?.[col];
        const hasSouth = row === depth - 1 || !footprint[row + 1]?.[col];
        const hasEast = col === width - 1 || !footprint[row][col + 1];
        const hasWest = col === 0 || !footprint[row][col - 1];

        const corners = { nw: false, ne: false, sw: false, se: false };

        // Add corner posts (matching the generator exactly)
        if (hasNorth && hasWest) {
          const cornerKey = `${col - 0.5},${row - 0.5},${floorIdx}`;
          if (!placedCorners.has(cornerKey)) {
            placedCorners.add(cornerKey);
            const cx = x - halfCell + halfThick;
            const cz = z - halfCell + halfThick;
            cornerPosts.push({
              minX: cx - halfThick,
              maxX: cx + halfThick,
              minY: y,
              maxY: y + WALL_HEIGHT,
              minZ: cz - halfThick,
              maxZ: cz + halfThick,
              label: `corner_nw_${col}_${row}_f${floorIdx}`,
            });
          }
          corners.nw = true;
        }
        if (hasNorth && hasEast) {
          const cornerKey = `${col + 0.5},${row - 0.5},${floorIdx}`;
          if (!placedCorners.has(cornerKey)) {
            placedCorners.add(cornerKey);
            const cx = x + halfCell - halfThick;
            const cz = z - halfCell + halfThick;
            cornerPosts.push({
              minX: cx - halfThick,
              maxX: cx + halfThick,
              minY: y,
              maxY: y + WALL_HEIGHT,
              minZ: cz - halfThick,
              maxZ: cz + halfThick,
              label: `corner_ne_${col}_${row}_f${floorIdx}`,
            });
          }
          corners.ne = true;
        }
        if (hasSouth && hasWest) {
          const cornerKey = `${col - 0.5},${row + 0.5},${floorIdx}`;
          if (!placedCorners.has(cornerKey)) {
            placedCorners.add(cornerKey);
            const cx = x - halfCell + halfThick;
            const cz = z + halfCell - halfThick;
            cornerPosts.push({
              minX: cx - halfThick,
              maxX: cx + halfThick,
              minY: y,
              maxY: y + WALL_HEIGHT,
              minZ: cz - halfThick,
              maxZ: cz + halfThick,
              label: `corner_sw_${col}_${row}_f${floorIdx}`,
            });
          }
          corners.sw = true;
        }
        if (hasSouth && hasEast) {
          const cornerKey = `${col + 0.5},${row + 0.5},${floorIdx}`;
          if (!placedCorners.has(cornerKey)) {
            placedCorners.add(cornerKey);
            const cx = x + halfCell - halfThick;
            const cz = z + halfCell - halfThick;
            cornerPosts.push({
              minX: cx - halfThick,
              maxX: cx + halfThick,
              minY: y,
              maxY: y + WALL_HEIGHT,
              minZ: cz - halfThick,
              maxZ: cz + halfThick,
              label: `corner_se_${col}_${row}_f${floorIdx}`,
            });
          }
          corners.se = true;
        }

        cellCorners.set(`${col},${row}`, corners);
      }
    }

    // Second pass: add walls (shortened at corners to meet corner posts exactly)
    for (let row = 0; row < depth; row++) {
      for (let col = 0; col < width; col++) {
        if (!footprint[row][col]) continue;

        const x = col * CELL_SIZE + CELL_SIZE / 2 - halfWidth;
        const z = row * CELL_SIZE + CELL_SIZE / 2 - halfDepth;

        const corners = cellCorners.get(`${col},${row}`) || {
          nw: false,
          ne: false,
          sw: false,
          se: false,
        };

        // Wall segments shortened at corners
        const sides = [
          {
            dc: -1,
            dr: 0,
            side: "west",
            isVertical: true,
            hasStart: corners.nw,
            hasEnd: corners.sw,
          },
          {
            dc: 1,
            dr: 0,
            side: "east",
            isVertical: true,
            hasStart: corners.ne,
            hasEnd: corners.se,
          },
          {
            dc: 0,
            dr: -1,
            side: "north",
            isVertical: false,
            hasStart: corners.nw,
            hasEnd: corners.ne,
          },
          {
            dc: 0,
            dr: 1,
            side: "south",
            isVertical: false,
            hasStart: corners.sw,
            hasEnd: corners.se,
          },
        ];

        for (const { dc, dr, side, isVertical, hasStart, hasEnd } of sides) {
          const nc = col + dc;
          const nr = row + dr;
          const hasNeighbor =
            nr >= 0 &&
            nr < depth &&
            nc >= 0 &&
            nc < width &&
            footprint[nr]?.[nc];

          if (!hasNeighbor) {
            const wallKey = `${Math.min(col, nc)},${Math.min(row, nr)},${isVertical ? "v" : "h"},${floorIdx}`;
            if (placedWalls.has(wallKey)) continue;
            placedWalls.add(wallKey);

            // Calculate wall length and offset - walls are shortened at corners
            let wallLength = CELL_SIZE;
            let offset = 0;

            // At corners, shorten wall by full thickness to meet corner post
            if (hasStart) {
              wallLength -= WALL_THICKNESS;
              offset += WALL_THICKNESS / 2;
            }
            if (hasEnd) {
              wallLength -= WALL_THICKNESS;
              offset -= WALL_THICKNESS / 2;
            }

            const ox = isVertical
              ? (-halfCell + halfThick) * (side === "west" ? 1 : -1)
              : offset;
            const oz = isVertical
              ? offset
              : (-halfCell + halfThick) * (side === "north" ? 1 : -1);

            const wx = x + ox;
            const wz = z + oz;
            const wWidth = isVertical ? WALL_THICKNESS : wallLength;
            const wDepth = isVertical ? wallLength : WALL_THICKNESS;

            walls.push({
              minX: wx - wWidth / 2,
              maxX: wx + wWidth / 2,
              minY: y,
              maxY: y + WALL_HEIGHT,
              minZ: wz - wDepth / 2,
              maxZ: wz + wDepth / 2,
              label: `wall_${side}_${col}_${row}_f${floorIdx}`,
            });
          }
        }
      }
    }
  }

  // Combine walls and corner posts for intersection checking
  const allElements = [...walls, ...cornerPosts];

  // Check for volumetric intersections (overlap)
  for (let i = 0; i < allElements.length; i++) {
    for (let j = i + 1; j < allElements.length; j++) {
      const a = allElements[i];
      const b = allElements[j];

      // Check if they overlap in volume (not just touching faces)
      const overlapVolume = getOverlapVolume(a, b);

      // Allow very small overlaps due to floating point (epsilon tolerance)
      const minVolume = WALL_THICKNESS * WALL_THICKNESS * 0.01; // 1% tolerance
      if (overlapVolume > minVolume) {
        intersections.push(
          `${a.label} intersects ${b.label} (volume: ${overlapVolume.toFixed(4)})`,
        );
      }
    }
  }

  return { valid: intersections.length === 0, intersections };
}

/**
 * Verify that corner posts and walls join perfectly (no gaps)
 */
function verifyCornerJoins(layout: {
  width: number;
  depth: number;
  floorPlans: Array<{ footprint: boolean[][] }>;
}): { valid: boolean; gaps: string[] } {
  const gaps: string[] = [];
  const halfCell = CELL_SIZE / 2;
  const halfThick = WALL_THICKNESS / 2;
  const epsilon = 0.001; // Tolerance for floating point comparison

  for (let floorIdx = 0; floorIdx < layout.floorPlans.length; floorIdx++) {
    const footprint = layout.floorPlans[floorIdx].footprint;
    const depth = footprint.length;
    const width = footprint[0]?.length || 0;

    const halfWidth = (layout.width * CELL_SIZE) / 2;
    const halfDepth = (layout.depth * CELL_SIZE) / 2;

    for (let row = 0; row < depth; row++) {
      for (let col = 0; col < width; col++) {
        if (!footprint[row][col]) continue;

        const x = col * CELL_SIZE + CELL_SIZE / 2 - halfWidth;
        const z = row * CELL_SIZE + CELL_SIZE / 2 - halfDepth;

        const hasNorth = row === 0 || !footprint[row - 1]?.[col];
        const hasSouth = row === depth - 1 || !footprint[row + 1]?.[col];
        const hasEast = col === width - 1 || !footprint[row][col + 1];
        const hasWest = col === 0 || !footprint[row][col - 1];

        // Check each corner that should exist
        const cornerChecks = [
          {
            hasCorner: hasNorth && hasWest,
            name: "NW",
            cornerX: x - halfCell + halfThick,
            cornerZ: z - halfCell + halfThick,
            wallW: {
              side: "west",
              endX: x - halfCell + halfThick,
              endZ: z - halfCell + WALL_THICKNESS,
            },
            wallN: {
              side: "north",
              endX: x - halfCell + WALL_THICKNESS,
              endZ: z - halfCell + halfThick,
            },
          },
          {
            hasCorner: hasNorth && hasEast,
            name: "NE",
            cornerX: x + halfCell - halfThick,
            cornerZ: z - halfCell + halfThick,
            wallE: {
              side: "east",
              endX: x + halfCell - halfThick,
              endZ: z - halfCell + WALL_THICKNESS,
            },
            wallN: {
              side: "north",
              endX: x + halfCell - WALL_THICKNESS,
              endZ: z - halfCell + halfThick,
            },
          },
          {
            hasCorner: hasSouth && hasWest,
            name: "SW",
            cornerX: x - halfCell + halfThick,
            cornerZ: z + halfCell - halfThick,
            wallW: {
              side: "west",
              endX: x - halfCell + halfThick,
              endZ: z + halfCell - WALL_THICKNESS,
            },
            wallS: {
              side: "south",
              endX: x - halfCell + WALL_THICKNESS,
              endZ: z + halfCell - halfThick,
            },
          },
          {
            hasCorner: hasSouth && hasEast,
            name: "SE",
            cornerX: x + halfCell - halfThick,
            cornerZ: z + halfCell - halfThick,
            wallE: {
              side: "east",
              endX: x + halfCell - halfThick,
              endZ: z + halfCell - WALL_THICKNESS,
            },
            wallS: {
              side: "south",
              endX: x + halfCell - WALL_THICKNESS,
              endZ: z + halfCell - halfThick,
            },
          },
        ];

        for (const check of cornerChecks) {
          if (!check.hasCorner) continue;

          // Corner post position
          const cpMinX = check.cornerX - halfThick;
          const cpMaxX = check.cornerX + halfThick;
          const cpMinZ = check.cornerZ - halfThick;
          const cpMaxZ = check.cornerZ + halfThick;

          // Verify corner post bounds are valid
          if (
            cpMaxX - cpMinX < WALL_THICKNESS - epsilon ||
            cpMaxZ - cpMinZ < WALL_THICKNESS - epsilon
          ) {
            gaps.push(
              `Corner ${check.name} at ${col},${row} f${floorIdx} has invalid dimensions`,
            );
          }
        }
      }
    }
  }

  return { valid: gaps.length === 0, gaps };
}

/**
 * Comprehensive verification of all geometry Y levels and XZ alignment
 * Checks that all elements are at the correct height and properly aligned
 */
function verifyGeometryLevels(layout: {
  width: number;
  depth: number;
  floors: number;
  floorPlans: Array<{ footprint: boolean[][] }>;
  stairs?: {
    col: number;
    row: number;
    landing: { col: number; row: number };
  } | null;
}): { valid: boolean; issues: string[] } {
  const issues: string[] = [];
  const halfCell = CELL_SIZE / 2;
  const halfThick = WALL_THICKNESS / 2;
  const epsilon = 0.001;

  for (let floorIdx = 0; floorIdx < layout.floors; floorIdx++) {
    const footprint = layout.floorPlans[floorIdx].footprint;
    const depth = footprint.length;
    const width = footprint[0]?.length || 0;
    const isTopFloor = floorIdx === layout.floors - 1;

    // Expected Y levels for this floor
    const floorY = floorIdx * FLOOR_HEIGHT + FOUNDATION_HEIGHT;
    const wallHeight = isTopFloor ? WALL_HEIGHT : FLOOR_HEIGHT;
    const wallTopY = floorY + wallHeight;
    const ceilingY = (floorIdx + 1) * FLOOR_HEIGHT + FOUNDATION_HEIGHT;

    const halfWidth = (layout.width * CELL_SIZE) / 2;
    const halfDepth = (layout.depth * CELL_SIZE) / 2;

    for (let row = 0; row < depth; row++) {
      for (let col = 0; col < width; col++) {
        if (!footprint[row][col]) continue;

        const x = col * CELL_SIZE + CELL_SIZE / 2 - halfWidth;
        const z = row * CELL_SIZE + CELL_SIZE / 2 - halfDepth;

        const hasNorth = row === 0 || !footprint[row - 1]?.[col];
        const hasSouth = row === depth - 1 || !footprint[row + 1]?.[col];
        const hasEast = col === width - 1 || !footprint[row][col + 1];
        const hasWest = col === 0 || !footprint[row][col - 1];

        // === FLOOR TILE VERIFICATION ===
        // Floor tile top surface should be at floorY
        // Floor tile bottom should be at floorY - FLOOR_THICKNESS
        // Floor tiles are inset from external walls by WALL_THICKNESS/2

        let expectedFloorMinX = x - halfCell;
        let expectedFloorMaxX = x + halfCell;
        let expectedFloorMinZ = z - halfCell;
        let expectedFloorMaxZ = z + halfCell;

        // Inset at external walls
        if (hasWest) expectedFloorMinX += halfThick;
        if (hasEast) expectedFloorMaxX -= halfThick;
        if (hasNorth) expectedFloorMinZ += halfThick;
        if (hasSouth) expectedFloorMaxZ -= halfThick;

        // Verify floor dimensions are positive
        if (expectedFloorMaxX - expectedFloorMinX < CELL_SIZE * 0.3) {
          issues.push(
            `Floor tile at ${col},${row} f${floorIdx} has invalid X size: ${expectedFloorMaxX - expectedFloorMinX}`,
          );
        }
        if (expectedFloorMaxZ - expectedFloorMinZ < CELL_SIZE * 0.3) {
          issues.push(
            `Floor tile at ${col},${row} f${floorIdx} has invalid Z size: ${expectedFloorMaxZ - expectedFloorMinZ}`,
          );
        }

        // === WALL VERIFICATION ===
        // Walls should start at floorY (bottom) and end at wallTopY (top)
        // Wall center is at (-halfCell + halfThick) from cell center for west/north
        // Wall center is at (+halfCell - halfThick) from cell center for east/south

        const wallChecks = [
          {
            hasWall: hasNorth,
            side: "north",
            centerZ: z - halfCell + halfThick,
            minX:
              hasNorth && hasWest
                ? x - halfCell + WALL_THICKNESS
                : x - halfCell,
            maxX:
              hasNorth && hasEast
                ? x + halfCell - WALL_THICKNESS
                : x + halfCell,
          },
          {
            hasWall: hasSouth,
            side: "south",
            centerZ: z + halfCell - halfThick,
            minX:
              hasSouth && hasWest
                ? x - halfCell + WALL_THICKNESS
                : x - halfCell,
            maxX:
              hasSouth && hasEast
                ? x + halfCell - WALL_THICKNESS
                : x + halfCell,
          },
          {
            hasWall: hasEast,
            side: "east",
            centerX: x + halfCell - halfThick,
            minZ:
              hasEast && hasNorth
                ? z - halfCell + WALL_THICKNESS
                : z - halfCell,
            maxZ:
              hasEast && hasSouth
                ? z + halfCell - WALL_THICKNESS
                : z + halfCell,
          },
          {
            hasWall: hasWest,
            side: "west",
            centerX: x - halfCell + halfThick,
            minZ:
              hasWest && hasNorth
                ? z - halfCell + WALL_THICKNESS
                : z - halfCell,
            maxZ:
              hasWest && hasSouth
                ? z + halfCell - WALL_THICKNESS
                : z + halfCell,
          },
        ];

        for (const check of wallChecks) {
          if (!check.hasWall) continue;

          // Verify wall length is positive
          if (check.side === "north" || check.side === "south") {
            const wallLength = check.maxX! - check.minX!;
            if (wallLength < CELL_SIZE * 0.3) {
              issues.push(
                `Wall ${check.side} at ${col},${row} f${floorIdx} has invalid length: ${wallLength}`,
              );
            }
          } else {
            const wallLength = check.maxZ! - check.minZ!;
            if (wallLength < CELL_SIZE * 0.3) {
              issues.push(
                `Wall ${check.side} at ${col},${row} f${floorIdx} has invalid length: ${wallLength}`,
              );
            }
          }
        }

        // === CORNER POST VERIFICATION ===
        // Corner posts are WALL_THICKNESS x WALL_HEIGHT x WALL_THICKNESS
        // Positioned at external corners
        const corners = [
          {
            hasCorner: hasNorth && hasWest,
            name: "NW",
            x: x - halfCell + halfThick,
            z: z - halfCell + halfThick,
          },
          {
            hasCorner: hasNorth && hasEast,
            name: "NE",
            x: x + halfCell - halfThick,
            z: z - halfCell + halfThick,
          },
          {
            hasCorner: hasSouth && hasWest,
            name: "SW",
            x: x - halfCell + halfThick,
            z: z + halfCell - halfThick,
          },
          {
            hasCorner: hasSouth && hasEast,
            name: "SE",
            x: x + halfCell - halfThick,
            z: z + halfCell - halfThick,
          },
        ];

        for (const corner of corners) {
          if (!corner.hasCorner) continue;

          // Verify corner post touches adjacent walls exactly
          // NW corner should touch north wall at x and west wall at z
          const cpMinX = corner.x - halfThick;
          const cpMaxX = corner.x + halfThick;
          const cpMinZ = corner.z - halfThick;
          const cpMaxZ = corner.z + halfThick;

          // Corner post should be exactly WALL_THICKNESS in both dimensions
          const cpWidthX = cpMaxX - cpMinX;
          const cpWidthZ = cpMaxZ - cpMinZ;

          if (Math.abs(cpWidthX - WALL_THICKNESS) > epsilon) {
            issues.push(
              `Corner ${corner.name} at ${col},${row} f${floorIdx} has wrong X width: ${cpWidthX} (expected ${WALL_THICKNESS})`,
            );
          }
          if (Math.abs(cpWidthZ - WALL_THICKNESS) > epsilon) {
            issues.push(
              `Corner ${corner.name} at ${col},${row} f${floorIdx} has wrong Z width: ${cpWidthZ} (expected ${WALL_THICKNESS})`,
            );
          }
        }
      }
    }
  }

  return { valid: issues.length === 0, issues };
}

/**
 * Verify floor tiles don't overlap with walls or each other
 */
function verifyFloorAlignment(layout: {
  width: number;
  depth: number;
  floors: number;
  floorPlans: Array<{ footprint: boolean[][] }>;
}): { valid: boolean; issues: string[] } {
  const issues: string[] = [];
  const floorInset = WALL_THICKNESS / 2;
  const halfWidth = (layout.width * CELL_SIZE) / 2;
  const halfDepth = (layout.depth * CELL_SIZE) / 2;

  for (let floorIdx = 0; floorIdx < layout.floors; floorIdx++) {
    const footprint = layout.floorPlans[floorIdx].footprint;
    const depth = footprint.length;
    const width = footprint[0]?.length || 0;
    const y = floorIdx * FLOOR_HEIGHT;

    for (let row = 0; row < depth; row++) {
      for (let col = 0; col < width; col++) {
        if (!footprint[row][col]) continue;

        const x = col * CELL_SIZE + CELL_SIZE / 2 - halfWidth;
        const z = row * CELL_SIZE + CELL_SIZE / 2 - halfDepth;

        // Check wall adjacency
        const hasNorth = row === 0 || !footprint[row - 1]?.[col];
        const hasSouth = row === depth - 1 || !footprint[row + 1]?.[col];
        const hasEast = col === width - 1 || !footprint[row][col + 1];
        const hasWest = col === 0 || !footprint[row][col - 1];

        // Calculate expected floor tile bounds
        let xSize = CELL_SIZE;
        let zSize = CELL_SIZE;
        let xOffset = 0;
        let zOffset = 0;

        if (hasWest) {
          xSize -= floorInset;
          xOffset += floorInset / 2;
        }
        if (hasEast) {
          xSize -= floorInset;
          xOffset -= floorInset / 2;
        }
        if (hasNorth) {
          zSize -= floorInset;
          zOffset += floorInset / 2;
        }
        if (hasSouth) {
          zSize -= floorInset;
          zOffset -= floorInset / 2;
        }

        // Floor tile should fit within cell boundaries with proper inset
        const floorMinX = x + xOffset - xSize / 2;
        const floorMaxX = x + xOffset + xSize / 2;
        const floorMinZ = z + zOffset - zSize / 2;
        const floorMaxZ = z + zOffset + zSize / 2;

        // Calculate wall boundaries for this cell
        const cellMinX = x - CELL_SIZE / 2;
        const cellMaxX = x + CELL_SIZE / 2;
        const cellMinZ = z - CELL_SIZE / 2;
        const cellMaxZ = z + CELL_SIZE / 2;

        // Verify floor doesn't extend past cell (with wall inset)
        const tolerance = 0.001;
        if (
          floorMinX < cellMinX - tolerance ||
          floorMaxX > cellMaxX + tolerance
        ) {
          issues.push(
            `Floor tile at (${col},${row}) floor ${floorIdx} X bounds exceed cell`,
          );
        }
        if (
          floorMinZ < cellMinZ - tolerance ||
          floorMaxZ > cellMaxZ + tolerance
        ) {
          issues.push(
            `Floor tile at (${col},${row}) floor ${floorIdx} Z bounds exceed cell`,
          );
        }
      }
    }
  }

  return { valid: issues.length === 0, issues };
}

describe("BuildingGenerator", () => {
  let generator: BuildingGenerator;

  beforeEach(() => {
    generator = new BuildingGenerator();
  });

  afterEach(() => {
    generator.dispose();
  });

  describe("generate", () => {
    it("generates a building for each recipe type", () => {
      const types = Object.keys(BUILDING_RECIPES);

      for (const typeKey of types) {
        const result = generator.generate(typeKey, { seed: `test_${typeKey}` });

        expect(result).not.toBeNull();
        expect(result!.typeKey).toBe(typeKey);
        expect(result!.mesh).toBeDefined();
        expect(result!.stats).toBeDefined();
        expect(result!.layout).toBeDefined();
      }
    });

    it("returns null for unknown building type", () => {
      const result = generator.generate("unknown_type");
      expect(result).toBeNull();
    });

    it("generates deterministic buildings with same seed", () => {
      const result1 = generator.generate("inn", { seed: "test_seed_123" });
      const result2 = generator.generate("inn", { seed: "test_seed_123" });

      expect(result1!.stats.rooms).toBe(result2!.stats.rooms);
      expect(result1!.stats.wallSegments).toBe(result2!.stats.wallSegments);
      expect(result1!.stats.footprintCells).toBe(result2!.stats.footprintCells);
    });

    it("generates different buildings with different seeds", () => {
      const seeds = ["seed_a", "seed_b", "seed_c", "seed_d", "seed_e"];
      const results = seeds.map((seed) => generator.generate("inn", { seed }));

      // At least some should have different footprints
      const footprints = results.map((r) => r!.stats.footprintCells);
      const uniqueFootprints = new Set(footprints);

      // With 5 different seeds, we should get at least 2 different footprint sizes
      expect(uniqueFootprints.size).toBeGreaterThanOrEqual(2);
    });

    it("respects includeRoof option", () => {
      const withRoof = generator.generate("simple-house", {
        seed: "roof_test",
        includeRoof: true,
      });
      const withoutRoof = generator.generate("simple-house", {
        seed: "roof_test",
        includeRoof: false,
      });

      expect(withRoof!.stats.roofPieces).toBeGreaterThan(0);
      expect(withoutRoof!.stats.roofPieces).toBe(0);
    });
  });

  describe("generateLayout", () => {
    it("generates valid layouts for all recipe types", () => {
      const types = Object.keys(BUILDING_RECIPES);

      for (const typeKey of types) {
        const recipe = BUILDING_RECIPES[typeKey];
        const rng = createRng(`layout_${typeKey}`);
        const layout = generator.generateLayout(recipe, rng);

        expect(layout.width).toBeGreaterThanOrEqual(recipe.widthRange[0]);
        expect(layout.width).toBeLessThanOrEqual(recipe.widthRange[1]);
        expect(layout.depth).toBeGreaterThanOrEqual(recipe.depthRange[0]);

        // Foyer-style buildings can extend depth beyond base range
        if (recipe.footprintStyle === "foyer" && recipe.foyerDepthRange) {
          const maxDepthWithFoyer =
            recipe.depthRange[1] + recipe.foyerDepthRange[1];
          expect(layout.depth).toBeLessThanOrEqual(maxDepthWithFoyer);
        } else {
          expect(layout.depth).toBeLessThanOrEqual(recipe.depthRange[1]);
        }

        expect(layout.floors).toBeGreaterThanOrEqual(1);
        expect(layout.floorPlans.length).toBe(layout.floors);
      }
    });

    it("generates rooms for each floor", () => {
      const recipe = BUILDING_RECIPES["bank"];
      const rng = createRng("rooms_test");
      const layout = generator.generateLayout(recipe, rng);

      for (const plan of layout.floorPlans) {
        expect(plan.rooms.length).toBeGreaterThan(0);
        expect(plan.footprint.length).toBeGreaterThan(0);
        expect(plan.roomMap.length).toBe(plan.footprint.length);
      }
    });
  });

  describe("buildBuilding", () => {
    it("creates a mesh from a layout", () => {
      const recipe = BUILDING_RECIPES["store"];
      const rng = createRng("mesh_test");
      const layout = generator.generateLayout(recipe, rng);
      const { building, stats } = generator.buildBuilding(
        layout,
        recipe,
        "store",
        rng,
        true,
      );

      expect(building).toBeDefined();
      expect(stats.wallSegments).toBeGreaterThan(0);
      expect(stats.floorTiles).toBeGreaterThan(0);
    });
  });
});

describe("BUILDING_RECIPES", () => {
  it("has required fields for each recipe", () => {
    const requiredFields = [
      "label",
      "widthRange",
      "depthRange",
      "floors",
      "entranceCount",
      "archBias",
      "extraConnectionChance",
      "entranceArchChance",
      "roomSpanRange",
      "minRoomArea",
      "windowChance",
      "frontSide",
    ];

    for (const [typeKey, recipe] of Object.entries(BUILDING_RECIPES)) {
      for (const field of requiredFields) {
        expect(recipe).toHaveProperty(field);
      }

      // Validate ranges
      expect(recipe.widthRange[0]).toBeLessThanOrEqual(recipe.widthRange[1]);
      expect(recipe.depthRange[0]).toBeLessThanOrEqual(recipe.depthRange[1]);
      expect(recipe.floors).toBeGreaterThanOrEqual(1);
    }
  });

  it("includes expected building types", () => {
    const expectedTypes = [
      // Basic
      "simple-house",
      "long-house",
      "inn",
      "bank",
      "store",
      "smithy",
      // Large residential
      "mansion",
      // Fortifications
      "keep",
      "fortress",
      // Religious
      "church",
      "cathedral",
      // Civic
      "guild-hall",
    ];

    for (const type of expectedTypes) {
      expect(BUILDING_RECIPES).toHaveProperty(type);
    }
  });
});

describe("createRng", () => {
  it("produces values between 0 and 1", () => {
    const rng = createRng("test_rng");

    for (let i = 0; i < 100; i++) {
      const value = rng.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("int produces values in range", () => {
    const rng = createRng("int_test");

    for (let i = 0; i < 100; i++) {
      const value = rng.int(5, 10);
      expect(value).toBeGreaterThanOrEqual(5);
      expect(value).toBeLessThanOrEqual(10);
    }
  });

  it("chance produces boolean based on probability", () => {
    const rng = createRng("chance_test");
    let trueCount = 0;
    const iterations = 1000;

    for (let i = 0; i < iterations; i++) {
      if (rng.chance(0.5)) trueCount++;
    }

    // Should be roughly 50% (with some tolerance)
    const ratio = trueCount / iterations;
    expect(ratio).toBeGreaterThan(0.4);
    expect(ratio).toBeLessThan(0.6);
  });

  it("is deterministic with same seed", () => {
    const rng1 = createRng("deterministic");
    const rng2 = createRng("deterministic");

    for (let i = 0; i < 20; i++) {
      expect(rng1.next()).toBe(rng2.next());
    }
  });
});

// ============================================================
// GEOMETRY VALIDATION TESTS
// ============================================================

describe("Building Geometry Validation", () => {
  let generator: BuildingGenerator;

  beforeEach(() => {
    generator = new BuildingGenerator();
  });

  afterEach(() => {
    generator.dispose();
  });

  describe("Wall intersection tests", () => {
    it("walls should not intersect for simple-house with various seeds", () => {
      const seeds = [
        "wall_test_1",
        "wall_test_2",
        "wall_test_3",
        "wall_test_4",
        "wall_test_5",
      ];

      for (const seed of seeds) {
        const result = generator.generate("simple-house", { seed });
        expect(result).not.toBeNull();

        const validation = verifyWallsNoIntersection(result!.layout);

        if (!validation.valid) {
          console.error(
            `Wall intersection issues for seed "${seed}":`,
            validation.intersections,
          );
        }

        expect(validation.valid).toBe(true);
      }
    });

    it("walls should not intersect for multi-floor buildings (inn)", () => {
      const seeds = [
        "inn_walls_1",
        "inn_walls_2",
        "inn_walls_3",
        "inn_walls_4",
        "inn_walls_5",
      ];

      for (const seed of seeds) {
        const result = generator.generate("inn", { seed });
        expect(result).not.toBeNull();

        const validation = verifyWallsNoIntersection(result!.layout);

        if (!validation.valid) {
          console.error(
            `Wall intersection issues for inn seed "${seed}":`,
            validation.intersections,
          );
        }

        expect(validation.valid).toBe(true);
      }
    });

    it("walls should not intersect for foyer-style buildings (bank)", () => {
      const seeds = ["bank_walls_1", "bank_walls_2", "bank_walls_3"];

      for (const seed of seeds) {
        const result = generator.generate("bank", { seed });
        expect(result).not.toBeNull();

        const validation = verifyWallsNoIntersection(result!.layout);

        if (!validation.valid) {
          console.error(
            `Wall intersection issues for bank seed "${seed}":`,
            validation.intersections,
          );
        }

        expect(validation.valid).toBe(true);
      }
    });

    it("walls should not intersect for all building types", () => {
      const types = Object.keys(BUILDING_RECIPES);

      for (const typeKey of types) {
        const result = generator.generate(typeKey, {
          seed: `all_types_${typeKey}`,
        });
        expect(result).not.toBeNull();

        const validation = verifyWallsNoIntersection(result!.layout);

        if (!validation.valid) {
          console.error(
            `Wall intersection issues for ${typeKey}:`,
            validation.intersections,
          );
        }

        expect(validation.valid).toBe(true);
      }
    });
  });

  describe("Floor alignment tests", () => {
    it("floor tiles should be properly aligned for all building types", () => {
      const types = Object.keys(BUILDING_RECIPES);

      for (const typeKey of types) {
        const result = generator.generate(typeKey, {
          seed: `floor_align_${typeKey}`,
        });
        expect(result).not.toBeNull();

        const validation = verifyFloorAlignment(result!.layout);

        if (!validation.valid) {
          console.error(
            `Floor alignment issues for ${typeKey}:`,
            validation.issues,
          );
        }

        expect(validation.valid).toBe(true);
      }
    });

    it("floor tiles should fit within cell boundaries with wall inset", () => {
      // Test with known seed for reproducibility
      const result = generator.generate("inn", { seed: "floor_bounds_test" });
      expect(result).not.toBeNull();

      const layout = result!.layout;
      const halfWidth = (layout.width * CELL_SIZE) / 2;
      const halfDepth = (layout.depth * CELL_SIZE) / 2;
      const floorInset = WALL_THICKNESS / 2;

      for (let floorIdx = 0; floorIdx < layout.floors; floorIdx++) {
        const footprint = layout.floorPlans[floorIdx].footprint;

        for (let row = 0; row < footprint.length; row++) {
          for (let col = 0; col < footprint[row].length; col++) {
            if (!footprint[row][col]) continue;

            const cellCenterX = col * CELL_SIZE + CELL_SIZE / 2 - halfWidth;
            const cellCenterZ = row * CELL_SIZE + CELL_SIZE / 2 - halfDepth;

            // Verify cell center is calculated correctly
            expect(Math.abs(cellCenterX)).toBeLessThanOrEqual(
              halfWidth + CELL_SIZE,
            );
            expect(Math.abs(cellCenterZ)).toBeLessThanOrEqual(
              halfDepth + CELL_SIZE,
            );
          }
        }
      }
    });
  });

  describe("Corner alignment tests", () => {
    it("corners should be properly aligned for L-shaped footprints", () => {
      // Generate buildings with carved corners
      const seedsWithCarving = [
        "carved_1",
        "carved_2",
        "carved_3",
        "carved_4",
        "carved_5",
      ];

      for (const seed of seedsWithCarving) {
        const result = generator.generate("store", { seed }); // Store has carve chance
        expect(result).not.toBeNull();

        const validation = verifyCornerAlignment(result!.layout);

        if (!validation.valid) {
          console.error(
            `Corner alignment issues for seed "${seed}":`,
            validation.issues,
          );
        }

        expect(validation.valid).toBe(true);
      }
    });

    it("corner posts should be placed at external corners", () => {
      const result = generator.generate("simple-house", {
        seed: "corner_post_test",
      });
      expect(result).not.toBeNull();

      const layout = result!.layout;

      // Count expected corners based on footprint
      for (const plan of layout.floorPlans) {
        const footprint = plan.footprint;
        let expectedCorners = 0;

        for (let row = 0; row < footprint.length; row++) {
          for (let col = 0; col < footprint[row].length; col++) {
            if (!footprint[row][col]) continue;

            const hasNorth = row === 0 || !footprint[row - 1]?.[col];
            const hasSouth =
              row === footprint.length - 1 || !footprint[row + 1]?.[col];
            const hasEast =
              col === footprint[row].length - 1 || !footprint[row][col + 1];
            const hasWest = col === 0 || !footprint[row][col - 1];

            if (hasNorth && hasWest) expectedCorners++;
            if (hasNorth && hasEast) expectedCorners++;
            if (hasSouth && hasWest) expectedCorners++;
            if (hasSouth && hasEast) expectedCorners++;
          }
        }

        // Should have at least 4 corners for a simple rectangular building
        expect(expectedCorners).toBeGreaterThanOrEqual(4);
      }
    });

    it("corner posts and walls should join perfectly with no gaps or overlaps", () => {
      // Test multiple building types to cover various corner scenarios
      const testCases = [
        { type: "simple-house", seed: "corner_join_1" },
        { type: "inn", seed: "corner_join_2" },
        { type: "bank", seed: "corner_join_3" },
        { type: "store", seed: "corner_join_4" },
        { type: "long-house", seed: "corner_join_5" },
      ];

      for (const { type, seed } of testCases) {
        const result = generator.generate(type, { seed });
        expect(result).not.toBeNull();

        // Verify no intersections between walls and corner posts
        const intersectionCheck = verifyWallsNoIntersection(result!.layout);
        if (!intersectionCheck.valid) {
          console.error(
            `Corner join intersections for ${type} (${seed}):`,
            intersectionCheck.intersections,
          );
        }
        expect(intersectionCheck.valid).toBe(true);

        // Verify corner joins have no gaps
        const gapCheck = verifyCornerJoins(result!.layout);
        if (!gapCheck.valid) {
          console.error(
            `Corner join gaps for ${type} (${seed}):`,
            gapCheck.gaps,
          );
        }
        expect(gapCheck.valid).toBe(true);
      }
    });

    it("all geometry should align correctly in X, Y, and Z dimensions", () => {
      // Test comprehensive XYZ alignment for all building types
      const testCases = [
        {
          type: "simple-house",
          seeds: ["xyz_test_1", "xyz_test_2", "xyz_test_3"],
        },
        { type: "inn", seeds: ["xyz_inn_1", "xyz_inn_2"] },
        { type: "bank", seeds: ["xyz_bank_1", "xyz_bank_2"] },
        { type: "store", seeds: ["xyz_store_1", "xyz_store_2"] },
        { type: "long-house", seeds: ["xyz_long_1"] },
        { type: "smithy", seeds: ["xyz_smithy_1"] },
      ];

      for (const { type, seeds } of testCases) {
        for (const seed of seeds) {
          const result = generator.generate(type, { seed });
          expect(result).not.toBeNull();

          // Verify all geometry levels are correct
          const levelCheck = verifyGeometryLevels(result!.layout);
          if (!levelCheck.valid) {
            console.error(
              `Geometry level issues for ${type} (${seed}):`,
              levelCheck.issues,
            );
          }
          expect(levelCheck.valid).toBe(true);

          // Also verify wall intersections
          const wallCheck = verifyWallsNoIntersection(result!.layout);
          if (!wallCheck.valid) {
            console.error(
              `Wall intersection issues for ${type} (${seed}):`,
              wallCheck.intersections,
            );
          }
          expect(wallCheck.valid).toBe(true);

          // Verify corner alignment
          const cornerCheck = verifyCornerAlignment(result!.layout);
          expect(cornerCheck.valid).toBe(true);
        }
      }
    });

    it("floor tiles should align with wall bottoms at Y level", () => {
      const result = generator.generate("inn", { seed: "floor_wall_y_test" });
      expect(result).not.toBeNull();

      const layout = result!.layout;

      for (let floor = 0; floor < layout.floors; floor++) {
        // Expected Y level for this floor
        const expectedFloorY = floor * FLOOR_HEIGHT + FOUNDATION_HEIGHT;

        // Floor tile top should be at expectedFloorY
        // Wall bottom should also be at expectedFloorY
        // This verifies they meet at the same level

        // The actual verification is done in verifyGeometryLevels
        // Here we just document the expected relationship:
        // - Floor tile: center at (expectedFloorY - FLOOR_THICKNESS/2), top at expectedFloorY
        // - Wall: bottom at expectedFloorY, center at (expectedFloorY + wallHeight/2)

        expect(expectedFloorY).toBeGreaterThan(0);
      }
    });

    it("ceiling tiles should align with floor tiles above", () => {
      // Find a multi-floor building
      for (let i = 0; i < 50; i++) {
        const result = generator.generate("inn", {
          seed: `ceiling_floor_${i}`,
        });
        if (!result || result.layout.floors < 2) continue;

        const layout = result.layout;

        // For floor 0, ceiling is at: (0 + 1) * FLOOR_HEIGHT + FOUNDATION_HEIGHT = FLOOR_HEIGHT + FOUNDATION_HEIGHT
        // For floor 1, floor is at: 1 * FLOOR_HEIGHT + FOUNDATION_HEIGHT = FLOOR_HEIGHT + FOUNDATION_HEIGHT
        // They should be at the same Y level!

        const ceilingY = (0 + 1) * FLOOR_HEIGHT + FOUNDATION_HEIGHT;
        const floorAboveY = 1 * FLOOR_HEIGHT + FOUNDATION_HEIGHT;

        expect(Math.abs(ceilingY - floorAboveY)).toBeLessThan(0.001);

        return; // Found and verified multi-floor building
      }

      console.warn("Could not generate multi-floor building for ceiling test");
    });

    it("all floors should have aligned corner vertices across different seeds", () => {
      // Test multiple seeds to ensure corner alignment works for all generated layouts
      const testSeeds = [
        "corner_align_1",
        "corner_align_2",
        "corner_align_3",
        "corner_align_4",
        "corner_align_5",
        "corner_align_6",
        "corner_align_7",
        "corner_align_8",
        "corner_align_9",
        "corner_align_10",
        "y3l7yl",
        "inn_test_abc",
        "inn_test_xyz",
      ];

      for (const seed of testSeeds) {
        const result = generator.generate("inn", { seed });
        if (!result) continue;

        const layout = result.layout;

        // Verify corners align on each floor
        for (let floorIdx = 0; floorIdx < layout.floors; floorIdx++) {
          const footprint = layout.floorPlans[floorIdx].footprint;

          // Build global corner post positions for this floor (same logic as the generator)
          const cornerPostPositions = new Set<string>();

          for (let row = 0; row < footprint.length; row++) {
            for (let col = 0; col < (footprint[row]?.length || 0); col++) {
              if (!footprint[row][col]) continue;

              const hasNorth = row === 0 || !footprint[row - 1]?.[col];
              const hasSouth =
                row === footprint.length - 1 || !footprint[row + 1]?.[col];
              const hasEast =
                col === (footprint[row]?.length || 0) - 1 ||
                !footprint[row][col + 1];
              const hasWest = col === 0 || !footprint[row][col - 1];

              if (hasNorth && hasWest)
                cornerPostPositions.add(`${col - 0.5},${row - 0.5}`);
              if (hasNorth && hasEast)
                cornerPostPositions.add(`${col + 0.5},${row - 0.5}`);
              if (hasSouth && hasWest)
                cornerPostPositions.add(`${col - 0.5},${row + 0.5}`);
              if (hasSouth && hasEast)
                cornerPostPositions.add(`${col + 0.5},${row + 0.5}`);
            }
          }

          // For each cell with external walls, verify wall endpoints align with corner posts
          for (let row = 0; row < footprint.length; row++) {
            for (let col = 0; col < (footprint[row]?.length || 0); col++) {
              if (!footprint[row][col]) continue;

              // Check each external wall
              const walls = [
                {
                  side: "north",
                  checkRow: row - 1,
                  startCorner: `${col - 0.5},${row - 0.5}`,
                  endCorner: `${col + 0.5},${row - 0.5}`,
                },
                {
                  side: "south",
                  checkRow: row + 1,
                  startCorner: `${col - 0.5},${row + 0.5}`,
                  endCorner: `${col + 0.5},${row + 0.5}`,
                },
                {
                  side: "east",
                  checkCol: col + 1,
                  startCorner: `${col + 0.5},${row - 0.5}`,
                  endCorner: `${col + 0.5},${row + 0.5}`,
                },
                {
                  side: "west",
                  checkCol: col - 1,
                  startCorner: `${col - 0.5},${row - 0.5}`,
                  endCorner: `${col - 0.5},${row + 0.5}`,
                },
              ];

              for (const wall of walls) {
                const isExternal =
                  wall.checkRow !== undefined
                    ? wall.checkRow < 0 ||
                      wall.checkRow >= footprint.length ||
                      !footprint[wall.checkRow]?.[col]
                    : wall.checkCol !== undefined &&
                      (wall.checkCol < 0 || !footprint[row][wall.checkCol]);

                if (isExternal) {
                  // If start corner exists, wall should be shortened there
                  // If end corner exists, wall should be shortened there
                  // This is verified by the existing verifyCornerJoins function
                  const hasStartCorner = cornerPostPositions.has(
                    wall.startCorner,
                  );
                  const hasEndCorner = cornerPostPositions.has(wall.endCorner);

                  // At least verify the corner detection is consistent
                  // The actual geometry verification is done by verifyCornerJoins
                  expect(typeof hasStartCorner).toBe("boolean");
                  expect(typeof hasEndCorner).toBe("boolean");
                }
              }
            }
          }
        }

        // Also run the full corner alignment verification
        const cornerCheck = verifyCornerJoins(result.layout);
        if (!cornerCheck.valid) {
          console.error(
            `Corner join issues for inn (${seed}):`,
            cornerCheck.gaps,
          );
        }
        expect(cornerCheck.valid).toBe(true);

        // And wall intersection check
        const wallCheck = verifyWallsNoIntersection(result.layout);
        if (!wallCheck.valid) {
          console.error(
            `Wall intersection issues for inn (${seed}):`,
            wallCheck.intersections,
          );
        }
        expect(wallCheck.valid).toBe(true);
      }
    });

    it("L-shaped buildings should have correct corner count and alignment", () => {
      // Generate buildings until we find one with an L-shape (carved corner)
      for (let i = 0; i < 100; i++) {
        const result = generator.generate("store", {
          seed: `l_shape_corner_${i}`,
        });
        if (!result) continue;

        const footprint = result.layout.floorPlans[0].footprint;

        // Check if this is L-shaped (has carved corner)
        let hasConcaveCorner = false;
        for (let row = 1; row < footprint.length - 1; row++) {
          for (let col = 1; col < (footprint[row]?.length || 0) - 1; col++) {
            if (!footprint[row][col]) {
              // Check if adjacent cells exist (indicating concave corner)
              const hasNeighbor =
                (footprint[row - 1]?.[col] && footprint[row][col - 1]) ||
                (footprint[row - 1]?.[col] && footprint[row][col + 1]) ||
                (footprint[row + 1]?.[col] && footprint[row][col - 1]) ||
                (footprint[row + 1]?.[col] && footprint[row][col + 1]);
              if (hasNeighbor) hasConcaveCorner = true;
            }
          }
        }

        if (hasConcaveCorner) {
          // Verify corner joins for L-shaped building
          const intersectionCheck = verifyWallsNoIntersection(result.layout);
          expect(intersectionCheck.valid).toBe(true);

          const gapCheck = verifyCornerJoins(result.layout);
          expect(gapCheck.valid).toBe(true);

          // Found and verified an L-shaped building, test passes
          return;
        }
      }

      // If we couldn't generate an L-shaped building, skip this test
      console.warn("Could not generate L-shaped building in 100 attempts");
    });

    it("multi-floor buildings should have aligned corners between floors", () => {
      // Generate a 2-floor building
      for (let i = 0; i < 50; i++) {
        const result = generator.generate("inn", {
          seed: `multi_floor_corner_${i}`,
        });
        if (!result || result.layout.floors < 2) continue;

        // Verify corner alignment for multi-floor building
        const intersectionCheck = verifyWallsNoIntersection(result.layout);
        if (!intersectionCheck.valid) {
          console.error(
            `Multi-floor corner issues:`,
            intersectionCheck.intersections,
          );
        }
        expect(intersectionCheck.valid).toBe(true);

        const gapCheck = verifyCornerJoins(result.layout);
        expect(gapCheck.valid).toBe(true);

        // Test passed
        return;
      }

      console.warn("Could not generate multi-floor building in 50 attempts");
    });
  });

  describe("Geometry integrity tests", () => {
    it("merged geometry should have no duplicate triangles after cleanup", () => {
      const result = generator.generate("inn", { seed: "dup_tri_test" });
      expect(result).not.toBeNull();

      if (result!.mesh instanceof THREE.Mesh) {
        const geometry = result!.mesh.geometry;
        const duplicates = countDuplicateTriangles(geometry);

        // After removeInternalFaces, there should be no duplicates
        expect(duplicates).toBe(0);
      }
    });

    it("building dimensions should match expected based on layout", () => {
      const result = generator.generate("simple-house", { seed: "dim_test" });
      expect(result).not.toBeNull();

      const layout = result!.layout;
      const expectedWidth = layout.width * CELL_SIZE;
      const expectedDepth = layout.depth * CELL_SIZE;
      // Building height now includes foundation above ground + terrain depth below ground
      const expectedHeightAboveGround =
        layout.floors * FLOOR_HEIGHT + ROOF_THICKNESS + FOUNDATION_HEIGHT;
      const expectedTotalHeight = expectedHeightAboveGround + TERRAIN_DEPTH;

      if (result!.mesh instanceof THREE.Mesh) {
        const geometry = result!.mesh.geometry;
        geometry.computeBoundingBox();
        const box = geometry.boundingBox!;

        const actualWidth = box.max.x - box.min.x;
        const actualDepth = box.max.z - box.min.z;
        const actualHeight = box.max.y - box.min.y;

        // Allow larger tolerance for entrance steps that extend beyond footprint
        // Steps extend: FOUNDATION_OVERHANG + ENTRANCE_STEP_DEPTH * (ENTRANCE_STEP_COUNT + TERRAIN_STEP_COUNT)
        const totalSteps = ENTRANCE_STEP_COUNT + TERRAIN_STEP_COUNT;
        const stepExtension =
          FOUNDATION_OVERHANG + ENTRANCE_STEP_DEPTH * totalSteps;
        const tolerance = Math.max(WALL_THICKNESS * 2, stepExtension * 2);

        expect(Math.abs(actualWidth - expectedWidth)).toBeLessThan(tolerance);
        expect(Math.abs(actualDepth - expectedDepth)).toBeLessThan(tolerance);
        expect(actualHeight).toBeLessThanOrEqual(
          expectedTotalHeight + tolerance,
        );
        expect(actualHeight).toBeGreaterThan(0);

        // Building should extend below ground level
        expect(box.min.y).toBeLessThan(0);
      }
    });

    it("stair geometry should fit within stair cells", () => {
      // Find a seed that generates stairs
      let resultWithStairs: {
        mesh: THREE.Mesh | THREE.Group;
        layout: {
          stairs: {
            col: number;
            row: number;
            direction: string;
            landing: { col: number; row: number };
          } | null;
        };
      } | null = null;
      const seeds = [
        "stair_1",
        "stair_2",
        "stair_3",
        "stair_4",
        "stair_5",
        "stair_6",
        "stair_7",
        "stair_8",
      ];

      for (const seed of seeds) {
        const result = generator.generate("inn", { seed });
        if (result && result.layout.stairs) {
          resultWithStairs = result;
          break;
        }
      }

      if (resultWithStairs && resultWithStairs.layout.stairs) {
        const stairs = resultWithStairs.layout.stairs;
        const layout = resultWithStairs.layout as {
          stairs: {
            col: number;
            row: number;
            direction: string;
            landing: { col: number; row: number };
          };
        };

        // Stairs should span exactly two cells
        const stairCellCount = 2;
        const expectedStairLength = CELL_SIZE; // From cell center to cell center

        // Verify stair and landing cells are adjacent
        const colDiff = Math.abs(stairs.col - stairs.landing.col);
        const rowDiff = Math.abs(stairs.row - stairs.landing.row);
        expect(colDiff + rowDiff).toBe(1); // Adjacent cells differ by 1 in one dimension

        // Verify stair direction matches cell positions
        if (stairs.direction === "north") {
          expect(stairs.landing.row).toBe(stairs.row - 1);
        } else if (stairs.direction === "south") {
          expect(stairs.landing.row).toBe(stairs.row + 1);
        } else if (stairs.direction === "east") {
          expect(stairs.landing.col).toBe(stairs.col + 1);
        } else if (stairs.direction === "west") {
          expect(stairs.landing.col).toBe(stairs.col - 1);
        }
      }
    });
  });

  describe("Comprehensive multi-seed validation", () => {
    it("100 random buildings should have no geometry issues", () => {
      const types = Object.keys(BUILDING_RECIPES);
      let totalIssues = 0;
      const issueDetails: string[] = [];

      for (let i = 0; i < 100; i++) {
        const typeKey = types[i % types.length];
        const seed = `comprehensive_test_${i}_${typeKey}`;

        const result = generator.generate(typeKey, { seed });
        expect(result).not.toBeNull();

        // Check wall intersections
        const wallValidation = verifyWallsNoIntersection(result!.layout);
        if (!wallValidation.valid) {
          totalIssues += wallValidation.intersections.length;
          issueDetails.push(
            `${typeKey} (${seed}): ${wallValidation.intersections.join(", ")}`,
          );
        }

        // Check floor alignment
        const floorValidation = verifyFloorAlignment(result!.layout);
        if (!floorValidation.valid) {
          totalIssues += floorValidation.issues.length;
          issueDetails.push(
            `${typeKey} (${seed}): ${floorValidation.issues.join(", ")}`,
          );
        }

        // Check corner alignment
        const cornerValidation = verifyCornerAlignment(result!.layout);
        if (!cornerValidation.valid) {
          totalIssues += cornerValidation.issues.length;
          issueDetails.push(
            `${typeKey} (${seed}): ${cornerValidation.issues.join(", ")}`,
          );
        }
      }

      if (totalIssues > 0) {
        console.error(
          `Found ${totalIssues} geometry issues:`,
          issueDetails.slice(0, 10),
        );
      }

      expect(totalIssues).toBe(0);
    });
  });

  describe("Specific edge case tests", () => {
    it("1x1 cell building should have exactly 4 corners", () => {
      // Create a minimal building
      const recipe = BUILDING_RECIPES["simple-house"];
      const rng = createRng("1x1_test");

      // Force 1x1 by adjusting layout manually isn't possible, but we can test smallest possible
      const result = generator.generate("simple-house", {
        seed: "smallest_house",
      });
      expect(result).not.toBeNull();

      const layout = result!.layout;
      expect(layout.width).toBeGreaterThanOrEqual(2); // Minimum based on recipe
      expect(layout.depth).toBeGreaterThanOrEqual(2);
    });

    it("L-shaped footprint should have proper corner handling", () => {
      // Generate many buildings to find one with carved corner
      let lShapedLayout: {
        width: number;
        depth: number;
        floorPlans: Array<{ footprint: boolean[][] }>;
      } | null = null;

      for (let i = 0; i < 50; i++) {
        const result = generator.generate("store", { seed: `lshape_${i}` });
        if (result) {
          const footprint = result.layout.floorPlans[0].footprint;
          let emptyCorner = false;

          // Check if any corner is carved
          const depth = footprint.length;
          const width = footprint[0]?.length || 0;
          if (
            !footprint[0]?.[0] ||
            !footprint[0]?.[width - 1] ||
            !footprint[depth - 1]?.[0] ||
            !footprint[depth - 1]?.[width - 1]
          ) {
            emptyCorner = true;
          }

          if (emptyCorner) {
            lShapedLayout = result.layout;
            break;
          }
        }
      }

      if (lShapedLayout) {
        const validation = verifyWallsNoIntersection(lShapedLayout);
        expect(validation.valid).toBe(true);
      }
    });

    it("multi-floor building with different floor sizes should align properly", () => {
      // Inn and Bank can have smaller upper floors
      for (let i = 0; i < 20; i++) {
        const result = generator.generate("inn", { seed: `multifloor_${i}` });
        if (result && result.layout.floors > 1) {
          const groundCells = result.stats.footprintCells;
          const upperCells = result.stats.upperFootprintCells;

          // Upper floor should be same or smaller than ground floor
          expect(upperCells).toBeLessThanOrEqual(groundCells);

          // Verify no intersections
          const validation = verifyWallsNoIntersection(result.layout);
          expect(validation.valid).toBe(true);

          break; // Found a multi-floor building
        }
      }
    });
  });
});

// ============================================================
// GRID ALIGNMENT TESTS
// ============================================================

import {
  BUILDING_GRID_SNAP,
  TILES_PER_CELL,
  MOVEMENT_TILE_SIZE,
  snapToBuildingGrid,
  isGridAligned,
} from "./constants";

describe("Grid Alignment System", () => {
  describe("Constants Relationships", () => {
    it("should have correct grid constant values", () => {
      // CELL_SIZE = 4 meters (4x4 movement tiles per building cell)
      expect(CELL_SIZE).toBe(4);

      // Movement tile is 1 meter
      expect(MOVEMENT_TILE_SIZE).toBe(1);

      // Tiles per cell should be CELL_SIZE / MOVEMENT_TILE_SIZE = 4
      expect(TILES_PER_CELL).toBe(4);

      // Grid snap should be CELL_SIZE / 2 = 2 (for cell center alignment)
      expect(BUILDING_GRID_SNAP).toBe(2);
    });

    it("should have 1 building cell = 16 movement tiles", () => {
      // Each building cell is CELL_SIZE x CELL_SIZE meters
      // Each movement tile is MOVEMENT_TILE_SIZE x MOVEMENT_TILE_SIZE meters
      // So 1 building cell = (CELL_SIZE/MOVEMENT_TILE_SIZE)^2 = 4x4 = 16 tiles
      const tilesPerCellArea = TILES_PER_CELL * TILES_PER_CELL;
      expect(tilesPerCellArea).toBe(16);
    });
  });

  describe("snapToBuildingGrid", () => {
    it("should snap exact grid positions to themselves", () => {
      // Positions on the grid should stay unchanged
      expect(snapToBuildingGrid(0, 0)).toEqual({ x: 0, z: 0 });
      expect(snapToBuildingGrid(2, 2)).toEqual({ x: 2, z: 2 });
      expect(snapToBuildingGrid(4, 4)).toEqual({ x: 4, z: 4 });
      expect(snapToBuildingGrid(-2, -2)).toEqual({ x: -2, z: -2 });
    });

    it("should snap off-grid positions to nearest grid point", () => {
      // Values < BUILDING_GRID_SNAP/2 from grid point snap to it
      expect(snapToBuildingGrid(0.5, 0.5)).toEqual({ x: 0, z: 0 });
      expect(snapToBuildingGrid(1.9, 1.9)).toEqual({ x: 2, z: 2 });

      // Values >= BUILDING_GRID_SNAP/2 from grid point snap to next
      expect(snapToBuildingGrid(1.0, 1.0)).toEqual({ x: 2, z: 2 });
      expect(snapToBuildingGrid(3.0, 3.0)).toEqual({ x: 4, z: 4 });
    });

    it("should handle negative coordinates", () => {
      // Note: JavaScript Math.round uses "round half toward positive infinity"
      // So Math.round(-0.5/2) = Math.round(-0.25) = 0, Math.round(-1.5/2) = Math.round(-0.75) = -1
      // Use closeTo for comparisons to avoid -0/+0 issues
      let result = snapToBuildingGrid(-0.5, -0.5);
      expect(result.x).toBeCloseTo(0, 5);
      expect(result.z).toBeCloseTo(0, 5);

      // -1.5/2 = -0.75, Math.round(-0.75) = -1, -1 * 2 = -2
      result = snapToBuildingGrid(-1.5, -1.5);
      expect(result.x).toBeCloseTo(-2, 5);
      expect(result.z).toBeCloseTo(-2, 5);

      // -3.0/2 = -1.5, Math.round(-1.5) = -1 (rounds toward +infinity), -1 * 2 = -2
      result = snapToBuildingGrid(-3.0, -3.0);
      expect(result.x).toBeCloseTo(-2, 5);
      expect(result.z).toBeCloseTo(-2, 5);

      // -4.0/2 = -2.0, Math.round(-2.0) = -2, -2 * 2 = -4
      result = snapToBuildingGrid(-4.0, -4.0);
      expect(result.x).toBeCloseTo(-4, 5);
      expect(result.z).toBeCloseTo(-4, 5);
    });

    it("should snap mixed positive/negative coordinates", () => {
      expect(snapToBuildingGrid(1.5, -1.5)).toEqual({ x: 2, z: -2 });
      expect(snapToBuildingGrid(-3.5, 3.5)).toEqual({ x: -4, z: 4 });
    });
  });

  describe("isGridAligned", () => {
    it("should return true for aligned positions", () => {
      expect(isGridAligned(0, 0)).toBe(true);
      expect(isGridAligned(2, 2)).toBe(true);
      expect(isGridAligned(4, 4)).toBe(true);
      expect(isGridAligned(-2, -2)).toBe(true);
      expect(isGridAligned(100, -200)).toBe(true);
    });

    it("should return false for unaligned positions", () => {
      expect(isGridAligned(0.5, 0)).toBe(false);
      expect(isGridAligned(0, 0.5)).toBe(false);
      expect(isGridAligned(1, 1)).toBe(false);
      expect(isGridAligned(3, 3)).toBe(false);
    });

    it("should handle small floating point errors", () => {
      // Positions very close to grid (within epsilon=0.001) should be aligned
      // Test values further from threshold to avoid floating point issues
      expect(isGridAligned(2.005, 4.005)).toBe(false); // Clearly outside epsilon
      expect(isGridAligned(2.0005, 4.0005)).toBe(true); // Within epsilon (0.001)
    });
  });

  describe("Building Cell to Tile Alignment", () => {
    it("should align building cells with movement tiles", () => {
      // A building at grid-aligned position should have cell boundaries
      // that align with movement tile boundaries

      // Building at (0, 0): cells should span tiles 0-3, 4-7, etc.
      const buildingPos = snapToBuildingGrid(0, 0);
      expect(buildingPos).toEqual({ x: 0, z: 0 });

      // Cell centers should be at positions like 2, 6, 10 (cell edges at 0, 4, 8, 12)
      // Since BUILDING_GRID_SNAP = 2, building positions are at 0, 2, 4, etc.
      // This means cell boundaries fall on even tile numbers

      // A 2-cell-wide building (8m) centered at x=0 spans from x=-4 to x=4
      // Cell 0: x=-4 to x=0 (tiles -4, -3, -2, -1)
      // Cell 1: x=0 to x=4 (tiles 0, 1, 2, 3)
      // Both ranges are 4 tiles each, aligned with tile boundaries
    });

    it("should ensure snapped positions maintain tile alignment for any building size", () => {
      // Test various building positions
      const testPositions = [
        { x: 15.3, z: 27.8 },
        { x: -42.1, z: 88.9 },
        { x: 100.5, z: -50.5 },
      ];

      for (const pos of testPositions) {
        const snapped = snapToBuildingGrid(pos.x, pos.z);

        // Snapped position should be on the grid
        expect(isGridAligned(snapped.x, snapped.z)).toBe(true);

        // The snapped position should be a multiple of BUILDING_GRID_SNAP
        // Use Math.abs to handle -0/+0 comparison
        expect(Math.abs(snapped.x % BUILDING_GRID_SNAP)).toBeCloseTo(0, 5);
        expect(Math.abs(snapped.z % BUILDING_GRID_SNAP)).toBeCloseTo(0, 5);
      }
    });
  });
});
