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

// Phase 4: Split Processing Systems (SRP)
// These can be used instead of ProcessingSystem when more granular control is needed
export * from "./ProcessingSystemBase";
export * from "./FiremakingSystem";
export * from "./CookingSystem";
