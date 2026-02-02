/**
 * DockGenerator
 *
 * Main class for procedural dock generation.
 * Creates docks with planks, support posts, optional railings and mooring posts.
 *
 * Supports three dock styles:
 * - Pier: Simple straight dock extending into water
 * - T-shaped: Pier with perpendicular end section for boat mooring
 * - L-shaped: Pier with 90-degree turn
 */

import * as THREE from "three";
import * as BufferGeometryUtils from "three/examples/jsm/utils/BufferGeometryUtils.js";

import type {
  DockRecipe,
  PartialDockRecipe,
  DockLayout,
  PlankData,
  PostData,
  RailingData,
  MooringData,
  GeneratedDock,
  DockGenerationOptions,
  DockGeometryArrays,
} from "./types";
import { DockStyle } from "./types";
import type {
  ShorelinePoint,
  ItemCollisionData,
  WoodTypeValue,
} from "../types";
import { DEFAULT_DOCK_PARAMS, getDockPreset, mergeDockParams } from "./presets";
import {
  createPlankGeometries,
  createPostGeometries,
  createRailingGeometries,
  createMooringGeometries,
  computeFlatNormals,
} from "./DockGeometry";
// @ts-ignore - TSL module uses dynamic typing
import { createDockMaterial } from "./DockMaterialTSL";
import { createRng, type RNG } from "../../math/Random.js";

// ============================================================================
// CONSTANTS
// ============================================================================

/** Default water level (Y coordinate) */
const DEFAULT_WATER_LEVEL = 5.0;

/** Default water floor depth below water level */
const DEFAULT_WATER_FLOOR_DEPTH = 3.0;

/** Plank thickness */
const PLANK_THICKNESS = 0.04;

/** Tile size for collision (matches game tile grid) */
const TILE_SIZE = 1.0;

// ============================================================================
// DOCK GENERATOR CLASS
// ============================================================================

/**
 * Procedural dock generator
 *
 * Creates realistic docks using:
 * 1. Plank grid layout based on dock dimensions
 * 2. Support post placement at regular intervals
 * 3. Optional railing sections along edges
 * 4. Optional mooring posts at corners/ends
 */
export class DockGenerator {
  /**
   * Generate a dock from a preset name
   */
  generateFromPreset(
    presetName: string,
    shorelinePoint: ShorelinePoint,
    options: DockGenerationOptions = {},
  ): GeneratedDock | null {
    const preset = getDockPreset(presetName);
    if (!preset) {
      console.warn(`Unknown dock preset: ${presetName}`);
      return null;
    }

    const params = mergeDockParams(DEFAULT_DOCK_PARAMS, preset);
    if (options.params) {
      Object.assign(params, options.params);
    }

    return this.generate(params, shorelinePoint, options);
  }

  /**
   * Generate a dock with custom parameters
   */
  generateCustom(
    customParams: PartialDockRecipe,
    shorelinePoint: ShorelinePoint,
    options: DockGenerationOptions = {},
  ): GeneratedDock {
    const params = mergeDockParams(DEFAULT_DOCK_PARAMS, customParams);
    return this.generate(params, shorelinePoint, options);
  }

  /**
   * Generate a dock with full parameters
   */
  generate(
    recipe: DockRecipe,
    shorelinePoint: ShorelinePoint,
    options: DockGenerationOptions = {},
  ): GeneratedDock {
    const startTime = performance.now();

    // Resolve seed and create RNG
    const seed = options.seed ?? `dock-${Date.now()}`;
    const rng = createRng(seed);

    // Resolve water parameters
    const waterLevel = options.waterLevel ?? DEFAULT_WATER_LEVEL;
    const waterFloorDepth =
      options.waterFloorDepth ?? DEFAULT_WATER_FLOOR_DEPTH;
    const waterFloorY = waterLevel - waterFloorDepth;

    // Generate layout
    const layout = this.generateLayout(
      recipe,
      shorelinePoint,
      rng,
      waterLevel,
      waterFloorY,
    );

    // Build geometry
    const geometryArrays = this.buildDock(layout, recipe);

    // Create mesh with WebGPU TSL material
    const mesh = this.createMesh(
      geometryArrays,
      layout,
      recipe.woodType,
      waterLevel,
    );

    // Generate collision data
    const collision = this.generateCollisionData(layout, shorelinePoint);

    // Calculate stats
    const stats = this.calculateStats(geometryArrays, startTime);

    return {
      mesh,
      position: layout.position,
      layout,
      recipe,
      collision,
      stats,
      geometryArrays,
    };
  }

  // ============================================================================
  // LAYOUT GENERATION
  // ============================================================================

  /**
   * Generate the dock layout from recipe and placement
   */
  private generateLayout(
    recipe: DockRecipe,
    shorelinePoint: ShorelinePoint,
    rng: RNG,
    waterLevel: number,
    waterFloorY: number,
  ): DockLayout {
    // Determine dock dimensions
    const length =
      rng.next() * (recipe.lengthRange[1] - recipe.lengthRange[0]) +
      recipe.lengthRange[0];
    const width =
      rng.next() * (recipe.widthRange[1] - recipe.widthRange[0]) +
      recipe.widthRange[0];

    // Deck height above water
    const deckY = waterLevel + recipe.deckHeight;

    // Dock extends in the waterward direction from the shoreline
    const direction = shorelinePoint.waterwardNormal;

    // Calculate rotation from direction
    const rotation = Math.atan2(direction.x, direction.z);

    // Base position at shoreline
    const position = {
      x: shorelinePoint.position.x,
      y: deckY,
      z: shorelinePoint.position.z,
    };

    // Generate planks for main section
    const planks = this.generatePlanks(recipe, length, width, direction, rng);

    // Generate support posts
    const posts = this.generatePosts(
      recipe,
      length,
      width,
      direction,
      deckY,
      waterFloorY,
    );

    // Generate railings if enabled
    // Skip end railing if T or L section will be attached
    const railings: RailingData[] = [];
    if (recipe.hasRailing) {
      const hasTSection =
        recipe.style === DockStyle.TShaped &&
        recipe.tSectionWidthRange !== undefined;
      const hasLSection =
        recipe.style === DockStyle.LShaped &&
        recipe.lSectionLengthRange !== undefined;
      railings.push(
        ...this.generateRailings(
          recipe,
          length,
          width,
          direction,
          0, // deckY relative to local origin
          { skipEndRailing: hasTSection || hasLSection },
        ),
      );
    }

    // Generate mooring posts if enabled
    const moorings: MooringData[] = [];
    if (recipe.hasMooring) {
      moorings.push(
        ...this.generateMoorings(
          recipe,
          length,
          width,
          direction,
          0, // deckY relative to local origin
        ),
      );
    }

    const layout: DockLayout = {
      position,
      direction,
      rotation,
      length,
      width,
      deckHeight: recipe.deckHeight,
      planks,
      posts,
      railings,
      moorings,
    };

    // Add T-section if T-shaped dock
    if (recipe.style === DockStyle.TShaped && recipe.tSectionWidthRange) {
      layout.tSection = this.generateTSection(
        recipe,
        length,
        width,
        direction,
        rng,
        0,
        waterFloorY - deckY, // Relative water floor
      );
    }

    // Add L-section if L-shaped dock
    if (recipe.style === DockStyle.LShaped && recipe.lSectionLengthRange) {
      layout.lSection = this.generateLSection(
        recipe,
        length,
        width,
        direction,
        rng,
        0,
        waterFloorY - deckY,
      );
    }

    return layout;
  }

  /**
   * Generate plank data for the deck surface
   */
  private generatePlanks(
    recipe: DockRecipe,
    length: number,
    width: number,
    direction: { x: number; z: number },
    rng: RNG,
  ): PlankData[] {
    const planks: PlankData[] = [];

    // Calculate number of planks
    const plankSpacing = recipe.plankWidth + recipe.plankGap;
    const numPlanks = Math.ceil(length / plankSpacing);

    // Perpendicular direction for plank orientation
    const perpX = -direction.z;
    const perpZ = direction.x;

    for (let i = 0; i < numPlanks; i++) {
      // Position along the dock length
      const t = (i + 0.5) / numPlanks;
      const distAlongDock = t * length;

      // Plank center position (relative to dock origin)
      const posX = direction.x * distAlongDock;
      const posZ = direction.z * distAlongDock;

      // Random weathering variation
      const weathering = rng.next() * 0.4;

      // Slight random rotation for natural look
      const rotationVariation = (rng.next() - 0.5) * 0.02;
      const plankRotation = Math.atan2(perpX, perpZ) + rotationVariation;

      planks.push({
        position: { x: posX, y: 0, z: posZ },
        rotation: plankRotation,
        width: recipe.plankWidth,
        length: width,
        thickness: PLANK_THICKNESS,
        weathering,
      });
    }

    return planks;
  }

  /**
   * Generate support post data
   */
  private generatePosts(
    recipe: DockRecipe,
    length: number,
    width: number,
    direction: { x: number; z: number },
    deckY: number,
    waterFloorY: number,
  ): PostData[] {
    const posts: PostData[] = [];

    // Perpendicular direction
    const perpX = -direction.z;
    const perpZ = direction.x;

    // Number of post pairs along length (minimum 2 for start and end)
    const numPostPairs = Math.max(
      2,
      Math.ceil(length / recipe.postSpacing) + 1,
    );

    // Post height from water floor to deck underside
    const postHeight = deckY - waterFloorY;

    for (let i = 0; i < numPostPairs; i++) {
      // Safe division: numPostPairs is always >= 2
      const t = i / (numPostPairs - 1);
      const distAlongDock = t * length;

      // Position along dock
      const baseX = direction.x * distAlongDock;
      const baseZ = direction.z * distAlongDock;

      // Half width offset for posts on each side
      const halfWidth = width / 2 - recipe.postRadius * 2;

      // Left post
      posts.push({
        position: {
          x: baseX + perpX * halfWidth,
          y: waterFloorY - deckY, // Relative to deck
          z: baseZ + perpZ * halfWidth,
        },
        radius: recipe.postRadius,
        height: postHeight,
        submergedHeight: deckY - recipe.deckHeight - waterFloorY,
      });

      // Right post
      posts.push({
        position: {
          x: baseX - perpX * halfWidth,
          y: waterFloorY - deckY,
          z: baseZ - perpZ * halfWidth,
        },
        radius: recipe.postRadius,
        height: postHeight,
        submergedHeight: deckY - recipe.deckHeight - waterFloorY,
      });
    }

    return posts;
  }

  /**
   * Generate railing data for dock edges
   * @param skipEndRailing - If true, don't generate end railing (for junction with T/L sections)
   * @param skipStartRailing - If true, start side railings further along (for L-section junction)
   */
  private generateRailings(
    recipe: DockRecipe,
    length: number,
    width: number,
    direction: { x: number; z: number },
    deckY: number,
    options: { skipEndRailing?: boolean; skipStartSection?: number } = {},
  ): RailingData[] {
    const railings: RailingData[] = [];
    const { skipEndRailing = false, skipStartSection = 0 } = options;

    // Perpendicular direction
    const perpX = -direction.z;
    const perpZ = direction.x;

    const halfWidth = width / 2;

    // Left side railing (optionally starting further along)
    const leftStart = {
      x: perpX * halfWidth + direction.x * skipStartSection,
      y: deckY,
      z: perpZ * halfWidth + direction.z * skipStartSection,
    };
    const leftEnd = {
      x: direction.x * length + perpX * halfWidth,
      y: deckY,
      z: direction.z * length + perpZ * halfWidth,
    };

    railings.push(
      this.createRailing(
        leftStart,
        leftEnd,
        recipe.railingHeight,
        recipe.railingPostSpacing,
      ),
    );

    // Right side railing (optionally starting further along)
    const rightStart = {
      x: -perpX * halfWidth + direction.x * skipStartSection,
      y: deckY,
      z: -perpZ * halfWidth + direction.z * skipStartSection,
    };
    const rightEnd = {
      x: direction.x * length - perpX * halfWidth,
      y: deckY,
      z: direction.z * length - perpZ * halfWidth,
    };

    railings.push(
      this.createRailing(
        rightStart,
        rightEnd,
        recipe.railingHeight,
        recipe.railingPostSpacing,
      ),
    );

    // End railing (at water end) - skip if junction with T/L section
    if (!skipEndRailing) {
      const endLeft = leftEnd;
      const endRight = rightEnd;
      railings.push(
        this.createRailing(
          endLeft,
          endRight,
          recipe.railingHeight,
          recipe.railingPostSpacing,
        ),
      );
    }

    return railings;
  }

  /**
   * Create a single railing section
   */
  private createRailing(
    start: { x: number; y: number; z: number },
    end: { x: number; y: number; z: number },
    height: number,
    postSpacing: number,
  ): RailingData {
    // Calculate post positions
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const dz = end.z - start.z;
    const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const numPosts = Math.max(2, Math.ceil(length / postSpacing) + 1);

    const posts: Array<{ x: number; y: number; z: number }> = [];
    for (let i = 0; i < numPosts; i++) {
      const t = i / (numPosts - 1);
      posts.push({
        x: start.x + dx * t,
        y: start.y + dy * t,
        z: start.z + dz * t,
      });
    }

    return {
      start,
      end,
      posts,
      height,
    };
  }

  /**
   * Generate mooring post data
   */
  private generateMoorings(
    recipe: DockRecipe,
    length: number,
    width: number,
    direction: { x: number; z: number },
    deckY: number,
  ): MooringData[] {
    const moorings: MooringData[] = [];

    // Perpendicular direction
    const perpX = -direction.z;
    const perpZ = direction.x;

    const halfWidth = width / 2 - 0.2; // Slightly inset from edge
    const mooringRadius = recipe.postRadius * 1.2;
    const mooringHeight = 0.4;

    // Mooring at end corners
    moorings.push({
      position: {
        x: direction.x * length + perpX * halfWidth,
        y: deckY,
        z: direction.z * length + perpZ * halfWidth,
      },
      radius: mooringRadius,
      height: mooringHeight,
    });

    moorings.push({
      position: {
        x: direction.x * length - perpX * halfWidth,
        y: deckY,
        z: direction.z * length - perpZ * halfWidth,
      },
      radius: mooringRadius,
      height: mooringHeight,
    });

    return moorings;
  }

  /**
   * Generate T-section for T-shaped docks
   */
  private generateTSection(
    recipe: DockRecipe,
    mainLength: number,
    mainWidth: number,
    direction: { x: number; z: number },
    rng: RNG,
    deckY: number,
    waterFloorRelative: number,
  ): DockLayout["tSection"] {
    const tWidthRange = recipe.tSectionWidthRange!;
    const tWidth =
      rng.next() * (tWidthRange[1] - tWidthRange[0]) + tWidthRange[0];

    // T-section is perpendicular to main dock, at the end
    const perpX = -direction.z;
    const perpZ = direction.x;

    // Center of T-section (at end of main dock)
    const centerX = direction.x * mainLength;
    const centerZ = direction.z * mainLength;

    // Generate planks for T-section
    // T-section planks run parallel to main dock (their length extends in perpendicular direction)
    // They are positioned along the perpendicular axis to span tWidth
    const planks: PlankData[] = [];
    const plankSpacing = recipe.plankWidth + recipe.plankGap;
    const halfTWidth = tWidth / 2;
    const numPlanks = Math.ceil(tWidth / plankSpacing);

    for (let i = 0; i < numPlanks; i++) {
      const t = (i + 0.5) / numPlanks;
      // Position along T-section's span (perpendicular to main dock)
      const distAlongT = (t - 0.5) * tWidth;

      planks.push({
        position: {
          // Offset in perpendicular direction to span tWidth
          x: centerX + perpX * distAlongT,
          y: deckY,
          z: centerZ + perpZ * distAlongT,
        },
        // Plank's length runs parallel to main direction (perpendicular to T's extension)
        rotation: Math.atan2(direction.x, direction.z),
        width: recipe.plankWidth,
        length: mainWidth, // Spans the main dock's width
        thickness: PLANK_THICKNESS,
        weathering: rng.next() * 0.4,
      });
    }

    // Generate posts for T-section corners
    const posts: PostData[] = [];
    const postHeight = -waterFloorRelative;
    const postOffset = halfTWidth - recipe.postRadius * 2;
    const halfMainWidth = mainWidth / 2 - recipe.postRadius * 2;

    // Four corner posts for T-section
    // Front-left (positive perpendicular, positive direction)
    posts.push({
      position: {
        x: centerX + perpX * postOffset + direction.x * halfMainWidth,
        y: waterFloorRelative,
        z: centerZ + perpZ * postOffset + direction.z * halfMainWidth,
      },
      radius: recipe.postRadius,
      height: postHeight,
      submergedHeight: postHeight - recipe.deckHeight,
    });
    // Front-right (positive perpendicular, negative direction)
    posts.push({
      position: {
        x: centerX + perpX * postOffset - direction.x * halfMainWidth,
        y: waterFloorRelative,
        z: centerZ + perpZ * postOffset - direction.z * halfMainWidth,
      },
      radius: recipe.postRadius,
      height: postHeight,
      submergedHeight: postHeight - recipe.deckHeight,
    });
    // Back-left (negative perpendicular, positive direction)
    posts.push({
      position: {
        x: centerX - perpX * postOffset + direction.x * halfMainWidth,
        y: waterFloorRelative,
        z: centerZ - perpZ * postOffset + direction.z * halfMainWidth,
      },
      radius: recipe.postRadius,
      height: postHeight,
      submergedHeight: postHeight - recipe.deckHeight,
    });
    // Back-right (negative perpendicular, negative direction)
    posts.push({
      position: {
        x: centerX - perpX * postOffset - direction.x * halfMainWidth,
        y: waterFloorRelative,
        z: centerZ - perpZ * postOffset - direction.z * halfMainWidth,
      },
      radius: recipe.postRadius,
      height: postHeight,
      submergedHeight: postHeight - recipe.deckHeight,
    });

    // Railings for T-section (three edges: two perpendicular ends + outer main direction edge)
    const railings: RailingData[] = [];
    if (recipe.hasRailing) {
      const halfMainWidthRail = mainWidth / 2;

      // Positive perpendicular end railing (front of T)
      railings.push(
        this.createRailing(
          {
            x: centerX + perpX * halfTWidth + direction.x * halfMainWidthRail,
            y: deckY,
            z: centerZ + perpZ * halfTWidth + direction.z * halfMainWidthRail,
          },
          {
            x: centerX + perpX * halfTWidth - direction.x * halfMainWidthRail,
            y: deckY,
            z: centerZ + perpZ * halfTWidth - direction.z * halfMainWidthRail,
          },
          recipe.railingHeight,
          recipe.railingPostSpacing,
        ),
      );

      // Negative perpendicular end railing (back of T)
      railings.push(
        this.createRailing(
          {
            x: centerX - perpX * halfTWidth + direction.x * halfMainWidthRail,
            y: deckY,
            z: centerZ - perpZ * halfTWidth + direction.z * halfMainWidthRail,
          },
          {
            x: centerX - perpX * halfTWidth - direction.x * halfMainWidthRail,
            y: deckY,
            z: centerZ - perpZ * halfTWidth - direction.z * halfMainWidthRail,
          },
          recipe.railingHeight,
          recipe.railingPostSpacing,
        ),
      );

      // Front railing along the outer water edge (at +direction)
      // This is the edge furthest from shore, running across the T
      railings.push(
        this.createRailing(
          {
            x: centerX + perpX * halfTWidth + direction.x * halfMainWidthRail,
            y: deckY,
            z: centerZ + perpZ * halfTWidth + direction.z * halfMainWidthRail,
          },
          {
            x: centerX - perpX * halfTWidth + direction.x * halfMainWidthRail,
            y: deckY,
            z: centerZ - perpZ * halfTWidth + direction.z * halfMainWidthRail,
          },
          recipe.railingHeight,
          recipe.railingPostSpacing,
        ),
      );

      // NOTE: Back edge (at -direction) intentionally has NO railing
      // This is the junction with the main dock where players walk through
    }

    return {
      width: tWidth,
      planks,
      posts,
      railings,
    };
  }

  /**
   * Generate L-section for L-shaped docks
   */
  private generateLSection(
    recipe: DockRecipe,
    mainLength: number,
    mainWidth: number,
    direction: { x: number; z: number },
    rng: RNG,
    deckY: number,
    waterFloorRelative: number,
  ): DockLayout["lSection"] {
    const lLengthRange = recipe.lSectionLengthRange!;
    const lLength =
      rng.next() * (lLengthRange[1] - lLengthRange[0]) + lLengthRange[0];

    // L-section turns 90 degrees (always to the right for consistency)
    const lDirection = {
      x: -direction.z,
      z: direction.x,
    };

    // Start of L-section (end of main dock)
    const startX = direction.x * mainLength;
    const startZ = direction.z * mainLength;

    // Generate planks
    const planks = this.generatePlanks(
      recipe,
      lLength,
      mainWidth,
      lDirection,
      rng,
    );

    // Offset planks to L-section position
    for (const plank of planks) {
      plank.position.x += startX;
      plank.position.z += startZ;
    }

    // Generate posts
    const posts = this.generatePosts(
      recipe,
      lLength,
      mainWidth,
      lDirection,
      deckY,
      deckY + waterFloorRelative,
    );

    // Offset posts
    for (const post of posts) {
      post.position.x += startX;
      post.position.z += startZ;
    }

    // Generate railings
    // Skip start section equal to half main dock width to avoid blocking junction
    const railings: RailingData[] = [];
    if (recipe.hasRailing) {
      const junctionClearance = mainWidth / 2;
      const lRailings = this.generateRailings(
        recipe,
        lLength,
        mainWidth,
        lDirection,
        deckY,
        { skipStartSection: junctionClearance },
      );

      // Offset railings
      for (const railing of lRailings) {
        railing.start.x += startX;
        railing.start.z += startZ;
        railing.end.x += startX;
        railing.end.z += startZ;
        for (const post of railing.posts) {
          post.x += startX;
          post.z += startZ;
        }
      }

      railings.push(...lRailings);
    }

    return {
      length: lLength,
      direction: lDirection,
      planks,
      posts,
      railings,
    };
  }

  // ============================================================================
  // GEOMETRY BUILDING
  // ============================================================================

  /**
   * Build all dock geometry from layout
   */
  private buildDock(
    layout: DockLayout,
    _recipe: DockRecipe,
  ): DockGeometryArrays {
    const arrays: DockGeometryArrays = {
      planks: [],
      posts: [],
      railingPosts: [],
      railingRails: [],
      moorings: [],
    };

    // Build main section
    arrays.planks.push(...createPlankGeometries(layout.planks));
    arrays.posts.push(...createPostGeometries(layout.posts));

    // Build railings
    for (const railing of layout.railings) {
      const { posts, rails } = createRailingGeometries(railing);
      arrays.railingPosts.push(...posts);
      arrays.railingRails.push(...rails);
    }

    // Build moorings
    arrays.moorings.push(...createMooringGeometries(layout.moorings));

    // Build T-section if present
    if (layout.tSection) {
      arrays.planks.push(...createPlankGeometries(layout.tSection.planks));
      arrays.posts.push(...createPostGeometries(layout.tSection.posts));
      for (const railing of layout.tSection.railings) {
        const { posts, rails } = createRailingGeometries(railing);
        arrays.railingPosts.push(...posts);
        arrays.railingRails.push(...rails);
      }
    }

    // Build L-section if present
    if (layout.lSection) {
      arrays.planks.push(...createPlankGeometries(layout.lSection.planks));
      arrays.posts.push(...createPostGeometries(layout.lSection.posts));
      for (const railing of layout.lSection.railings) {
        const { posts, rails } = createRailingGeometries(railing);
        arrays.railingPosts.push(...posts);
        arrays.railingRails.push(...rails);
      }
    }

    return arrays;
  }

  /**
   * Create the final mesh from geometry arrays using WebGPU TSL material
   */
  private createMesh(
    arrays: DockGeometryArrays,
    layout: DockLayout,
    woodType: WoodTypeValue,
    waterLevel: number,
  ): THREE.Group {
    const group = new THREE.Group();
    group.name = "Dock";

    // Create WebGPU TSL material for wood
    const { material, uniforms } = createDockMaterial(woodType);
    uniforms.waterLevel.value = waterLevel;

    // Helper to merge and add geometry
    const addMergedMesh = (
      geometries: THREE.BufferGeometry[],
      name: string,
    ): void => {
      if (geometries.length === 0) return;

      // Convert to non-indexed for merging
      const nonIndexed = geometries.map((g) => {
        const ni = g.index ? g.toNonIndexed() : g;
        computeFlatNormals(ni);
        return ni;
      });

      // Merge all geometries
      const merged = BufferGeometryUtils.mergeGeometries(nonIndexed, false);
      if (!merged) {
        console.warn(
          `[DockGenerator] Failed to merge ${name} geometries (${geometries.length} items)`,
        );
        return;
      }

      merged.computeBoundingSphere();

      // Create mesh with WebGPU TSL material
      const mesh = new THREE.Mesh(merged, material);
      mesh.name = name;
      mesh.castShadow = true;
      mesh.receiveShadow = true;

      group.add(mesh);

      // Dispose temporary geometries
      geometries.forEach((g) => g.dispose());
    };

    // Add all geometry groups
    addMergedMesh(arrays.planks, "DockPlanks");
    addMergedMesh(arrays.posts, "DockPosts");
    addMergedMesh(arrays.railingPosts, "DockRailingPosts");
    addMergedMesh(arrays.railingRails, "DockRailingRails");
    addMergedMesh(arrays.moorings, "DockMoorings");

    // Position the group
    group.position.set(layout.position.x, layout.position.y, layout.position.z);

    return group;
  }

  // ============================================================================
  // COLLISION GENERATION
  // ============================================================================

  /**
   * Generate collision data for the dock
   */
  private generateCollisionData(
    layout: DockLayout,
    _shorelinePoint: ShorelinePoint,
  ): ItemCollisionData {
    const walkableTiles: Array<{ x: number; z: number }> = [];
    const blockedEdges: ItemCollisionData["blockedEdges"] = [];
    const tileSet = new Set<string>(); // Track unique tiles

    const addTile = (x: number, z: number) => {
      const key = `${x},${z}`;
      if (!tileSet.has(key)) {
        tileSet.add(key);
        walkableTiles.push({ x, z });
      }
    };

    // Calculate tile coverage for main section
    const direction = layout.direction;
    const perpX = -direction.z;
    const perpZ = direction.x;

    // Sample tiles along the dock
    const tileLength = Math.ceil(layout.length / TILE_SIZE);
    const tileWidth = Math.ceil(layout.width / TILE_SIZE);
    const halfWidth = Math.floor(tileWidth / 2);

    for (let l = 0; l < tileLength; l++) {
      for (let w = -halfWidth; w <= halfWidth; w++) {
        const worldX =
          layout.position.x +
          direction.x * (l + 0.5) * TILE_SIZE +
          perpX * w * TILE_SIZE;
        const worldZ =
          layout.position.z +
          direction.z * (l + 0.5) * TILE_SIZE +
          perpZ * w * TILE_SIZE;

        const tileX = Math.floor(worldX / TILE_SIZE);
        const tileZ = Math.floor(worldZ / TILE_SIZE);

        addTile(tileX, tileZ);

        // Add blocked edges for perimeter tiles
        const isLeftEdge = w === -halfWidth;
        const isRightEdge = w === halfWidth;
        const isEndEdge = l === tileLength - 1;

        if (isLeftEdge) {
          const edgeDir = this.getEdgeDirection(perpX, perpZ, -1);
          blockedEdges.push({ tileX, tileZ, direction: edgeDir });
        }
        if (isRightEdge) {
          const edgeDir = this.getEdgeDirection(perpX, perpZ, 1);
          blockedEdges.push({ tileX, tileZ, direction: edgeDir });
        }
        if (isEndEdge && !layout.tSection && !layout.lSection) {
          const edgeDir = this.getEdgeDirection(direction.x, direction.z, 1);
          blockedEdges.push({ tileX, tileZ, direction: edgeDir });
        }
      }
    }

    // T-section collision tiles
    if (layout.tSection) {
      const tWidth = layout.tSection.width;
      const tTileWidth = Math.ceil(tWidth / TILE_SIZE);
      const tHalfWidth = Math.floor(tTileWidth / 2);
      const mainTileWidth = Math.ceil(layout.width / TILE_SIZE);
      const mainHalfWidth = Math.floor(mainTileWidth / 2);

      // T-section extends perpendicular from main dock end
      const endX = layout.position.x + direction.x * layout.length;
      const endZ = layout.position.z + direction.z * layout.length;

      for (let t = -tHalfWidth; t <= tHalfWidth; t++) {
        for (let w = -mainHalfWidth; w <= mainHalfWidth; w++) {
          const worldX =
            endX + perpX * t * TILE_SIZE + direction.x * w * TILE_SIZE;
          const worldZ =
            endZ + perpZ * t * TILE_SIZE + direction.z * w * TILE_SIZE;

          const tileX = Math.floor(worldX / TILE_SIZE);
          const tileZ = Math.floor(worldZ / TILE_SIZE);

          addTile(tileX, tileZ);

          // Block edges at T-section ends
          const isOuterEdge = Math.abs(t) === tHalfWidth;
          const isEndEdge = Math.abs(w) === mainHalfWidth;

          if (isOuterEdge) {
            const edgeDir = this.getEdgeDirection(perpX, perpZ, t > 0 ? 1 : -1);
            blockedEdges.push({ tileX, tileZ, direction: edgeDir });
          }
          if (isEndEdge) {
            const edgeDir = this.getEdgeDirection(
              direction.x,
              direction.z,
              w > 0 ? 1 : -1,
            );
            blockedEdges.push({ tileX, tileZ, direction: edgeDir });
          }
        }
      }
    }

    // L-section collision tiles
    if (layout.lSection) {
      const lLength = layout.lSection.length;
      const lDirection = layout.lSection.direction;
      const lPerpX = -lDirection.z;
      const lPerpZ = lDirection.x;

      const lTileLength = Math.ceil(lLength / TILE_SIZE);
      const lTileWidth = Math.ceil(layout.width / TILE_SIZE);
      const lHalfWidth = Math.floor(lTileWidth / 2);

      // L-section starts at main dock end
      const startX = layout.position.x + direction.x * layout.length;
      const startZ = layout.position.z + direction.z * layout.length;

      for (let l = 0; l < lTileLength; l++) {
        for (let w = -lHalfWidth; w <= lHalfWidth; w++) {
          const worldX =
            startX +
            lDirection.x * (l + 0.5) * TILE_SIZE +
            lPerpX * w * TILE_SIZE;
          const worldZ =
            startZ +
            lDirection.z * (l + 0.5) * TILE_SIZE +
            lPerpZ * w * TILE_SIZE;

          const tileX = Math.floor(worldX / TILE_SIZE);
          const tileZ = Math.floor(worldZ / TILE_SIZE);

          addTile(tileX, tileZ);

          // Block edges at L-section perimeter
          const isLeftEdge = w === -lHalfWidth;
          const isRightEdge = w === lHalfWidth;
          const isEndEdge = l === lTileLength - 1;

          if (isLeftEdge) {
            const edgeDir = this.getEdgeDirection(lPerpX, lPerpZ, -1);
            blockedEdges.push({ tileX, tileZ, direction: edgeDir });
          }
          if (isRightEdge) {
            const edgeDir = this.getEdgeDirection(lPerpX, lPerpZ, 1);
            blockedEdges.push({ tileX, tileZ, direction: edgeDir });
          }
          if (isEndEdge) {
            const edgeDir = this.getEdgeDirection(
              lDirection.x,
              lDirection.z,
              1,
            );
            blockedEdges.push({ tileX, tileZ, direction: edgeDir });
          }
        }
      }
    }

    return {
      walkableTiles,
      blockedEdges,
    };
  }

  /**
   * Convert direction vector to cardinal direction
   */
  private getEdgeDirection(
    dx: number,
    dz: number,
    sign: number,
  ): "north" | "south" | "east" | "west" {
    const x = dx * sign;
    const z = dz * sign;

    if (Math.abs(x) > Math.abs(z)) {
      return x > 0 ? "east" : "west";
    } else {
      return z > 0 ? "south" : "north";
    }
  }

  // ============================================================================
  // STATISTICS
  // ============================================================================

  /**
   * Calculate generation statistics
   */
  private calculateStats(
    arrays: DockGeometryArrays,
    startTime: number,
  ): GeneratedDock["stats"] {
    let totalVertices = 0;
    let totalTriangles = 0;

    const countGeom = (geoms: THREE.BufferGeometry[]) => {
      for (const g of geoms) {
        const posAttr = g.getAttribute("position");
        if (posAttr) {
          totalVertices += posAttr.count;
          totalTriangles += posAttr.count / 3;
        }
      }
    };

    countGeom(arrays.planks);
    countGeom(arrays.posts);
    countGeom(arrays.railingPosts);
    countGeom(arrays.railingRails);
    countGeom(arrays.moorings);

    return {
      vertices: totalVertices,
      triangles: Math.floor(totalTriangles),
      generationTime: performance.now() - startTime,
    };
  }
}

// ============================================================================
// SINGLETON EXPORT
// ============================================================================

/**
 * Default dock generator instance
 */
export const dockGenerator = new DockGenerator();
