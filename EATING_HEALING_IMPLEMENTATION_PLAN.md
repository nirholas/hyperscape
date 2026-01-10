# Eating for Healing - OSRS-Accurate Implementation Plan

---

## Technical Audit (Pre-Implementation)

### Current Rating: 5.5/10 - Major Issues Identified

| Criterion | Current Score | Issues |
|-----------|---------------|--------|
| **Production Quality** | 6/10 | No input validation, duplicate event emission, no tests |
| **OWASP Security** | 5/10 | No rate limiting, no slot bounds checking, trusts client data |
| **Game Studio/Anti-Cheat** | 4/10 | No server-side ownership verification, broken event handler |
| **Memory/Allocation** | 8/10 | Good use of pre-allocated temp vectors, minimal GC pressure |
| **SOLID Principles** | 6/10 | SRP violation (PlayerSystem too large), DIP violation |

### Critical Vulnerabilities Found

1. **Broken Event Chain**: `INVENTORY_CONSUME_ITEM` event has NO subscriber
2. **Missing Client UI**: No "Eat" option in inventory context menu
3. **No Rate Limiting**: Players can spam eat requests (macro/bot vulnerability)
4. **No Server Authority**: `useItem()` doesn't verify `world.isServer`
5. **Duplicate Events**: `handleItemUsed()` emits `PLAYER_HEALTH_UPDATED` twice
6. **No Input Validation**: No bounds checking on slot, no itemId sanitization

### Target: 9/10 Production Ready

This plan includes all fixes to achieve production-ready code.

---

## Research Summary

### OSRS Eating Mechanics (from OSRS Wiki)

#### Core Mechanics
| Mechanic | OSRS Value | Description |
|----------|------------|-------------|
| **Eat Delay** | 3 ticks (1.8s) | Time before player can eat again after eating |
| **Attack Delay** | 3 ticks (1.8s) | Added to weapon cooldown when eating during combat |
| **Tick Duration** | 600ms | One game tick = 0.6 seconds |
| **Healing** | Instant | Health is restored immediately when food is consumed |

#### Key Behaviors
1. **Eat Delay**: After eating, player cannot eat again for 3 ticks (1.8 seconds)
2. **Attack Delay**: If player eats while waiting to attack, an additional 3-tick delay is added to their next attack
3. **No Attack Delay If Ready**: If weapon is ready to attack (not on cooldown), eating does NOT add attack delay
4. **Potions**: Do NOT incur eat or attack delays (future consideration)
5. **Fast Foods**: Some foods have 2-tick delays instead of 3 (future consideration)
6. **Combo Eating**: Certain foods can be eaten together in one tick (future consideration)

#### Sources
- [Food - OSRS Wiki](https://oldschool.runescape.wiki/w/Food)
- [Food/Fast foods - OSRS Wiki](https://oldschool.runescape.wiki/w/Food/Fast_foods)
- [Tick eating - OSRS Wiki](https://oldschool.runescape.wiki/w/Tick_eating)

---

## Current Implementation Analysis

### What Exists
| Component | File | Status |
|-----------|------|--------|
| Food manifest with `healAmount` | `server/world/assets/manifests/items/food.json` | ✅ Complete |
| `healPlayer()` method | `PlayerSystem.ts:906-927` | ✅ Works |
| `handleItemUsed()` for food | `PlayerSystem.ts:929-964` | ✅ Basic healing works |
| Tick-based timing system | `CombatConstants.ts:19` | ✅ `TICK_DURATION_MS: 600` |
| Health capped at max | `PlayerSystem.ts:912` | ✅ Cannot overheal |
| "Eat" action registered | `InventoryInteractionSystem.ts:1066-1078` | ⚠️ Exists but broken |

### ⚠️ CRITICAL BUG: Eating is Currently BROKEN!

**Root Cause Analysis:**

1. **No "Eat" option in client UI**: `InventoryPanel.tsx:276-286` has a **hardcoded** context menu with only: "Use", "Equip", "Drop", "Examine". Food items do NOT show an "Eat" option!

2. **Event handler not connected**: The "Eat" action in `InventoryInteractionSystem.ts:1072` emits `INVENTORY_CONSUME_ITEM`, but **NOTHING subscribes to this event**.

3. **Working path exists but is inaccessible**:
   - `INVENTORY_USE` → `InventorySystem.useItem()` → `ITEM_USED` → `PlayerSystem.handleItemUsed()` → `healPlayer()` ✅
   - But the client never emits `INVENTORY_USE` for food items

**Event Flow Diagram:**
```
BROKEN PATH (current "Eat" action):
  "Eat" clicked → INVENTORY_CONSUME_ITEM → ??? (no subscriber!) → ❌ Nothing happens

WORKING PATH (if we could trigger it):
  INVENTORY_USE → InventorySystem.useItem() → ITEM_USED → PlayerSystem.handleItemUsed() → healPlayer() ✅
```

### What's Missing
| Feature | Priority | Impact |
|---------|----------|--------|
| **"Eat" option in context menu** | **CRITICAL** | Eating doesn't work at all! |
| **Fix INVENTORY_CONSUME_ITEM** | **CRITICAL** | Event has no handler |
| 3-tick eat delay between foods | **HIGH** | Prevents spam eating |
| 3-tick attack delay when eating in combat | **HIGH** | Combat balance |
| "You are already eating" rejection message | MEDIUM | UX feedback |
| Proper OSRS chat message format | LOW | Polish |
| Animation/emote while eating | LOW | Visual feedback |

---

## Implementation Plan

### Phase 0: Fix Broken Eating Mechanism (PREREQUISITE)

⚠️ **This phase must be completed first - eating doesn't work at all currently!**

#### 0.1 Fix the "Eat" Action Callback (Recommended Approach)
**File:** `packages/shared/src/systems/shared/interaction/InventoryInteractionSystem.ts`

Change the "eat" action callback to emit `INVENTORY_USE` instead of the broken `INVENTORY_CONSUME_ITEM`:

```typescript
// BEFORE (broken - INVENTORY_CONSUME_ITEM has no subscriber):
callback: (playerId: string, itemId: string, slot: number | null) => {
  this.emitTypedEvent(EventType.INVENTORY_CONSUME_ITEM, {
    playerId: playerId,
    itemId: itemId,
    slot: slot,
  });
}

// AFTER (working - reuses existing INVENTORY_USE → useItem() → ITEM_USED pipeline):
callback: (playerId: string, itemId: string, slot: number | null) => {
  // Validate slot is within bounds (OWASP: Input Validation)
  const validSlot = slot !== null && slot >= 0 && slot < INPUT_LIMITS.MAX_INVENTORY_SLOTS
    ? slot
    : 0;

  this.emitTypedEvent(EventType.INVENTORY_USE, {
    playerId,
    itemId,
    slot: validSlot,
  });
}
```

**Why Option A over Option B:**
- **DRY Principle**: Reuses existing `useItem()` logic instead of duplicating it
- **Single Responsibility**: `InventorySystem.useItem()` already handles item consumption correctly
- **Less Code**: No new subscriber needed, just route to existing handler

#### 0.2 Add "Eat" to Client Context Menu
**File:** `packages/client/src/game/panels/InventoryPanel.tsx`

The context menu (lines 276-286) is hardcoded. Add food detection:

```typescript
// Import at top of file
import { getItem } from "@hyperscape/shared";

// Inside onContextMenu handler, after isUsable check (~line 274):
const itemData = getItem(item.itemId);
const isEdible = itemData?.type === "consumable" &&
                 itemData?.healAmount !== undefined &&
                 itemData.healAmount > 0;

// Add "Eat" as FIRST option in the items array (OSRS: Eat is always first for food)
const items = [
  // "Eat" appears first for food items (OSRS-style)
  ...(isEdible
    ? [{ id: "eat", label: `Eat`, enabled: true }]  // OSRS: Just "Eat", not "Eat item_name"
    : []),
  // ... rest of existing options
];
```

#### 0.3 Wire Up Context Menu Action Handler
**File:** `packages/client/src/game/CoreUI.tsx` or wherever context menu actions are handled

Ensure "eat" action emits the correct event:

```typescript
// When context menu action is selected:
if (action.id === "eat") {
  world.emit(EventType.ITEM_ACTION_SELECTED, {
    playerId: localPlayer.id,
    actionId: "eat",
    itemId: contextMenu.target.name, // item.itemId from context
    slot: parseInt(contextMenu.target.id.replace("inventory_slot_", "")),
  });
}
```

#### 0.4 Add Server-Side Guard to useItem()
**File:** `packages/shared/src/systems/shared/character/InventorySystem.ts`

Add server authority check (follows pattern from `pickupItem()`):

```typescript
private useItem(data: {
  playerId: string;
  itemId: string;
  slot: number;
}): void {
  // SERVER-SIDE ONLY: Prevent duplication by ensuring only server processes use
  if (!this.world.isServer) {
    return; // Client just sent the request, don't process locally
  }

  // ... rest of existing implementation
}
```

---

### Phase 1: Add Eat Delay System (Server-Side)

#### 1.1 Add Constants
**File:** `packages/shared/src/constants/CombatConstants.ts`

```typescript
// Add to COMBAT_CONSTANTS (after existing timing constants)

// === Food Consumption (OSRS-accurate) ===
/** Ticks before player can eat again after eating */
EAT_DELAY_TICKS: 3,
/** Ticks added to attack cooldown when eating during combat */
EAT_ATTACK_DELAY_TICKS: 3,
```

**Also add to `interaction.ts` INPUT_LIMITS:**
```typescript
/** Maximum heal amount (prevents exploit with modified manifests) */
MAX_HEAL_AMOUNT: 99,
/** Minimum valid slot index */
MIN_SLOT: 0,
```

#### 1.2 Create EatDelayManager (SOLID: Single Responsibility)
**New File:** `packages/shared/src/systems/shared/character/EatDelayManager.ts`

Extract eating delay logic into a focused class:

```typescript
/**
 * EatDelayManager - Manages eating cooldowns per player
 *
 * Single Responsibility: Track and enforce eat delay timing
 * Memory: Uses Map with automatic cleanup on player disconnect
 */
import { COMBAT_CONSTANTS } from "../../../constants/CombatConstants";

export class EatDelayManager {
  /** Map of playerId → last eat tick */
  private lastEatTick = new Map<string, number>();

  /**
   * Check if player can eat (not on cooldown)
   * @returns true if player can eat, false if still on cooldown
   */
  canEat(playerId: string, currentTick: number): boolean {
    const lastTick = this.lastEatTick.get(playerId) ?? 0;
    return currentTick - lastTick >= COMBAT_CONSTANTS.EAT_DELAY_TICKS;
  }

  /**
   * Get remaining cooldown ticks
   * @returns 0 if ready to eat, otherwise ticks remaining
   */
  getRemainingCooldown(playerId: string, currentTick: number): number {
    const lastTick = this.lastEatTick.get(playerId) ?? 0;
    const elapsed = currentTick - lastTick;
    return Math.max(0, COMBAT_CONSTANTS.EAT_DELAY_TICKS - elapsed);
  }

  /**
   * Record that player just ate
   */
  recordEat(playerId: string, currentTick: number): void {
    this.lastEatTick.set(playerId, currentTick);
  }

  /**
   * Clear player's eat cooldown (on death, disconnect)
   */
  clearPlayer(playerId: string): void {
    this.lastEatTick.delete(playerId);
  }

  /**
   * Clear all state (for testing)
   */
  clear(): void {
    this.lastEatTick.clear();
  }
}
```

#### 1.3 Modify handleItemUsed with Validation & Rate Limiting
**File:** `packages/shared/src/systems/shared/character/PlayerSystem.ts`

**Add imports:**
```typescript
import { EatDelayManager } from "./EatDelayManager";
import { COMBAT_CONSTANTS } from "../../../constants/CombatConstants";
import { INPUT_LIMITS } from "../../../constants/interaction";
```

**Add class property:**
```typescript
private eatDelayManager = new EatDelayManager();
```

**Replace handleItemUsed with validated version:**
```typescript
private handleItemUsed(data: {
  playerId: string;
  itemId: string;
  slot: number;
  itemData: { id: string; name: string; type: string };
}): void {
  // === SECURITY: Input Validation (OWASP) ===
  if (!data.playerId || typeof data.playerId !== "string") {
    Logger.systemError("PlayerSystem", "Invalid playerId in handleItemUsed");
    return;
  }

  // Only process consumables
  if (data.itemData.type !== "consumable" && data.itemData.type !== "food") {
    return;
  }

  // Get the full item data to check for healing properties
  const itemData = getItem(data.itemId);
  if (!itemData || !itemData.healAmount || itemData.healAmount <= 0) {
    return;
  }

  // === SECURITY: Bounds checking (OWASP) ===
  const healAmount = Math.min(
    Math.max(0, Math.floor(itemData.healAmount)),
    INPUT_LIMITS.MAX_HEAL_AMOUNT ?? 99
  );

  // === RATE LIMITING: Eat delay check (Anti-Cheat) ===
  const currentTick = this.world.getCurrentTick?.() ?? 0;
  if (!this.eatDelayManager.canEat(data.playerId, currentTick)) {
    // Already eating - send rejection message
    this.emitTypedEvent(EventType.UI_MESSAGE, {
      playerId: data.playerId,
      message: "You are already eating.",
      type: "warning" as const,
    });
    return;
  }

  // Record this eat action
  this.eatDelayManager.recordEat(data.playerId, currentTick);

  // Apply healing
  const healed = this.healPlayer(data.playerId, healAmount);

  if (healed) {
    // NOTE: healPlayer() already emits PLAYER_HEALTH_UPDATED
    // Only emit the UI message here (avoid duplicate events)

    // OSRS-style message (lowercase item name, no heal amount shown)
    this.emitTypedEvent(EventType.UI_MESSAGE, {
      playerId: data.playerId,
      message: `You eat the ${itemData.name.toLowerCase()}.`,
      type: "success" as const,
    });

    // === COMBAT INTEGRATION: Apply attack delay if in combat ===
    this.applyEatAttackDelay(data.playerId, currentTick);
  }
}
```

#### 1.4 Add Attack Delay Integration Method
**File:** `packages/shared/src/systems/shared/character/PlayerSystem.ts`

```typescript
/**
 * Apply attack delay when eating during combat (OSRS-accurate)
 *
 * OSRS Rule: Foods only add to EXISTING attack delay.
 * If weapon is ready to attack, eating does NOT add delay.
 */
private applyEatAttackDelay(playerId: string, currentTick: number): void {
  const combatSystem = this.world.getSystem("combat") as CombatSystem | null;
  if (!combatSystem) return;

  // Check if player is on attack cooldown
  const isOnCooldown = combatSystem.isPlayerOnAttackCooldown?.(playerId, currentTick);

  if (isOnCooldown) {
    // Add eat delay to attack cooldown
    combatSystem.addAttackDelay?.(playerId, COMBAT_CONSTANTS.EAT_ATTACK_DELAY_TICKS);
  }
  // If not on cooldown, do nothing (OSRS-accurate behavior)
}
```

#### 1.5 Clear Eat Cooldown on Death/Disconnect
**Add to existing death handler in PlayerSystem:**

```typescript
// In handlePlayerDeath or similar:
this.eatDelayManager.clearPlayer(playerId);

// In handlePlayerLeave or similar:
this.eatDelayManager.clearPlayer(playerId);
```

---

### Phase 2: Combat System Integration

#### 2.1 Add Public Methods to CombatSystem
**File:** `packages/shared/src/systems/shared/combat/CombatSystem.ts`

Add these public methods (follows existing patterns):

```typescript
/**
 * Check if player is on attack cooldown
 * Used by eating system to determine if eat should add attack delay
 *
 * @param playerId - Player to check
 * @param currentTick - Current game tick
 * @returns true if player has pending attack cooldown
 */
public isPlayerOnAttackCooldown(playerId: string, currentTick: number): boolean {
  const typedPlayerId = createEntityID(playerId);
  const nextAllowedTick = this.nextAttackTicks.get(typedPlayerId) ?? 0;
  return currentTick < nextAllowedTick;
}

/**
 * Add delay ticks to player's next attack
 * Used by eating system (OSRS: eating during combat adds 3 tick delay)
 *
 * OSRS-Accurate: Only called when player is ALREADY on cooldown.
 * If weapon is ready, eating does not add delay.
 *
 * @param playerId - Player to modify
 * @param delayTicks - Ticks to add to attack cooldown
 */
public addAttackDelay(playerId: string, delayTicks: number): void {
  const typedPlayerId = createEntityID(playerId);
  const currentNext = this.nextAttackTicks.get(typedPlayerId);

  if (currentNext !== undefined) {
    // Add delay to existing cooldown (mutate in place, no allocation)
    this.nextAttackTicks.set(typedPlayerId, currentNext + delayTicks);

    // Also update CombatData if active
    const combatData = this.stateService.getCombatData(typedPlayerId);
    if (combatData) {
      combatData.nextAttackTick += delayTicks;
    }
  }
  // If no current cooldown, do nothing (OSRS-accurate: no delay if weapon ready)
}
```

#### 2.2 Type Export for Cross-System Access
**File:** `packages/shared/src/index.ts`

Ensure CombatSystem type is exported for PlayerSystem to use:
```typescript
// Already exported, but verify:
export { CombatSystem } from "./systems/shared/combat/CombatSystem";
```

#### 2.3 Add Type Declaration for World.getSystem
Ensure TypeScript knows about the combat system methods:

```typescript
// In PlayerSystem.ts import section:
import type { CombatSystem } from "../combat/CombatSystem";

// The getSystem call is already type-safe with the cast:
const combatSystem = this.world.getSystem("combat") as CombatSystem | null;
```

---

### Phase 3: Client-Side Feedback

#### 3.1 "Already Eating" Message (Already Implemented in Phase 1.3)
The rejection message is already handled in `handleItemUsed()`:
```typescript
this.emitTypedEvent(EventType.UI_MESSAGE, {
  playerId: data.playerId,
  message: "You are already eating.",
  type: "warning" as const,
});
```

#### 3.2 OSRS-Accurate Eat Message (Already Implemented in Phase 1.3)
Changed from:
```
"You eat the Shrimp and heal 3 HP."
```
To OSRS format:
```
"You eat the shrimp."  // lowercase item name, no heal amount shown
```

#### 3.3 Client-Side Optimistic Feedback (Optional Enhancement)
**File:** `packages/client/src/game/panels/InventoryPanel.tsx`

Add visual feedback when eat action is triggered (before server confirms):

```typescript
// In the context menu handler for "eat":
const handleEat = (item: InventorySlotViewItem, slot: number) => {
  // Immediate visual feedback (item briefly pulses/highlights)
  // This is purely cosmetic - server is authoritative
  setEatingSlot(slot);
  setTimeout(() => setEatingSlot(null), 200);

  // Send to server
  world?.emit(EventType.ITEM_ACTION_SELECTED, {
    playerId: localPlayer.id,
    actionId: "eat",
    itemId: item.itemId,
    slot,
  });
};
```

#### 3.4 (Future) Add Eating Animation
**Note:** Deferred to future work - requires animation system integration.

```typescript
// When implemented:
this.emitTypedEvent(EventType.PLAYER_EMOTE, {
  playerId,
  emote: "eat",
  duration: COMBAT_CONSTANTS.EAT_DELAY_TICKS * COMBAT_CONSTANTS.TICK_DURATION_MS,
});
```

---

### Phase 4: Edge Cases & Polish

#### 4.1 Handle Player Death While Eating
**File:** `packages/shared/src/systems/shared/character/PlayerSystem.ts`

In existing death handler (subscribe to `PLAYER_DEATH`):
```typescript
// Clear eat cooldown on death
this.eatDelayManager.clearPlayer(playerId);
```

**Validation:** Eating while dead is already blocked by `healPlayer()`:
```typescript
if (!player || !player.alive) return false;
```

#### 4.2 Handle Logout/Disconnect
**File:** `packages/shared/src/systems/shared/character/PlayerSystem.ts`

In existing leave handler (subscribe to `PLAYER_LEAVE`):
```typescript
// Clean up player state (memory hygiene)
this.eatDelayManager.clearPlayer(playerId);
```

#### 4.3 Full Health Behavior (OSRS-Accurate)
**Current behavior is already OSRS-accurate:**
- `healPlayer()` allows eating at full health
- Food is consumed but health doesn't change
- No special message needed (OSRS behavior)

**Do NOT add:** "You don't need to eat that right now." - this is NOT OSRS behavior.

#### 4.4 Memory Cleanup (Production Hygiene)
**File:** `packages/shared/src/systems/shared/character/EatDelayManager.ts`

Add periodic cleanup for stale entries (defense against memory leaks):

```typescript
// Optional: Add cleanup method called by PlayerSystem tick
public cleanup(activePlayers: Set<string>): void {
  for (const playerId of this.lastEatTick.keys()) {
    if (!activePlayers.has(playerId)) {
      this.lastEatTick.delete(playerId);
    }
  }
}
```

#### 4.5 Fix Duplicate Event Emission
**File:** `packages/shared/src/systems/shared/character/PlayerSystem.ts`

Current `healPlayer()` already emits `PLAYER_HEALTH_UPDATED`. Remove duplicate from `handleItemUsed()`:

```typescript
// REMOVE this duplicate emission from handleItemUsed:
// this.emitTypedEvent(EventType.PLAYER_HEALTH_UPDATED, {
//   playerId: data.playerId,
//   amount: itemData.healAmount,
//   source: "food",
// });

// The healPlayer() call already emits the correct event
```

#### 4.6 Slot Validation in useItem
**File:** `packages/shared/src/systems/shared/character/InventorySystem.ts`

Add bounds checking (OWASP: Input Validation):

```typescript
private useItem(data: {
  playerId: string;
  itemId: string;
  slot: number;
}): void {
  // SERVER-SIDE ONLY
  if (!this.world.isServer) return;

  // === SECURITY: Bounds validation (OWASP) ===
  if (data.slot < 0 || data.slot >= INPUT_LIMITS.MAX_INVENTORY_SLOTS) {
    Logger.systemError(
      "InventorySystem",
      `Invalid slot ${data.slot} (must be 0-${INPUT_LIMITS.MAX_INVENTORY_SLOTS - 1})`,
      new Error("Invalid slot index"),
    );
    return;
  }

  // ... rest of existing implementation
}
```

---

## File Change Summary

| File | Changes | LOC Est. |
|------|---------|----------|
| `EatDelayManager.ts` | **NEW:** Single-responsibility class for eat delay tracking | ~50 |
| `InventoryInteractionSystem.ts` | Fix "eat" callback to emit `INVENTORY_USE` with validation | ~10 |
| `InventoryPanel.tsx` | Add "Eat" option to context menu for food items | ~15 |
| `CombatConstants.ts` | Add `EAT_DELAY_TICKS`, `EAT_ATTACK_DELAY_TICKS` constants | ~5 |
| `interaction.ts` | Add `MAX_HEAL_AMOUNT`, `MIN_SLOT` to INPUT_LIMITS | ~3 |
| `PlayerSystem.ts` | Integrate EatDelayManager, rewrite `handleItemUsed()` with validation | ~60 |
| `InventorySystem.ts` | Add server-side guard, slot bounds validation to `useItem()` | ~15 |
| `CombatSystem.ts` | Add `isPlayerOnAttackCooldown()`, `addAttackDelay()` public methods | ~30 |
| `event-types.ts` | (No changes needed - existing events sufficient) | 0 |
| **Tests** | Unit tests for all new functionality | ~200 |

**Total Estimated Lines:** ~390 LOC (including tests)

---

## Test Plan

### Unit Tests - EatDelayManager
**File:** `packages/shared/src/systems/shared/character/__tests__/EatDelayManager.test.ts`

```typescript
describe("EatDelayManager", () => {
  describe("canEat", () => {
    it("returns true when player has never eaten", () => {});
    it("returns false within 3 ticks of last eat", () => {});
    it("returns true after 3+ ticks since last eat", () => {});
    it("returns true exactly at 3 tick boundary", () => {});
  });

  describe("getRemainingCooldown", () => {
    it("returns 0 when ready to eat", () => {});
    it("returns correct remaining ticks during cooldown", () => {});
  });

  describe("recordEat", () => {
    it("stores current tick for player", () => {});
    it("updates existing entry for same player", () => {});
  });

  describe("clearPlayer", () => {
    it("removes player from tracking map", () => {});
    it("allows immediate eating after clear", () => {});
  });
});
```

### Unit Tests - PlayerSystem.handleItemUsed
**File:** `packages/shared/src/systems/shared/character/__tests__/PlayerSystem.eating.test.ts`

```typescript
describe("PlayerSystem - Eating", () => {
  describe("Input Validation (OWASP)", () => {
    it("rejects empty playerId", () => {});
    it("rejects non-string playerId", () => {});
    it("rejects invalid slot index (negative)", () => {});
    it("rejects invalid slot index (>= MAX_SLOTS)", () => {});
    it("caps healAmount at MAX_HEAL_AMOUNT", () => {});
  });

  describe("Eat Delay Enforcement", () => {
    it("allows first eat", () => {});
    it("rejects second eat within 3 ticks", () => {});
    it("allows eat after 3 tick delay", () => {});
    it("emits warning message when rate limited", () => {});
  });

  describe("Healing", () => {
    it("increases health by healAmount", () => {});
    it("caps health at max health", () => {});
    it("does not heal dead players", () => {});
    it("consumes food item on successful eat", () => {});
    it("emits OSRS-style lowercase message", () => {});
  });

  describe("Combat Integration", () => {
    it("adds attack delay when player on cooldown", () => {});
    it("does NOT add delay when weapon ready", () => {});
  });

  describe("Cleanup", () => {
    it("clears eat cooldown on player death", () => {});
    it("clears eat cooldown on player disconnect", () => {});
  });
});
```

### Unit Tests - CombatSystem Methods
**File:** `packages/shared/src/systems/shared/combat/__tests__/CombatSystem.eatDelay.test.ts`

```typescript
describe("CombatSystem - Eat Delay Integration", () => {
  describe("isPlayerOnAttackCooldown", () => {
    it("returns false when no cooldown set", () => {});
    it("returns true when on cooldown", () => {});
    it("returns false when cooldown expired", () => {});
  });

  describe("addAttackDelay", () => {
    it("adds delay to existing cooldown", () => {});
    it("does nothing when no existing cooldown", () => {});
    it("updates CombatData.nextAttackTick", () => {});
  });
});
```

### Unit Tests - InventorySystem.useItem
**File:** `packages/shared/src/systems/shared/character/__tests__/InventorySystem.useItem.test.ts`

```typescript
describe("InventorySystem.useItem", () => {
  it("only processes on server (isServer check)", () => {});
  it("validates slot is within bounds", () => {});
  it("verifies item exists at claimed slot", () => {});
  it("emits ITEM_USED with correct data", () => {});
  it("removes consumables after use", () => {});
});
```

### Integration Tests
**File:** `packages/shared/src/systems/shared/character/__tests__/EatingIntegration.test.ts`

```typescript
describe("Eating Integration", () => {
  it("full eat flow: click → validate → heal → consume", async () => {});
  it("attack delay is added mid-combat", async () => {});
  it("no attack delay when starting fresh fight", async () => {});
  it("spam protection across multiple rapid clicks", async () => {});
});
```

### Manual Test Scenarios
1. **Spam-click food rapidly** - should only eat every 1.8 seconds
2. **Eat during combat** - next attack should be delayed by 3 ticks
3. **Eat when not in combat** - attack timing unaffected
4. **Eat at full health** - food consumed, no health change (OSRS behavior)
5. **Eat when dead** - nothing happens, no error
6. **Context menu shows "Eat"** - food items show Eat option, non-food don't
7. **OSRS message format** - "You eat the shrimp." (lowercase, no heal amount)

---

## Future Enhancements (Not in Scope)

| Feature | OSRS Behavior | Priority |
|---------|---------------|----------|
| **Potions** | No eat/attack delay | Medium |
| **Fast foods** | 2-tick delay instead of 3 | Low |
| **Combo eating** | Karambwan + food in same tick | Low |
| **Tick eating** | Heal between damage calc and application | Very Low |
| **Overheal** | Anglerfish can heal above max | Low |

---

## Implementation Order

### Sprint 1: Fix Broken Eating (Phase 0)
1. **0.1** Fix "eat" action callback in InventoryInteractionSystem.ts
2. **0.2** Add "Eat" to client context menu in InventoryPanel.tsx
3. **0.3** Wire up context menu handler in CoreUI.tsx
4. **0.4** Add server-side guard to InventorySystem.useItem()
5. ✅ **Checkpoint:** Eating should now work (basic functionality)

### Sprint 2: OSRS-Accurate Timing (Phase 1-2)
6. **1.1** Add constants to CombatConstants.ts and interaction.ts
7. **1.2** Create EatDelayManager.ts (new file)
8. **1.3** Rewrite handleItemUsed() with validation and rate limiting
9. **1.4** Add applyEatAttackDelay() method
10. **2.1** Add isPlayerOnAttackCooldown() to CombatSystem
11. **2.2** Add addAttackDelay() to CombatSystem
12. ✅ **Checkpoint:** 3-tick eat delay and attack delay working

### Sprint 3: Polish & Edge Cases (Phase 3-4)
13. **4.1** Hook death handler to clear eat cooldown
14. **4.2** Hook disconnect handler to clear eat cooldown
15. **4.5** Remove duplicate event emission
16. **4.6** Add slot validation to useItem()
17. ✅ **Checkpoint:** All edge cases handled

### Sprint 4: Testing
18. Write EatDelayManager unit tests
19. Write PlayerSystem.eating unit tests
20. Write CombatSystem.eatDelay unit tests
21. Write InventorySystem.useItem unit tests
22. Write integration tests
23. ✅ **Checkpoint:** All tests passing

### Sprint 5: Code Review & Documentation
24. Self-review against audit criteria
25. Verify 9/10 rating achieved
26. Update any documentation if needed

---

## Success Criteria

### Functional Requirements
**Phase 0 (Fix Broken Eating):**
- [ ] "Eat" option appears in context menu for food items
- [ ] Clicking "Eat" actually consumes food and heals player
- [ ] Food item is removed from inventory on consumption
- [ ] Server-side guard prevents client-side processing

**Phase 1-4 (OSRS-Accurate Timing):**
- [ ] Eating has 3-tick (1.8s) cooldown between foods
- [ ] "You are already eating" shown when trying to eat too fast
- [ ] Eating during combat adds 3-tick delay to next attack (only if on cooldown)
- [ ] Eating when weapon ready does NOT add attack delay
- [ ] Health increases correctly by food's `healAmount`
- [ ] OSRS-style message: "You eat the [item]." (lowercase, no heal amount)
- [ ] Eat cooldown clears on death and disconnect

### Production Quality Checklist
**Security (OWASP):**
- [ ] Input validation on playerId (non-empty string)
- [ ] Slot bounds checking (0 to MAX_INVENTORY_SLOTS-1)
- [ ] healAmount capped at MAX_HEAL_AMOUNT
- [ ] Server authority check in useItem()

**Anti-Cheat:**
- [ ] Rate limiting via EatDelayManager
- [ ] Server verifies item exists at claimed slot
- [ ] No duplicate event emissions

**SOLID Principles:**
- [ ] SRP: EatDelayManager handles only eat delay logic
- [ ] OCP: Existing PlayerSystem extensible without modification
- [ ] DIP: EatDelayManager injectable/replaceable

**Memory Hygiene:**
- [ ] No allocations in hot path (handleItemUsed)
- [ ] Player state cleaned up on disconnect
- [ ] Map entries cleared appropriately

**Testing:**
- [ ] Unit tests for EatDelayManager
- [ ] Unit tests for handleItemUsed validation
- [ ] Unit tests for CombatSystem eat delay methods
- [ ] Integration tests for full flow
- [ ] All tests passing

### Target Rating: 9/10

| Criterion | Target Score |
|-----------|--------------|
| Production Quality | 9/10 |
| OWASP Security | 9/10 |
| Game Studio/Anti-Cheat | 9/10 |
| Memory/Allocation | 9/10 |
| SOLID Principles | 9/10 |

---

## Appendix: Rating Justification

### Why 9/10 and Not 10/10?

The following items would push to 10/10 but are deferred for scope:
- **Animation system integration** (eating emote)
- **Fast food support** (2-tick variants)
- **Combo eating** (Karambwan stacking)
- **Full E2E Playwright tests** (deferred to integration phase)

### Rating Breakdown (Post-Implementation)

#### Production Quality: 9/10
- ✅ Strong typing throughout (no `any`)
- ✅ Comprehensive error handling with Logger
- ✅ Input validation on all public entry points
- ✅ Clear documentation and JSDoc comments
- ✅ Follows existing codebase patterns
- ⚠️ Missing: Animation integration (out of scope)

#### OWASP Security: 9/10
- ✅ Input validation (playerId, slot, healAmount)
- ✅ Server authority pattern (isServer checks)
- ✅ Rate limiting (3-tick eat delay)
- ✅ Bounds checking (slot range validation)
- ✅ No injection vulnerabilities (typed events)
- ⚠️ Not applicable: No user-generated strings involved

#### Game Studio/Anti-Cheat: 9/10
- ✅ Server-authoritative (all validation server-side)
- ✅ Rate limiting prevents automation
- ✅ Tick-based timing matches OSRS spec exactly
- ✅ No client trust (server verifies item at slot)
- ✅ Clean state management (cleanup on death/disconnect)
- ⚠️ Future: Could add anomaly detection logging

#### Memory/Allocation: 9/10
- ✅ No allocations in hot path (handleItemUsed)
- ✅ Reuses existing event infrastructure
- ✅ Map cleanup on player disconnect
- ✅ Uses primitives where possible
- ⚠️ String interpolation in UI_MESSAGE (minimal impact, not hot path)

#### SOLID Principles: 9/10
- ✅ **SRP:** EatDelayManager has single responsibility
- ✅ **OCP:** CombatSystem extended without modification
- ✅ **LSP:** Not applicable (no inheritance)
- ✅ **ISP:** Small, focused interfaces
- ✅ **DIP:** EatDelayManager injectable (constructor injection possible)
- ⚠️ PlayerSystem still large, but eat logic is cleanly isolated

### Comparison: Before vs After

| Criterion | Before | After | Improvement |
|-----------|--------|-------|-------------|
| Production Quality | 6/10 | 9/10 | +50% |
| OWASP Security | 5/10 | 9/10 | +80% |
| Game Studio/Anti-Cheat | 4/10 | 9/10 | +125% |
| Memory/Allocation | 8/10 | 9/10 | +12.5% |
| SOLID Principles | 6/10 | 9/10 | +50% |
| **Overall** | **5.5/10** | **9/10** | **+64%** |
