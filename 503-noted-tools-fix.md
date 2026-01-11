# Plan: Fix Noted Tools Skilling Validation (Issue #503)

## Problem Statement

Noted versions of tools (e.g., `bronze_pickaxe_noted`) incorrectly pass validation when checking if a player has the required tool for gathering skills. A noted item is a **bank note** representing the item - it cannot be equipped or used until converted back to its normal form.

### Current Behavior (Bug)
```
Player has: bronze_pickaxe_noted (a bank note)
Attempts: Mine copper ore (requires pickaxe)
Result: ✅ Allowed (WRONG - should fail)
```

### Expected Behavior
```
Player has: bronze_pickaxe_noted (a bank note)
Attempts: Mine copper ore (requires pickaxe)
Result: ❌ Rejected - "You need a pickaxe to mine this rock"
```

---

## Root Cause Analysis

### Affected Code Path

```
ResourceSystem.startGathering()
    └── playerHasToolCategory(playerId, "pickaxe")
            └── itemMatchesToolCategory(itemId: string, category: string)
                    └── itemId.includes("pickaxe")  // BUG: substring matching
```

### The Bug

`itemMatchesToolCategory()` in `ToolUtils.ts` (lines 103-124) uses **substring matching**:

```typescript
// Current (buggy) implementation
if (category === "pickaxe") {
  return lowerItemId.includes("pickaxe") || lowerItemId.includes("pick");
}
```

This passes for `"bronze_pickaxe_noted"` because it contains `"pickaxe"`.

### What Is NOT Affected

**`getBestTool()` is SAFE** - it uses exact ID matching:
```typescript
// ResourceSystem.ts line 2682
if (playerItemIds.has(tool.itemId)) {  // Exact match: "bronze_pickaxe" !== "bronze_pickaxe_noted"
```

**Fishing tools are SAFE** - they use exact matching:
```typescript
// ToolUtils.ts line 110-112
if (isExactMatchFishingTool(category)) {
  return lowerItemId === category;  // Exact match
}
```

### Only Affected Function

`itemMatchesToolCategory()` when matching **category-based tools** (pickaxe, hatchet/axe) that use `.includes()` substring matching.

---

## Existing Infrastructure

The codebase already has note detection utilities:

```typescript
// NoteGenerator.ts line 224
export function isNotedItemId(itemId: string): boolean {
  return itemId.endsWith("_noted");
}

// item-types.ts line 470
export function isNotedItem(item: Item): item is Item & { isNoted: true; baseItemId: string } {
  return item.isNoted === true && typeof item.baseItemId === "string";
}
```

---

## Solution: Use Existing `isNotedItemId()` Utility

### Why This Is The AAA Approach

1. **Uses existing infrastructure** - No new code to maintain
2. **Fixes at the right layer** - ToolUtils is where matching happens
3. **All callers automatically protected** - Single point of fix
4. **Minimal code change** - 2 lines added
5. **Future-proof** - Easy to add more checks in one place

### Implementation

**File**: `packages/shared/src/systems/shared/entities/gathering/ToolUtils.ts`

```typescript
// Add import at top of file
import { isNotedItemId } from '../../../data/NoteGenerator';

/**
 * Check if an item ID matches the required tool category
 */
export function itemMatchesToolCategory(
  itemId: string,
  category: string,
): boolean {
  // NEW: Noted items are bank notes - cannot be used as tools
  if (isNotedItemId(itemId)) {
    return false;
  }

  const lowerItemId = itemId.toLowerCase();

  // If category is an exact fishing tool, require exact match
  if (isExactMatchFishingTool(category)) {
    return lowerItemId === category;
  }

  // For hatchet/pickaxe categories, check if item contains the category
  if (category === "hatchet") {
    return lowerItemId.includes("hatchet") || lowerItemId.includes("axe");
  }
  if (category === "pickaxe") {
    return lowerItemId.includes("pickaxe") || lowerItemId.includes("pick");
  }

  // Fallback: check if item ID contains the category
  return lowerItemId.includes(category);
}
```

### Alternative: Type-Safe Approach (More Complex)

If we wanted to use the full `Item` object's `isNoted` property instead of string checking, we would need to:

1. Fix the weak type cast in `ResourceSystem.playerHasToolCategory()`:
```typescript
// Current weak cast loses item.item
getInventory?: (playerId: string) => {
  items?: Array<{ itemId?: string }>;  // Missing item: Item
};
```

2. Check `item.item.isNoted` before calling `itemMatchesToolCategory()`

However, **the string-based approach is preferred** because:
- `isNotedItemId()` is already battle-tested
- Noted item IDs ALWAYS end with `_noted` (enforced by NoteGenerator)
- No signature changes needed
- Simpler implementation

---

## Files to Modify

| File | Changes |
|------|---------|
| `packages/shared/src/systems/shared/entities/gathering/ToolUtils.ts` | Add import, add `isNotedItemId` check at start of `itemMatchesToolCategory()` |

**That's it. One file, two lines.**

---

## Tests

### Unit Tests for `itemMatchesToolCategory()`

**File**: `packages/shared/src/systems/shared/entities/gathering/__tests__/ToolUtils.test.ts`

```typescript
describe('itemMatchesToolCategory', () => {
  describe('noted items rejection', () => {
    it('rejects noted pickaxes', () => {
      expect(itemMatchesToolCategory('bronze_pickaxe_noted', 'pickaxe')).toBe(false);
      expect(itemMatchesToolCategory('rune_pickaxe_noted', 'pickaxe')).toBe(false);
      expect(itemMatchesToolCategory('dragon_pickaxe_noted', 'pickaxe')).toBe(false);
    });

    it('rejects noted hatchets', () => {
      expect(itemMatchesToolCategory('bronze_axe_noted', 'hatchet')).toBe(false);
      expect(itemMatchesToolCategory('rune_hatchet_noted', 'hatchet')).toBe(false);
    });

    it('accepts normal (unnoted) tools', () => {
      expect(itemMatchesToolCategory('bronze_pickaxe', 'pickaxe')).toBe(true);
      expect(itemMatchesToolCategory('rune_pickaxe', 'pickaxe')).toBe(true);
      expect(itemMatchesToolCategory('bronze_axe', 'hatchet')).toBe(true);
    });
  });

  describe('existing behavior unchanged', () => {
    it('still matches pickaxe category correctly', () => {
      expect(itemMatchesToolCategory('bronze_pickaxe', 'pickaxe')).toBe(true);
      expect(itemMatchesToolCategory('iron_pick', 'pickaxe')).toBe(true);
      expect(itemMatchesToolCategory('bronze_sword', 'pickaxe')).toBe(false);
    });

    it('still matches hatchet category correctly', () => {
      expect(itemMatchesToolCategory('bronze_hatchet', 'hatchet')).toBe(true);
      expect(itemMatchesToolCategory('iron_axe', 'hatchet')).toBe(true);
      expect(itemMatchesToolCategory('bronze_sword', 'hatchet')).toBe(false);
    });

    it('still requires exact match for fishing tools', () => {
      expect(itemMatchesToolCategory('small_fishing_net', 'small_fishing_net')).toBe(true);
      expect(itemMatchesToolCategory('fishing_rod', 'small_fishing_net')).toBe(false);
    });
  });
});
```

---

## OSRS Behavioral Reference

In Old School RuneScape:
- Noted items **cannot** be equipped or used for any skill
- Players must use a bank or Bank Deposit Box to un-note items
- Attempting to use a noted tool shows: "You can't use that."
- The game checks item properties, not just the name

Our implementation matches this behavior exactly.

---

## Future Extensibility

If we need to add more unusable states (broken, uncharged, degraded), we can expand the check:

```typescript
export function itemMatchesToolCategory(itemId: string, category: string): boolean {
  // Items that cannot be used as tools
  if (isNotedItemId(itemId)) return false;
  // Future: if (isBrokenItemId(itemId)) return false;
  // Future: if (isUnchargedItemId(itemId)) return false;

  // ... rest of matching logic
}
```

---

## Summary

| Aspect | Details |
|--------|---------|
| **Root Cause** | Substring matching in `itemMatchesToolCategory()` |
| **Fix** | Add `isNotedItemId()` check at function start |
| **Files Changed** | 1 (`ToolUtils.ts`) |
| **Lines Added** | 2 (import + if check) |
| **Risk** | Minimal - adds early return, no logic changes |
| **Testing** | Unit tests for noted rejection + existing behavior |

---

## Success Criteria

- [ ] `itemMatchesToolCategory()` returns `false` for any `*_noted` item ID
- [ ] Players cannot gather with only noted tools in inventory
- [ ] Players CAN gather when they have both noted and normal tools
- [ ] All existing gathering functionality unchanged for normal tools
- [ ] Fishing tools still require exact matching (unchanged)
- [ ] Unit tests cover noted rejection cases
