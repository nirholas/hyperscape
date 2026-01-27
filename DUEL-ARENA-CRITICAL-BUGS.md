# Duel Arena Critical Bugs Investigation

## Executive Summary

**5 critical bugs** are causing the duel arena to completely fail:

1. Winner never receives staked items
2. Gravestones appear (shouldn't in duels)
3. Player inventories appear linked
4. Both players can loot the gravestone
5. Items not removed from inventory when staked

---

## Bug #1: No Handlers for Stake Transfer Events

**Severity:** CRITICAL
**Impact:** Winner never receives loser's staked items - items are lost

### Problem

The DuelSystem emits these events when a duel completes:

**File:** `/packages/server/src/systems/DuelSystem/index.ts`

```typescript
// Line 1673 - Transfer event (logging)
this.world.emit("duel:stakes:transfer", { ... });

// Line 1686 - Return winner's own stakes
this.world.emit("duel:stakes:return", {
  playerId: winnerId,
  items: winnerStakes,
});

// Line 1695 - Award loser's stakes to winner
this.world.emit("duel:stakes:award", {
  playerId: winnerId,
  items: loserStakes,
});
```

**BUT:** There are **NO event listeners** for these events anywhere in the codebase.

```bash
# Search for handlers:
grep -r "on.*duel:stakes" packages/server/src/
# Returns: (no results)
```

The `duel:completed` event IS handled (for UI notifications), but the actual item transfer events are ignored.

### Solution

Add event handlers in `ServerNetwork/index.ts`:

```typescript
// Listen for stake returns (winner gets their own stakes back)
this.world.on("duel:stakes:return", async (event) => {
  const { playerId, items } = event as {
    playerId: string;
    items: Array<{ itemId: string; quantity: number }>;
  };

  // Add items back to player's inventory
  for (const item of items) {
    this.world.emit(EventType.INVENTORY_ADD, {
      playerId,
      itemId: item.itemId,
      quantity: item.quantity,
    });
  }
});

// Listen for stake awards (winner gets loser's stakes)
this.world.on("duel:stakes:award", async (event) => {
  const { playerId, items } = event as {
    playerId: string;
    items: Array<{ itemId: string; quantity: number }>;
  };

  // Add loser's items to winner's inventory
  for (const item of items) {
    this.world.emit(EventType.INVENTORY_ADD, {
      playerId,
      itemId: item.itemId,
      quantity: item.quantity,
    });
  }
});
```

---

## Bug #2: Gravestones Appear in Duel Deaths

**Severity:** CRITICAL
**Impact:** Items dropped on ground instead of going to winner

### Problem

**File:** `/packages/shared/src/systems/shared/combat/PlayerDeathSystem.ts`

The PlayerDeathSystem has **zero awareness of duels**:

```bash
grep -n "duel\|Duel" packages/shared/src/systems/shared/combat/PlayerDeathSystem.ts
# Returns: (no matches)
```

When a player dies in a duel:
1. DuelSystem detects death and calls `resolveDuel()`
2. But the `PLAYER_DIED` event STILL propagates
3. PlayerDeathSystem handles `PLAYER_DIED` and creates a gravestone
4. Items are dropped on the ground

### OSRS Accuracy

In OSRS Duel Arena:
- NO items drop on death
- NO gravestone appears
- Stakes transfer directly to winner
- Both players respawn at hospital area

### Solution

**Option A:** Make PlayerDeathSystem duel-aware

```typescript
// In PlayerDeathSystem.handlePlayerDeath():
private handlePlayerDeath(event: PlayerDeathEvent): void {
  const { playerId } = event;

  // Check if player is in an active duel
  const duelSystem = this.world.getSystem("duel") as {
    isPlayerInActiveDuel?: (playerId: string) => boolean;
  } | null;

  if (duelSystem?.isPlayerInActiveDuel?.(playerId)) {
    // Skip gravestone creation - duel system handles death
    return;
  }

  // ... normal death handling with gravestone
}
```

**Option B:** DuelSystem prevents death event propagation

```typescript
// In DuelSystem, intercept death before it reaches PlayerDeathSystem
// by using a higher priority listener or stopping propagation
```

---

## Bug #3: Player Inventories Appear Linked

**Severity:** CRITICAL
**Impact:** Changes to one player's inventory affect the other

### Problem

**File:** `/packages/server/src/systems/ServerNetwork/handlers/duel/stakes.ts`

When items are staked, they're stored as **slot references**, not removed from inventory:

```typescript
// Line 94-101 in handleDuelAddStake():
const result = duelSystem.addStake(
  duelId,
  playerId,
  inventorySlot,  // ← Just a reference to slot number
  itemId,
  qty,
  value
);
// Item is NOT removed from inventory!
```

**File:** `/packages/server/src/systems/DuelSystem/index.ts`

Stakes are stored with slot references:

```typescript
// Line 651:
stakes.push({
  inventorySlot,    // ← Slot number reference
  itemId,
  quantity,
  value,
});
```

### Root Cause Theory

If both players stake items and the system tries to "return" or "award" items using slot references that overlap, it could be writing to wrong slots. Additionally, if entity IDs or socket sessions get mixed up, inventory sync packets could go to the wrong client.

### Investigation Needed

1. Check how `duel:stakes:return` and `duel:stakes:award` are supposed to work
2. Verify player IDs are correct throughout the duel flow
3. Check socket-to-player mapping during duel

### Solution

1. **Remove items from inventory when staked:**
   ```typescript
   // In handleDuelAddStake():
   // After validating item exists, REMOVE it from inventory
   this.world.emit(EventType.INVENTORY_REMOVE, {
     playerId,
     slot: inventorySlot,
     quantity: qty,
   });
   ```

2. **Store actual item data, not slot references:**
   ```typescript
   stakes.push({
     itemId,
     quantity,
     value,
     // DON'T store inventorySlot - item is no longer there
   });
   ```

3. **Add items back using INVENTORY_ADD, not slot manipulation**

---

## Bug #4: Both Players Can Loot Gravestone

**Severity:** HIGH
**Impact:** Item duplication or loss

### Problem

Gravestones created during duel deaths have no loot protection:

**File:** `/packages/shared/src/systems/shared/combat/PlayerDeathSystem.ts`

```typescript
// Line ~1206:
lootProtectionUntil: 0,  // No protection
protectedFor: undefined,
```

### Solution

This bug is eliminated if Bug #2 is fixed (no gravestone in duels). But if gravestones must exist:

```typescript
// Add owner protection:
lootProtectionUntil: Date.now() + 60000,  // 60 second protection
protectedFor: deadPlayerId,
```

---

## Bug #5: Items Not Removed from Inventory When Staked

**Severity:** HIGH
**Impact:** Items usable while staked, potential duplication

### Problem

**File:** `/packages/server/src/systems/ServerNetwork/handlers/duel/stakes.ts`

The `handleDuelAddStake` function:
1. Validates item exists in inventory ✅
2. Adds stake reference to DuelSession ✅
3. **Does NOT remove item from inventory** ❌
4. **Does NOT lock the inventory slot** ❌

### OSRS Behavior

In OSRS, when you add an item to duel stakes:
1. Item is removed from inventory
2. Item appears in "Your Stake" area
3. If duel is cancelled, items return to inventory
4. If you win, you get your items back + opponent's items
5. If you lose, you lose your staked items

### Solution

```typescript
// In handleDuelAddStake():

// 1. Remove item from inventory immediately
const removeResult = await inventoryRepo.removeItemFromSlot(
  playerId,
  inventorySlot,
  qty
);

if (!removeResult.success) {
  sendDuelError(socket, "Failed to stake item", "INVENTORY_ERROR");
  return;
}

// 2. Add to stakes (already done)
const result = duelSystem.addStake(duelId, playerId, inventorySlot, itemId, qty, value);

// 3. Sync inventory to client
this.world.emit(EventType.INVENTORY_SYNC, { playerId });
```

---

## Implementation Priority

| Priority | Bug | Fix Complexity |
|----------|-----|----------------|
| **P0** | #2: Gravestones in duels | Medium - Add duel check to PlayerDeathSystem |
| **P0** | #1: No stake handlers | Medium - Add event listeners |
| **P0** | #5: Items not removed | Medium - Add inventory removal |
| **P1** | #3: Linked inventories | Low - Fixed by #5 |
| **P1** | #4: Both can loot | Low - Fixed by #2 |

---

## Files to Modify

```
packages/server/src/systems/ServerNetwork/index.ts
  - Add duel:stakes:return handler
  - Add duel:stakes:award handler

packages/server/src/systems/ServerNetwork/handlers/duel/stakes.ts
  - Remove items from inventory when staked
  - Add items back when stake removed (cancel)

packages/shared/src/systems/shared/combat/PlayerDeathSystem.ts
  - Add duel awareness check
  - Skip gravestone creation for duel deaths

packages/server/src/systems/DuelSystem/index.ts
  - Verify stake transfer logic
  - Consider preventing PLAYER_DIED propagation for duel deaths
```

---

## Testing Checklist

After fixes:

1. [ ] Player A stakes sword, Player B stakes 1000 gold
2. [ ] Player A kills Player B
3. [ ] NO gravestone appears
4. [ ] Player A receives: their sword back + Player B's 1000 gold
5. [ ] Player B's inventory is unchanged (lost staked gold only)
6. [ ] Player A and Player B inventories are independent
7. [ ] Both players teleported to hospital area
8. [ ] Both players healed to full HP

---

*Generated: 2025-01-26*
