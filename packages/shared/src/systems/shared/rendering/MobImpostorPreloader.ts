/**
 * MobImpostorPreloader.ts - Pre-bakes Animated Impostor Atlases at Load Time
 *
 * This module ensures all mob/NPC animated impostors are baked BEFORE
 * any entities spawn, eliminating runtime baking hitches and pop-in.
 *
 * Architecture (matching Horde approach):
 * - Pre-load all unique mob model types during world initialization
 * - Bake walk cycle animations into texture arrays
 * - Register with GlobalMobAtlasManager for single-draw-call rendering
 * - All work done ahead of time, similar to how Horde pre-bakes to KTX2
 *
 * Usage:
 * ```typescript
 * // In createClientWorld.ts, after PhysX and loader are ready:
 * await prewarmMobImpostors(world);
 * ```
 *
 * @module MobImpostorPreloader
 */

import THREE from "../../../extras/three/three";
import type { World } from "../../../types";
import {
  AnimatedImpostorManager,
  ANIMATED_IMPOSTOR_CONFIG,
} from "./AnimatedImpostorManager";
import { modelCache } from "../../../utils/rendering/ModelCache";

/**
 * Mob model definition for preloading
 */
interface MobModelDef {
  /** Unique identifier (e.g., "mob_goblin") */
  modelId: string;
  /** Asset path to the model */
  modelPath: string;
  /** Model type (vrm or glb) */
  modelType: "vrm" | "glb";
  /** Walk animation clip name (default: "walk" or "idle") */
  walkClipName?: string;
}

/**
 * Known mob model archetypes - these are pre-defined to ensure
 * all mob types have their impostors baked at load time.
 *
 * This list should match the NPC_MODEL_ARCHETYPES in DataManager.ts
 * All mobs/NPCs use GLB (not VRM) for simpler loading and better performance.
 */
const MOB_MODEL_ARCHETYPES: MobModelDef[] = [
  {
    modelId: "mob_goblin",
    modelPath: "asset://models/goblin/goblin_rigged.glb",
    modelType: "glb",
    walkClipName: "walk",
  },
  {
    modelId: "mob_human",
    modelPath: "asset://models/human/human_rigged.glb",
    modelType: "glb",
    walkClipName: "walk",
  },
  {
    modelId: "mob_thug",
    modelPath: "asset://models/thug/thug_rigged.glb",
    modelType: "glb",
    walkClipName: "walk",
  },
  {
    modelId: "mob_troll",
    modelPath: "asset://models/troll/troll_rigged.glb",
    modelType: "glb",
    walkClipName: "walk",
  },
  {
    modelId: "mob_imp",
    modelPath: "asset://models/imp/imp_rigged.glb",
    modelType: "glb",
    walkClipName: "walk",
  },
];

/**
 * Pre-warm mob impostor atlases during world initialization.
 *
 * This should be called AFTER the world loader is fully initialized
 * to ensure all mob animated impostor atlases are ready.
 *
 * @param world - The client world
 * @returns Promise that resolves when all mob impostors are pre-baked
 */
export async function prewarmMobImpostors(world: World): Promise<void> {
  // Skip on server
  if (world.isServer) return;

  console.log("[MobImpostorPreloader] Starting mob impostor pre-baking...");

  const manager = AnimatedImpostorManager.getInstance(world);

  // Initialize baker (requires renderer)
  if (!manager.initBaker()) {
    console.warn(
      "[MobImpostorPreloader] Cannot initialize baker - renderer not ready",
    );
    return;
  }

  const startTime = performance.now();
  let bakedCount = 0;

  // Get unique mob models to pre-bake
  const modelsToBake = await collectMobModelsToBake(world);

  console.log(
    `[MobImpostorPreloader] Found ${modelsToBake.length} unique mob models to pre-bake`,
  );

  // Pre-bake each model sequentially (to avoid GPU contention)
  for (const modelDef of modelsToBake) {
    try {
      // Skip if already registered (cached from previous session)
      if (manager.isMobRegistered(modelDef.modelId)) {
        console.log(`[MobImpostorPreloader] Cache hit: ${modelDef.modelId}`);
        continue;
      }

      // Load the model using the appropriate loader
      const loadResult = await loadMobModelForBaking(world, modelDef);
      if (!loadResult) {
        console.warn(
          `[MobImpostorPreloader] Failed to load model: ${modelDef.modelPath}`,
        );
        continue;
      }

      const { mesh, mixer, walkClip } = loadResult;

      if (!walkClip) {
        console.warn(
          `[MobImpostorPreloader] No walk clip for ${modelDef.modelId}, skipping`,
        );
        // Cleanup
        disposeMobModel(mesh);
        continue;
      }

      // Register with manager (this triggers baking)
      await manager.registerMob(modelDef.modelId, mesh, mixer, walkClip);
      bakedCount++;

      console.log(`[MobImpostorPreloader] ✓ Pre-baked: ${modelDef.modelId}`);

      // Cleanup the temp model (atlas is now in GlobalMobAtlasManager)
      disposeMobModel(mesh);

      // Yield to browser to prevent long task warning
      await new Promise((resolve) => setTimeout(resolve, 0));
    } catch (err) {
      console.warn(
        `[MobImpostorPreloader] Error pre-baking ${modelDef.modelId}:`,
        err,
      );
    }
  }

  // Rebuild the global atlas with all pre-baked variants
  if (bakedCount > 0) {
    manager.rebuildAtlas();
  }

  const elapsed = performance.now() - startTime;
  console.log(
    `[MobImpostorPreloader] Pre-baking complete: ${bakedCount} mob types in ${elapsed.toFixed(0)}ms`,
  );
}

/**
 * Collect all unique mob models that need pre-baking.
 *
 * This queries the DataManager to find all NPC types and their models,
 * deduplicating by model path.
 */
async function collectMobModelsToBake(world: World): Promise<MobModelDef[]> {
  const models: MobModelDef[] = [];
  const seenPaths = new Set<string>();

  // Add known archetypes (both GLB and VRM - VRM is a superset of GLB)
  for (const archetype of MOB_MODEL_ARCHETYPES) {
    if (!seenPaths.has(archetype.modelPath)) {
      seenPaths.add(archetype.modelPath);
      models.push(archetype);
    }
  }

  // Then query DataManager for any additional unique GLB/VRM models
  try {
    // Import getCombatNPCs directly from npcs.ts
    const { getCombatNPCs } = await import("../../../data/npcs");

    // Get all combat NPCs (mobs and bosses)
    const combatNPCs = getCombatNPCs();

    for (const npc of combatNPCs) {
      const modelPath = npc.appearance?.modelPath;
      if (!modelPath || seenPaths.has(modelPath)) continue;

      // Pre-bake GLB and VRM models (VRM is a superset of GLB)
      const isGLB = modelPath.endsWith(".glb");
      const isVRM = modelPath.endsWith(".vrm");
      if (!isGLB && !isVRM) continue;

      seenPaths.add(modelPath);

      const modelId = `mob_${npc.id}`;

      models.push({
        modelId,
        modelPath,
        modelType: isVRM ? "vrm" : "glb",
        walkClipName: "walk",
      });
    }
  } catch (err) {
    console.warn(
      "[MobImpostorPreloader] Could not query DataManager for NPC models:",
      err,
    );
  }

  return models;
}

/**
 * Load a mob model for baking purposes.
 *
 * Uses modelCache for both GLB and VRM models.
 * VRM is a superset of GLB format, so it can be loaded the same way.
 *
 * @returns Object with mesh, mixer, and walkClip, or null if loading failed
 */
async function loadMobModelForBaking(
  world: World,
  modelDef: MobModelDef,
): Promise<{
  mesh: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  walkClip: THREE.AnimationClip | null;
} | null> {
  try {
    // Load GLB/VRM model using ModelCache (VRM is a superset of GLB)
    const { scene, animations } = await modelCache.loadModel(
      modelDef.modelPath,
      world,
    );

    if (!scene) {
      console.warn(
        `[MobImpostorPreloader] No scene in loaded model: ${modelDef.modelPath}`,
      );
      return null;
    }

    // Clone the scene (modelCache returns cached instance)
    const mesh = scene.clone();

    // Find skinned mesh for mixer
    let skinnedMesh: THREE.SkinnedMesh | null = null;
    mesh.traverse((node: THREE.Object3D) => {
      if (node instanceof THREE.SkinnedMesh && !skinnedMesh) {
        skinnedMesh = node;
      }
    });

    if (!skinnedMesh) {
      console.warn(
        `[MobImpostorPreloader] No skinned mesh in model: ${modelDef.modelPath}`,
      );
      return null;
    }

    const mixer = new THREE.AnimationMixer(skinnedMesh);

    // Find walk clip
    let walkClip = animations.find(
      (c: THREE.AnimationClip) =>
        c.name.toLowerCase().includes("walk") ||
        c.name.toLowerCase() === "walk",
    );

    if (!walkClip) {
      walkClip = animations.find(
        (c: THREE.AnimationClip) =>
          c.name.toLowerCase().includes("idle") ||
          c.name.toLowerCase() === "idle",
      );
    }

    // If no embedded animation, try loading from external file
    if (!walkClip) {
      const basePath = modelDef.modelPath.substring(
        0,
        modelDef.modelPath.lastIndexOf("/"),
      );
      try {
        const walkAnim = await modelCache.loadModel(
          `${basePath}/animations/walk.glb`,
          world,
        );
        if (walkAnim?.animations?.[0]) {
          walkClip = walkAnim.animations[0];
        }
      } catch {
        // External animation not found - continue without it
      }
    }

    return { mesh, mixer, walkClip: walkClip || null };
  } catch (err) {
    console.warn(
      `[MobImpostorPreloader] Error loading ${modelDef.modelPath}:`,
      err,
    );
    return null;
  }
}

/**
 * Dispose of a temporarily loaded mob model
 */
function disposeMobModel(mesh: THREE.Object3D): void {
  mesh.traverse((node) => {
    if (node instanceof THREE.Mesh) {
      // Don't dispose geometry - it's shared via modelCache
      // Don't dispose materials - they're shared via modelCache
      // Just clear references
      node.geometry = undefined as unknown as THREE.BufferGeometry;
      node.material = undefined as unknown as THREE.Material;
    }
  });
}

/**
 * Get statistics about pre-baked mob impostors
 */
export function getMobImpostorStats(world: World): {
  registeredCount: number;
  modelIds: string[];
} {
  if (world.isServer) {
    return { registeredCount: 0, modelIds: [] };
  }

  const manager = AnimatedImpostorManager.getInstance(world);
  return {
    registeredCount: manager.getRegisteredMobs().length,
    modelIds: manager.getRegisteredMobs(),
  };
}

export default prewarmMobImpostors;
