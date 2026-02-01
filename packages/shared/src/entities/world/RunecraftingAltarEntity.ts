/**
 * RunecraftingAltarEntity - Altar for crafting runes from essence
 *
 * Represents a runecrafting altar where players convert essence into runes.
 * Each altar is tied to a specific rune type (air, water, earth, fire, mind, chaos).
 *
 * **Extends**: InteractableEntity (players can interact to craft runes)
 *
 * **Interaction**:
 * - Left-click: Instantly converts all carried essence into runes
 * - Right-click: Context menu with "Craft-rune" and "Examine"
 *
 * **Runs on**: Server (authoritative), Client (visual)
 *
 * @see RunecraftingSystem for crafting logic
 */

import THREE from "../../extras/three/three";
import type { World } from "../../core/World";
import type { EntityInteractionData } from "../../types/entities";
import type { EntityData } from "../../types";
import { EntityType, InteractionType } from "../../types/entities";
import {
  InteractableEntity,
  type InteractableConfig,
} from "../InteractableEntity";
import { EventType } from "../../types/events";
import { stationDataProvider } from "../../data/StationDataProvider";
import { modelCache } from "../../utils/rendering/ModelCache";
import { CollisionFlag } from "../../systems/shared/movement/CollisionFlags";
import {
  worldToTile,
  type TileCoord,
} from "../../systems/shared/movement/TileSystem";
import {
  resolveFootprint,
  type FootprintSpec,
} from "../../types/game/resource-processing-types";

/** Default interaction range for runecrafting altars (in tiles) */
const RUNECRAFTING_ALTAR_INTERACTION_RANGE = 2;

/**
 * Configuration for creating a RunecraftingAltarEntity.
 */
export interface RunecraftingAltarEntityConfig {
  id: string;
  name?: string;
  position: { x: number; y: number; z: number };
  rotation?: { x: number; y: number; z: number };
  /** Collision footprint */
  footprint?: FootprintSpec;
  /** Which rune type this altar produces (e.g., "air", "water", "fire") */
  runeType: string;
}

export class RunecraftingAltarEntity extends InteractableEntity {
  public readonly entityType = "runecrafting_altar";
  public readonly isInteractable = true;
  public readonly isPermanent = true;

  /** Display name */
  public displayName: string;

  /** Which rune this altar produces */
  public readonly runeType: string;

  /** Tiles this station occupies for collision */
  private collisionTiles: TileCoord[] = [];

  /** Footprint specification for this station */
  private footprint: FootprintSpec;

  /** Particle layer types */
  private static readonly LAYER_PILLAR = 0;
  private static readonly LAYER_WISP = 1;
  private static readonly LAYER_SPARK = 2;
  private static readonly LAYER_BASE = 3;

  /** Shared unit CircleGeometry for billboard particle meshes */
  private static particleGeometry: THREE.CircleGeometry | null = null;

  /** Mystical particle meshes added to world.stage.scene (client-only) */
  private particleMeshes: THREE.Mesh[] = [];
  private particleState: {
    types: Uint8Array;
    ages: Float32Array;
    lifetimes: Float32Array;
    angles: Float32Array;
    speeds: Float32Array;
    radii: Float32Array;
    heights: Float32Array;
    directions: Int8Array;
    baseScales: Float32Array;
    /** Per-particle spawn offset from altar center (x,y,z triples) */
    spawnOffsets: Float32Array;
    /** Sampled surface vertex positions relative to altar center (x,y,z triples) */
    surfacePoints: Float32Array;
    surfaceCount: number;
    /** Mesh bounding radius in XZ plane */
    meshRadiusXZ: number;
    /** Bottom of mesh relative to yOffset */
    meshMinY: number;
    /** Top of mesh relative to yOffset */
    meshMaxY: number;
    yOffset: number;
    worldX: number;
    worldY: number;
    worldZ: number;
  } | null = null;

  constructor(world: World, config: RunecraftingAltarEntityConfig) {
    const defaultName = `${config.runeType.charAt(0).toUpperCase()}${config.runeType.slice(1)} Altar`;
    const interactableConfig: InteractableConfig = {
      id: config.id,
      name: config.name || defaultName,
      type: EntityType.RUNECRAFTING_ALTAR,
      position: config.position,
      rotation: config.rotation
        ? { ...config.rotation, w: 1 }
        : { x: 0, y: 0, z: 0, w: 1 },
      scale: { x: 1, y: 1, z: 1 },
      visible: true,
      interactable: true,
      interactionType: InteractionType.RUNECRAFTING,
      interactionDistance: RUNECRAFTING_ALTAR_INTERACTION_RANGE,
      description: "A mysterious altar pulsing with runic energy.",
      model: null,
      interaction: {
        prompt: "Craft-rune",
        description: "Craft runes from essence.",
        range: RUNECRAFTING_ALTAR_INTERACTION_RANGE,
        cooldown: 0,
        usesRemaining: -1,
        maxUses: -1,
        effect: "runecrafting",
      },
      properties: {
        movementComponent: null,
        combatComponent: null,
        healthComponent: null,
        visualComponent: null,
        health: { current: 1, max: 1 },
        level: 1,
      },
    };

    super(world, interactableConfig);
    this.displayName = config.name || defaultName;
    this.runeType = config.runeType;

    // Get footprint from manifest (data-driven), allow per-instance override
    this.footprint =
      config.footprint ??
      stationDataProvider.getFootprint("runecrafting_altar");

    // Register collision (server-side only)
    if (this.world.isServer) {
      const centerTile = worldToTile(config.position.x, config.position.z);
      const size = resolveFootprint(this.footprint);

      const offsetX = Math.floor(size.x / 2);
      const offsetZ = Math.floor(size.z / 2);

      for (let dx = 0; dx < size.x; dx++) {
        for (let dz = 0; dz < size.z; dz++) {
          const tile = {
            x: centerTile.x + dx - offsetX,
            z: centerTile.z + dz - offsetZ,
          };
          this.collisionTiles.push(tile);
          this.world.collision.addFlags(tile.x, tile.z, CollisionFlag.BLOCKED);
        }
      }
    }
  }

  /**
   * Clean up collision and particles when destroyed.
   */
  destroy(local?: boolean): void {
    // Remove particle meshes from the world scene
    if (this.particleMeshes.length > 0 && this.world.stage?.scene) {
      for (const mesh of this.particleMeshes) {
        this.world.stage.scene.remove(mesh);
        (mesh.material as THREE.Material).dispose();
      }
      this.particleMeshes = [];
      this.particleState = null;
      this.world.setHot(this, false);
    }
    if (this.world.isServer && this.collisionTiles.length > 0) {
      for (const tile of this.collisionTiles) {
        this.world.collision.removeFlags(tile.x, tile.z, CollisionFlag.BLOCKED);
      }
      this.collisionTiles = [];
    }
    super.destroy(local);
  }

  /**
   * Return tiles occupied by this station for OSRS-style interaction checking.
   */
  protected override getOccupiedTiles(): TileCoord[] {
    if (this.collisionTiles.length > 0) {
      return this.collisionTiles;
    }
    const pos = this.getPosition();
    return [worldToTile(pos.x, pos.z)];
  }

  protected async createMesh(): Promise<void> {
    if (this.world.isServer) {
      return;
    }

    // Get station data from manifest
    const stationData =
      stationDataProvider.getStationData("runecrafting_altar");
    const modelPath = stationData?.model ?? null;
    const modelScale = stationData?.modelScale ?? 1.0;
    const modelYOffset = stationData?.modelYOffset ?? 0;

    // Try to load 3D model
    if (modelPath && this.world.loader) {
      try {
        const { scene } = await modelCache.loadModel(modelPath, this.world);

        this.mesh = scene;
        this.mesh.name = `RunecraftingAltar_${this.id}`;
        this.mesh.scale.set(modelScale, modelScale, modelScale);
        this.mesh.position.y = modelYOffset;

        this.mesh.layers.set(1);
        this.mesh.traverse((child) => {
          child.layers.set(1);
          if (child instanceof THREE.Mesh) {
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });

        this.mesh.userData = {
          type: "runecrafting_altar",
          entityId: this.id,
          name: this.displayName,
          interactable: true,
          runeType: this.runeType,
        };

        if (this.node) {
          this.node.add(this.mesh);
          this.node.userData.type = "runecrafting_altar";
          this.node.userData.entityId = this.id;
          this.node.userData.interactable = true;
        }

        // Add mystical particle effect using actual mesh geometry
        this.createParticleEffect(modelYOffset, scene, modelScale);

        return;
      } catch (error) {
        console.warn(
          `[RunecraftingAltarEntity] Failed to load model, using placeholder:`,
          error,
        );
      }
    }

    // FALLBACK: Teal box placeholder
    const boxHeight = 1.0;
    const geometry = new THREE.BoxGeometry(1.0, boxHeight, 1.0);
    const material = new THREE.MeshStandardMaterial({
      color: 0x008080, // Teal for runecrafting
      roughness: 0.4,
      metalness: 0.4,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `RunecraftingAltar_${this.id}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.position.y = boxHeight / 2;
    mesh.layers.set(1);
    this.mesh = mesh;

    mesh.userData = {
      type: "runecrafting_altar",
      entityId: this.id,
      name: this.displayName,
      interactable: true,
      runeType: this.runeType,
    };

    if (this.mesh && this.node) {
      this.node.add(this.mesh);
      this.node.userData.type = "runecrafting_altar";
      this.node.userData.entityId = this.id;
      this.node.userData.interactable = true;
    }
  }

  /**
   * Get color palette for a given rune type.
   */
  private static getRuneColors(runeType: string): {
    core: number;
    mid: number;
    outer: number;
  } {
    switch (runeType) {
      case "air":
        return { core: 0xffffff, mid: 0xe0e8f0, outer: 0xc8d8e8 };
      case "water":
        return { core: 0x80d0ff, mid: 0x2090e0, outer: 0x1060c0 };
      case "earth":
        return { core: 0x80ff80, mid: 0x30a030, outer: 0x208020 };
      case "fire":
        return { core: 0xff6040, mid: 0xe02020, outer: 0xb01010 };
      case "mind":
        return { core: 0xe879f9, mid: 0xa855f7, outer: 0x7c3aed };
      case "body":
        return { core: 0x60a5fa, mid: 0x3080d0, outer: 0x2060a0 };
      case "cosmic":
        return { core: 0xffff80, mid: 0xc0c020, outer: 0x808010 };
      case "chaos":
        return { core: 0xff6b6b, mid: 0xdc2626, outer: 0x991b1b };
      case "nature":
        return { core: 0x60e060, mid: 0x20a020, outer: 0x108010 };
      case "law":
        return { core: 0x8080ff, mid: 0x4040e0, outer: 0x2020b0 };
      case "death":
        return { core: 0xd0d0d0, mid: 0x606060, outer: 0x303030 };
      case "blood":
        return { core: 0xff4040, mid: 0xc01010, outer: 0x800808 };
      default:
        return { core: 0xc4b5fd, mid: 0x8b5cf6, outer: 0x60a5fa };
    }
  }

  /**
   * Create a color-baked radial glow CanvasTexture.
   * Color is baked directly INTO the texture pixels (not via material.color)
   * because THREE.Sprite / MeshBasicMaterial.color tinting doesn't reliably
   * produce colored output in the WebGPU renderer path.
   *
   * This mirrors how DamageSplatSystem bakes red/blue into its CanvasTextures.
   */
  private static createColoredGlowTexture(
    colorHex: number,
    size: number,
    sharpness: number,
  ): THREE.DataTexture {
    const r = (colorHex >> 16) & 0xff;
    const g = (colorHex >> 8) & 0xff;
    const b = colorHex & 0xff;
    const data = new Uint8Array(size * size * 4);
    const half = size / 2;

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = (x + 0.5 - half) / half;
        const dy = (y + 0.5 - half) / half;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const falloff = Math.max(0, 1 - dist);
        const strength = Math.pow(falloff, sharpness);
        const idx = (y * size + x) * 4;
        data[idx] = Math.round(r * strength);
        data[idx + 1] = Math.round(g * strength);
        data[idx + 2] = Math.round(b * strength);
        data[idx + 3] = Math.round(255 * strength);
      }
    }

    const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    return tex;
  }

  /**
   * Create a material for a glow particle with color baked into the texture.
   * No dependency on material.color tinting — color is in the texture pixels.
   *
   * @param colorHex - Hex color (e.g. 0xff6040)
   * @param sharpness - Falloff exponent (1.5 = soft glow, 4.0 = sharp spark)
   * @param initialOpacity - Starting opacity (0-1)
   */
  private static createGlowMaterial(
    colorHex: number,
    sharpness: number,
    initialOpacity: number,
  ): THREE.MeshBasicMaterial {
    const tex = RunecraftingAltarEntity.createColoredGlowTexture(
      colorHex,
      64,
      sharpness,
    );

    return new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      opacity: initialOpacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
      fog: false,
    });
  }

  /** Get or create shared unit CircleGeometry for round particles */
  private static getParticleGeometry(): THREE.CircleGeometry {
    if (!RunecraftingAltarEntity.particleGeometry) {
      RunecraftingAltarEntity.particleGeometry = new THREE.CircleGeometry(
        0.5,
        16,
      );
    }
    return RunecraftingAltarEntity.particleGeometry;
  }

  /**
   * Sample surface points and bounding box from the loaded 3D model.
   * Returns positions relative to the model's local origin (pre-world-transform).
   */
  private sampleMeshGeometry(
    meshRoot: THREE.Object3D,
    modelScale: number,
    modelYOffset: number,
    sampleCount: number,
  ): {
    surfacePoints: Float32Array;
    surfaceCount: number;
    radiusXZ: number;
    minY: number;
    maxY: number;
  } {
    const allPositions: number[] = [];
    const bbox = new THREE.Box3();

    meshRoot.traverse((child) => {
      if (!(child instanceof THREE.Mesh) || !child.geometry) return;
      const posAttr = child.geometry.getAttribute(
        "position",
      ) as THREE.BufferAttribute | null;
      if (!posAttr) return;

      // Get child's world matrix relative to meshRoot
      child.updateWorldMatrix(true, false);
      const matrix = child.matrixWorld.clone();
      // We need relative to meshRoot's parent (the entity node), not scene root.
      // meshRoot is added to this.node, and meshRoot has scale + position.y set.
      // child.matrixWorld includes all ancestors, but we want relative to node.
      // Since meshRoot is direct child of node, and node is at world origin for
      // this calculation, we can use meshRoot's inverse to get child-relative-to-meshRoot,
      // then re-apply scale+offset ourselves.
      meshRoot.updateWorldMatrix(true, false);
      const meshRootInverse = meshRoot.matrixWorld.clone().invert();
      const localMatrix = matrix.premultiply(meshRootInverse);

      const vertex = new THREE.Vector3();
      for (let v = 0; v < posAttr.count; v++) {
        vertex.set(posAttr.getX(v), posAttr.getY(v), posAttr.getZ(v));
        vertex.applyMatrix4(localMatrix);
        // Apply model scale and Y offset
        vertex.multiplyScalar(modelScale);
        vertex.y += modelYOffset;
        allPositions.push(vertex.x, vertex.y, vertex.z);
        bbox.expandByPoint(vertex);
      }
    });

    // Sample random surface points
    const vertCount = allPositions.length / 3;
    const actualSamples = Math.min(sampleCount, vertCount);
    const surfacePoints = new Float32Array(actualSamples * 3);

    if (vertCount > 0) {
      for (let i = 0; i < actualSamples; i++) {
        const vi = Math.floor(Math.random() * vertCount);
        surfacePoints[i * 3] = allPositions[vi * 3];
        surfacePoints[i * 3 + 1] = allPositions[vi * 3 + 1];
        surfacePoints[i * 3 + 2] = allPositions[vi * 3 + 2];
      }
    }

    // Compute XZ bounding radius from center
    const centerX = (bbox.min.x + bbox.max.x) / 2;
    const centerZ = (bbox.min.z + bbox.max.z) / 2;
    const halfX = (bbox.max.x - bbox.min.x) / 2;
    const halfZ = (bbox.max.z - bbox.min.z) / 2;
    const radiusXZ = Math.sqrt(halfX * halfX + halfZ * halfZ);

    return {
      surfacePoints,
      surfaceCount: actualSamples,
      radiusXZ: radiusXZ || 0.5,
      minY: bbox.min.y || 0,
      maxY: bbox.max.y || 1,
    };
  }

  /**
   * Create a multi-layered mystical particle effect using actual mesh geometry.
   *
   * 4 layers:
   * - Pillar: large soft glows above mesh peak
   * - Wisps: medium orbs orbiting just outside mesh silhouette
   * - Sparks: small bright particles rising from mesh surface vertices
   * - Base: low ambient glows at mesh footprint
   */
  private createParticleEffect(
    modelYOffset: number,
    meshRoot?: THREE.Object3D,
    modelScale?: number,
  ): void {
    if (!this.world.stage?.scene) return;

    const colors = RunecraftingAltarEntity.getRuneColors(this.runeType);

    const pos = this.getPosition();
    const worldX = pos.x;
    const worldY = pos.y;
    const worldZ = pos.z;

    // Sample mesh geometry for mesh-aware placement
    const sampleTarget = 64;
    const geo = meshRoot
      ? this.sampleMeshGeometry(
          meshRoot,
          modelScale ?? 1.0,
          modelYOffset,
          sampleTarget,
        )
      : {
          surfacePoints: new Float32Array(0),
          surfaceCount: 0,
          radiusXZ: 0.5,
          minY: modelYOffset,
          maxY: modelYOffset + 1.0,
        };

    const meshR = geo.radiusXZ;
    const meshHeight = geo.maxY - geo.minY;

    // Layer counts
    const pillarCount = 2;
    const wispCount = 10;
    const sparkCount = 14;
    const baseCount = 4;
    const total = pillarCount + wispCount + sparkCount + baseCount;

    const types = new Uint8Array(total);
    const ages = new Float32Array(total);
    const lifetimes = new Float32Array(total);
    const angles = new Float32Array(total);
    const speeds = new Float32Array(total);
    const radii = new Float32Array(total);
    const heights = new Float32Array(total);
    const directions = new Int8Array(total);
    const baseScales = new Float32Array(total);
    const spawnOffsets = new Float32Array(total * 3);

    let idx = 0;

    // Helper: pick a random surface point offset (relative to altar center)
    const pickSurface = (outIdx: number): void => {
      if (geo.surfaceCount > 0) {
        const si = Math.floor(Math.random() * geo.surfaceCount);
        spawnOffsets[outIdx * 3] = geo.surfacePoints[si * 3];
        spawnOffsets[outIdx * 3 + 1] = geo.surfacePoints[si * 3 + 1];
        spawnOffsets[outIdx * 3 + 2] = geo.surfacePoints[si * 3 + 2];
      } else {
        // Fallback: random point on a cylinder
        const a = Math.random() * Math.PI * 2;
        spawnOffsets[outIdx * 3] = Math.cos(a) * meshR * 0.8;
        spawnOffsets[outIdx * 3 + 1] =
          modelYOffset + Math.random() * meshHeight;
        spawnOffsets[outIdx * 3 + 2] = Math.sin(a) * meshR * 0.8;
      }
    };

    // Helper: create a billboard particle mesh with the given material
    const makeParticle = (mat: THREE.MeshBasicMaterial): THREE.Mesh => {
      const geomRef = RunecraftingAltarEntity.getParticleGeometry();
      const particle = new THREE.Mesh(geomRef, mat);
      particle.renderOrder = 999;
      particle.frustumCulled = false;
      particle.layers.set(1);
      this.world.stage.scene.add(particle);
      this.particleMeshes.push(particle);
      return particle;
    };

    // --- PILLAR: large soft glows above mesh peak ---
    for (let i = 0; i < pillarCount; i++, idx++) {
      types[idx] = RunecraftingAltarEntity.LAYER_PILLAR;
      lifetimes[idx] = 4.0 + Math.random() * 2.0;
      ages[idx] = Math.random() * lifetimes[idx];
      angles[idx] = (i / pillarCount) * Math.PI * 2;
      speeds[idx] = 0.15 + Math.random() * 0.1;
      radii[idx] = meshR * 0.1;
      heights[idx] = geo.maxY + 0.05 + i * 0.35;
      directions[idx] = 1;
      baseScales[idx] = meshR * 0.7 + Math.random() * meshR * 0.3;
      spawnOffsets[idx * 3] = 0;
      spawnOffsets[idx * 3 + 1] = heights[idx];
      spawnOffsets[idx * 3 + 2] = 0;

      const mat = RunecraftingAltarEntity.createGlowMaterial(
        colors.core,
        1.5,
        0.5,
      );
      const particle = makeParticle(mat);
      const s = baseScales[idx];
      particle.scale.set(s, s * 1.3, s);
      particle.position.set(worldX, worldY + heights[idx], worldZ);
    }

    // --- WISPS: orbit just outside mesh silhouette ---
    const wispOrbitR = meshR + 0.1;
    for (let i = 0; i < wispCount; i++, idx++) {
      types[idx] = RunecraftingAltarEntity.LAYER_WISP;
      lifetimes[idx] = 3.0 + Math.random() * 3.0;
      ages[idx] = Math.random() * lifetimes[idx];
      angles[idx] = Math.random() * Math.PI * 2;
      speeds[idx] = 0.5 + Math.random() * 0.6;
      radii[idx] = wispOrbitR + Math.random() * 0.15;
      heights[idx] = geo.minY + Math.random() * meshHeight;
      directions[idx] = Math.random() > 0.5 ? 1 : -1;
      baseScales[idx] = 0.25 + Math.random() * 0.2;
      spawnOffsets[idx * 3] = 0;
      spawnOffsets[idx * 3 + 1] = 0;
      spawnOffsets[idx * 3 + 2] = 0;

      const mat = RunecraftingAltarEntity.createGlowMaterial(
        colors.mid,
        3.0,
        0.65,
      );
      const particle = makeParticle(mat);
      const s = baseScales[idx];
      particle.scale.set(s, s, s);
    }

    // --- SPARKS: rise from actual mesh surface vertices ---
    for (let i = 0; i < sparkCount; i++, idx++) {
      types[idx] = RunecraftingAltarEntity.LAYER_SPARK;
      lifetimes[idx] = 1.2 + Math.random() * 1.5;
      ages[idx] = Math.random() * lifetimes[idx];
      angles[idx] = Math.random() * Math.PI * 2;
      speeds[idx] = 0.6 + Math.random() * 1.0;
      radii[idx] = 0.05 + Math.random() * 0.1;
      heights[idx] = 0;
      directions[idx] = Math.random() > 0.5 ? 1 : -1;
      baseScales[idx] = 0.05 + Math.random() * 0.06;
      pickSurface(idx);

      const mat = RunecraftingAltarEntity.createGlowMaterial(
        colors.core,
        4.0,
        0.8,
      );
      const particle = makeParticle(mat);
      const s = baseScales[idx];
      particle.scale.set(s, s, s);
    }

    // --- BASE: ambient glow at mesh footprint ---
    const baseR = meshR + 0.05;
    for (let i = 0; i < baseCount; i++, idx++) {
      types[idx] = RunecraftingAltarEntity.LAYER_BASE;
      lifetimes[idx] = 5.0 + Math.random() * 3.0;
      ages[idx] = Math.random() * lifetimes[idx];
      angles[idx] = (i / baseCount) * Math.PI * 2;
      speeds[idx] = 0.08 + Math.random() * 0.06;
      radii[idx] = baseR + Math.random() * 0.15;
      heights[idx] = geo.minY + Math.random() * 0.1;
      directions[idx] = 1;
      baseScales[idx] = meshR * 0.5 + Math.random() * meshR * 0.3;
      spawnOffsets[idx * 3] = 0;
      spawnOffsets[idx * 3 + 1] = 0;
      spawnOffsets[idx * 3 + 2] = 0;

      const mat = RunecraftingAltarEntity.createGlowMaterial(
        colors.outer,
        1.5,
        0.2,
      );
      const particle = makeParticle(mat);
      const s = baseScales[idx];
      particle.scale.set(s, s * 0.6, s);
    }

    this.particleState = {
      types,
      ages,
      lifetimes,
      angles,
      speeds,
      radii,
      heights,
      directions,
      baseScales,
      spawnOffsets,
      surfacePoints: geo.surfacePoints,
      surfaceCount: geo.surfaceCount,
      meshRadiusXZ: meshR,
      meshMinY: geo.minY,
      meshMaxY: geo.maxY,
      yOffset: modelYOffset,
      worldX,
      worldY,
      worldZ,
    };

    // Register for frame updates so clientUpdate() is called
    this.world.setHot(this, true);
  }

  /**
   * Handle altar interaction - emits runecrafting interact event.
   */
  public async handleInteraction(data: EntityInteractionData): Promise<void> {
    this.world.emit(EventType.RUNECRAFTING_INTERACT, {
      playerId: data.playerId,
      altarId: this.id,
      runeType: this.runeType,
    });
  }

  /**
   * Get context menu actions.
   */
  public getContextMenuActions(playerId: string): Array<{
    id: string;
    label: string;
    priority: number;
    handler: () => void;
  }> {
    return [
      {
        id: "craft_rune",
        label: "Craft-rune",
        priority: 1,
        handler: () => {
          this.world.emit(EventType.RUNECRAFTING_INTERACT, {
            playerId,
            altarId: this.id,
            runeType: this.runeType,
          });
        },
      },
      {
        id: "examine",
        label: "Examine",
        priority: 100,
        handler: () => {
          this.world.emit(EventType.UI_MESSAGE, {
            playerId,
            message: "A mysterious altar pulsing with runic energy.",
          });
        },
      },
    ];
  }

  /**
   * Override serialize() to include runeType in the initial snapshot.
   * Base Entity.serialize() only copies this.data properties — runeType
   * is an instance property so it must be added explicitly.
   */
  serialize(): EntityData {
    const baseData = super.serialize();
    return {
      ...baseData,
      runeType: this.runeType,
    };
  }

  /**
   * Network data for syncing to clients.
   */
  getNetworkData(): Record<string, unknown> {
    const baseData = super.getNetworkData();
    return {
      ...baseData,
      runeType: this.runeType,
    };
  }

  protected clientUpdate(deltaTime: number): void {
    super.clientUpdate(deltaTime);

    if (!this.particleState || this.particleMeshes.length === 0) {
      return;
    }

    const {
      types,
      ages,
      lifetimes,
      angles,
      speeds,
      radii,
      heights,
      directions,
      baseScales,
      spawnOffsets,
      surfacePoints,
      surfaceCount,
      meshRadiusXZ,
      worldX,
      worldY,
      worldZ,
    } = this.particleState;
    const count = ages.length;
    const now = Date.now();
    const globalPulse = 0.85 + Math.sin(now * 0.002) * 0.15;

    // Billboard: copy camera quaternion so all particle planes face the viewer
    const cam = this.world.camera;
    const camQuat = cam?.quaternion;

    for (let i = 0; i < count; i++) {
      ages[i] += deltaTime;
      const particle = this.particleMeshes[i];
      const mat = particle.material as THREE.MeshBasicMaterial;
      const layer = types[i];

      // Billboard orientation — face the camera
      if (camQuat) {
        particle.quaternion.copy(camQuat);
      }

      // Respawn when lifetime expires
      if (ages[i] >= lifetimes[i]) {
        ages[i] -= lifetimes[i];
        if (layer === RunecraftingAltarEntity.LAYER_SPARK) {
          // Pick a new surface spawn point
          if (surfaceCount > 0) {
            const si = Math.floor(Math.random() * surfaceCount);
            spawnOffsets[i * 3] = surfacePoints[si * 3];
            spawnOffsets[i * 3 + 1] = surfacePoints[si * 3 + 1];
            spawnOffsets[i * 3 + 2] = surfacePoints[si * 3 + 2];
          }
          angles[i] = Math.random() * Math.PI * 2;
          speeds[i] = 0.6 + Math.random() * 1.0;
          radii[i] = 0.05 + Math.random() * 0.1;
        } else if (layer === RunecraftingAltarEntity.LAYER_WISP) {
          angles[i] = Math.random() * Math.PI * 2;
          speeds[i] = 0.5 + Math.random() * 0.6;
        }
      }

      const t = ages[i] / lifetimes[i];

      if (layer === RunecraftingAltarEntity.LAYER_PILLAR) {
        // Pillar: slow vertical bob above mesh peak, gentle sway, scale breathes
        const bob = Math.sin(now * 0.001 + i * 3.14) * 0.12;
        const sway = Math.sin(now * 0.0008 + i * 1.5) * meshRadiusXZ * 0.06;
        particle.position.set(
          worldX + sway,
          worldY + heights[i] + bob,
          worldZ + Math.cos(now * 0.0006 + i) * meshRadiusXZ * 0.04,
        );
        const breathe = 1.0 + Math.sin(now * 0.0015 + i * 2.0) * 0.15;
        const s = baseScales[i] * breathe;
        particle.scale.set(s, s * 1.4, s);
        mat.opacity = (0.3 + Math.sin(now * 0.0012 + i) * 0.1) * globalPulse;
      } else if (layer === RunecraftingAltarEntity.LAYER_WISP) {
        // Wisps: helical orbit just outside mesh silhouette
        const dir = directions[i];
        const angle = angles[i] + t * speeds[i] * dir * 5.0;
        const r = radii[i] * (0.8 + Math.sin(t * Math.PI * 2) * 0.2);
        const h = heights[i] + Math.sin(t * Math.PI * 2.5) * 0.3;
        particle.position.set(
          worldX + Math.cos(angle) * r,
          worldY + h,
          worldZ + Math.sin(angle) * r,
        );
        const pulse = 1.0 + Math.sin(t * Math.PI * 3) * 0.2;
        const s = baseScales[i] * pulse;
        particle.scale.set(s, s, s);
        const fadeIn = Math.min(t * 3, 1);
        const fadeOut = Math.min((1 - t) * 3, 1);
        mat.opacity = 0.5 * fadeIn * fadeOut * globalPulse;
      } else if (layer === RunecraftingAltarEntity.LAYER_SPARK) {
        // Sparks: rise from actual mesh surface vertex with slight drift
        const ox = spawnOffsets[i * 3];
        const oy = spawnOffsets[i * 3 + 1];
        const oz = spawnOffsets[i * 3 + 2];
        const drift = Math.sin(angles[i] + t * directions[i] * 2.0) * radii[i];
        const riseHeight = t * 1.8;
        particle.position.set(
          worldX + ox + drift,
          worldY + oy + riseHeight,
          worldZ + oz + Math.cos(angles[i] + t * 1.5) * radii[i],
        );
        const shrink = 1.0 - t * 0.5;
        const s = baseScales[i] * shrink;
        particle.scale.set(s, s, s);
        const fadeIn = Math.min(t * 8, 1);
        const fadeOut = Math.pow(1 - t, 1.5);
        mat.opacity = 0.85 * fadeIn * fadeOut * globalPulse;
      } else {
        // Base: slow orbit at mesh footprint, gentle pulse
        const angle = angles[i] + now * 0.0003 * speeds[i] * 10;
        particle.position.set(
          worldX + Math.cos(angle) * radii[i],
          worldY + heights[i],
          worldZ + Math.sin(angle) * radii[i],
        );
        const pulse = 1.0 + Math.sin(now * 0.001 + i * 1.57) * 0.15;
        const s = baseScales[i] * pulse;
        particle.scale.set(s, s * 0.6, s);
        mat.opacity =
          (0.15 + Math.sin(now * 0.0008 + i * 2) * 0.06) * globalPulse;
      }
    }
  }
}
