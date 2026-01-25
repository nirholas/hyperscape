# Trading System Upgrade Plan

> **Goal**: Upgrade the player-to-player trading system from 7.4/10 to 9/10 based on production quality, security, and OSRS accuracy criteria.

## Executive Summary

The trading system has solid foundations (server-authoritative, atomic transactions, comprehensive tests) but has critical gaps preventing production readiness:

1. **UI not wired** - TradePanel exists but isn't rendered
2. **Security hole** - `tradeable` flag not enforced
3. **Missing OSRS mechanics** - No two-screen confirmation, no proximity check
4. **Cleanup bug** - TradingSystem not destroyed on shutdown
5. **No interface blocking** - Can receive trade while bank/store is open
6. **No movement cancellation** - Trade doesn't cancel when players walk apart

This plan addresses all issues in priority order with specific file changes.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CLIENT SIDE                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│  InterfaceManager.tsx                                                        │
│    ├── Listens to UI_UPDATE events                                          │
│    ├── Renders TradeRequestModal (incoming request popup)                    │
│    └── Renders TradePanel (active trade window)                             │
│                                                                              │
│  ClientNetwork.ts (already implemented)                                      │
│    ├── onTradeIncoming → emits UI_UPDATE "tradeRequest"                     │
│    ├── onTradeStarted → emits UI_UPDATE "trade"                             │
│    ├── onTradeUpdated → emits UI_UPDATE "tradeUpdate"                       │
│    ├── onTradeCompleted → emits UI_UPDATE "tradeClose"                      │
│    ├── onTradeCancelled → emits UI_UPDATE "tradeClose"                      │
│    └── onTradeError → emits UI_TOAST                                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                              SERVER SIDE                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│  ServerNetwork/index.ts                                                      │
│    ├── Registers all trade packet handlers                                   │
│    ├── Creates TradingSystem instance                                        │
│    └── Should call tradingSystem.destroy() on shutdown                       │
│                                                                              │
│  handlers/trade.ts                                                           │
│    ├── handleTradeRequest (proximity + tradeable validation needed)          │
│    ├── handleTradeRequestRespond                                             │
│    ├── handleTradeAddItem (tradeable validation needed)                      │
│    ├── handleTradeRemoveItem                                                 │
│    ├── handleTradeSetQuantity                                                │
│    ├── handleTradeAccept (two-screen logic needed)                          │
│    ├── handleTradeCancelAccept                                               │
│    ├── handleTradeCancel                                                     │
│    └── executeTradeSwap (tradeable re-validation needed)                     │
│                                                                              │
│  TradingSystem/index.ts                                                      │
│    ├── Trade session state management                                        │
│    ├── Already has destroy() method (just needs to be called)               │
│    └── Needs moveToConfirmation() for two-screen flow                        │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Current Scores → Target Scores

| Criterion | Current | Target | Key Changes |
|-----------|---------|--------|-------------|
| Production Quality | 8/10 | 9/10 | Add tradeable validation, fix destroy() |
| Best Practices | 8/10 | 9/10 | Wire UI, add missing tests |
| OWASP Security | 7/10 | 9/10 | Enforce tradeable, add proximity check |
| Game Studio Audit | 7/10 | 9/10 | Two-screen confirm, item removal warnings |
| Memory Hygiene | 6/10 | 8/10 | Fix cleanup leak, reduce allocations |
| SOLID Principles | 8/10 | 8/10 | No changes needed |
| OSRS Likeness | 7/10 | 9/10 | Two-screen, wealth indicator, warnings |

---

## Phase 1: Critical Fixes (P0)

### 1.1 Wire TradePanel to UI

**Problem**: `TradePanel` and `TradeRequestModal` components exist but are never rendered. The `ClientNetwork.ts` emits `UI_UPDATE` events but `InterfaceManager.tsx` doesn't handle them.

**Files to modify**:
- `packages/client/src/components/interface/InterfaceManager.tsx`

**Step-by-step implementation**:

#### Step 1.1.1: Add imports (near top of file, ~line 50)
```typescript
import { TradePanel, TradeRequestModal } from "../../game/panels";
import type { TradeWindowState, TradeRequestModalState, TradeOfferItem } from "@hyperscape/shared";
```

#### Step 1.1.2: Add state variables (inside InterfaceManager component, ~line 200)
```typescript
// Trade UI state
const [tradeState, setTradeState] = useState<TradeWindowState>({
  isOpen: false,
  tradeId: null,
  partner: null,
  myOffer: [],
  myAccepted: false,
  theirOffer: [],
  theirAccepted: false,
  screen: "offer",
});

const [tradeRequestState, setTradeRequestState] = useState<TradeRequestModalState>({
  visible: false,
  tradeId: null,
  fromPlayer: null,
});
```

#### Step 1.1.3: Add trade handlers to existing onUIUpdate function (~line 1498)

Find the existing `onUIUpdate` function and add these cases inside it:
```typescript
const onUIUpdate = (raw: unknown) => {
  const update = raw as { component: string; data: unknown };

  // ... existing handlers for "player", "equipment", etc. ...

  // ADD: Trade request modal
  if (update.component === "tradeRequest") {
    const data = update.data as {
      visible: boolean;
      tradeId: string;
      fromPlayer: { id: string; name: string; level: number };
    };
    setTradeRequestState({
      visible: data.visible,
      tradeId: data.tradeId,
      fromPlayer: data.fromPlayer,
    });
  }

  // ADD: Trade window opened
  if (update.component === "trade") {
    const data = update.data as {
      isOpen: boolean;
      tradeId: string;
      partner: { id: string; name: string; level: number };
    };
    setTradeState(prev => ({
      ...prev,
      isOpen: data.isOpen,
      tradeId: data.tradeId,
      partner: data.partner,
      myOffer: [],
      theirOffer: [],
      myAccepted: false,
      theirAccepted: false,
      screen: "offer",
    }));
    // Close request modal when trade starts
    setTradeRequestState(prev => ({ ...prev, visible: false }));
  }

  // ADD: Trade state updated
  if (update.component === "tradeUpdate") {
    const data = update.data as {
      tradeId: string;
      myOffer: TradeOfferItem[];
      myAccepted: boolean;
      theirOffer: TradeOfferItem[];
      theirAccepted: boolean;
    };
    setTradeState(prev => ({
      ...prev,
      myOffer: data.myOffer,
      myAccepted: data.myAccepted,
      theirOffer: data.theirOffer,
      theirAccepted: data.theirAccepted,
    }));
  }

  // ADD: Trade closed (completed or cancelled)
  if (update.component === "tradeClose") {
    setTradeState(prev => ({
      ...prev,
      isOpen: false,
      tradeId: null,
      partner: null,
      myOffer: [],
      theirOffer: [],
    }));
    setTradeRequestState(prev => ({ ...prev, visible: false }));
  }
};
```

#### Step 1.1.4: Render the components (in the JSX return, ~line 2200)

Add before the closing fragment or after other modals:
```tsx
{/* Trade Request Modal */}
{tradeRequestState.visible && tradeRequestState.fromPlayer && (
  <TradeRequestModal
    state={tradeRequestState}
    onAccept={() => {
      if (tradeRequestState.tradeId) {
        world.network?.respondToTradeRequest(tradeRequestState.tradeId, true);
      }
    }}
    onDecline={() => {
      if (tradeRequestState.tradeId) {
        world.network?.respondToTradeRequest(tradeRequestState.tradeId, false);
      }
      setTradeRequestState(prev => ({ ...prev, visible: false }));
    }}
  />
)}

{/* Trade Panel */}
{tradeState.isOpen && tradeState.tradeId && (
  <TradePanel
    state={tradeState}
    inventory={inventory.map((item, idx) => ({
      slot: item.slot ?? idx,
      itemId: item.itemId,
      quantity: item.quantity,
    }))}
    onAddItem={(slot, quantity) => {
      world.network?.addItemToTrade(tradeState.tradeId!, slot, quantity);
    }}
    onRemoveItem={(tradeSlot) => {
      world.network?.removeItemFromTrade(tradeState.tradeId!, tradeSlot);
    }}
    onAccept={() => {
      world.network?.acceptTrade(tradeState.tradeId!);
    }}
    onCancel={() => {
      world.network?.cancelTrade(tradeState.tradeId!);
      setTradeState(prev => ({ ...prev, isOpen: false }));
    }}
  />
)}
```

**Tests to add**:
- Integration test: Trade request shows modal
- Integration test: Accepting trade opens TradePanel
- Integration test: Trade completion closes panel

---

### 1.2 Enforce `tradeable` Flag

**Problem**: Items have `tradeable: boolean` in `item-types.ts:150` but it's never checked. Untradeable items (quest items, skill outfits, etc.) can be traded.

**Files to modify**:
- `packages/server/src/systems/ServerNetwork/handlers/trade.ts`
- `packages/shared/src/types/game/trade-types.ts`

**Step-by-step implementation**:

#### Step 1.2.1: Add tradeable check in handleTradeAddItem (trade.ts ~line 447)

Find this existing code block:
```typescript
// Validate item exists in item database
const itemData = getItem(inventoryItem.itemId);
if (!itemData) {
  sendTradeError(socket, "Invalid item", "INVALID_ITEM");
  return;
}
```

Add immediately after:
```typescript
// Validate item is tradeable
if (itemData.tradeable === false) {
  sendTradeError(socket, "That item cannot be traded", "UNTRADEABLE_ITEM");
  return;
}
```

#### Step 1.2.2: Add tradeable re-validation in executeTradeSwap (trade.ts ~line 837)

Find the validation loop that starts with:
```typescript
for (const offer of session.initiator.offeredItems) {
  const item = initiatorInventory.find(
    (i) => i.slotIndex === offer.inventorySlot,
  );
  if (
    !item ||
    item.itemId !== offer.itemId ||
    item.quantity < offer.quantity
  ) {
    throw new Error("ITEM_CHANGED");
  }
}
```

Replace it with:
```typescript
for (const offer of session.initiator.offeredItems) {
  const item = initiatorInventory.find(
    (i) => i.slotIndex === offer.inventorySlot,
  );
  if (
    !item ||
    item.itemId !== offer.itemId ||
    item.quantity < offer.quantity
  ) {
    throw new Error("ITEM_CHANGED");
  }

  // Re-validate tradeable at swap time (item could have been modified)
  const itemDef = getItem(offer.itemId);
  if (!itemDef || itemDef.tradeable === false) {
    throw new Error("UNTRADEABLE_ITEM");
  }
}

// Same for recipient's items
for (const offer of session.recipient.offeredItems) {
  const item = recipientInventory.find(
    (i) => i.slotIndex === offer.inventorySlot,
  );
  if (
    !item ||
    item.itemId !== offer.itemId ||
    item.quantity < offer.quantity
  ) {
    throw new Error("ITEM_CHANGED");
  }

  const itemDef = getItem(offer.itemId);
  if (!itemDef || itemDef.tradeable === false) {
    throw new Error("UNTRADEABLE_ITEM");
  }
}
```

#### Step 1.2.3: Add error message mapping (trade.ts ~line 994)

Find the errorMessages object and add:
```typescript
errorMessages: {
  ITEM_CHANGED: "Items changed during trade",
  INVENTORY_FULL_INITIATOR: "Your inventory is full",
  INVENTORY_FULL_RECIPIENT: "Partner's inventory is full",
  UNTRADEABLE_ITEM: "Trade contains untradeable items",  // ADD THIS
},
```

#### Step 1.2.4: Add error code to types (trade-types.ts ~line 260)

Find the `TradeErrorPayload.code` union type and add:
```typescript
code:
  | "NOT_IN_TRADE"
  | "INVALID_TRADE"
  | "INVALID_ITEM"
  | "INVALID_SLOT"
  | "INVALID_QUANTITY"
  | "INVENTORY_FULL"
  | "ALREADY_IN_TRADE"
  | "PLAYER_BUSY"
  | "PLAYER_OFFLINE"
  | "RATE_LIMITED"
  | "SELF_TRADE"
  | "UNTRADEABLE_ITEM";  // ADD THIS
```

**Tests to add** (`trade.integration.test.ts`):
```typescript
describe("Untradeable Items", () => {
  it("rejects adding untradeable item to trade", () => {
    // Setup: Create item with tradeable: false in test data
    // Act: Try to add it to trade offer
    // Assert: Expect error with code "UNTRADEABLE_ITEM"
  });

  it("rejects swap if item became untradeable between add and swap", () => {
    // This tests the re-validation during executeTradeSwap
  });
});
```

---

### 1.3 Fix TradingSystem Cleanup on Shutdown

**Problem**: `ServerNetwork.destroy()` at line 2139 doesn't call `tradingSystem.destroy()`. The TradingSystem has a cleanup interval running every 10 seconds that will leak, and active trades won't be properly cancelled.

**Note**: The `TradingSystem.destroy()` method already exists (lines 126-140) and properly:
- Clears the cleanup interval
- Cancels all active trades with "server_error" reason
- Clears all Maps

We just need to call it.

**File to modify**:
- `packages/server/src/systems/ServerNetwork/index.ts`

**Step-by-step implementation**:

#### Step 1.3.1: Add destroy call (ServerNetwork/index.ts line 2139)

Find the existing `destroy()` method:
```typescript
override destroy(): void {
  this.socketManager.destroy();
  this.saveManager.destroy();
  this.interactionSessionManager.destroy();
  this.tickSystem.stop();

  for (const [_id, socket] of this.sockets) {
    socket.close?.();
  }
  this.sockets.clear();
}
```

Replace with:
```typescript
override destroy(): void {
  // Destroy trading system first - cancels all active trades and clears cleanup interval
  if (this.tradingSystem) {
    this.tradingSystem.destroy();
  }

  this.socketManager.destroy();
  this.saveManager.destroy();
  this.interactionSessionManager.destroy();
  this.tickSystem.stop();

  for (const [_id, socket] of this.sockets) {
    socket.close?.();
  }
  this.sockets.clear();
}
```

**Verification**: The TradingSystem.destroy() method at line 126-140 does:
```typescript
destroy(): void {
  if (this.cleanupInterval) {
    clearInterval(this.cleanupInterval);
    this.cleanupInterval = null;
  }

  // Cancel all active trades
  for (const [tradeId] of this.tradeSessions) {
    this.cancelTrade(tradeId, "server_error");
  }

  this.tradeSessions.clear();
  this.playerTrades.clear();
  this.requestCooldowns.clear();
}
```

---

## Phase 2: OSRS Accuracy (P1)

### 2.1 Add Proximity Check

**Problem**: Players can trade from anywhere on the map. In OSRS, players must be within 1 tile (adjacent, including diagonals) to initiate and maintain a trade.

**Note**: There's already a `getEntityPosition` helper in `handlers/common/helpers.ts:126` that we can reuse.

**Files to modify**:
- `packages/server/src/systems/ServerNetwork/handlers/trade.ts`
- `packages/shared/src/types/game/trade-types.ts`

**Step-by-step implementation**:

#### Step 2.1.1: Import the existing helper (trade.ts ~line 44)

Add to imports:
```typescript
import {
  executeSecureTransaction,
  sendToSocket,
  sendSuccessToast,
  getPlayerId,
  getEntityPosition,  // ADD THIS
} from "./common";
```

#### Step 2.1.2: Add proximity check in handleTradeRequest (trade.ts ~line 258)

Find this code block:
```typescript
if (!tradingSystem.isPlayerOnline(targetPlayerId)) {
  sendTradeError(socket, "Player is not online", "PLAYER_OFFLINE");
  return;
}
```

Add immediately after:
```typescript
// Proximity check - must be within 1 tile (OSRS requires adjacent)
const TRADE_DISTANCE_TILES = 1;

const initiatorEntity = world.entities?.players?.get(playerId);
const targetEntity = world.entities?.players?.get(targetPlayerId);

const initiatorPos = getEntityPosition(initiatorEntity);
const targetPos = getEntityPosition(targetEntity);

if (initiatorPos && targetPos) {
  // Chebyshev distance (max of x/z difference) - OSRS style
  const distance = Math.max(
    Math.abs(Math.floor(initiatorPos.x) - Math.floor(targetPos.x)),
    Math.abs(Math.floor(initiatorPos.z) - Math.floor(targetPos.z))
  );

  if (distance > TRADE_DISTANCE_TILES) {
    sendTradeError(socket, "You need to move closer to trade", "TOO_FAR");
    return;
  }
}
```

#### Step 2.1.3: Add error code to types (trade-types.ts ~line 260)

Add to the `TradeErrorPayload.code` union:
```typescript
| "TOO_FAR"
```

#### Step 2.1.4 (Optional - Future): Cancel trade when players move apart

In OSRS, the trade cancels if players walk too far apart. This requires:
1. Subscribing to player movement events in TradingSystem
2. Checking distance on each movement
3. Cancelling trade if distance exceeds threshold

Add to `TradingSystem.init()`:
```typescript
// Cancel trade if players move too far apart
this.world.on(EventType.ENTITY_TILE_UPDATE, (payload: unknown) => {
  const data = payload as { entityId: string };
  const tradeId = this.getPlayerTradeId(data.entityId);
  if (!tradeId) return;

  const session = this.tradeSessions.get(tradeId);
  if (!session || session.status !== "active") return;

  // Check distance between both players
  const initiator = this.world.entities?.players?.get(session.initiator.playerId);
  const recipient = this.world.entities?.players?.get(session.recipient.playerId);

  if (initiator && recipient) {
    const pos1 = getEntityPosition(initiator);
    const pos2 = getEntityPosition(recipient);

    if (pos1 && pos2) {
      const distance = Math.max(
        Math.abs(Math.floor(pos1.x) - Math.floor(pos2.x)),
        Math.abs(Math.floor(pos1.z) - Math.floor(pos2.z))
      );

      if (distance > 15) { // OSRS uses ~15 tiles
        this.cancelTrade(tradeId, "cancelled");
      }
    }
  }
});
```

**Tests to add** (`trade.integration.test.ts`):
```typescript
describe("Proximity", () => {
  it("rejects trade request when players are far apart", () => {
    // Position players 10 tiles apart
    // Request trade
    // Expect TOO_FAR error
  });

  it("allows trade when players are adjacent (1 tile)", () => {
    // Position players 1 tile apart
    // Request trade
    // Expect success
  });

  it("allows trade when players are diagonally adjacent", () => {
    // Position players diagonally (1,1 offset)
    // Request trade
    // Expect success (Chebyshev distance = 1)
  });
});
```

---

### 2.2 Interface Blocking Check

**Problem**: In OSRS, you can't receive a trade request while you have the bank, store, or another trade window open. The message "That player is busy" is shown.

**Files to modify**:
- `packages/server/src/systems/ServerNetwork/handlers/trade.ts`
- `packages/server/src/systems/TradingSystem/index.ts`

**Step-by-step implementation**:

#### Step 2.2.1: Add session check in handleTradeRequest (trade.ts ~line 252)

Find after the online check and before proximity check, add:
```typescript
// Check if target player is busy (has another interface open)
const sessionManager = getSessionManager(world);
if (sessionManager) {
  const targetSession = sessionManager.getSession(targetPlayerId);
  if (targetSession) {
    sendTradeError(socket, "That player is busy", "PLAYER_BUSY");
    return;
  }
}

// Also check if target is already in a trade
if (tradingSystem.isPlayerInTrade(targetPlayerId)) {
  sendTradeError(socket, "That player is already trading", "PLAYER_BUSY");
  return;
}
```

#### Step 2.2.2: Import getSessionManager (trade.ts ~line 44)

```typescript
import {
  executeSecureTransaction,
  sendToSocket,
  sendSuccessToast,
  getPlayerId,
  getEntityPosition,
  getSessionManager,  // ADD THIS
} from "./common";
```

---

### 2.3 Two-Screen Confirmation System

**Problem**: Single accept. OSRS has two screens:
1. **Offer Screen**: Add/remove items, see abbreviated values (10M, 1,234K)
2. **Confirmation Screen**: Read-only, shows FULL exact values (10,435,672), both must accept again

**Files to modify**:
- `packages/shared/src/types/game/trade-types.ts`
- `packages/shared/src/platform/shared/packets.ts`
- `packages/server/src/systems/TradingSystem/index.ts`
- `packages/server/src/systems/ServerNetwork/handlers/trade.ts`
- `packages/client/src/game/panels/TradePanel/TradePanel.tsx`
- `packages/shared/src/systems/client/ClientNetwork.ts`

**Step-by-step implementation**:

#### Step 2.3.1: Update TradeStatus type (trade-types.ts ~line 29)

```typescript
// Before
export type TradeStatus = "pending" | "active" | "completed" | "cancelled";

// After
export type TradeStatus = "pending" | "active" | "confirming" | "completed" | "cancelled";
```

#### Step 2.3.2: Add new payload type (trade-types.ts ~line 230)

Add after `TradeUpdatedPayload`:
```typescript
/**
 * Trade confirmation screen (second screen)
 */
export type TradeConfirmScreenPayload = {
  /** Trade session ID */
  tradeId: string;
  /** My offered items (frozen for confirmation) */
  myOffer: TradeOfferItem[];
  /** Partner's offered items (frozen for confirmation) */
  theirOffer: TradeOfferItem[];
  /** Total value of my offer in GP */
  myOfferValue: number;
  /** Total value of their offer in GP */
  theirOfferValue: number;
};
```

#### Step 2.3.3: Update TradeWindowState (trade-types.ts ~line 280)

```typescript
export type TradeWindowState = {
  isOpen: boolean;
  tradeId: string | null;
  partner: { id: PlayerID; name: string; level: number } | null;
  myOffer: TradeOfferItem[];
  myAccepted: boolean;
  theirOffer: TradeOfferItem[];
  theirAccepted: boolean;
  screen: "offer" | "confirm";  // ADD: Which screen we're on
  myOfferValue?: number;        // ADD: For confirm screen
  theirOfferValue?: number;     // ADD: For confirm screen
};
```

#### Step 2.3.4: Add packet (packets.ts ~line 285)

Add after `'tradeError'`:
```typescript
'tradeConfirmScreen',  // Server -> Client: both accepted on screen 1, show confirmation
```

#### Step 2.3.5: Add moveToConfirmation method (TradingSystem/index.ts ~line 580)

Add before `cancelTrade`:
```typescript
/**
 * Move trade to confirmation phase after both accept on offer screen
 */
moveToConfirmation(tradeId: string): { success: boolean; error?: string; errorCode?: string } {
  const session = this.tradeSessions.get(tradeId);
  if (!session) {
    return { success: false, error: "Trade not found", errorCode: "INVALID_TRADE" };
  }

  if (session.status !== "active") {
    return { success: false, error: "Trade not active", errorCode: "NOT_IN_TRADE" };
  }

  if (!session.initiator.accepted || !session.recipient.accepted) {
    return { success: false, error: "Both must accept", errorCode: "NOT_ACCEPTED" };
  }

  // Move to confirmation phase
  session.status = "confirming";

  // Reset acceptance for second round
  session.initiator.accepted = false;
  session.recipient.accepted = false;

  // Update activity timestamp
  session.lastActivityAt = Date.now();

  return { success: true };
}
```

#### Step 2.3.6: Update setAcceptance to handle confirming status (TradingSystem/index.ts ~line 520)

Modify the existing `setAcceptance` method to work with both statuses:
```typescript
setAcceptance(
  tradeId: string,
  playerId: string,
  accepted: boolean,
): { success: boolean; bothAccepted?: boolean; error?: string; errorCode?: string } {
  const session = this.tradeSessions.get(tradeId);
  if (!session) {
    return { success: false, error: "Trade not found", errorCode: "INVALID_TRADE" };
  }

  // Allow acceptance in both "active" and "confirming" statuses
  if (session.status !== "active" && session.status !== "confirming") {
    return { success: false, error: "Trade not active", errorCode: "NOT_IN_TRADE" };
  }

  // ... rest of existing logic ...
}
```

#### Step 2.3.7: Update handleTradeAccept (trade.ts ~line 607)

Replace the `if (result.bothAccepted)` block:
```typescript
if (result.bothAccepted) {
  const session = tradingSystem.getTradeSession(data.tradeId);
  if (!session) return;

  if (session.status === "active") {
    // First accept phase complete → move to confirmation screen
    const confirmResult = tradingSystem.moveToConfirmation(data.tradeId);
    if (!confirmResult.success) {
      sendTradeError(socket, confirmResult.error!, confirmResult.errorCode || "UNKNOWN");
      return;
    }

    // Calculate offer values
    const initiatorValue = calculateOfferValue(session.initiator.offeredItems);
    const recipientValue = calculateOfferValue(session.recipient.offeredItems);

    // Send confirmation screen to initiator
    const initiatorSocket = getSocketByPlayerId(world, session.initiator.playerId);
    if (initiatorSocket) {
      sendToSocket(initiatorSocket, "tradeConfirmScreen", {
        tradeId: data.tradeId,
        myOffer: session.initiator.offeredItems,
        theirOffer: session.recipient.offeredItems,
        myOfferValue: initiatorValue,
        theirOfferValue: recipientValue,
      });
    }

    // Send confirmation screen to recipient (swap my/their)
    const recipientSocket = getSocketByPlayerId(world, session.recipient.playerId);
    if (recipientSocket) {
      sendToSocket(recipientSocket, "tradeConfirmScreen", {
        tradeId: data.tradeId,
        myOffer: session.recipient.offeredItems,
        theirOffer: session.initiator.offeredItems,
        myOfferValue: recipientValue,
        theirOfferValue: initiatorValue,
      });
    }

  } else if (session.status === "confirming") {
    // Second accept phase complete → execute the swap
    await executeTradeSwap(tradingSystem, data.tradeId, world, db);
  }
}
```

#### Step 2.3.8: Add calculateOfferValue helper (trade.ts ~line 95)

```typescript
/**
 * Calculate total GP value of trade offer
 */
function calculateOfferValue(items: TradeOfferItem[]): number {
  let total = 0;
  for (const item of items) {
    const itemDef = getItem(item.itemId);
    if (itemDef?.value) {
      total += itemDef.value * item.quantity;
    }
  }
  return total;
}
```

#### Step 2.3.9: Add client handler (ClientNetwork.ts ~line 2135)

Add new handler:
```typescript
/**
 * Trade confirmation screen (both accepted on offer screen)
 */
onTradeConfirmScreen = (data: {
  tradeId: string;
  myOffer: TradeOfferItem[];
  theirOffer: TradeOfferItem[];
  myOfferValue: number;
  theirOfferValue: number;
}) => {
  this.world.emit(EventType.UI_UPDATE, {
    component: "tradeConfirmScreen",
    data: {
      tradeId: data.tradeId,
      screen: "confirm",
      myOffer: data.myOffer,
      theirOffer: data.theirOffer,
      myOfferValue: data.myOfferValue,
      theirOfferValue: data.theirOfferValue,
      myAccepted: false,
      theirAccepted: false,
    },
  });
};
```

#### Step 2.3.10: Update InterfaceManager for confirm screen

Add handler in onUIUpdate:
```typescript
if (update.component === "tradeConfirmScreen") {
  const data = update.data as {
    tradeId: string;
    screen: "confirm";
    myOffer: TradeOfferItem[];
    theirOffer: TradeOfferItem[];
    myOfferValue: number;
    theirOfferValue: number;
  };
  setTradeState(prev => ({
    ...prev,
    screen: "confirm",
    myOffer: data.myOffer,
    theirOffer: data.theirOffer,
    myOfferValue: data.myOfferValue,
    theirOfferValue: data.theirOfferValue,
    myAccepted: false,
    theirAccepted: false,
  }));
}
```

#### Step 2.3.11: Update TradePanel UI (TradePanel.tsx)

The TradePanel needs to render differently based on screen:
```typescript
// At component start
const isConfirmScreen = state.screen === "confirm";

// In JSX - show different UI based on screen
{isConfirmScreen ? (
  <ConfirmationView
    myOffer={state.myOffer}
    theirOffer={state.theirOffer}
    myValue={state.myOfferValue}
    theirValue={state.theirOfferValue}
    myAccepted={state.myAccepted}
    theirAccepted={state.theirAccepted}
    onAccept={onAccept}
    onDecline={onCancel}
    formatQuantity={formatQuantityExact}  // Full numbers on confirm
  />
) : (
  <OfferView
    // ... existing offer screen props
    formatQuantity={formatQuantityAbbrev}  // Abbreviated on offer
  />
)}
```

---

### 2.3 Item Removal Warning

**Problem**: No visual indicator when partner removes items from offer.

**Files to modify**:
- `packages/shared/src/types/game/trade-types.ts`
- `packages/server/src/systems/ServerNetwork/handlers/trade.ts`
- `packages/client/src/game/panels/TradePanel/TradePanel.tsx`

**Type changes**:
```typescript
// Add to TradeUpdatedPayload
removedSlots?: number[];  // Trade slots that had items removed
```

**Server changes** (in `handleTradeRemoveItem`):
```typescript
// After successful removal, include removed slot in update
sendTradeUpdateWithRemoval(world, tradingSystem, data.tradeId, data.tradeSlot);
```

**UI changes**:
```typescript
// Track removed slots
const [removedSlots, setRemovedSlots] = useState<Set<number>>(new Set());

// On update, check for removals
useEffect(() => {
  if (state.removedSlots?.length) {
    setRemovedSlots(prev => new Set([...prev, ...state.removedSlots]));
    // Clear after 3 seconds
    setTimeout(() => setRemovedSlots(new Set()), 3000);
  }
}, [state.removedSlots]);

// Render warning on removed slots
{removedSlots.has(slotIndex) && (
  <div className="absolute inset-0 flex items-center justify-center animate-pulse">
    <span className="text-red-500 text-2xl font-bold">!</span>
  </div>
)}

// Block accept if items were removed
const hasRemovals = removedSlots.size > 0;
{hasRemovals && (
  <p className="text-red-500 text-sm">Warning: Items have been removed. Check the offer!</p>
)}
```

---

## Phase 3: Polish & Value Display (P2)

### 3.1 Wealth Transfer Indicator

**Files to modify**:
- `packages/shared/src/types/game/trade-types.ts`
- `packages/server/src/systems/ServerNetwork/handlers/trade.ts`
- `packages/client/src/game/panels/TradePanel/TradePanel.tsx`

**Implementation**:
```typescript
// Add value calculation helper
function calculateOfferValue(items: TradeOfferItem[]): number {
  let total = 0;
  for (const item of items) {
    const def = getItem(item.itemId);
    if (def?.value) {
      total += def.value * item.quantity;
    }
  }
  return total;
}

// Include in trade updates
const myValue = calculateOfferValue(session.initiator.offeredItems);
const theirValue = calculateOfferValue(session.recipient.offeredItems);

sendToSocket(initiatorSocket, "tradeUpdated", {
  ...existing,
  myOfferValue: myValue,
  theirOfferValue: theirValue,
  wealthTransfer: theirValue - myValue,  // Positive = gaining
});
```

**UI**: Add wealth bar component showing balance of trade.

---

### 3.2 Full Value Display on Confirmation Screen

**Problem**: Both screens show abbreviated values. Screen 2 should show exact.

**Implementation** (`TradePanel.tsx`):
```typescript
// Format for offer screen (abbreviated)
function formatQuantityAbbrev(qty: number): string {
  if (qty >= 10_000_000) return `${Math.floor(qty / 1_000_000)}M`;
  if (qty >= 100_000) return `${Math.floor(qty / 1_000)}K`;
  return qty.toLocaleString();
}

// Format for confirm screen (exact)
function formatQuantityExact(qty: number): string {
  return qty.toLocaleString();  // 10,435,672
}

// Use appropriate formatter based on screen
const formatQty = isConfirmScreen ? formatQuantityExact : formatQuantityAbbrev;
```

---

## Phase 4: Memory & Testing (P3)

### 4.1 Reduce Allocations in Hot Paths

**File**: `packages/server/src/systems/ServerNetwork/handlers/trade.ts`

**Changes**:
```typescript
// Reuse Set objects instead of creating new ones
// Before (creates new Sets on every swap):
const initiatorOfferSlots = new Set(session.initiator.offeredItems.map(i => i.inventorySlot));

// After (pre-allocate and reuse):
const reusableSet = new Set<number>();
function fillSetFromOffers(set: Set<number>, items: TradeOfferItem[]): void {
  set.clear();
  for (const item of items) {
    set.add(item.inventorySlot);
  }
}
```

### 4.2 Add Missing Tests

**File**: `packages/server/tests/integration/trade/trade.integration.test.ts`

**New test cases**:
```typescript
describe("Untradeable Items", () => {
  it("rejects adding untradeable item to trade", async () => {
    // Add untradeable item to inventory
    // Try to add to trade
    // Expect UNTRADEABLE_ITEM error
  });

  it("rejects swap if item became untradeable", async () => {
    // Add tradeable item
    // Both accept
    // Mark item as untradeable (simulate)
    // Expect swap to fail
  });
});

describe("Proximity", () => {
  it("rejects trade request when players are far apart", async () => {
    // Position players 10 tiles apart
    // Request trade
    // Expect TOO_FAR error
  });

  it("allows trade when players are adjacent", async () => {
    // Position players 1 tile apart
    // Request trade
    // Expect success
  });
});

describe("Two-Screen Confirmation", () => {
  it("moves to confirmation screen after both accept", async () => {
    // Create active trade
    // Both accept
    // Expect status = "confirming"
    // Expect tradeConfirmScreen packet sent
  });

  it("requires second accept on confirmation screen", async () => {
    // Move to confirming status
    // Only one player accepts
    // Expect no swap
    // Both accept
    // Expect swap executed
  });
});

describe("Item Removal Warning", () => {
  it("includes removed slot in update payload", async () => {
    // Add item
    // Remove item
    // Check update includes removedSlots
  });
});
```

---

## Implementation Checklist

### Phase 1 (P0) - Critical Fixes
- [ ] **1.1.1** Add imports for TradePanel, TradeRequestModal to InterfaceManager.tsx
- [ ] **1.1.2** Add tradeState and tradeRequestState useState hooks
- [ ] **1.1.3** Add trade handlers to onUIUpdate function (tradeRequest, trade, tradeUpdate, tradeClose)
- [ ] **1.1.4** Render TradeRequestModal and TradePanel in JSX
- [ ] **1.2.1** Add tradeable check in handleTradeAddItem (after getItem)
- [ ] **1.2.2** Add tradeable re-check in executeTradeSwap validation loop
- [ ] **1.2.3** Add UNTRADEABLE_ITEM to errorMessages mapping
- [ ] **1.2.4** Add UNTRADEABLE_ITEM to TradeErrorPayload.code union
- [ ] **1.3.1** Call tradingSystem.destroy() in ServerNetwork.destroy()

### Phase 2 (P1) - OSRS Accuracy
- [ ] **2.1.1** Import getEntityPosition in trade.ts
- [ ] **2.1.2** Add proximity check in handleTradeRequest (after online check)
- [ ] **2.1.3** Add TOO_FAR to TradeErrorPayload.code union
- [ ] **2.2.1** Add interface blocking check (getSessionManager) in handleTradeRequest
- [ ] **2.3.1** Update TradeStatus to include "confirming"
- [ ] **2.3.2** Add TradeConfirmScreenPayload type
- [ ] **2.3.3** Update TradeWindowState with screen, myOfferValue, theirOfferValue
- [ ] **2.3.4** Add 'tradeConfirmScreen' packet to packets.ts
- [ ] **2.3.5** Add moveToConfirmation() method to TradingSystem
- [ ] **2.3.6** Update setAcceptance to work with confirming status
- [ ] **2.3.7** Update handleTradeAccept for two-screen flow
- [ ] **2.3.8** Add calculateOfferValue helper function
- [ ] **2.3.9** Add onTradeConfirmScreen handler to ClientNetwork.ts
- [ ] **2.3.10** Add tradeConfirmScreen handler to InterfaceManager
- [ ] **2.3.11** Update TradePanel to render offer/confirm screens
- [ ] **2.4.1** Add removedSlots tracking to TradeUpdatedPayload
- [ ] **2.4.2** Track removed slots in sendTradeUpdate
- [ ] **2.4.3** Add removal warning UI to TradePanel

### Phase 3 (P2) - Polish
- [ ] Include myOfferValue, theirOfferValue in tradeUpdated packets
- [ ] Add wealth transfer indicator component to TradePanel
- [ ] Add formatQuantityExact for confirm screen (full numbers)
- [ ] Add formatQuantityAbbrev for offer screen (K/M suffixes)

### Phase 4 (P3) - Memory & Tests
- [ ] Refactor Set creation in executeTradeSwap to reuse objects
- [ ] Add test: reject untradeable item in trade
- [ ] Add test: reject swap with untradeable item
- [ ] Add test: reject trade when too far
- [ ] Add test: allow trade when adjacent
- [ ] Add test: move to confirmation after both accept
- [ ] Add test: require second accept on confirm screen
- [ ] Add test: item removal includes removedSlots

---

## File Change Summary

| File | Line(s) | Changes |
|------|---------|---------|
| `InterfaceManager.tsx` | ~50, ~200, ~1498, ~2200 | Imports, state, handlers, JSX |
| `trade.ts` | ~44, ~95, ~252, ~258, ~447, ~607, ~837, ~994 | Imports, helpers, checks, two-screen logic |
| `TradingSystem/index.ts` | ~520, ~580 | Update setAcceptance, add moveToConfirmation |
| `ServerNetwork/index.ts` | ~2139 | Add destroy call |
| `trade-types.ts` | ~29, ~230, ~260, ~280 | Status, payloads, error codes, state |
| `packets.ts` | ~285 | Add tradeConfirmScreen packet |
| `ClientNetwork.ts` | ~2135 | Add onTradeConfirmScreen handler |
| `TradePanel.tsx` | Throughout | Confirm screen, removal warnings, value display |
| `trade.integration.test.ts` | End of file | New test suites |

---

## Detailed File Modifications

### packages/client/src/components/interface/InterfaceManager.tsx

| Location | Change |
|----------|--------|
| Line ~50 | Add imports: `TradePanel`, `TradeRequestModal`, types |
| Line ~200 | Add `tradeState` and `tradeRequestState` useState |
| Line ~1498 | Add handlers in `onUIUpdate` for trade components |
| Line ~2200 | Add JSX rendering for TradeRequestModal and TradePanel |

### packages/server/src/systems/ServerNetwork/handlers/trade.ts

| Location | Change |
|----------|--------|
| Line ~44 | Import `getEntityPosition`, `getSessionManager` |
| Line ~95 | Add `calculateOfferValue()` helper function |
| Line ~252 | Add interface blocking check (getSessionManager) |
| Line ~258 | Add proximity check using getEntityPosition |
| Line ~447 | Add `tradeable` flag check after getItem |
| Line ~607 | Update handleTradeAccept for two-screen flow |
| Line ~837 | Add tradeable re-validation in executeTradeSwap |
| Line ~994 | Add UNTRADEABLE_ITEM to errorMessages |

### packages/server/src/systems/TradingSystem/index.ts

| Location | Change |
|----------|--------|
| Line ~520 | Modify setAcceptance to allow "confirming" status |
| Line ~580 | Add new `moveToConfirmation()` method |

### packages/shared/src/types/game/trade-types.ts

| Location | Change |
|----------|--------|
| Line ~29 | Add "confirming" to TradeStatus |
| Line ~230 | Add TradeConfirmScreenPayload type |
| Line ~260 | Add TOO_FAR, UNTRADEABLE_ITEM to error codes |
| Line ~280 | Add screen, myOfferValue, theirOfferValue to TradeWindowState |

---

## Expected Final Scores

| Criterion | Before | After | Improvement |
|-----------|--------|-------|-------------|
| Production Quality | 8/10 | 9/10 | Tradeable validation, proper cleanup |
| Best Practices | 8/10 | 9/10 | UI wired, comprehensive tests |
| OWASP Security | 7/10 | 9/10 | Untradeable enforced, proximity check |
| Game Studio Audit | 7/10 | 9/10 | Two-screen, scam prevention |
| Memory Hygiene | 6/10 | 8/10 | Cleanup fixed, reduced allocations |
| SOLID Principles | 8/10 | 8/10 | Already good |
| OSRS Likeness | 7/10 | 9/10 | Two-screen, warnings, proximity |

**Overall: 7.4/10 → 8.9/10**

---

---

## Testing Strategy

### Unit Tests (TradingSystem)

Location: `packages/server/tests/integration/trade/trade.integration.test.ts`

```typescript
// Add these test suites:

describe("Untradeable Items", () => {
  it("rejects adding untradeable item", async () => {
    // 1. Add item with tradeable: false to player inventory
    // 2. Create active trade
    // 3. Try to add item
    // 4. Expect UNTRADEABLE_ITEM error
  });

  it("rejects swap if item became untradeable", async () => {
    // Edge case: item was tradeable when added, untradeable at swap time
  });
});

describe("Proximity Validation", () => {
  it("rejects trade when players > 1 tile apart", async () => {
    // Mock player positions 10 tiles apart
    // Request trade
    // Expect TOO_FAR error
  });

  it("allows trade at exactly 1 tile distance", async () => {
    // Mock adjacent positions
    // Request trade
    // Expect success
  });

  it("allows diagonal adjacency (Chebyshev distance)", async () => {
    // Position at (0,0) and (1,1) = distance 1
  });
});

describe("Two-Screen Confirmation", () => {
  it("moves to confirming status after both accept", async () => {
    // Create active trade with offers
    // Both accept
    // Expect status === "confirming"
    // Expect both accepted flags reset to false
  });

  it("sends tradeConfirmScreen packet to both players", async () => {
    // Track sent packets
    // Both accept on offer screen
    // Verify tradeConfirmScreen sent to both
  });

  it("executes swap only after both accept on confirm screen", async () => {
    // Move to confirming
    // Only one accepts
    // Verify no swap
    // Second accepts
    // Verify swap executed
  });

  it("allows declining on confirmation screen", async () => {
    // Move to confirming
    // One player cancels
    // Expect trade cancelled
  });
});

describe("Interface Blocking", () => {
  it("rejects trade if target has bank open", async () => {
    // Mock session manager returning active session for target
    // Request trade
    // Expect PLAYER_BUSY error
  });
});

describe("Item Removal Warnings", () => {
  it("includes removedSlots in update after removal", async () => {
    // Add item
    // Remove item
    // Verify tradeUpdated includes removedSlots
  });
});
```

### E2E Tests (Playwright)

Location: `packages/server/tests/e2e/trade.spec.ts` (new file)

```typescript
import { test, expect } from "@playwright/test";

test.describe("Trading E2E", () => {
  test("complete trade flow", async ({ browser }) => {
    // Create two browser contexts (two players)
    const player1 = await browser.newContext();
    const player2 = await browser.newContext();

    // Login both players
    // Position players adjacent
    // Player1 initiates trade
    // Verify Player2 sees request modal
    // Player2 accepts
    // Both see trade panel
    // Add items
    // Both accept
    // Verify confirmation screen
    // Both accept again
    // Verify items swapped
  });

  test("trade request shows on adjacent player", async ({ browser }) => {
    // Visual test with screenshot comparison
  });

  test("trade panel closes on cancel", async ({ browser }) => {
    // Start trade, cancel, verify closed
  });
});
```

---

## Future Enhancements (Not in Scope)

These features are OSRS-accurate but not required for 9/10 rating:

### Ironman Mode (P4)
OSRS ironmen cannot trade - they "stand alone". Would require:
- `is_ironman` column on characters table
- Check in handleTradeRequest
- Different error message: "This player is an Ironman and cannot trade"

### Trade Value Warnings (P4)
OSRS shows warnings for very unbalanced trades:
- Warning if giving away items worth > 10M more than receiving
- Requires "Are you sure?" confirmation

### Trade History/Logging (P4)
For GM review and RWT detection:
- `trades` table already exists in schema
- Would need to populate it on trade completion
- Admin panel to view trade history

### Movement Cancellation (P4)
Cancel trade if players move > 15 tiles apart during active trade:
- Subscribe to ENTITY_TILE_UPDATE in TradingSystem
- Check distance on each movement
- Already outlined in Phase 2.1.4 as optional

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Race condition in two-screen flow | Low | High | Both accepts must complete before swap |
| Memory leak from uncleared interval | Fixed | Medium | destroy() now called |
| Untradeable item bypass | Fixed | High | Validation at add AND swap time |
| UI not showing trade panel | Fixed | High | Events now handled in InterfaceManager |
| Performance impact from value calc | Low | Low | Only calc on accept, not every update |

---

## References

- [Trading - OSRS Wiki](https://oldschool.runescape.wiki/w/Trading)
- [Scams - OSRS Wiki](https://oldschool.runescape.wiki/w/Scams)
- [Category: Untradeable Items - OSRS Wiki](https://oldschool.runescape.wiki/w/Category:Untradeable_items)
- [Grand Exchange/Non-tradeable items - OSRS Wiki](https://oldschool.runescape.wiki/w/Grand_Exchange/Non-tradeable_items)
