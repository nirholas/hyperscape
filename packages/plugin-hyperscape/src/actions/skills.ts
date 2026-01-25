/**
 * Skill actions - CHOP_TREE, CATCH_FISH, MINE_ROCK, LIGHT_FIRE, COOK_FOOD
 */

import type {
  Action,
  IAgentRuntime,
  Memory,
  State,
  HandlerCallback,
  HandlerOptions,
  JsonValue,
} from "@elizaos/core";
import { logger } from "@elizaos/core";
import type { HyperscapeService } from "../services/HyperscapeService.js";
import type { GatherResourceCommand, Entity, InventoryItem } from "../types.js";

// Max distance to attempt gathering (server update loop requires <= 4m)
const MAX_GATHER_DISTANCE = 4;
type HandlerOptionsParam =
  | HandlerOptions
  | Record<string, JsonValue | undefined>;

type Position3 = [number, number, number];
type PositionLike = Position3 | { x: number; y?: number; z: number };

function getPositionXZ(pos: PositionLike | null | undefined): {
  x: number;
  z: number;
} | null {
  if (!pos) return null;
  if (Array.isArray(pos) && pos.length >= 3) {
    return { x: pos[0], z: pos[2] };
  }
  const obj = pos as { x: number; z: number };
  return { x: obj.x, z: obj.z };
}

function getPositionArray(
  pos: PositionLike | null | undefined,
): Position3 | null {
  if (!pos) return null;
  if (Array.isArray(pos) && pos.length >= 3) {
    return [pos[0], pos[1], pos[2]];
  }
  const obj = pos as { x: number; y?: number; z: number };
  return [obj.x, obj.y ?? 0, obj.z];
}

/**
 * Calculate 3D distance between player position and entity position
 */
function getEntityDistance(
  playerPos: PositionLike | null | undefined,
  entityPos: PositionLike | null | undefined,
): number | null {
  const player = getPositionXZ(playerPos);
  const entity = getPositionXZ(entityPos);
  if (!player || !entity) return null;
  const dx = player.x - entity.x;
  const dz = player.z - entity.z;
  return Math.sqrt(dx * dx + dz * dz);
}

function getInventoryItemName(item: InventoryItem): string {
  return (item.name || item.item?.name || item.itemId || "")
    .toString()
    .toLowerCase();
}

/**
 * Check if an entity is a tree (strict detection)
 */
function isTree(e: Entity): boolean {
  const name = e.name?.toLowerCase() || "";
  const id = (e.id || "").toLowerCase();

  // Exclude ground items (by type or ID patterns)
  const entityType = (e.type || "").toLowerCase();
  if (entityType === "item" || /bow|sword|shield|axe|armor|helm/i.test(id)) {
    return false;
  }

  // Check for explicit tree types
  if (e.resourceType === "tree" || e.type === "tree") {
    return true;
  }

  // Check for tree-like names (must contain "tree" in name)
  if (name.includes("tree") && /oak|willow|maple|yew|normal/i.test(name)) {
    return true;
  }

  // Generic "tree" match
  if (name.includes("tree") && !name.includes("item")) {
    return true;
  }

  return false;
}

/**
 * Check if an entity is a fishing spot
 */
function isFishingSpot(e: Entity): boolean {
  const resourceType = (e.resourceType || "").toLowerCase();
  const type = (e.type || "").toLowerCase();
  const name = e.name?.toLowerCase() || "";

  if (resourceType === "fishing_spot" || resourceType === "fish") return true;
  if (type === "fishing_spot") return true;
  if (name.includes("fishing spot")) return true;

  return false;
}

/**
 * Check if an entity is a mining rock
 */
function isMiningRock(e: Entity): boolean {
  const resourceType = (e.resourceType || "").toLowerCase();
  const type = (e.type || "").toLowerCase();
  const name = e.name?.toLowerCase() || "";

  if (resourceType === "mining_rock") return true;
  if (resourceType === "ore" || resourceType === "rock") return true;
  if (type === "mining_rock" || type === "rock") return true;
  if (name.includes("rock") || name.includes("ore")) return true;

  return false;
}

export const chopTreeAction: Action = {
  name: "CHOP_TREE",
  similes: ["CHOP", "WOODCUT", "CUT_TREE"],
  description: "Chop down a tree to gather logs. Requires an axe.",

  validate: async (runtime: IAgentRuntime) => {
    const service = runtime.getService<HyperscapeService>("hyperscapeService");
    if (!service) {
      logger.info("[CHOP_TREE] Validation failed: no service");
      return false;
    }
    const playerEntity = service.getPlayerEntity();
    const entities = service.getNearbyEntities() || [];

    // Check player entity exists and is alive
    if (!playerEntity) {
      logger.info("[CHOP_TREE] Validation failed: no player entity");
      return false;
    }

    // Check alive - treat undefined as alive (some entity formats don't set this explicitly)
    const isAlive = playerEntity.alive !== false;
    if (!service.isConnected() || !isAlive) {
      logger.info(
        `[CHOP_TREE] Validation failed: connected=${service.isConnected()}, alive=${playerEntity.alive}`,
      );
      return false;
    }

    // Check for axe or hatchet in inventory (hatchets are woodcutting tools)
    // Handle both flat (i.name) and nested (i.item.name) inventory formats
    const hasAxe =
      playerEntity.items?.some((i) => {
        const name = getInventoryItemName(i);
        return name.includes("axe") || name.includes("hatchet");
      }) ?? false;

    // Check for trees WITHIN approach range (20m)
    // Handler will walk to tree if needed, then chop when within 4m
    const playerPos = playerEntity.position;
    const allTrees = entities.filter(isTree);
    const approachableTrees = allTrees.filter((e) => {
      const entityPos = e.position;
      if (!entityPos) return false;
      const dist = getEntityDistance(playerPos, entityPos);
      return dist !== null && dist <= 20; // 20m approach range
    });

    // Use approachable trees for validation
    const trees = approachableTrees;

    logger.info(
      `[CHOP_TREE] Validation: hasAxe=${hasAxe}, trees=${trees.length}, ` +
        `totalEntities=${entities.length}, items=${playerEntity.items?.length || 0}`,
    );

    if (!hasAxe) {
      logger.info("[CHOP_TREE] Validation failed: no axe/hatchet in inventory");
      // Log inventory for debugging - handle both formats
      const items = playerEntity.items || [];
      const itemCount = items.length;
      if (itemCount === 0) {
        logger.info(`[CHOP_TREE] Inventory is empty (${itemCount} items)`);
      } else {
        const itemDetails = items
          .map((i) => {
            const name = getInventoryItemName(i) || "unknown";
            return name;
          })
          .join(", ");
        logger.info(
          `[CHOP_TREE] Inventory items (${itemCount}): ${itemDetails}`,
        );
      }
    }

    if (trees.length === 0) {
      logger.info("[CHOP_TREE] Validation failed: no trees nearby");
      // Log first few entities for debugging
      const entityInfo = entities
        .slice(0, 5)
        .map((e) => {
          const type = e.type || e.entityType || "unknown";
          const resourceType = e.resourceType || "unknown";
          return `${e.name || e.id}(type=${type},rt=${resourceType})`;
        })
        .join(", ");
      logger.info(`[CHOP_TREE] Nearby entities sample: ${entityInfo}`);
    }

    return hasAxe && trees.length > 0;
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: HandlerOptionsParam,
    callback?: HandlerCallback,
  ) => {
    try {
      const service =
        runtime.getService<HyperscapeService>("hyperscapeService");
      if (!service) {
        return {
          success: false,
          error: new Error("Hyperscape service not available"),
        };
      }
      const entities = service.getNearbyEntities();

      // Find trees and sort by distance
      const player = service.getPlayerEntity();
      const playerPos = player?.position;
      const allTrees = entities.filter(isTree);

      // Get all trees with distance, sorted by nearest
      const treesWithDistance = allTrees
        .map((e) => {
          const entityPos = e.position;
          const dist = entityPos
            ? getEntityDistance(playerPos, entityPos)
            : null;
          return { entity: e, distance: dist, position: entityPos };
        })
        .filter((t) => t.distance !== null)
        .sort((a, b) => (a.distance ?? 999) - (b.distance ?? 999));

      // Trees within gathering range (4m)
      const nearbyTrees = treesWithDistance.filter(
        (t) => t.distance !== null && t.distance <= MAX_GATHER_DISTANCE,
      );

      // Trees within approach range (20m) - close enough to walk to
      const approachableTrees = treesWithDistance.filter(
        (t) => t.distance !== null && t.distance <= 20,
      );

      logger.info(
        `[CHOP_TREE] Handler: Found ${nearbyTrees.length} trees within ${MAX_GATHER_DISTANCE}m, ` +
          `${approachableTrees.length} within 20m (${allTrees.length} total)`,
      );

      // If no trees within gathering range but some within approach range, walk to nearest first
      if (nearbyTrees.length === 0 && approachableTrees.length > 0) {
        const nearest = approachableTrees[0];
        const treePos = getPositionArray(
          nearest.position as PositionLike | null,
        );
        if (!treePos) {
          logger.info("[CHOP_TREE] Handler: Could not get tree position");
          await callback?.({ text: "Could not locate tree.", error: true });
          return { success: false };
        }
        const [treeX, treeY, treeZ] = treePos;

        // Get player position to find nearest cardinal adjacent tile
        const playerXZ = getPositionXZ(playerPos as PositionLike | null);
        if (!playerXZ) {
          logger.info("[CHOP_TREE] Handler: Could not get player position");
          await callback?.({ text: "Could not locate player.", error: true });
          return { success: false };
        }
        const { x: px, z: pz } = playerXZ;

        // Server requires player to be on a CARDINAL adjacent tile (N/S/E/W, not diagonal)
        // Calculate the 4 cardinal adjacent positions and pick the nearest one to player
        const treeTileX = Math.floor(treeX);
        const treeTileZ = Math.floor(treeZ);
        const cardinalPositions = [
          { x: treeTileX, z: treeTileZ - 1, dir: "South" }, // South (Z-)
          { x: treeTileX, z: treeTileZ + 1, dir: "North" }, // North (Z+)
          { x: treeTileX - 1, z: treeTileZ, dir: "West" }, // West (X-)
          { x: treeTileX + 1, z: treeTileZ, dir: "East" }, // East (X+)
        ];

        // Find the cardinal position nearest to player
        let nearestCardinal = cardinalPositions[0];
        let minDist = Infinity;
        for (const pos of cardinalPositions) {
          const dist = Math.sqrt(
            Math.pow(px - pos.x, 2) + Math.pow(pz - pos.z, 2),
          );
          if (dist < minDist) {
            minDist = dist;
            nearestCardinal = pos;
          }
        }

        // Target the center of the cardinal adjacent tile
        const targetPos: [number, number, number] = [
          nearestCardinal.x + 0.5,
          treeY,
          nearestCardinal.z + 0.5,
        ];

        logger.info(
          `[CHOP_TREE] Handler: Walking to tree ${nearest.entity.name} - ` +
            `stopping at cardinal tile [${nearestCardinal.x}, ${nearestCardinal.z}] (${nearestCardinal.dir}) ` +
            `(tree at tile [${treeTileX}, ${treeTileZ}], ${nearest.distance?.toFixed(1)}m away)`,
        );

        // Walk to cardinal adjacent position
        await service.executeMove({ target: targetPos, runMode: false });
        await callback?.({
          text: `Walking to ${nearest.entity.name}...`,
          action: "CHOP_TREE",
        });
        return { success: true, text: `Walking to ${nearest.entity.name}` };
      }

      const tree = nearbyTrees[0]?.entity; // Pick nearest tree within range

      if (!tree) {
        logger.info("[CHOP_TREE] Handler: No tree found within approach range");
        await callback?.({ text: "No tree found nearby.", error: true });
        return { success: false };
      }

      // Log positions for debugging
      const treePos = tree.position;
      const treeDist = nearbyTrees[0]?.distance;

      // Get tree position for cardinal check
      const treePosArray = getPositionArray(treePos as PositionLike | null);
      if (!treePosArray) {
        logger.info("[CHOP_TREE] Handler: Could not get tree position");
        await callback?.({ text: "Could not locate tree.", error: true });
        return { success: false };
      }
      const [treeX, treeY, treeZ] = treePosArray;

      // Get player position
      const playerXZ = getPositionXZ(playerPos as PositionLike | null);
      if (!playerXZ) {
        logger.info("[CHOP_TREE] Handler: Could not get player position");
        await callback?.({ text: "Could not locate player.", error: true });
        return { success: false };
      }
      const { x: px, z: pz } = playerXZ;

      // Check if player is on a cardinal adjacent tile
      const treeTileX = Math.floor(treeX);
      const treeTileZ = Math.floor(treeZ);
      const playerTileX = Math.floor(px);
      const playerTileZ = Math.floor(pz);

      const isCardinalAdjacent =
        (playerTileX === treeTileX &&
          Math.abs(playerTileZ - treeTileZ) === 1) ||
        (playerTileZ === treeTileZ && Math.abs(playerTileX - treeTileX) === 1);

      logger.info(
        `[CHOP_TREE] Handler: Tree ${tree.id} (${tree.name}) ` +
          `at tile [${treeTileX}, ${treeTileZ}], player at tile [${playerTileX}, ${playerTileZ}], ` +
          `dist=${treeDist?.toFixed(1)}m, cardinalAdjacent=${isCardinalAdjacent}`,
      );

      // If not on cardinal adjacent tile, walk to one
      if (!isCardinalAdjacent) {
        const cardinalPositions = [
          { x: treeTileX, z: treeTileZ - 1, dir: "South" },
          { x: treeTileX, z: treeTileZ + 1, dir: "North" },
          { x: treeTileX - 1, z: treeTileZ, dir: "West" },
          { x: treeTileX + 1, z: treeTileZ, dir: "East" },
        ];

        let nearestCardinal = cardinalPositions[0];
        let minDist = Infinity;
        for (const pos of cardinalPositions) {
          const dist = Math.sqrt(
            Math.pow(px - pos.x, 2) + Math.pow(pz - pos.z, 2),
          );
          if (dist < minDist) {
            minDist = dist;
            nearestCardinal = pos;
          }
        }

        const targetPos: [number, number, number] = [
          nearestCardinal.x + 0.5,
          treeY,
          nearestCardinal.z + 0.5,
        ];

        logger.info(
          `[CHOP_TREE] Handler: Not on cardinal tile, moving to [${nearestCardinal.x}, ${nearestCardinal.z}] (${nearestCardinal.dir})`,
        );

        await service.executeMove({ target: targetPos, runMode: false });
        await callback?.({
          text: `Positioning to chop ${tree.name}...`,
          action: "CHOP_TREE",
        });
        return { success: true, text: `Positioning to chop ${tree.name}` };
      }

      const command: GatherResourceCommand = {
        resourceEntityId: tree.id,
        skill: "woodcutting",
      };
      await service.executeGatherResource(command);

      await callback?.({ text: `Chopping ${tree.name}`, action: "CHOP_TREE" });

      return { success: true, text: `Started chopping ${tree.name}` };
    } catch (error) {
      logger.error(
        `[CHOP_TREE] Handler error: ${error instanceof Error ? error.message : error}`,
      );
      await callback?.({
        text: `Failed to chop: ${error instanceof Error ? error.message : ""}`,
        error: true,
      });
      return { success: false, error: error as Error };
    }
  },

  examples: [
    [
      { name: "user", content: { text: "Chop down that oak tree" } },
      {
        name: "agent",
        content: { text: "Chopping Oak Tree", action: "CHOP_TREE" },
      },
    ],
  ],
};

export const catchFishAction: Action = {
  name: "CATCH_FISH",
  similes: ["FISH", "FISHING"],
  description: "Catch fish at a fishing spot. Requires a fishing rod.",

  validate: async (runtime: IAgentRuntime) => {
    const service = runtime.getService<HyperscapeService>("hyperscapeService");
    if (!service) return false;
    const playerEntity = service.getPlayerEntity();
    const entities = service.getNearbyEntities() || [];

    if (!service.isConnected() || !playerEntity || playerEntity.alive === false)
      return false;

    const hasRod =
      playerEntity.items?.some((i) => {
        const name = getInventoryItemName(i);
        return name.includes("fishing rod") || name.includes("rod");
      }) ?? false;

    const fishingLevel = playerEntity.skills?.fishing?.level ?? 1;
    const playerPos = playerEntity.position;
    const spots = entities.filter(isFishingSpot);

    const approachableSpots = spots.filter((spot) => {
      if (spot.depleted) return false;
      const requiredLevel = spot.requiredLevel ?? 1;
      if (requiredLevel > fishingLevel) return false;
      const dist = getEntityDistance(playerPos, spot.position);
      return dist !== null && dist <= 20;
    });

    return hasRod && approachableSpots.length > 0;
  },

  handler: async (
    runtime: IAgentRuntime,
    _message: Memory,
    _state?: State,
    _options?: HandlerOptionsParam,
    callback?: HandlerCallback,
  ) => {
    try {
      const service =
        runtime.getService<HyperscapeService>("hyperscapeService");
      if (!service) {
        return {
          success: false,
          error: new Error("Hyperscape service not available"),
        };
      }
      const entities = service.getNearbyEntities();
      const player = service.getPlayerEntity();
      const playerPos = player?.position;
      const fishingLevel = player?.skills?.fishing?.level ?? 1;

      // Find fishing spots and sort by distance
      const allSpots = entities.filter(isFishingSpot).filter((spot) => {
        if (spot.depleted) return false;
        const requiredLevel = spot.requiredLevel ?? 1;
        return requiredLevel <= fishingLevel;
      });

      const spotsWithDistance = allSpots
        .map((e) => {
          const dist = getEntityDistance(playerPos, e.position);
          return { entity: e, distance: dist, position: e.position };
        })
        .filter((t) => t.distance !== null)
        .sort((a, b) => (a.distance ?? 999) - (b.distance ?? 999));

      const nearbySpots = spotsWithDistance.filter(
        (t) => t.distance !== null && t.distance <= MAX_GATHER_DISTANCE,
      );
      const approachableSpots = spotsWithDistance.filter(
        (t) => t.distance !== null && t.distance <= 20,
      );

      if (nearbySpots.length === 0 && approachableSpots.length > 0) {
        const nearest = approachableSpots[0];
        const spotPos = nearest.position as
          | [number, number, number]
          | { x: number; y?: number; z: number };

        let spotX: number, spotY: number, spotZ: number;
        if (Array.isArray(spotPos)) {
          [spotX, spotY, spotZ] = spotPos;
        } else {
          spotX = spotPos.x;
          spotY = spotPos.y ?? 0;
          spotZ = spotPos.z;
        }

        let px = 0,
          pz = 0;
        if (Array.isArray(playerPos)) {
          px = playerPos[0];
          pz = playerPos[2];
        } else if (playerPos && typeof playerPos === "object") {
          const pos = playerPos as { x?: number; z?: number };
          px = pos.x ?? 0;
          pz = pos.z ?? 0;
        }

        const spotTileX = Math.floor(spotX);
        const spotTileZ = Math.floor(spotZ);
        const cardinalPositions = [
          { x: spotTileX, z: spotTileZ - 1, dir: "South" },
          { x: spotTileX, z: spotTileZ + 1, dir: "North" },
          { x: spotTileX - 1, z: spotTileZ, dir: "West" },
          { x: spotTileX + 1, z: spotTileZ, dir: "East" },
        ];

        let nearestCardinal = cardinalPositions[0];
        let minDist = Infinity;
        for (const pos of cardinalPositions) {
          const dist = Math.sqrt(
            Math.pow(px - pos.x, 2) + Math.pow(pz - pos.z, 2),
          );
          if (dist < minDist) {
            minDist = dist;
            nearestCardinal = pos;
          }
        }

        const targetPos: [number, number, number] = [
          nearestCardinal.x + 0.5,
          spotY,
          nearestCardinal.z + 0.5,
        ];

        logger.info(
          `[CATCH_FISH] Walking to fishing spot ${nearest.entity.name} - ` +
            `stopping at cardinal tile [${nearestCardinal.x}, ${nearestCardinal.z}] (${nearestCardinal.dir})`,
        );

        await service.executeMove({ target: targetPos, runMode: false });
        await callback?.({
          text: `Walking to ${nearest.entity.name}...`,
          action: "CATCH_FISH",
        });
        return { success: true, text: `Walking to ${nearest.entity.name}` };
      }

      const spot = nearbySpots[0]?.entity;
      if (!spot) {
        await callback?.({
          text: "No fishing spot found nearby.",
          error: true,
        });
        return { success: false };
      }

      const spotPos = spot.position as
        | [number, number, number]
        | { x: number; y?: number; z: number };

      let spotX = 0,
        spotZ = 0;
      if (Array.isArray(spotPos)) {
        spotX = spotPos[0];
        spotZ = spotPos[2];
      } else {
        spotX = spotPos.x;
        spotZ = spotPos.z;
      }

      let px = 0,
        pz = 0;
      if (Array.isArray(playerPos)) {
        px = playerPos[0];
        pz = playerPos[2];
      } else if (playerPos && typeof playerPos === "object") {
        const pos = playerPos as { x?: number; z?: number };
        px = pos.x ?? 0;
        pz = pos.z ?? 0;
      }

      const spotTileX = Math.floor(spotX);
      const spotTileZ = Math.floor(spotZ);
      const playerTileX = Math.floor(px);
      const playerTileZ = Math.floor(pz);

      const isCardinalAdjacent =
        (playerTileX === spotTileX &&
          Math.abs(playerTileZ - spotTileZ) === 1) ||
        (playerTileZ === spotTileZ && Math.abs(playerTileX - spotTileX) === 1);

      if (!isCardinalAdjacent) {
        const cardinalPositions = [
          { x: spotTileX, z: spotTileZ - 1, dir: "South" },
          { x: spotTileX, z: spotTileZ + 1, dir: "North" },
          { x: spotTileX - 1, z: spotTileZ, dir: "West" },
          { x: spotTileX + 1, z: spotTileZ, dir: "East" },
        ];

        let nearestCardinal = cardinalPositions[0];
        let minDist = Infinity;
        for (const pos of cardinalPositions) {
          const dist = Math.sqrt(
            Math.pow(px - pos.x, 2) + Math.pow(pz - pos.z, 2),
          );
          if (dist < minDist) {
            minDist = dist;
            nearestCardinal = pos;
          }
        }

        const targetPos: [number, number, number] = [
          nearestCardinal.x + 0.5,
          Array.isArray(spotPos) ? spotPos[1] : (spotPos.y ?? 0),
          nearestCardinal.z + 0.5,
        ];

        await service.executeMove({ target: targetPos, runMode: false });
        await callback?.({
          text: `Positioning to fish at ${spot.name}...`,
          action: "CATCH_FISH",
        });
        return { success: true, text: `Positioning to fish at ${spot.name}` };
      }

      const command: GatherResourceCommand = {
        resourceEntityId: spot.id,
        skill: "fishing",
      };
      await service.executeGatherResource(command);

      await callback?.({ text: "Fishing...", action: "CATCH_FISH" });

      return { success: true, text: "Started fishing" };
    } catch (error) {
      await callback?.({
        text: `Failed to fish: ${error instanceof Error ? error.message : ""}`,
        error: true,
      });
      return { success: false, error: error as Error };
    }
  },

  examples: [
    [
      { name: "user", content: { text: "Catch some fish" } },
      { name: "agent", content: { text: "Fishing...", action: "CATCH_FISH" } },
    ],
  ],
};

export const mineRockAction: Action = {
  name: "MINE_ROCK",
  similes: ["MINE", "MINING", "DIG"],
  description: "Mine a rock to gather ore. Requires a pickaxe.",

  validate: async (runtime: IAgentRuntime) => {
    const service = runtime.getService<HyperscapeService>("hyperscapeService");
    if (!service) return false;
    const playerEntity = service.getPlayerEntity();
    const entities = service.getNearbyEntities() || [];

    if (!service.isConnected() || !playerEntity || playerEntity.alive === false)
      return false;

    const hasPickaxe =
      playerEntity.items?.some((i) => {
        const name = getInventoryItemName(i);
        return name.includes("pickaxe") || name.includes("pick");
      }) ?? false;

    const miningLevel = playerEntity.skills?.mining?.level ?? 1;
    const playerPos = playerEntity.position;
    const rocks = entities.filter(isMiningRock);

    const approachableRocks = rocks.filter((rock) => {
      if (rock.depleted) return false;
      const requiredLevel = rock.requiredLevel ?? 1;
      if (requiredLevel > miningLevel) return false;
      const dist = getEntityDistance(playerPos, rock.position);
      return dist !== null && dist <= 20;
    });

    return hasPickaxe && approachableRocks.length > 0;
  },

  handler: async (
    runtime: IAgentRuntime,
    _message: Memory,
    _state?: State,
    _options?: HandlerOptionsParam,
    callback?: HandlerCallback,
  ) => {
    try {
      const service =
        runtime.getService<HyperscapeService>("hyperscapeService");
      if (!service) {
        return {
          success: false,
          error: new Error("Hyperscape service not available"),
        };
      }
      const entities = service.getNearbyEntities();
      const player = service.getPlayerEntity();
      const playerPos = player?.position;
      const miningLevel = player?.skills?.mining?.level ?? 1;

      const allRocks = entities.filter(isMiningRock).filter((rock) => {
        if (rock.depleted) return false;
        const requiredLevel = rock.requiredLevel ?? 1;
        return requiredLevel <= miningLevel;
      });

      const rocksWithDistance = allRocks
        .map((e) => {
          const dist = getEntityDistance(playerPos, e.position);
          return { entity: e, distance: dist, position: e.position };
        })
        .filter((t) => t.distance !== null)
        .sort((a, b) => (a.distance ?? 999) - (b.distance ?? 999));

      const nearbyRocks = rocksWithDistance.filter(
        (t) => t.distance !== null && t.distance <= MAX_GATHER_DISTANCE,
      );
      const approachableRocks = rocksWithDistance.filter(
        (t) => t.distance !== null && t.distance <= 20,
      );

      if (nearbyRocks.length === 0 && approachableRocks.length > 0) {
        const nearest = approachableRocks[0];
        const rockPos = nearest.position as
          | [number, number, number]
          | { x: number; y?: number; z: number };

        let rockX: number, rockY: number, rockZ: number;
        if (Array.isArray(rockPos)) {
          [rockX, rockY, rockZ] = rockPos;
        } else {
          rockX = rockPos.x;
          rockY = rockPos.y ?? 0;
          rockZ = rockPos.z;
        }

        let px = 0,
          pz = 0;
        if (Array.isArray(playerPos)) {
          px = playerPos[0];
          pz = playerPos[2];
        } else if (playerPos && typeof playerPos === "object") {
          const pos = playerPos as { x?: number; z?: number };
          px = pos.x ?? 0;
          pz = pos.z ?? 0;
        }

        const rockTileX = Math.floor(rockX);
        const rockTileZ = Math.floor(rockZ);
        const cardinalPositions = [
          { x: rockTileX, z: rockTileZ - 1, dir: "South" },
          { x: rockTileX, z: rockTileZ + 1, dir: "North" },
          { x: rockTileX - 1, z: rockTileZ, dir: "West" },
          { x: rockTileX + 1, z: rockTileZ, dir: "East" },
        ];

        let nearestCardinal = cardinalPositions[0];
        let minDist = Infinity;
        for (const pos of cardinalPositions) {
          const dist = Math.sqrt(
            Math.pow(px - pos.x, 2) + Math.pow(pz - pos.z, 2),
          );
          if (dist < minDist) {
            minDist = dist;
            nearestCardinal = pos;
          }
        }

        const targetPos: [number, number, number] = [
          nearestCardinal.x + 0.5,
          rockY,
          nearestCardinal.z + 0.5,
        ];

        await service.executeMove({ target: targetPos, runMode: false });
        await callback?.({
          text: `Walking to ${nearest.entity.name}...`,
          action: "MINE_ROCK",
        });
        return { success: true, text: `Walking to ${nearest.entity.name}` };
      }

      const rock = nearbyRocks[0]?.entity;
      if (!rock) {
        await callback?.({ text: "No rock found nearby.", error: true });
        return { success: false };
      }

      const rockPos = rock.position as
        | [number, number, number]
        | { x: number; y?: number; z: number };

      let rockX = 0,
        rockZ = 0;
      if (Array.isArray(rockPos)) {
        rockX = rockPos[0];
        rockZ = rockPos[2];
      } else {
        rockX = rockPos.x;
        rockZ = rockPos.z;
      }

      let px = 0,
        pz = 0;
      if (Array.isArray(playerPos)) {
        px = playerPos[0];
        pz = playerPos[2];
      } else if (playerPos && typeof playerPos === "object") {
        const pos = playerPos as { x?: number; z?: number };
        px = pos.x ?? 0;
        pz = pos.z ?? 0;
      }

      const rockTileX = Math.floor(rockX);
      const rockTileZ = Math.floor(rockZ);
      const playerTileX = Math.floor(px);
      const playerTileZ = Math.floor(pz);

      const isCardinalAdjacent =
        (playerTileX === rockTileX &&
          Math.abs(playerTileZ - rockTileZ) === 1) ||
        (playerTileZ === rockTileZ && Math.abs(playerTileX - rockTileX) === 1);

      if (!isCardinalAdjacent) {
        const cardinalPositions = [
          { x: rockTileX, z: rockTileZ - 1, dir: "South" },
          { x: rockTileX, z: rockTileZ + 1, dir: "North" },
          { x: rockTileX - 1, z: rockTileZ, dir: "West" },
          { x: rockTileX + 1, z: rockTileZ, dir: "East" },
        ];

        let nearestCardinal = cardinalPositions[0];
        let minDist = Infinity;
        for (const pos of cardinalPositions) {
          const dist = Math.sqrt(
            Math.pow(px - pos.x, 2) + Math.pow(pz - pos.z, 2),
          );
          if (dist < minDist) {
            minDist = dist;
            nearestCardinal = pos;
          }
        }

        const targetPos: [number, number, number] = [
          nearestCardinal.x + 0.5,
          Array.isArray(rockPos) ? rockPos[1] : (rockPos.y ?? 0),
          nearestCardinal.z + 0.5,
        ];

        await service.executeMove({ target: targetPos, runMode: false });
        await callback?.({
          text: `Positioning to mine ${rock.name}...`,
          action: "MINE_ROCK",
        });
        return { success: true, text: `Positioning to mine ${rock.name}` };
      }

      const command: GatherResourceCommand = {
        resourceEntityId: rock.id,
        skill: "mining",
      };
      await service.executeGatherResource(command);

      await callback?.({ text: `Mining ${rock.name}`, action: "MINE_ROCK" });

      return { success: true, text: `Started mining ${rock.name}` };
    } catch (error) {
      await callback?.({
        text: `Failed to mine: ${error instanceof Error ? error.message : ""}`,
        error: true,
      });
      return { success: false, error: error as Error };
    }
  },

  examples: [
    [
      { name: "user", content: { text: "Mine that rock" } },
      {
        name: "agent",
        content: { text: "Mining rock...", action: "MINE_ROCK" },
      },
    ],
  ],
};

export const lightFireAction: Action = {
  name: "LIGHT_FIRE",
  similes: ["FIREMAKING", "MAKE_FIRE", "BURN_LOGS"],
  description: "Light a fire. Requires tinderbox and logs.",

  validate: async (runtime: IAgentRuntime) => {
    const service = runtime.getService<HyperscapeService>("hyperscapeService");
    if (!service) return false;
    const playerEntity = service.getPlayerEntity();

    if (!service.isConnected() || !playerEntity?.alive) return false;

    const hasTinderbox = playerEntity.items.some((i) =>
      i.name.toLowerCase().includes("tinderbox"),
    );
    const hasLogs = playerEntity.items.some((i) =>
      i.name.toLowerCase().includes("logs"),
    );

    return hasTinderbox && hasLogs;
  },

  handler: async (
    runtime: IAgentRuntime,
    _message: Memory,
    _state?: State,
    _options?: HandlerOptionsParam,
    callback?: HandlerCallback,
  ) => {
    try {
      const service =
        runtime.getService<HyperscapeService>("hyperscapeService");
      if (!service) {
        return {
          success: false,
          error: new Error("Hyperscape service not available"),
        };
      }
      const command: GatherResourceCommand = {
        resourceEntityId: "",
        skill: "firemaking",
      };
      await service.executeGatherResource(command);

      await callback?.({ text: "Lighting a fire...", action: "LIGHT_FIRE" });

      return { success: true, text: "Started lighting fire" };
    } catch (error) {
      await callback?.({
        text: `Failed to light fire: ${error instanceof Error ? error.message : ""}`,
        error: true,
      });
      return { success: false, error: error as Error };
    }
  },

  examples: [
    [
      { name: "user", content: { text: "Light a fire" } },
      {
        name: "agent",
        content: { text: "Lighting a fire...", action: "LIGHT_FIRE" },
      },
    ],
  ],
};

export const cookFoodAction: Action = {
  name: "COOK_FOOD",
  similes: ["COOK", "COOKING"],
  description: "Cook raw food. Requires raw food and a fire.",

  validate: async (runtime: IAgentRuntime) => {
    const service = runtime.getService<HyperscapeService>("hyperscapeService");
    if (!service) return false;
    const playerEntity = service.getPlayerEntity();

    if (!service.isConnected() || !playerEntity?.alive) return false;

    const hasRawFood = playerEntity.items.some((i) =>
      i.name.toLowerCase().includes("raw"),
    );

    return hasRawFood;
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: HandlerOptionsParam,
    callback?: HandlerCallback,
  ) => {
    try {
      const service =
        runtime.getService<HyperscapeService>("hyperscapeService");
      if (!service) {
        return {
          success: false,
          error: new Error("Hyperscape service not available"),
        };
      }
      const playerEntity = service.getPlayerEntity();
      const content = message.content.text || "";

      const rawFood = playerEntity?.items.find(
        (i) =>
          i.name.toLowerCase().includes("raw") &&
          i.name.toLowerCase().includes(content.toLowerCase()),
      );

      if (!rawFood) {
        await callback?.({
          text: "No raw food found in inventory.",
          error: true,
        });
        return { success: false };
      }

      const command: GatherResourceCommand = {
        resourceEntityId: rawFood.id,
        skill: "cooking",
      };
      await service.executeGatherResource(command);

      await callback?.({
        text: `Cooking ${rawFood.name}...`,
        action: "COOK_FOOD",
      });

      return { success: true, text: `Cooking ${rawFood.name}` };
    } catch (error) {
      await callback?.({
        text: `Failed to cook: ${error instanceof Error ? error.message : ""}`,
        error: true,
      });
      return { success: false, error: error as Error };
    }
  },

  examples: [
    [
      { name: "user", content: { text: "Cook the raw fish" } },
      {
        name: "agent",
        content: { text: "Cooking Raw Fish...", action: "COOK_FOOD" },
      },
    ],
  ],
};
