# Player Interaction Issues - Research Findings

## Issue 1: Following a Player Doesn't Work

### Root Cause
The `followPlayer` packet is **not registered** in the packet system.

### Evidence
- **Client sends**: `MESSAGE_TYPES.FOLLOW_PLAYER` = `"followPlayer"` (defined in `constants.ts:170`)
- **packets.ts**: Does NOT contain `'followPlayer'` in the `names` array
- **Server**: No handler registered for `onFollowPlayer`

### Code References
```typescript
// PlayerInteractionHandler.ts:151-156
private followPlayer(target: RaycastTarget): void {
  this.send(MESSAGE_TYPES.FOLLOW_PLAYER, {
    targetPlayerId: target.entityId,
  });
  this.addChatMessage(`Following ${target.name}.`);
}
```

### Fix Required
1. Add `'followPlayer'` to `packets.ts` names array
2. Create `handleFollowPlayer()` in `handlers/combat.ts` (or new `handlers/player.ts`)
3. Register `onFollowPlayer` handler in `ServerNetwork/index.ts`
4. Implement server-side follow logic (pathfinding to follow target)

---

## Issue 2: Attack Option Greyed Out in PvP Zone

### Root Cause
**Zone overlap bug**: The `starter_area` bounds (X: -50 to 50, Z: -50 to 50) completely encompass the `wilderness_test` bounds (X: 25 to 45, Z: -10 to 10).

The `lookupZoneProperties()` function iterates through `ALL_WORLD_AREAS` and returns the **first match**. Since `starter_area` is defined first and has larger bounds, it matches before `wilderness_test` can be checked.

### Evidence
```typescript
// world-areas.ts - Zone definitions
starter_area: {
  bounds: { minX: -50, maxX: 50, minZ: -50, maxZ: 50 },  // HUGE area
  safeZone: true,
},
wilderness_test: {
  bounds: { minX: 25, maxX: 45, minZ: -10, maxZ: 10 },   // Inside starter_area!
  safeZone: false,
  pvpEnabled: true,
},
```

```typescript
// ZoneDetectionSystem.ts:97-131 - First-match logic
for (const area of Object.values(ALL_WORLD_AREAS) as WorldArea[]) {
  if (area.bounds) {
    const { minX, maxX, minZ, maxZ } = area.bounds;
    if (position.x >= minX && position.x <= maxX &&
        position.z >= minZ && position.z <= maxZ) {
      // Returns FIRST match - starter_area always wins!
      return { ... isPvPEnabled: isPvP ... };
    }
  }
}
```

### Flow Trace
1. Player at position (35, 0) - inside wilderness_test bounds
2. `isInPvPZone()` calls `zoneSystem.isPvPEnabled({ x: 35, z: 0 })`
3. `lookupZoneProperties()` iterates areas
4. **starter_area** checked first: 35 >= -50 && 35 <= 50 && 0 >= -50 && 0 <= 50 = **TRUE**
5. Returns `{ safeZone: true, isPvPEnabled: false }` for starter_area
6. wilderness_test is **never checked**
7. Attack button remains greyed out

### Fix Options
1. **Option A**: Shrink `starter_area` bounds to NOT overlap with `wilderness_test`
   ```typescript
   starter_area: {
     bounds: { minX: -50, maxX: 24, minZ: -50, maxZ: 50 }, // Stop before wilderness
   }
   ```

2. **Option B**: Check smaller/more specific zones first (sort by area size)
   ```typescript
   const sortedAreas = Object.values(ALL_WORLD_AREAS)
     .sort((a, b) => getAreaSize(a) - getAreaSize(b)); // Smallest first
   ```

3. **Option C**: Add zone priority system
   ```typescript
   wilderness_test: {
     priority: 10,  // Higher priority = checked first
     ...
   }
   ```

---

## Issue 3: Attack Should Only Appear in PvP Zones

### Current Behavior
Attack option is **always shown** in the menu but greyed out when not in PvP zone.

### OSRS Behavior
In OSRS, the "Attack" option on players **only appears in the Wilderness** (PvP zones). It's not shown at all in safe zones.

### Code Reference
```typescript
// PlayerInteractionHandler.ts:41-49
// Currently ALWAYS adds Attack to menu, just toggles `enabled`
actions.push({
  id: "attack",
  label: `Attack ${target.name} (level-${targetLevel})`,
  icon: "⚔️",
  enabled: inPvPZone,  // Only controls grey/enabled state
  priority: 0,
  handler: () => this.attackPlayer(target),
});
```

### Fix Required
```typescript
// Only add Attack option if in PvP zone
if (inPvPZone) {
  actions.push({
    id: "attack",
    label: `Attack ${target.name} (level-${targetLevel})`,
    icon: "⚔️",
    enabled: true,
    priority: 0,
    handler: () => this.attackPlayer(target),
  });
}
```

---

## Summary of Fixes Needed

| Issue | File(s) | Fix |
|-------|---------|-----|
| 1. Follow not working | `packets.ts`, `handlers/combat.ts`, `ServerNetwork/index.ts` | Add packet, handler, registration |
| 2. Attack greyed out | `world-areas.ts` OR `ZoneDetectionSystem.ts` | Fix zone overlap (shrink starter_area or check smaller zones first) |
| 3. Attack always shown | `PlayerInteractionHandler.ts` | Conditionally add Attack option only in PvP zones |

---

## Priority Recommendation

1. **Fix Issue 2 first** - This is blocking PvP testing entirely
2. **Fix Issue 3 second** - Quick change for OSRS accuracy
3. **Fix Issue 1 last** - Follow is less critical for PvP testing
