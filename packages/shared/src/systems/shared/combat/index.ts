/**
 * Combat Systems
 * Combat mechanics, aggro management, and death handling
 */

export * from "./CombatSystem";
export * from "./AggroSystem";
export * from "./PlayerDeathSystem";
export * from "./MobDeathSystem";

// Modular combat services (extracted from CombatSystem)
export * from "./CombatStateService";
export * from "./CombatAnimationManager";
export * from "./CombatRotationManager";
export * from "./CombatAnimationSync";

// Anti-cheat monitoring (Phase 6 - Game Studio Hardening)
export * from "./CombatAntiCheat";

// OSRS-accurate range calculations
export * from "./RangeSystem";

// Combat replay and debugging (Phase 7 - EventStore Integration)
export * from "./CombatReplayService";

// NOTE: CombatRequestValidator is SERVER-ONLY (uses Node.js crypto)
// Import directly: import { CombatRequestValidator } from "@hyperscape/shared/systems/shared/combat/CombatRequestValidator"
