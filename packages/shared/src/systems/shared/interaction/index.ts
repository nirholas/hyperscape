/**
 * Interaction Systems
 * Player-world interactions, inventory actions, crafting, and physics
 *
 * NOTE: The main InteractionRouter is exported from systems/client/interaction/
 */

export * from "./InventoryInteractionSystem";
export * from "./ProcessingSystem";
export * from "./Physics";
export * from "./DialogueSystem";

// Item Targeting System (for "Use X on Y" interactions)
export * from "./ItemTargetingSystem";
export * from "./TargetValidator";

// Split Processing Systems (SRP)
// These can be used instead of ProcessingSystem when more granular control is needed
export * from "./ProcessingSystemBase";
export * from "./FiremakingSystem";
export * from "./CookingSystem";

// Smithing skill systems (furnace smelting, anvil smithing)
export * from "./SmeltingSystem";
export * from "./SmithingSystem";

// Crafting skill system (leather, jewelry, gem cutting)
export * from "./CraftingSystem";

// Fletching skill system (knife + logs, stringing, arrow tipping)
export * from "./FletchingSystem";

// Tanning system (NPC tanner: hides → leather)
export * from "./TanningSystem";

// Runecrafting skill system (essence + altar → runes)
export * from "./RunecraftingSystem";
