# OSRS-Accurate "Use Item" System Implementation Plan

This document outlines the implementation plan to make our "Use X on Y" targeting system match OSRS exactly.

## Current State vs OSRS Target

| Feature | Current | OSRS Target |
|---------|---------|-------------|
| Source item visual | None | White border highlight |
| Cursor states | "pointer" on valid | Valid cursor / Invalid cursor (red X) |
| Hover tooltip | None | "Use X → Y" text |
| Target highlighting | Green glow | None (cursor indicates) |
| UI Banner | Green pulsing banner | None |
| World targeting | Inventory only | World objects + inventory |
| Fire placement | At player position | Where log dropped |
| Post-fire movement | None | Auto-walk 1 tile west |
| Cancel method | ESC/movement/timeout | Click empty space |

---

## Phase 1: Visual Feedback Overhaul

### 1.1 Source Item White Border

**Goal**: When player selects "Use" on an item, that item gets a white border highlight.

**Files to modify**:
- `packages/client/src/game/panels/InventoryPanel.tsx`

**Implementation**:
```typescript
// Add to TargetingState interface
interface TargetingState {
  active: boolean;
  sourceItem: { id: string; slot: number; name?: string } | null;
  sourceSlot: number | null;  // ADD: track source slot for highlighting
  validTargetIds: Set<string>;
  actionType: "firemaking" | "cooking" | "none";
}

// In DraggableInventorySlot, add white border when this is the source item
const isSourceItem = targetingState?.active && targetingState.sourceSlot === index;

// Style for source item:
borderColor: isSourceItem
  ? "rgba(255, 255, 255, 0.95)"  // White border
  : // ... existing logic
borderWidth: isSourceItem ? "2px" : "1px",
boxShadow: isSourceItem
  ? "0 0 8px rgba(255, 255, 255, 0.6)"  // White glow
  : // ... existing logic
```

### 1.2 Custom Cursor States

**Goal**: Cursor changes to indicate valid/invalid targets during targeting mode.

**Files to modify**:
- `packages/client/src/game/panels/InventoryPanel.tsx`
- `packages/client/src/index.css` (or create cursor assets)
- `packages/client/public/cursors/` (new directory for cursor images)

**Cursor assets needed**:
- `cursor-use-valid.png` - Yellow/gold pointer or crosshair (32x32)
- `cursor-use-invalid.png` - Red X cursor (32x32)
- `cursor-use-default.png` - Default "use mode" cursor (32x32)

**Implementation**:
```css
/* Add to global CSS */
.targeting-mode {
  cursor: url('/cursors/cursor-use-default.png') 16 16, crosshair;
}

.targeting-mode .valid-target {
  cursor: url('/cursors/cursor-use-valid.png') 16 16, pointer;
}

.targeting-mode .invalid-target {
  cursor: url('/cursors/cursor-use-invalid.png') 16 16, not-allowed;
}
```

**Alternative (CSS-only, no custom images)**:
```typescript
// In InventoryPanel, apply cursor styles
cursor: isTargetingActive
  ? isValidTarget
    ? "cell"        // Valid target - crosshair-like
    : "not-allowed" // Invalid target - red circle with line
  : // ... existing logic
```

**For world entities** (3D canvas):
- Raycast from mouse position
- Check if hit entity is valid target
- Update document.body.style.cursor based on result

### 1.3 "Use X → Y" Hover Tooltip

**Goal**: Show "Use Tinderbox → Logs" text when hovering over valid targets.

**Files to modify**:
- `packages/client/src/game/panels/InventoryPanel.tsx`
- `packages/client/src/game/ui/ActionTooltip.tsx` (new component)

**Implementation**:

Create new tooltip component:
```typescript
// ActionTooltip.tsx
interface ActionTooltipProps {
  visible: boolean;
  sourceItemName: string;
  targetItemName: string;
  position: { x: number; y: number };
}

export function ActionTooltip({ visible, sourceItemName, targetItemName, position }: ActionTooltipProps) {
  if (!visible) return null;

  return (
    <div
      className="fixed pointer-events-none z-50 px-2 py-1 bg-black/80 border border-yellow-600 text-yellow-400 text-sm font-runescape"
      style={{
        left: position.x + 16,
        top: position.y + 16,
        textShadow: '1px 1px 0 #000'
      }}
    >
      Use {sourceItemName} → {targetItemName}
    </div>
  );
}
```

Track hover state in InventoryPanel:
```typescript
const [hoverTarget, setHoverTarget] = useState<{
  itemName: string;
  position: { x: number; y: number };
} | null>(null);

// On mouse move over valid target slot
onMouseEnter={(e) => {
  if (targetingState.active && isValidTarget) {
    setHoverTarget({
      itemName: item.name || item.itemId,
      position: { x: e.clientX, y: e.clientY }
    });
  }
}}
onMouseLeave={() => setHoverTarget(null)}
```

### 1.4 Remove Green Glow & Banner

**Goal**: Remove non-OSRS visual elements.

**Files to modify**:
- `packages/client/src/game/panels/InventoryPanel.tsx`

**Changes**:
1. Remove the green pulsing banner entirely
2. Remove green glow/border from valid targets
3. Valid targets only indicated by cursor change and tooltip

```typescript
// REMOVE this entire block (lines ~756-772):
{targetingState.active && targetingState.sourceItem && (
  <div className="text-center py-1 px-2 rounded text-xs font-medium animate-pulse" ...>
    Use {targetingState.sourceItem.name} on...
  </div>
)}

// REMOVE green styling from valid targets:
// Before: borderColor: isValidTarget ? "rgba(100, 220, 100, 0.9)" : ...
// After: borderColor: isSourceItem ? "rgba(255, 255, 255, 0.95)" : ... (normal for targets)
```

---

## Phase 2: World Entity Targeting

### 2.1 Enable Clicking World Objects During Targeting

**Goal**: When in "Use" targeting mode, clicking on fires/ranges in the 3D world should work.

**Files to modify**:
- `packages/shared/src/systems/client/interaction/ItemTargetingSystem.ts`
- `packages/client/src/game/Game.tsx` (or wherever click handling occurs)
- `packages/shared/src/systems/shared/interaction/InventoryInteractionSystem.ts`

**Implementation**:

Add world click handler during targeting:
```typescript
// In Game.tsx or InputSystem, when targeting is active:
const handleWorldClick = (event: MouseEvent) => {
  if (!targetingState.active) return;

  // Raycast to find clicked entity
  const intersects = raycaster.intersectObjects(scene.children, true);

  for (const hit of intersects) {
    const userData = hit.object.userData;

    // Check if this is a fire
    if (userData.type === 'fire' && targetingState.actionType === 'cooking') {
      world.emit(EventType.TARGETING_SELECT, {
        playerId: localPlayer.id,
        sourceItemId: targetingState.sourceItem.id,
        sourceSlot: targetingState.sourceItem.slot,
        targetId: userData.fireId,
        targetType: 'world_entity',
      });
      return;
    }

    // Check if this is a range/stove
    if (userData.type === 'range' && targetingState.actionType === 'cooking') {
      world.emit(EventType.TARGETING_SELECT, {
        playerId: localPlayer.id,
        sourceItemId: targetingState.sourceItem.id,
        sourceSlot: targetingState.sourceItem.slot,
        targetId: userData.entityId,
        targetType: 'world_entity',
      });
      return;
    }
  }
};
```

### 2.2 World Entity Cursor Feedback

**Goal**: Change cursor when hovering over valid world targets.

**Implementation**:
```typescript
// On mouse move during targeting mode:
const handleWorldMouseMove = (event: MouseEvent) => {
  if (!targetingState.active) return;

  const intersects = raycaster.intersectObjects(scene.children, true);

  let foundValidTarget = false;
  for (const hit of intersects) {
    const userData = hit.object.userData;
    if (isValidWorldTarget(userData, targetingState.actionType)) {
      foundValidTarget = true;
      document.body.style.cursor = 'url(/cursors/cursor-use-valid.png) 16 16, pointer';

      // Show tooltip
      setWorldHoverTarget({
        name: userData.name || 'Fire',
        position: { x: event.clientX, y: event.clientY }
      });
      break;
    }
  }

  if (!foundValidTarget) {
    document.body.style.cursor = 'url(/cursors/cursor-use-invalid.png) 16 16, not-allowed';
    setWorldHoverTarget(null);
  }
};
```

---

## Phase 3: Firemaking Mechanics

### 3.1 Drop Log Before Lighting

**Goal**: When lighting a fire, the log should be dropped to the ground first, then lit.

**Files to modify**:
- `packages/shared/src/systems/shared/interaction/ProcessingSystem.ts`
- `packages/server/src/systems/ServerNetwork/index.ts`

**Implementation**:
```typescript
// In ProcessingSystem.startFiremakingProcess():

// 1. Remove log from inventory immediately
this.emitTypedEvent(EventType.INVENTORY_ITEM_REMOVED, {
  playerId,
  itemId: logsId,
  quantity: 1,
  slot: logsSlot,
});

// 2. Create temporary "dropped log" entity at player position
const droppedLogPosition = {
  x: player.node.position.x,
  y: 0, // Ground level
  z: player.node.position.z,
};

this.emitTypedEvent(EventType.GROUND_ITEM_CREATED, {
  itemId: logsId,
  position: droppedLogPosition,
  temporary: true, // Will be replaced by fire
  ownerId: playerId,
});

// 3. Show "attempting to light" message
this.emitTypedEvent(EventType.UI_MESSAGE, {
  playerId,
  message: "You attempt to light the logs...",
  type: "info",
});

// 4. After duration, create fire at log position (not player position)
setTimeout(() => {
  this.completeFiremaking(playerId, action, droppedLogPosition);
}, this.FIREMAKING_TIME);
```

### 3.2 Auto-Walk After Lighting Fire

**Goal**: Player walks 1 tile west after successfully lighting a fire.

**Files to modify**:
- `packages/shared/src/systems/shared/interaction/ProcessingSystem.ts`

**Implementation**:
```typescript
// In completeFiremakingProcess(), after fire is created:

// Calculate walk destination (1 tile west, or fallback directions)
const walkDirections = [
  { x: -1, z: 0 },  // West (primary)
  { x: 1, z: 0 },   // East (fallback 1)
  { x: 0, z: 1 },   // South (fallback 2)
  { x: 0, z: -1 },  // North (fallback 3)
];

const TILE_SIZE = 1; // Adjust based on your tile scale

for (const dir of walkDirections) {
  const targetPos = {
    x: position.x + dir.x * TILE_SIZE,
    y: position.y,
    z: position.z + dir.z * TILE_SIZE,
  };

  // Check if tile is walkable (no collision)
  if (this.isTileWalkable(targetPos)) {
    // Move player to this position
    this.emitTypedEvent(EventType.PLAYER_FORCE_MOVE, {
      playerId,
      position: targetPos,
      instant: false, // Animate the walk
    });
    break;
  }
}
```

---

## Phase 4: Cancellation & Polish

### 4.1 Click Empty Space to Cancel

**Goal**: Clicking on empty ground/invalid targets cancels targeting mode.

**Files to modify**:
- `packages/client/src/game/panels/InventoryPanel.tsx`
- `packages/client/src/game/Game.tsx`

**Implementation**:
```typescript
// In world click handler:
const handleWorldClick = (event: MouseEvent) => {
  if (!targetingState.active) return;

  const intersects = raycaster.intersectObjects(scene.children, true);

  // Check for valid target
  let foundValidTarget = false;
  for (const hit of intersects) {
    if (isValidWorldTarget(hit.object.userData, targetingState.actionType)) {
      foundValidTarget = true;
      // ... handle valid target click
      break;
    }
  }

  // If no valid target found, cancel targeting
  if (!foundValidTarget) {
    world.emit(EventType.TARGETING_CANCEL, { playerId: localPlayer.id });
  }
};

// In InventoryPanel, clicking invalid slot cancels:
onClick={(e) => {
  if (isTargetingActive && !isValidTarget) {
    // Cancel targeting when clicking invalid inventory slot
    world?.emit(EventType.TARGETING_CANCEL, { playerId: localPlayer.id });
    return;
  }
  // ... existing logic
}}
```

### 4.2 Remove Timeout-Based Cancellation

**Goal**: OSRS doesn't auto-cancel after 30 seconds.

**Files to modify**:
- `packages/shared/src/systems/client/interaction/ItemTargetingSystem.ts`

**Implementation**:
```typescript
// REMOVE the 30-second timeout:
// DELETE: setTimeout(() => this.cancelTargeting(), 30000);
```

---

## Phase 5: Messages & Audio

### 5.1 OSRS-Accurate Messages

**Firemaking messages**:
- Start: `"You attempt to light the logs."`
- Success: `"The fire catches and the logs begin to burn."`
- Fail (level): `"You need a Firemaking level of X to burn these logs."`
- Fail (location): `"You can't light a fire here."`

**Cooking messages**:
- Start: `"You cook the raw shrimps."`
- Success: `"You successfully cook the shrimps."`
- Burn: `"You accidentally burn the shrimps."`

### 5.2 Sound Effects (Future)

Add sound triggers for:
- Fire lighting success
- Fire crackling (loop while active)
- Cooking sizzle
- Burn sound

---

## Implementation Order

### Sprint 1: Core Visual Feedback (Priority: Critical)
1. [ ] Add white border to source item during targeting
2. [ ] Implement cursor state changes (valid/invalid)
3. [ ] Add "Use X → Y" hover tooltip
4. [ ] Remove green glow and banner

### Sprint 2: World Targeting (Priority: Critical)
5. [ ] Enable clicking world objects during targeting
6. [ ] Add world entity cursor feedback
7. [ ] Implement cooking on world fires

### Sprint 3: Firemaking Polish (Priority: Medium)
8. [ ] Drop log to ground before lighting
9. [ ] Fire spawns at log position
10. [ ] Auto-walk 1 tile west after lighting

### Sprint 4: Cancellation & Messages (Priority: Low)
11. [ ] Click empty space to cancel targeting
12. [ ] Remove timeout-based cancellation
13. [ ] Update all messages to match OSRS exactly

---

## Testing Checklist

### Visual Feedback Tests
- [ ] Right-click tinderbox → "Use" → tinderbox has white border
- [ ] Hover over logs → cursor changes to valid cursor
- [ ] Hover over empty slot → cursor changes to invalid cursor
- [ ] Hover over logs → tooltip shows "Use Tinderbox → Logs"
- [ ] No green glow on any items
- [ ] No green banner at top of inventory

### World Targeting Tests
- [ ] Light a fire with tinderbox + logs
- [ ] Right-click raw fish → "Use"
- [ ] Click on fire in world → cooking starts
- [ ] Hover over fire → valid cursor + tooltip "Use Raw Shrimps → Fire"
- [ ] Hover over empty ground → invalid cursor

### Firemaking Flow Tests
- [ ] Use tinderbox on logs → log removed from inventory
- [ ] Log appears on ground briefly
- [ ] Fire appears where log was dropped
- [ ] Player auto-walks 1 tile west
- [ ] If west blocked, walks east/south/north
- [ ] Message: "You attempt to light the logs."
- [ ] Message: "The fire catches and the logs begin to burn."

### Cancellation Tests
- [ ] Click empty inventory slot → targeting cancelled
- [ ] Click empty ground in world → targeting cancelled
- [ ] Right-click → targeting cancelled
- [ ] No 30-second auto-cancel

---

## Asset Requirements

### Cursor Images (32x32 PNG with transparency)
1. `cursor-use-valid.png` - Yellow/gold crosshair or hand
2. `cursor-use-invalid.png` - Red X or prohibited symbol
3. `cursor-use-default.png` - Default targeting cursor

### Reference
- OSRS cursor sprites can be found in the OSRS cache or wiki
- Match the pixelated, oldschool aesthetic

---

## Notes

- All changes should be tested on both desktop and mobile
- Cursor changes may need fallback for touch devices (use toast/banner on mobile only)
- Consider adding subtle highlight on world objects when hovering during targeting (optional polish)
