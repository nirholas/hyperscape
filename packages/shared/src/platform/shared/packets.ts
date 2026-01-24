/**
 * Binary Network Packet Protocol
 *
 * This module defines the binary protocol for client-server communication in Hyperscape.
 * It uses msgpackr for efficient binary serialization and maps packet names to numeric IDs
 * to minimize network bandwidth.
 *
 * **Protocol Design**:
 * - All packets are binary ArrayBuffers (no JSON overhead)
 * - Packet format: [packet_id, data] where packet_id is a small integer
 * - Packet IDs map to method names with "on" prefix (e.g., 'snapshot' → 'onSnapshot')
 * - msgpackr provides efficient binary serialization with structured clone support
 *
 * **Packet Types**:
 *
 * **Core Packets**:
 * - `snapshot`: Full world state update from server
 * - `command`: Client command to server (move, attack, interact)
 * - `ping`/`pong`: Heartbeat/keepalive mechanism
 *
 * **Chat Packets**:
 * - `chatAdded`: New chat message
 * - `chatCleared`: Clear chat history
 *
 * **Entity Packets**:
 * - `entityAdded`: New entity spawned in world
 * - `entityModified`: Entity state changed (position, health, etc.)
 * - `entityRemoved`: Entity removed from world
 * - `entityEvent`: Custom entity event (emote, action, etc.)
 *
 * **Player Packets**:
 * - `moveRequest`: Client requests movement
 * - `playerTeleport`: Server forces player teleport
 * - `playerPush`: Server applies force to player
 * - `playerSessionAvatar`: Player changed avatar
 * - `playerState`: Full player state update
 *
 * **Resource/Gathering Packets**:
 * - `resourceSnapshot`: Initial resource node state
 * - `resourceSpawnPoints`: Spawn locations for resources
 * - `resourceSpawned`/`resourceDepleted`/`resourceRespawned`: Resource lifecycle
 * - `resourceGather`: Client attempts to gather
 * - `gatheringComplete`: Server confirms gathering success
 *
 * **Combat Packets**:
 * - `attackMob`: Client attacks a mob
 *
 * **Inventory Packets**:
 * - `pickupItem`: Client picks up ground item
 * - `inventoryUpdated`: Server syncs inventory state
 *
 * **Character Selection Packets** (feature-flagged):
 * - `characterListRequest`: Request list of characters
 * - `characterCreate`: Create new character
 * - `characterList`: Server returns character list
 * - `characterCreated`: Server confirms character creation
 * - `characterSelected`: Client selects a character
 * - `enterWorld`: Client enters world with selected character
 *
 * **Adding New Packets**:
 * 1. Add packet name to the `names` array (order matters!)
 * 2. Packet ID is automatically assigned based on array index
 * 3. Handler method name gets "on" prefix (e.g., 'snapshot' → 'onSnapshot')
 * 4. Implement handler in ServerNetwork or ClientNetwork
 *
 * **Referenced by**: Socket (send/receive), ServerNetwork, ClientNetwork
 */

import { Packr } from "msgpackr";
import type { PacketInfo } from "../../types/network/networking";

/**
 * msgpackr instance for binary serialization
 * structuredClone ensures complex objects are properly handled
 */
const packr = new Packr({ structuredClone: true });

/**
 * Ordered list of all packet names
 * Array index determines packet ID (0, 1, 2, ...) for network transmission
 * Order must remain consistent across client and server builds
 */
// prettier-ignore
const names = [
  'snapshot',
  'command',
  'chatAdded',
  'chatCleared',
  'entityAdded',
  'entityModified',
  'moveRequest',
  'entityEvent',
  'entityRemoved',
  'playerTeleport',
  'playerPush',
  'playerSessionAvatar',
  'settingsModified',
  'spawnModified',
  'kick',
  'ping',
  'pong',
  // New packets for multiplayer movement
  'input',
  'inputAck',
  'correction',
  'playerState',
  'serverStateUpdate',
  'deltaUpdate',
  'compressedUpdate',
  // Resource system packets
  'resourceSnapshot',
  'resourceSpawnPoints',
  'resourceSpawned',
  'resourceDepleted',
  'resourceRespawned',
  'fishingSpotMoved',  // Fishing spot relocated to new position
  'resourceInteract',  // Server-authoritative: client sends resourceId, server calculates path
  'resourceGather',    // Legacy: used after server paths player to cardinal tile
  'gatheringComplete',
  'gatheringStarted',  // Server -> Client: gathering session started
  'gatheringStopped',  // Server -> Client: gathering session stopped
  'gatheringToolShow', // Server -> Client: show gathering tool in hand (OSRS fishing rod)
  'gatheringToolHide', // Server -> Client: hide gathering tool from hand
  // Processing packets (firemaking/cooking)
  'firemakingRequest', // Client -> Server: request to light fire (tinderbox + logs)
  'cookingRequest',    // Client -> Server: request to cook food on fire/range
  'cookingSourceInteract', // Client -> Server: server-authoritative cooking (walk to fire first)
  'fireCreated',       // Server -> Client: fire entity created
  'fireExtinguished',  // Server -> Client: fire entity expired/removed
  // Smelting/Smithing packets
  'smeltingSourceInteract', // Client -> Server: player clicked furnace to smelt
  'smithingSourceInteract', // Client -> Server: player clicked anvil to smith
  'processingSmelting', // Client -> Server: player selected bar to smelt from UI
  'processingSmithing', // Client -> Server: player selected item to smith from UI
  'smeltingInterfaceOpen', // Server -> Client: show smelting interface with available bars
  'smithingInterfaceOpen', // Server -> Client: show smithing interface with available recipes
  // Combat packets
  'attackMob',
  'attackPlayer',  // PvP attack
  'followPlayer',  // Follow another player (OSRS-style)
  'changeAttackStyle',
  'setAutoRetaliate',
  'autoRetaliateChanged',
  // Item pickup packets
  'pickupItem',
  // Inventory action packets
  'dropItem',
  'moveItem',
  'useItem',
  'coinPouchWithdraw',
  // Equipment packets
  'equipItem',
  'unequipItem',
  // Inventory sync packets
  'inventoryUpdated',
  'coinsUpdated',
  'playerWeightUpdated',  // Player inventory weight changed (for stamina drain)
  // Equipment sync packets
  'equipmentUpdated',
  // Skills sync packets
  'skillsUpdated',
  // XP drop visual feedback packets (RS3-style)
  'xpDrop',
  // UI feedback packets
  'showToast',
  // Death screen packets
  'deathScreen',
  'deathScreenClose',
  'requestRespawn',
  // Death state packets
  'playerSetDead',
  'playerRespawned',
  // Loot packets
  'corpseLoot',
  // Attack style packets
  'attackStyleChanged',
  'attackStyleUpdate',
  // Combat visual feedback packets
  'combatDamageDealt',
  // Player state packets
  'playerUpdated',
  // Character selection packets (feature-flagged usage)
  'characterListRequest',
  'characterCreate',
  'characterList',
  'characterCreated',
  'characterSelected',
  'enterWorld',
  'enterWorldApproved',  // Server -> Client: character spawn successful, proceed to game
  'enterWorldRejected',  // Server -> Client: character already logged in
  // Agent goal sync packet (for dashboard display)
  'syncGoal',
  // Agent goal override packet (dashboard -> plugin)
  'goalOverride',
  // Agent thought sync packet (for dashboard thought process display)
  'syncAgentThought',
  // Bank packets
  'bankOpen',
  'bankState',
  'bankDeposit',
  'bankDepositAll',
  'bankWithdraw',
  'bankDepositCoins',
  'bankWithdrawCoins',
  'bankClose',
  'bankMove',
  // Bank tab packets
  'bankCreateTab',     // Create new tab with first item
  'bankDeleteTab',     // Delete tab (items move to main tab)
  'bankMoveToTab',     // Move item between tabs
  'bankSelectTab',     // Client selected a different tab
  // Bank placeholder packets (RS3 style: qty=0 in bank_storage)
  'bankWithdrawPlaceholder',      // Withdraw all and leave qty=0 placeholder (RS3 style)
  'bankReleasePlaceholder',       // Release single placeholder (delete qty=0 row)
  'bankReleaseAllPlaceholders',   // Clear all placeholders (delete all qty=0 rows)
  'bankToggleAlwaysPlaceholder',  // Toggle auto-placeholder setting
  // Bank equipment tab packets (RS3-style equipment view in bank)
  'bankWithdrawToEquipment',      // Withdraw item directly to equipment slot
  'bankDepositEquipment',         // Deposit single equipment slot to bank
  'bankDepositAllEquipment',      // Deposit all worn equipment to bank
  // Store packets
  'storeOpen',
  'storeState',
  'storeBuy',
  'storeSell',
  'storeClose',
  // NPC interaction packets
  'npcInteract',
  // Generic entity interaction (for chests, interactables, etc.)
  'entityInteract',
  // Dialogue packets
  'dialogueStart',
  'dialogueNodeChange',
  'dialogueResponse',
  'dialogueContinue',
  'dialogueEnd',
  'dialogueClose',
  // Tile movement packets (RuneScape-style)
  'entityTileUpdate',    // Server -> Client: entity moved to new tile position
  'tileMovementStart',   // Server -> Client: movement path started
  'tileMovementEnd',     // Server -> Client: arrived at destination
  // System message packets (UI_MESSAGE events -> chat)
  'systemMessage',       // Server -> Client: system/game messages for chat
  // Player loading state packets (Issue #356)
  'clientReady',         // Client -> Server: client finished loading, player now targetable
  // World time sync packets (day/night cycle)
  'worldTimeSync',       // Server -> Client: periodic world time sync for day/night
  // Prayer system packets
  'prayerToggle',        // Client -> Server: toggle a prayer on/off
  'prayerDeactivateAll', // Client -> Server: deactivate all prayers
  'altarPray',           // Client -> Server: pray at altar to recharge
  'prayerStateSync',     // Server -> Client: full prayer state sync
  'prayerToggled',       // Server -> Client: prayer toggle feedback
  'prayerPointsChanged', // Server -> Client: prayer points changed
  // Quest system packets
  'getQuestList',        // Client -> Server: request quest list
  'getQuestDetail',      // Client -> Server: request quest detail
  'questList',           // Server -> Client: quest list response
  'questDetail',         // Server -> Client: quest detail response
  'questStartConfirm',   // Server -> Client: show quest accept screen
  'questAccept',         // Client -> Server: player accepted quest
  'questProgressed',     // Server -> Client: quest progress updated
  'questCompleted',      // Server -> Client: quest completed, show rewards
  // XP Lamp packets
  'xpLampUse',           // Client -> Server: use XP lamp on skill
  // Home Teleport packets
  'homeTeleport',        // Client -> Server: request home teleport
  'homeTeleportCancel',  // Client -> Server: cancel home teleport cast
  'homeTeleportStart',   // Server -> Client: casting started (show progress)
  'homeTeleportFailed',  // Server -> Client: teleport failed (combat, cooldown, etc.)
  // Player Trading packets
  'tradeRequest',        // Client -> Server: request trade with target player
  'tradeRequestRespond', // Client -> Server: accept/decline incoming trade request
  'tradeIncoming',       // Server -> Client: notify of incoming trade request
  'tradeStarted',        // Server -> Client: trade session activated (both players)
  'tradeAddItem',        // Client -> Server: add item from inventory to trade offer
  'tradeRemoveItem',     // Client -> Server: remove item from trade offer back to inventory
  'tradeSetItemQuantity',// Client -> Server: set quantity for stackable item in trade
  'tradeUpdated',        // Server -> Client: trade state changed (items, acceptance)
  'tradeAccept',         // Client -> Server: accept current trade state
  'tradeCancelAccept',   // Client -> Server: cancel acceptance (offer modified)
  'tradeCancel',         // Client -> Server: cancel/close trade session
  'tradeCompleted',      // Server -> Client: trade successful, items swapped
  'tradeCancelled',      // Server -> Client: trade cancelled (disconnect, decline, etc.)
  'tradeError',          // Server -> Client: trade operation failed with reason
]

const byName: Record<string, PacketInfo> = {};
const byId: Record<number, PacketInfo> = {};

let ids = -1;

for (const name of names) {
  const id = ++ids;
  const info: PacketInfo = {
    id,
    name,
    method: `on${capitalize(name)}`, // eg 'connect' -> 'onConnect'
  };
  byName[name] = info;
  byId[id] = info;
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Exported packet names array for use by other packages.
 * This is the SINGLE SOURCE OF TRUTH for packet ordering.
 * DO NOT duplicate this list elsewhere - import it instead!
 */
export const PACKET_NAMES: readonly string[] = names;

/**
 * Get packet ID from packet name.
 * Returns null if packet name is not found.
 */
export function getPacketId(name: string): number | null {
  const info = byName[name];
  return info ? info.id : null;
}

/**
 * Get packet name from packet ID.
 * Returns null if packet ID is not found.
 */
export function getPacketName(id: number): string | null {
  const info = byId[id];
  return info ? info.name : null;
}

export function writePacket(name: string, data: unknown): ArrayBuffer {
  const info = byName[name];
  if (!info) throw new Error(`writePacket failed: ${name} (name not found)`);
  const packet = packr.pack([info.id, data]);
  // Convert Buffer/Uint8Array to ArrayBuffer
  if (packet instanceof ArrayBuffer) {
    return packet;
  }
  // If it's a view (Buffer/Uint8Array), create a new ArrayBuffer and copy the data
  const arrayBuffer = new ArrayBuffer(packet.length);
  const view = new Uint8Array(arrayBuffer);
  view.set(packet);
  return arrayBuffer;
}

export function readPacket(
  packet: ArrayBuffer | Uint8Array,
): [string, unknown] | [] {
  try {
    // Convert ArrayBuffer to Uint8Array if needed
    const buffer =
      packet instanceof ArrayBuffer ? new Uint8Array(packet) : packet;
    const [id, data] = packr.unpack(buffer);
    const info = byId[id];
    if (!info) {
      // Log warning but don't crash - return empty array so handler can gracefully ignore
      console.warn(
        `[readPacket] Unknown packet ID ${id} - this may indicate a version mismatch between client and server`,
      );
      return [];
    }
    return [info.method, data];
  } catch (error) {
    // Handle any deserialization errors gracefully
    console.error("[readPacket] Failed to deserialize packet:", error);
    return [];
  }
}
