# Trade Panel UI Redesign Plan - OSRS Style

## Overview

Redesign the TradePanel to match Old School RuneScape's trading UX patterns. The key change is moving from drag-and-drop to click-based item management with right-click context menus.

**References:**
- [OSRS Wiki - Trading](https://oldschool.runescape.wiki/w/Trading)
- [OSRS Wiki - Inventory](https://oldschool.runescape.wiki/w/Inventory)

---

## OSRS Specifications

### Item & Grid Dimensions
- **Item icons**: 36x32 pixels
- **Inventory grid**: 4 columns × 7 rows = 28 slots
- **Offer grid**: 4 columns × 7 rows = 28 slots per side (matches inventory)

### Two-Screen Flow
1. **First Screen (Offer)**: Add/remove items, see abbreviated values, can modify trade
2. **Second Screen (Confirmation)**: Read-only review, full values shown, no modifications allowed

### Value Display
- **First screen**: Abbreviated (e.g., "1,234K" for 1,234,567 or "10M" for 10,435,672)
- **Second screen**: Full values (e.g., "10,435,672 coins")

### Key UI Elements
- **Wealth Transfer Scale**: Shows if trade favors one player using Grand Exchange prices
- **Free Slots Indicator**: Shows how many inventory slots the other player has available
- **Accept/Decline Buttons**: Both screens have these
- **"Other player has accepted"**: Message shown when partner accepts before you

### Trade Request (Chat Message)
- When someone sends you a trade request, it appears in chat as a **pink/magenta clickable message**
- Format: `[PlayerName] wishes to trade with you.` (in pink/magenta color)
- **Clicking the message accepts the trade** and opens the trade window
- This matches OSRS where trade requests appear as interactive chat messages

---

## Current vs Target UX

| Feature | Current | Target (OSRS) |
|---------|---------|---------------|
| Trade request | Modal popup | Pink clickable chat message |
| Add items | Drag from inventory | Left-click = add 1, Right-click = context menu |
| Remove items | Click in offer | Click in offer (same) |
| Quantity selection | None | Offer, Offer-5, Offer-10, Offer-X, Offer-All |
| Context menu | None | Value, Examine options |
| Item warnings | None | Big red flashing exclamation on removal |
| Value display | Basic total | Abbreviated (1st) / Full (2nd) + wealth transfer |
| Confirmation screen | Basic | Read-only, full values, red bar on modified items |
| Free slots indicator | No | Yes - partner's available slots |
| Click outside window | Nothing | Declines trade for both players |
| Partner accepted | No indicator | "Other player has accepted" message |

---

## Phase 1: Core Interaction Changes

### 1.1 Remove Drag-and-Drop for Adding Items

**File:** `packages/client/src/game/panels/TradePanel/TradePanel.tsx`

Replace the current drag-and-drop inventory with click-based interaction:

```typescript
// Current: onDragEnd handler
// New: onClick and onContextMenu handlers

const handleInventoryItemClick = (item: InventoryItem) => {
  // Left-click: add 1 of the item
  onAddItem(item.slot, 1);
};

const handleInventoryItemContextMenu = (e: React.MouseEvent, item: InventoryItem) => {
  e.preventDefault();
  setContextMenu({
    x: e.clientX,
    y: e.clientY,
    item,
    options: [
      // OSRS order: Offer (1), Offer-5, Offer-10, Offer-X, Offer-All, Value, Examine
      { label: "Offer", action: () => onAddItem(item.slot, 1) },
      { label: "Offer-5", action: () => onAddItem(item.slot, 5) },
      { label: "Offer-10", action: () => onAddItem(item.slot, 10) },
      { label: "Offer-X", action: () => showQuantityPrompt(item) },
      { label: "Offer-All", action: () => onAddItem(item.slot, item.quantity) },
      { label: "Value", action: () => showItemValue(item) },
      { label: "Examine", action: () => showItemExamine(item) },
    ],
  });
};
```

### 1.2 Quantity Prompt Dialog

Add a modal for "Offer-X" that supports K/M notation:

```typescript
interface QuantityPromptProps {
  item: InventoryItem;
  maxQuantity: number;
  onConfirm: (quantity: number) => void;
  onCancel: () => void;
}

// Parse "10k" -> 10000, "1.5m" -> 1500000
function parseQuantityInput(input: string): number {
  const normalized = input.toLowerCase().trim();
  const match = normalized.match(/^(\d+\.?\d*)(k|m)?$/);
  if (!match) return 0;

  let value = parseFloat(match[1]);
  if (match[2] === 'k') value *= 1000;
  if (match[2] === 'm') value *= 1000000;
  return Math.floor(value);
}
```

### 1.3 Context Menu Component

Create a reusable context menu component:

```typescript
interface ContextMenuProps {
  x: number;
  y: number;
  options: Array<{
    label: string;
    action: () => void;
    disabled?: boolean;
  }>;
  onClose: () => void;
}

const ContextMenu: React.FC<ContextMenuProps> = ({ x, y, options, onClose }) => {
  // Close on click outside or Escape
  // Position near cursor but within viewport bounds
  // OSRS-style dark background with yellow/white text
};
```

---

## Phase 2: Layout Redesign

### 2.1 First Screen Layout (Offer Screen)

```
┌────────────────────────────────────────────────────────────────────────────────────┐
│                           Trading with: [Partner Name]                              │
├─────────────────────────────┬─────────────────────────────┬────────────────────────┤
│         YOUR OFFER          │         THEIR OFFER         │    YOUR INVENTORY      │
│   ┌──┬──┬──┬──┐            │       ┌──┬──┬──┬──┐        │   ┌──┬──┬──┬──┐       │
│   │  │  │  │  │            │       │  │  │  │  │        │   │  │  │  │  │       │
│   ├──┼──┼──┼──┤            │       ├──┼──┼──┼──┤        │   ├──┼──┼──┼──┤       │
│   │  │  │  │  │  (4x7      │ (4x7  │  │  │  │  │        │   │  │  │  │  │       │
│   ├──┼──┼──┼──┤   grid)    │ grid) ├──┼──┼──┼──┤        │   ├──┼──┼──┼──┤       │
│   │  │  │  │  │            │       │  │  │  │  │        │   │  │  │  │  │       │
│   ├──┼──┼──┼──┤            │       ├──┼──┼──┼──┤        │   ├──┼──┼──┼──┤       │
│   │  │  │  │  │            │       │  │  │  │  │        │   │  │  │  │  │       │
│   ├──┼──┼──┼──┤            │       ├──┼──┼──┼──┤        │   ├──┼──┼──┼──┤       │
│   │  │  │  │  │            │       │  │  │  │  │        │   │  │  │  │  │       │
│   ├──┼──┼──┼──┤            │       ├──┼──┼──┼──┤        │   ├──┼──┼──┼──┤       │
│   │  │  │  │  │            │       │  │  │  │  │        │   │  │  │  │  │       │
│   └──┴──┴──┴──┘            │       └──┴──┴──┴──┘        │   └──┴──┴──┴──┘       │
│                             │                            │                        │
│   Value: 1,234K            │       Value: 2,345K        │   Drag items to trade  │
├─────────────────────────────┴────────────────────────────┴────────────────────────┤
│  Free slots: 15                         Wealth transfer: +1,111K (green)          │
├───────────────────────────────────────────────────────────────────────────────────┤
│                     [ ACCEPT ]                    [ DECLINE ]                      │
│                              "Other player has accepted"                           │
└───────────────────────────────────────────────────────────────────────────────────┘

Note: Clicking outside the trade window declines trade for both players
```

### 2.2 Second Screen Layout (Confirmation Screen)

```
┌───────────────────────────────────────────────────────────────────────┐
│              Are you sure you want to make this trade?                │
├─────────────────────────────┬─────────────────────────────────────────┤
│      YOU ARE GIVING:        │        YOU ARE RECEIVING:               │
│   ┌──┬──┬──┬──┐            │           ┌──┬──┬──┬──┐                │
│   │  │  │  │  │            │           │  │  │  │  │                │
│   ├──┼──┼──┼──┤            │           ├──┼──┼──┼──┤                │
│   │  │  │  │  │            │           │  │  │  │  │                │
│   ├──┼──┼──┼──┤            │           ├──┼──┼──┼──┤                │
│   │  │  │  │  │            │           │  │  │  │  │                │
│   ├──┼──┼──┼──┤            │           ├──┼──┼──┼──┤                │
│   │  │  │  │  │            │           │  │  │  │  │                │
│   └──┴──┴──┴──┘            │           └──┴──┴──┴──┘                │
│                             │                                         │
│   Value: 1,234,567 gp      │           Value: 2,345,678 gp          │
│   (FULL value shown)       │           (FULL value shown)            │
├─────────────────────────────┴─────────────────────────────────────────┤
│                  Wealth transfer: +1,111,111 gp                       │
├───────────────────────────────────────────────────────────────────────┤
│              [ ACCEPT ]                    [ DECLINE ]                │
│                        "Other player has accepted"                    │
└───────────────────────────────────────────────────────────────────────┘

Note: NO inventory shown - this screen is READ-ONLY
      Modified items since 1st screen show red bar/highlight
```

### 2.3 Component Structure

```typescript
<TradePanel onClickOutside={handleDecline}>
  {/* FIRST SCREEN: Offer */}
  {screen === "offer" && (
    <>
      <TradePanelHeader>
        Trading with: {partner.name}
      </TradePanelHeader>

      <TradePanelBody>
        <OfferSection side="left" title="Your Offer">
          <OfferGrid
            items={myOffer}
            onItemClick={handleRemoveFromOffer}
            onItemContextMenu={handleOfferContextMenu}
            removedItems={myRemovedItems}  // Shows red exclamation
          />
          <OfferValue value={myOfferValue} abbreviated />
        </OfferSection>

        <OfferSection side="right" title="Their Offer">
          <OfferGrid
            items={theirOffer}
            readOnly
            removedItems={theirRemovedItems}  // Shows red exclamation
          />
          <OfferValue value={theirOfferValue} abbreviated />
        </OfferSection>
      </TradePanelBody>

      <TradeStatusBar
        theirFreeSlots={partnerFreeSlots}
        wealthDifference={theirOfferValue - myOfferValue}
        abbreviated
      />

      <TradeActions
        onAccept={handleAccept}
        onDecline={handleDecline}
        theirAccepted={theirAccepted}
        acceptLabel="Accept"
      />

      <InventorySection
        items={inventory}
        onItemClick={handleInventoryItemClick}
        onItemContextMenu={handleInventoryItemContextMenu}
      />
    </>
  )}

  {/* SECOND SCREEN: Confirmation */}
  {screen === "confirming" && (
    <>
      <TradePanelHeader>
        Are you sure you want to make this trade?
      </TradePanelHeader>

      <TradePanelBody>
        <OfferSection side="left" title="You Are Giving:">
          <OfferGrid
            items={myOffer}
            readOnly
            modifiedItems={modifiedItems}  // Red bar on changed items
          />
          <OfferValue value={myOfferValue} full />
        </OfferSection>

        <OfferSection side="right" title="You Are Receiving:">
          <OfferGrid
            items={theirOffer}
            readOnly
            modifiedItems={modifiedItems}
          />
          <OfferValue value={theirOfferValue} full />
        </OfferSection>
      </TradePanelBody>

      <TradeStatusBar
        wealthDifference={theirOfferValue - myOfferValue}
        full  // Show full values
      />

      <TradeActions
        onAccept={handleConfirmAccept}
        onDecline={handleDecline}
        theirAccepted={theirAccepted}
        acceptLabel="Accept"
      />

      {/* NO inventory on confirmation screen */}
    </>
  )}
</TradePanel>
```

---

## Phase 3: Safety Features (OSRS Anti-Scam)

### 3.1 Big Red Flashing Exclamation (Item Removal Warning)

Per OSRS: "If an item is removed from an offer, a big red flashing exclamation point will appear where the item used to be."

```typescript
interface RemovedItemIndicator {
  slot: number;
  itemId: string;
  timestamp: number;
  side: "mine" | "theirs";
}

// Track removed items - OSRS shows them for several seconds
const [removedItems, setRemovedItems] = useState<RemovedItemIndicator[]>([]);

// Listen for item removals from server
useEffect(() => {
  const handleItemRemoved = (data: { slot: number; side: string; itemId: string }) => {
    setRemovedItems(prev => [...prev, {
      slot: data.slot,
      itemId: data.itemId,
      side: data.side as "mine" | "theirs",
      timestamp: Date.now(),
    }]);
    // Auto-clear after 5 seconds
    setTimeout(() => {
      setRemovedItems(prev => prev.filter(r => r.timestamp !== Date.now()));
    }, 5000);
  };
  // Subscribe to removal events
}, []);

// Render in the offer grid
{removedItems
  .filter(r => r.side === side)
  .map(removed => (
    <RemovedItemSlot
      key={`removed-${removed.slot}`}
      style={{ gridArea: `slot-${removed.slot}` }}
    >
      <FlashingExclamation className="animate-pulse text-red-600 text-3xl font-bold">
        !
      </FlashingExclamation>
    </RemovedItemSlot>
  ))
}
```

### 3.2 Accept Warning When Items Removed

If items were recently removed and player tries to accept:

```typescript
const handleAccept = () => {
  const hasRecentRemovals = removedItems.length > 0;

  if (hasRecentRemovals) {
    setShowWarningDialog({
      title: "Trade Modified!",
      message: "Items have been removed from the trade. Are you sure you want to accept?",
      confirmText: "Accept Anyway",
      cancelText: "Cancel",
      onConfirm: () => {
        setShowWarningDialog(null);
        confirmAccept();
      },
      onCancel: () => setShowWarningDialog(null),
    });
  } else {
    confirmAccept();
  }
};
```

### 3.3 Red Bar on Modified Items (Second Screen)

On the confirmation screen, items that changed since the first accept are highlighted:

```typescript
// When entering confirmation screen, snapshot the current offers
const [firstScreenSnapshot, setFirstScreenSnapshot] = useState<{
  myOffer: TradeItem[];
  theirOffer: TradeItem[];
} | null>(null);

// Detect modifications
const getModifiedSlots = (): Set<string> => {
  if (!firstScreenSnapshot) return new Set();

  const modified = new Set<string>();
  // Compare current offers to snapshot
  // Mark any differences
  return modified;
};

// Render with red bar
<OfferItem
  item={item}
  className={modifiedSlots.has(item.tradeSlot) ? "border-l-4 border-red-500" : ""}
/>
```

### 3.4 Click Outside to Decline

Per OSRS: "clicking outside of the bounding window will decline the trade for both players"

```typescript
const TradePanelContainer = styled.div`
  // ... styles
`;

const handleClickOutside = (e: MouseEvent) => {
  if (!panelRef.current?.contains(e.target as Node)) {
    handleDecline();
  }
};

useEffect(() => {
  document.addEventListener("mousedown", handleClickOutside);
  return () => document.removeEventListener("mousedown", handleClickOutside);
}, []);
```

### 3.5 Partner Declined Notification

Per OSRS: "the player will be notified with the 'Other player declined trade.' message"

```typescript
// When partner declines, show notification before closing
const handlePartnerDeclined = () => {
  showNotification("Other player declined trade.");
  setTimeout(() => closeTrade(), 1500);
};
```

---

## Phase 4: Enhanced Value Display

Per OSRS Wiki: "if a player offers 10,435,672 coins in the first window, it will only display as a green 10M. In the second window however, the full value is shown"

### 4.1 First Screen (Abbreviated - OSRS Style)

```typescript
/**
 * OSRS abbreviation format:
 * - Under 100K: show full number (99,999)
 * - 100K to 10M: show as XXX,XXXK (1,234K)
 * - 10M+: show as XXM or X.XM (10M, 1.5M)
 *
 * Note: Coins shown in GREEN color
 */
function formatValueAbbreviated(value: number): string {
  if (value >= 10_000_000) {
    // 10M+ shows as "10M" or "1.5M"
    const millions = value / 1_000_000;
    return millions >= 10
      ? `${Math.floor(millions)}M`
      : `${millions.toFixed(1)}M`;
  }
  if (value >= 100_000) {
    // 100K to 10M shows as "1,234K"
    return `${Math.floor(value / 1000).toLocaleString()}K`;
  }
  // Under 100K shows full value
  return value.toLocaleString();
}

// Examples:
// 10,435,672 → "10M" (green)
// 1,234,567 → "1,234K"
// 99,999 → "99,999"
```

### 4.2 Second Screen (Full Values)

```typescript
/**
 * Second screen shows EXACT amounts - no abbreviation
 * This is the anti-scam feature so players can verify exact quantities
 */
function formatValueFull(value: number): string {
  return value.toLocaleString(); // e.g., "10,435,672 coins"
}
```

### 4.3 Wealth Transfer Scale

Per OSRS: "Calculates the values of all the items using Grand Exchange price as an indicator and then shows if the trade is balanced or positive to one or another player"

```typescript
interface WealthTransferProps {
  myOfferValue: number;
  theirOfferValue: number;
  abbreviated?: boolean;
}

function WealthTransfer({ myOfferValue, theirOfferValue, abbreviated }: WealthTransferProps) {
  const difference = theirOfferValue - myOfferValue;
  const format = abbreviated ? formatValueAbbreviated : formatValueFull;

  // Color coding
  let color: string;
  let prefix: string;
  let label: string;

  if (difference > 0) {
    color = "#22c55e"; // Green - you receive more
    prefix = "+";
    label = "You receive";
  } else if (difference < 0) {
    color = "#ef4444"; // Red - you give more
    prefix = "";
    label = "You give";
  } else {
    color = "#ffffff"; // White - balanced
    prefix = "";
    label = "Balanced";
  }

  // Handle overflow (OSRS shows "Unknown" if > 2,147,483,647)
  if (Math.abs(difference) > 2_147_483_647) {
    return <span style={{ color }}>Unknown</span>;
  }

  return (
    <span style={{ color }}>
      {label}: {prefix}{format(Math.abs(difference))} gp
    </span>
  );
}
```

---

## Phase 5: Server Changes

### 5.1 Add Quantity Support to Trade Packets

**File:** `packages/shared/src/platform/shared/packets.ts`

The `tradeAddItem` packet already supports quantity, but ensure UI sends it:

```typescript
// Existing packet structure
tradeAddItem: { tradeId: string; inventorySlot: number; quantity: number }
```

### 5.2 Track Partner's Free Slots

Add to trade state sync:

```typescript
interface TradeWindowState {
  // ... existing fields
  partnerFreeSlots: number; // Add this
}
```

Emit when trade opens and when items change:

```typescript
// In trade handler, calculate and send free slots
const partnerInventory = await getPlayerInventory(partnerId);
const usedSlots = partnerInventory.filter(i => i !== null).length;
const freeSlots = 28 - usedSlots;
```

---

## Phase 6: Trade Request as Clickable Chat Message

### 6.1 OSRS-Style Trade Request

Per OSRS: When a player requests to trade with you, it appears as a **pink/magenta clickable message** in the chat box.

**Current behavior**: Modal popup appears asking to accept/decline
**Target behavior**: Pink message in chat that you click to accept

```typescript
// Message format (pink color: #FF00FF or similar magenta)
"[PlayerName] wishes to trade with you."

// Clicking the message triggers trade acceptance
```

### 6.2 Chat Message Component

**File:** `packages/client/src/game/chat/ChatMessage.tsx` (or equivalent)

```typescript
interface TradeRequestMessage {
  type: "trade_request";
  fromPlayerId: string;
  fromPlayerName: string;
  tradeId: string;
  timestamp: number;
}

// Render as clickable pink message
function TradeRequestChatMessage({ message }: { message: TradeRequestMessage }) {
  const handleClick = () => {
    // Accept the trade request
    world.network.send("tradeAccept", { tradeId: message.tradeId });
  };

  return (
    <div
      onClick={handleClick}
      style={{
        color: "#FF00FF", // OSRS pink/magenta
        cursor: "pointer",
        textDecoration: "underline",
      }}
    >
      {message.fromPlayerName} wishes to trade with you.
    </div>
  );
}
```

### 6.3 Server Changes

**File:** `packages/server/src/systems/ServerNetwork/handlers/trade.ts`

When a trade request is sent:
1. Don't show modal popup to recipient
2. Instead, emit a chat message event with type "trade_request"
3. Store pending trade request with timeout (e.g., 30 seconds)

```typescript
// When player A requests trade with player B
const tradeRequest = {
  tradeId: generateTradeId(),
  fromPlayerId: playerA.id,
  fromPlayerName: playerA.name,
  toPlayerId: playerB.id,
  expiresAt: Date.now() + 30000, // 30 second timeout
};

// Send as chat message to player B
sendToPlayer(playerB.id, "chatMessage", {
  type: "trade_request",
  ...tradeRequest,
});
```

### 6.4 Expiration Handling

- Trade requests expire after 30 seconds (OSRS-style)
- Expired requests should be visually dimmed or removed from chat
- Clicking an expired request shows: "Trade request has expired."

---

## Implementation Order

1. **Phase 1.3** - Context Menu Component (foundation for all interactions)
2. **Phase 1.1** - Click-based item adding (replace drag-and-drop)
3. **Phase 1.2** - Quantity prompt with K/M notation
4. **Phase 2** - Layout redesign
5. **Phase 3** - Safety features (warnings, red indicators)
6. **Phase 4** - Enhanced value display
7. **Phase 5** - Server changes for free slots
8. **Phase 6** - Trade request as clickable chat message

---

## Files to Modify

| File | Changes |
|------|---------|
| `packages/client/src/game/panels/TradePanel/TradePanel.tsx` | Main UI redesign |
| `packages/client/src/game/panels/TradePanel/index.ts` | Export new components |
| `packages/client/src/components/ContextMenu.tsx` | New reusable context menu |
| `packages/client/src/components/QuantityPrompt.tsx` | New quantity input dialog |
| `packages/shared/src/types/game/trade-types.ts` | Add partnerFreeSlots |
| `packages/server/src/systems/ServerNetwork/handlers/trade.ts` | Send free slots, trade request as chat |
| `packages/client/src/game/chat/ChatMessage.tsx` | Handle trade_request message type |
| `packages/client/src/game/panels/TradePanel/TradeRequestModal.tsx` | Remove or repurpose |

---

## Testing Checklist

### Core Interactions
- [ ] Left-click inventory item adds 1 to offer
- [ ] Right-click inventory item shows context menu
- [ ] Context menu has: Offer, Offer-5, Offer-10, Offer-X, Offer-All, Value, Examine
- [ ] Offer-X prompt accepts K/M notation (10k, 1.5m, 2.5k)
- [ ] Offer-All adds entire stack of item
- [ ] Left-click item in offer removes it
- [ ] Right-click item in offer shows remove options

### Two-Screen Flow
- [ ] First screen shows abbreviated values (1,234K, 10M)
- [ ] Both players accepting moves to confirmation screen
- [ ] Confirmation screen shows full values (10,435,672)
- [ ] Confirmation screen is read-only (no inventory shown)
- [ ] Confirmation screen header says "Are you sure you want to make this trade?"
- [ ] Both accepting on confirmation completes trade

### Safety Features
- [ ] Big red flashing exclamation appears when item removed
- [ ] Exclamation appears in both players' views
- [ ] Warning dialog appears if accepting after recent removal
- [ ] Modified items show red bar/highlight on confirmation screen
- [ ] Clicking outside trade window declines trade
- [ ] "Other player declined trade" message shown when partner declines

### Value Display
- [ ] Wealth transfer shows green when you receive more
- [ ] Wealth transfer shows red when you give more
- [ ] Wealth transfer shows white when balanced
- [ ] Large values (>2.1B) show "Unknown"
- [ ] Partner's free inventory slots displayed

### Trade Request (Chat Message)
- [ ] Trade request appears as pink/magenta message in chat
- [ ] Message format: "[PlayerName] wishes to trade with you."
- [ ] Clicking the message accepts the trade
- [ ] Trade request expires after 30 seconds
- [ ] Clicking expired request shows "Trade request has expired."
- [ ] No modal popup shown for trade requests

### Edge Cases
- [ ] Cannot offer more items than partner has free slots
- [ ] Trade closes if either player moves too far away
- [ ] Trade closes if either player logs out
- [ ] Stacked items show quantity overlay
