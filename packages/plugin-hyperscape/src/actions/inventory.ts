/**
 * Inventory actions - EQUIP_ITEM, USE_ITEM, DROP_ITEM, PICKUP_ITEM
 */

import type {
  Action,
  IAgentRuntime,
  Memory,
  State,
  HandlerCallback,
} from "@elizaos/core";
import { logger } from "@elizaos/core";
import type { HyperscapeService } from "../services/HyperscapeService.js";
import type {
  EquipItemCommand,
  UseItemCommand,
  Equipment,
  Entity,
} from "../types.js";

// Max distance to pick up items
const MAX_PICKUP_DISTANCE = 4;

// Max items to drop in a single "drop all" operation (prevents memory leak / DoS)
const MAX_DROP_ALL_ITEMS = 50;

// Delay between drops in milliseconds
const DROP_DELAY_MS = 150;

/**
 * Calculate 2D distance between player and entity
 */
function getEntityDistance(
  playerPos: unknown,
  entityPos: unknown,
): number | null {
  let px: number, pz: number;
  if (Array.isArray(playerPos) && playerPos.length >= 3) {
    px = playerPos[0];
    pz = playerPos[2];
  } else if (playerPos && typeof playerPos === "object" && "x" in playerPos) {
    const pos = playerPos as { x: number; z: number };
    px = pos.x;
    pz = pos.z;
  } else {
    return null;
  }

  let ex: number, ez: number;
  if (Array.isArray(entityPos) && entityPos.length >= 3) {
    ex = entityPos[0];
    ez = entityPos[2];
  } else if (entityPos && typeof entityPos === "object" && "x" in entityPos) {
    const pos = entityPos as { x: number; z: number };
    ex = pos.x;
    ez = pos.z;
  } else {
    return null;
  }

  const dx = px - ex;
  const dz = pz - ez;
  return Math.sqrt(dx * dx + dz * dz);
}

/**
 * Check if an entity is a ground item
 */
function isGroundItem(e: Entity): boolean {
  const entityAny = e as unknown as Record<string, unknown>;
  const entityType = (entityAny.type as string)?.toLowerCase() || "";
  return entityType === "item" || entityType === "grounditem";
}

export const equipItemAction: Action = {
  name: "EQUIP_ITEM",
  similes: ["EQUIP", "WIELD", "WEAR"],
  description: "Equip a weapon or armor from inventory.",

  validate: async (runtime: IAgentRuntime) => {
    const service = runtime.getService<HyperscapeService>("hyperscapeService");
    if (!service) return false;
    const playerEntity = service.getPlayerEntity();

    return service.isConnected() && (playerEntity?.items.length ?? 0) > 0;
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: unknown,
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

      const item = playerEntity?.items.find((i) =>
        i.name.toLowerCase().includes(content.toLowerCase()),
      );

      if (!item) {
        await callback?.({ text: "Item not found in inventory.", error: true });
        return { success: false };
      }

      // Determine equip slot based on item name
      let equipSlot: keyof Equipment = "weapon";
      if (item.name.toLowerCase().includes("shield")) equipSlot = "shield";
      else if (item.name.toLowerCase().includes("helmet")) equipSlot = "helmet";
      else if (
        item.name.toLowerCase().includes("body") ||
        item.name.toLowerCase().includes("platebody")
      )
        equipSlot = "body";
      else if (item.name.toLowerCase().includes("legs")) equipSlot = "legs";
      else if (item.name.toLowerCase().includes("boots")) equipSlot = "boots";

      const command: EquipItemCommand = { itemId: item.id, equipSlot };
      await service.executeEquipItem(command);

      await callback?.({ text: `Equipped ${item.name}`, action: "EQUIP_ITEM" });

      return { success: true, text: `Equipped ${item.name}` };
    } catch (error) {
      await callback?.({
        text: `Failed to equip: ${error instanceof Error ? error.message : ""}`,
        error: true,
      });
      return { success: false, error: error as Error };
    }
  },

  examples: [
    [
      { name: "user", content: { text: "Equip bronze sword" } },
      {
        name: "agent",
        content: { text: "Equipped Bronze Sword", action: "EQUIP_ITEM" },
      },
    ],
  ],
};

export const useItemAction: Action = {
  name: "USE_ITEM",
  similes: ["EAT", "DRINK", "CONSUME"],
  description: "Use an item from inventory (eat food, drink potion, etc.).",

  validate: async (runtime: IAgentRuntime) => {
    const service = runtime.getService<HyperscapeService>("hyperscapeService");
    if (!service) return false;
    const playerEntity = service.getPlayerEntity();

    return service.isConnected() && (playerEntity?.items.length ?? 0) > 0;
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: unknown,
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

      const item = playerEntity?.items.find((i) =>
        i.name.toLowerCase().includes(content.toLowerCase()),
      );

      if (!item) {
        await callback?.({ text: "Item not found in inventory.", error: true });
        return { success: false };
      }

      const command: UseItemCommand = { itemId: item.id };
      await service.executeUseItem(command);

      await callback?.({ text: `Used ${item.name}`, action: "USE_ITEM" });

      return { success: true, text: `Used ${item.name}` };
    } catch (error) {
      await callback?.({
        text: `Failed to use item: ${error instanceof Error ? error.message : ""}`,
        error: true,
      });
      return { success: false, error: error as Error };
    }
  },

  examples: [
    [
      { name: "user", content: { text: "Eat the bread" } },
      { name: "agent", content: { text: "Used Bread", action: "USE_ITEM" } },
    ],
  ],
};

export const dropItemAction: Action = {
  name: "DROP_ITEM",
  similes: ["DROP", "DISCARD", "THROW_AWAY", "TRASH", "REMOVE"],
  description: "Drop an item from inventory onto the ground.",

  validate: async (runtime: IAgentRuntime) => {
    const service = runtime.getService<HyperscapeService>("hyperscapeService");
    if (!service) {
      logger.debug("[DROP_ITEM] Validation failed: no service");
      return false;
    }

    if (!service.isConnected()) {
      logger.debug("[DROP_ITEM] Validation failed: not connected");
      return false;
    }

    const playerEntity = service.getPlayerEntity();
    if (!playerEntity || playerEntity.alive === false) {
      logger.debug("[DROP_ITEM] Validation failed: player not alive");
      return false;
    }

    const hasItems = (playerEntity.items?.length ?? 0) > 0;
    logger.info(
      `[DROP_ITEM] Validation: ${playerEntity.items?.length ?? 0} items in inventory`,
    );
    return hasItems;
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: unknown,
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
      const content = (message.content.text || "").toLowerCase();

      if (!playerEntity?.items || playerEntity.items.length === 0) {
        await callback?.({
          text: "No items in inventory to drop.",
          error: true,
        });
        return { success: false };
      }

      // Helper to get item name - server sends items with nested `item` property
      // Structure: { slot, itemId, quantity, item: { id, name, type, ... } }
      const getItemName = (i: unknown): string | null => {
        const slot = i as Record<string, unknown>;
        // Check for nested item.name (server format)
        if (slot.item && typeof slot.item === "object") {
          const itemDef = slot.item as Record<string, unknown>;
          if (itemDef.name && typeof itemDef.name === "string") {
            return itemDef.name;
          }
        }
        // Check for direct name (legacy format)
        if (slot.name && typeof slot.name === "string") {
          return slot.name;
        }
        return null;
      };

      // Helper to get item ID
      const getItemId = (i: unknown): string | null => {
        const slot = i as Record<string, unknown>;
        // Check for itemId (server format)
        if (slot.itemId && typeof slot.itemId === "string") {
          return slot.itemId;
        }
        // Check for direct id (legacy format)
        if (slot.id && typeof slot.id === "string") {
          return slot.id;
        }
        return null;
      };

      // Helper to get item quantity
      const getItemQuantity = (i: unknown): number => {
        const slotData = i as Record<string, unknown>;
        if (typeof slotData.quantity === "number") {
          return slotData.quantity;
        }
        return 1;
      };

      // Helper to get inventory slot number (needed for dropping specific instances of same item)
      const getItemSlot = (i: unknown): number | undefined => {
        const slotData = i as Record<string, unknown>;
        if (typeof slotData.slot === "number") {
          return slotData.slot;
        }
        return undefined;
      };

      // Filter out items without names
      const validItems = playerEntity.items.filter((i) => i && getItemName(i));

      logger.info(
        `[DROP_ITEM] Found ${validItems.length} valid items with names out of ${playerEntity.items.length} total`,
      );

      if (validItems.length === 0) {
        // Log the first item's structure for debugging
        if (playerEntity.items.length > 0) {
          logger.info(
            `[DROP_ITEM] First item structure: ${JSON.stringify(playerEntity.items[0])}`,
          );
        }
        await callback?.({
          text: "No valid items in inventory to drop.",
          error: true,
        });
        return { success: false };
      }

      // Helper to escape regex special characters for word boundary matching
      const escapeRegexDrop = (str: string) =>
        str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

      // Check if user wants to drop ALL items
      const isDropAll =
        content.includes("all") ||
        content.includes("everything") ||
        content.includes("every item");

      // Check if it's "drop all <item type>" vs "drop all items/everything"
      const isDropAllOfType =
        isDropAll &&
        !content.includes("items") &&
        !content.includes("everything") &&
        !content.includes("every item") &&
        !content.includes("inventory");

      if (isDropAll) {
        let itemsToDrop: unknown[];

        if (isDropAllOfType) {
          // "drop all logs" - find all items matching a specific type
          // Uses word boundary matching to prevent false matches
          itemsToDrop = validItems.filter((i) => {
            const itemName = getItemName(i)?.toLowerCase();
            if (!itemName) return false;
            // Check if message contains the item name (with word boundaries)
            const nameRegex = new RegExp(
              `\\b${escapeRegexDrop(itemName)}\\b`,
              "i",
            );
            if (nameRegex.test(content)) return true;
            // Also check individual words from item name
            const itemWords = itemName.split(/\s+/);
            return itemWords.some((word) => {
              if (word.length <= 3) return false;
              const wordRegex = new RegExp(
                `\\b${escapeRegexDrop(word)}\\b`,
                "i",
              );
              return wordRegex.test(content);
            });
          });

          if (itemsToDrop.length === 0) {
            const itemList = validItems
              .map((i) => getItemName(i))
              .filter(Boolean)
              .join(", ");
            await callback?.({
              text: `No matching items found. Available: ${itemList}`,
              error: true,
            });
            return { success: false };
          }
        } else {
          // "drop all items" / "drop everything" - drop ALL items
          itemsToDrop = validItems;
        }

        // Limit items to prevent memory leak / DoS
        const limitedItems = itemsToDrop.slice(0, MAX_DROP_ALL_ITEMS);
        const wasLimited = itemsToDrop.length > MAX_DROP_ALL_ITEMS;

        logger.info(
          `[DROP_ITEM] Dropping ${limitedItems.length} items (drop all)${wasLimited ? ` - limited from ${itemsToDrop.length}` : ""}`,
        );

        const droppedNames: string[] = [];
        let failedCount = 0;
        const MAX_CONSECUTIVE_FAILURES = 3; // Stop if too many failures in a row
        let consecutiveFailures = 0;

        for (const item of limitedItems) {
          // Early termination on too many consecutive failures
          if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
            logger.warn(
              `[DROP_ITEM] Stopping drop-all after ${MAX_CONSECUTIVE_FAILURES} consecutive failures`,
            );
            break;
          }

          const itemId = getItemId(item);
          const itemName = getItemName(item);
          const quantity = getItemQuantity(item);
          const slot = getItemSlot(item);

          if (itemId) {
            try {
              logger.info(
                `[DROP_ITEM] Dropping ${itemName} (id=${itemId}, qty=${quantity}, slot=${slot})`,
              );
              await service.executeDropItem(itemId, quantity, slot);
              droppedNames.push(itemName || itemId);
              consecutiveFailures = 0; // Reset on success
            } catch (dropError) {
              logger.warn(
                `[DROP_ITEM] Failed to drop ${itemName}: ${dropError instanceof Error ? dropError.message : String(dropError)}`,
              );
              failedCount++;
              consecutiveFailures++;
            }
            // Small delay between drops to avoid server issues
            await new Promise((resolve) => setTimeout(resolve, DROP_DELAY_MS));
          }
        }

        let summary =
          droppedNames.length <= 3
            ? droppedNames.join(", ")
            : `${droppedNames.length} items`;

        // Add info about failures or limiting
        if (failedCount > 0) {
          summary += ` (${failedCount} failed)`;
        }
        if (wasLimited) {
          summary += ` (limited to ${MAX_DROP_ALL_ITEMS})`;
        }

        await callback?.({ text: `Dropped ${summary}`, action: "DROP_ITEM" });
        logger.info(
          `[DROP_ITEM] Dropped ${droppedNames.length} items, ${failedCount} failed: ${droppedNames.join(", ")}`,
        );

        return { success: true, text: `Dropped ${summary}` };
      }

      // Single item drop - try to find item matching the user's description
      // Uses word boundary matching to prevent false matches
      const matchedItem = validItems.find((i) => {
        const itemName = getItemName(i)?.toLowerCase();
        if (!itemName) return false;
        // Check if message contains the item name (with word boundaries)
        const nameRegex = new RegExp(`\\b${escapeRegexDrop(itemName)}\\b`, "i");
        if (nameRegex.test(content)) return true;
        // Also check individual words from item name (e.g., "hatchet" from "Bronze Hatchet")
        const itemWords = itemName.split(/\s+/);
        return itemWords.some((word) => {
          if (word.length <= 3) return false;
          const wordRegex = new RegExp(`\\b${escapeRegexDrop(word)}\\b`, "i");
          return wordRegex.test(content);
        });
      });

      if (!matchedItem) {
        // List available items for the user
        const itemList = validItems
          .map((i) => getItemName(i))
          .filter(Boolean)
          .join(", ");
        await callback?.({
          text: `Item not found in inventory. Available items: ${itemList}`,
          error: true,
        });
        return { success: false };
      }

      const itemId = getItemId(matchedItem);
      const itemName = getItemName(matchedItem);
      const slot = getItemSlot(matchedItem);

      if (!itemId) {
        await callback?.({ text: "Could not get item ID.", error: true });
        return { success: false };
      }

      logger.info(
        `[DROP_ITEM] Dropping item: ${itemName} (id=${itemId}, slot=${slot})`,
      );

      await service.executeDropItem(itemId, 1, slot);

      await callback?.({ text: `Dropped ${itemName}`, action: "DROP_ITEM" });

      logger.info(`[DROP_ITEM] Dropped ${itemName}`);

      return { success: true, text: `Dropped ${itemName}` };
    } catch (error) {
      logger.error(
        `[DROP_ITEM] Error: ${error instanceof Error ? error.message : error}`,
      );
      await callback?.({
        text: `Failed to drop: ${error instanceof Error ? error.message : ""}`,
        error: true,
      });
      return { success: false, error: error as Error };
    }
  },

  examples: [
    [
      { name: "user", content: { text: "Drop the bronze hatchet" } },
      {
        name: "agent",
        content: { text: "Dropped Bronze Hatchet", action: "DROP_ITEM" },
      },
    ],
    [
      { name: "user", content: { text: "Discard the junk" } },
      { name: "agent", content: { text: "Dropped Junk", action: "DROP_ITEM" } },
    ],
    [
      { name: "user", content: { text: "Drop all logs" } },
      {
        name: "agent",
        content: { text: "Dropped Logs, Logs, Logs", action: "DROP_ITEM" },
      },
    ],
    [
      { name: "user", content: { text: "Drop everything" } },
      {
        name: "agent",
        content: { text: "Dropped 10 items", action: "DROP_ITEM" },
      },
    ],
    [
      { name: "user", content: { text: "Drop all items" } },
      {
        name: "agent",
        content: { text: "Dropped 5 items", action: "DROP_ITEM" },
      },
    ],
  ],
};

/**
 * PICKUP_ITEM - Pick up an item from the ground
 */
export const pickupItemAction: Action = {
  name: "PICKUP_ITEM",
  similes: ["PICKUP", "PICK_UP", "GRAB", "TAKE", "LOOT", "GET"],
  description: "Pick up an item from the ground nearby.",

  validate: async (runtime: IAgentRuntime) => {
    const service = runtime.getService<HyperscapeService>("hyperscapeService");
    if (!service) {
      logger.debug("[PICKUP_ITEM] Validation failed: no service");
      return false;
    }

    if (!service.isConnected()) {
      logger.debug("[PICKUP_ITEM] Validation failed: not connected");
      return false;
    }

    const player = service.getPlayerEntity();
    if (!player || player.alive === false) {
      logger.debug("[PICKUP_ITEM] Validation failed: player not alive");
      return false;
    }

    // Check for ground items within approach range (20m)
    const entities = service.getNearbyEntities() || [];
    const playerPos = player.position;
    const groundItems = entities.filter((e) => {
      if (!isGroundItem(e)) return false;
      const entityAny = e as unknown as Record<string, unknown>;
      const entityPos = entityAny.position;
      if (!entityPos) return false;
      const dist = getEntityDistance(playerPos, entityPos);
      return dist !== null && dist <= 20;
    });

    logger.info(
      `[PICKUP_ITEM] Validation: ${groundItems.length} ground items within 20m`,
    );

    return groundItems.length > 0;
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: unknown,
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

      const entities = service.getNearbyEntities() || [];
      const player = service.getPlayerEntity();
      const playerPos = player?.position;
      const content = (message.content.text || "").toLowerCase();

      // Find all ground items
      const groundItems = entities.filter(isGroundItem);

      // Get items with distance, sorted by nearest
      const itemsWithDistance = groundItems
        .map((e) => {
          const entityAny = e as unknown as Record<string, unknown>;
          const entityPos = entityAny.position;
          const dist = entityPos
            ? getEntityDistance(playerPos, entityPos)
            : null;
          return { entity: e, distance: dist, position: entityPos };
        })
        .filter((t) => t.distance !== null)
        .sort((a, b) => (a.distance ?? 999) - (b.distance ?? 999));

      // Try to find item matching the user's description using a scoring system
      // Higher score = better match. We prioritize items that match more words from the user's request
      // Uses word boundary checks to prevent false matches (e.g., "log" in "dialogue")
      const scoreItem = (item: { entity: Entity }) => {
        const itemName = item.entity.name.toLowerCase();
        const itemWords = itemName.split(/\s+/);
        const contentWords = content.split(/\s+/).filter((w) => w.length > 2);

        // Perfect match - item name is exactly in the content (with word boundaries)
        const exactNameRegex = new RegExp(
          `\\b${escapeRegex(itemName)}\\b`,
          "i",
        );
        if (exactNameRegex.test(content)) return 100;

        // Score based on how many item words are in the content
        let score = 0;
        for (const itemWord of itemWords) {
          if (itemWord.length <= 3) continue; // Skip short words like "of", "the"

          // Word boundary check - prevents "log" matching in "dialogue"
          const wordBoundaryRegex = new RegExp(
            `\\b${escapeRegex(itemWord)}\\b`,
            "i",
          );
          if (wordBoundaryRegex.test(content)) {
            score += 10; // Each matching word adds 10 points
          }

          // Also check if any content word matches (exact word match)
          for (const contentWord of contentWords) {
            if (contentWord === itemWord) {
              score += 5; // Exact word match bonus
            }
          }
        }

        return score;
      };

      // Helper to escape regex special characters
      const escapeRegex = (str: string) =>
        str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

      // Score all items and find the best match
      const scoredItems = itemsWithDistance.map((item) => ({
        ...item,
        score: scoreItem(item),
      }));

      // Sort by score (highest first), then by distance (nearest first)
      scoredItems.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return (a.distance ?? 999) - (b.distance ?? 999);
      });

      // Get the best matching item (score > 0 means at least one word matched)
      let targetItem = scoredItems.find((item) => item.score > 0);

      // If no match by name, pick the nearest item
      if (!targetItem && scoredItems.length > 0) {
        targetItem = scoredItems[0];
        logger.info(
          `[PICKUP_ITEM] No item matching in "${content}", picking nearest: ${targetItem.entity.name}`,
        );
      }

      // Log the matching for debugging
      if (targetItem && targetItem.score > 0) {
        logger.info(
          `[PICKUP_ITEM] Best match: "${targetItem.entity.name}" (score=${targetItem.score}) for request "${content}"`,
        );
      }

      if (!targetItem) {
        await callback?.({
          text: "No items found nearby to pick up.",
          error: true,
        });
        return { success: false };
      }

      const item = targetItem.entity;
      const itemDistance = targetItem.distance ?? 0;

      logger.info(
        `[PICKUP_ITEM] Found item: ${item.name} (${item.id}) at distance ${itemDistance.toFixed(1)}m`,
      );

      // If too far, walk to it first
      if (itemDistance > MAX_PICKUP_DISTANCE) {
        const itemPos = targetItem.position as
          | [number, number, number]
          | { x: number; y: number; z: number };

        let itemX: number, itemY: number, itemZ: number;
        if (Array.isArray(itemPos)) {
          [itemX, itemY, itemZ] = itemPos as [number, number, number];
        } else if (itemPos && typeof itemPos === "object" && "x" in itemPos) {
          itemX = itemPos.x;
          itemY = itemPos.y;
          itemZ = itemPos.z;
        } else {
          await callback?.({
            text: "Could not locate item position.",
            error: true,
          });
          return { success: false };
        }

        // Max move distance allowed by server (200 tiles, use 150 for safety)
        const MAX_MOVE_DISTANCE = 150;

        let targetPos: [number, number, number];
        let responseText: string;

        if (itemDistance > MAX_MOVE_DISTANCE) {
          // Move in steps - calculate intermediate waypoint
          let px: number, pz: number;
          if (Array.isArray(playerPos) && playerPos.length >= 3) {
            px = playerPos[0];
            pz = playerPos[2];
          } else if (
            playerPos &&
            typeof playerPos === "object" &&
            "x" in playerPos
          ) {
            const pos = playerPos as unknown as { x: number; z: number };
            px = pos.x;
            pz = pos.z;
          } else {
            await callback?.({
              text: "Could not get player position.",
              error: true,
            });
            return { success: false };
          }

          const dx = itemX - px;
          const dz = itemZ - pz;
          const ratio = MAX_MOVE_DISTANCE / itemDistance;
          const stepX = px + dx * ratio;
          const stepZ = pz + dz * ratio;

          targetPos = [stepX, itemY, stepZ];
          responseText = `Walking towards ${item.name} (${Math.round(itemDistance - MAX_MOVE_DISTANCE)}m remaining)...`;

          logger.info(
            `[PICKUP_ITEM] Distance ${itemDistance.toFixed(0)}m exceeds max ${MAX_MOVE_DISTANCE}, moving to intermediate point`,
          );
        } else {
          targetPos = [itemX, itemY, itemZ];
          responseText = `Walking to pick up ${item.name}...`;
        }

        logger.info(
          `[PICKUP_ITEM] Walking to ${item.name} at ${JSON.stringify(targetPos)}`,
        );

        await service.executeMove({ target: targetPos, runMode: false });
        await callback?.({
          text: responseText,
          action: "PICKUP_ITEM",
        });
        return { success: true, text: responseText };
      }

      // Close enough - pick it up
      await service.executePickupItem(item.id);

      await callback?.({
        text: `Picked up ${item.name}`,
        action: "PICKUP_ITEM",
      });

      logger.info(`[PICKUP_ITEM] Picked up ${item.name}`);

      return { success: true, text: `Picked up ${item.name}` };
    } catch (error) {
      logger.error(
        `[PICKUP_ITEM] Error: ${error instanceof Error ? error.message : error}`,
      );
      await callback?.({
        text: `Failed to pick up: ${error instanceof Error ? error.message : ""}`,
        error: true,
      });
      return { success: false, error: error as Error };
    }
  },

  examples: [
    [
      { name: "user", content: { text: "Pick up the bronze hatchet" } },
      {
        name: "agent",
        content: { text: "Picked up Bronze Hatchet", action: "PICKUP_ITEM" },
      },
    ],
    [
      { name: "user", content: { text: "Grab that sword" } },
      {
        name: "agent",
        content: {
          text: "Walking to pick up Bronze Sword...",
          action: "PICKUP_ITEM",
        },
      },
    ],
    [
      { name: "user", content: { text: "Loot the coins" } },
      {
        name: "agent",
        content: { text: "Picked up Coins", action: "PICKUP_ITEM" },
      },
    ],
  ],
};
