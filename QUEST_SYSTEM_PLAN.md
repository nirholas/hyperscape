# Quest System Implementation Plan

## Overview

Implement a RuneScape-style questing system, starting with a simple "Goblin Slayer" quest. The system will be manifest-driven (like NPCs and dialogue), track progress server-side, and provide the classic quest completion experience.

---

## The Quest: Goblin Slayer

**Summary**: Captain Rowan asks the player to kill 15 goblins threatening the town.

| Property | Value |
|----------|-------|
| Quest Name | Goblin Slayer |
| Difficulty | Novice |
| Quest Points | 1 |
| Replayable | No |

### Flow

1. Player speaks to Captain Rowan (quest giver NPC)
2. Dialogue tree explains the goblin threat
3. Player accepts quest → receives **Bronze Sword**
4. Player kills 15 goblins (progress tracked)
5. Player returns to Captain Rowan
6. Quest completion screen displays
7. Player receives: **1 Quest Point** + **XP Lamp (1000 XP)**

---

## Existing Infrastructure

### Already Working

| System | Location | What It Does |
|--------|----------|--------------|
| Kill Tracking | `packages/server/src/database/schema.ts:685-699` | `npc_kills` table tracks kills per player/NPC |
| Kill Repository | `packages/server/src/database/repositories/NPCKillRepository.ts` | `getNPCKillCountAsync()` queries kill counts |
| Quest Events | `packages/shared/src/types/events/event-types.ts` | `QUEST_STARTED`, `QUEST_PROGRESSED`, `QUEST_COMPLETED` |
| XP Rewards | `packages/shared/src/systems/shared/character/SkillsSystem.ts` | Already subscribes to `QUEST_COMPLETED` for XP |
| Dialogue System | `packages/shared/src/systems/shared/interaction/DialogueSystem.ts` | Server-authoritative with `effect` support |
| Toast Notifications | `EventType.UI_TOAST` | Player feedback system |
| Manifest Pattern | `packages/server/world/assets/manifests/` | JSON-driven definitions |

---

## Database Schema

### New Table: `quest_progress`

```sql
CREATE TABLE quest_progress (
  id SERIAL PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  quest_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'not_started',  -- not_started | in_progress | completed (DB only stores these 3)
  current_stage TEXT,
  stage_progress JSONB DEFAULT '{}',           -- e.g., {"kills": 7}
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  UNIQUE(player_id, quest_id)
);

CREATE INDEX idx_quest_progress_player ON quest_progress(player_id);
CREATE INDEX idx_quest_progress_status ON quest_progress(player_id, status);
```

**Note**: `ready_to_complete` is a **derived state**, not stored in DB. It's computed when `status = "in_progress"` AND the current stage's objective is met (e.g., kills >= 15). QuestSystem computes this dynamically.

### Character Table Addition

```sql
ALTER TABLE characters ADD COLUMN quest_points INTEGER DEFAULT 0 NOT NULL;
```

---

## Manifest Structure

### `packages/server/world/assets/manifests/quests.json`

```json
{
  "goblin_slayer": {
    "id": "goblin_slayer",
    "name": "Goblin Slayer",
    "description": "Captain Rowan needs help dealing with the goblin threat.",
    "difficulty": "novice",
    "questPoints": 1,
    "replayable": false,
    "requirements": {
      "quests": [],
      "skills": {},
      "items": []
    },
    "startNpc": "captain_rowan",
    "stages": [
      {
        "id": "start",
        "type": "dialogue",
        "description": "Speak to Captain Rowan in Lumbridge",
        "npcId": "captain_rowan"
      },
      {
        "id": "kill_goblins",
        "type": "kill",
        "description": "Kill 15 goblins",
        "target": "goblin",
        "count": 15
      },
      {
        "id": "return",
        "type": "dialogue",
        "description": "Return to Captain Rowan",
        "npcId": "captain_rowan"
      }
    ],
    "onStart": {
      "items": [
        { "itemId": "bronze_sword", "quantity": 1 }
      ],
      "dialogue": "quest_accepted"
    },
    "rewards": {
      "questPoints": 1,
      "items": [
        { "itemId": "xp_lamp_1000", "quantity": 1 }
      ],
      "xp": {}
    }
  }
}
```

---

## NPC Dialogue Integration

### Captain Rowan NPC Definition

Add to `packages/server/world/assets/manifests/npcs.json`:

```json
{
  "id": "captain_rowan",
  "name": "Captain Rowan",
  "description": "The captain of the Lumbridge town guard",
  "category": "neutral",
  "faction": "town",
  "combat": { "attackable": false },
  "movement": { "type": "stationary" },
  "dialogue": {
    "entryNodeId": "greeting",
    "questOverrides": {
      "goblin_slayer": {
        "in_progress": "progress_check",
        "ready_to_complete": "quest_complete",
        "completed": "post_quest"
      }
    },
    "nodes": [
      {
        "id": "greeting",
        "text": "Halt, traveler! The roads aren't safe. Goblins have been attacking anyone who ventures outside town.",
        "responses": [
          { "text": "Is there anything I can do to help?", "nextNodeId": "quest_offer" },
          { "text": "I'll be careful. Goodbye.", "nextNodeId": null }
        ]
      },
      {
        "id": "quest_offer",
        "text": "You look capable enough. If you could thin their numbers - say, fifteen of the wretches - it would make the roads safer for everyone. I can offer you a sword and a reward for your trouble.",
        "responses": [
          { "text": "I'll do it.", "nextNodeId": "quest_accepted", "effect": "startQuest:goblin_slayer" },
          { "text": "Maybe later.", "nextNodeId": null }
        ]
      },
      {
        "id": "quest_accepted",
        "text": "Excellent! Take this sword. Return to me once you've slain fifteen goblins. Good luck, adventurer."
      },
      {
        "id": "progress_check",
        "text": "How goes the goblin hunt? Have you slain fifteen of them yet?",
        "responses": [
          { "text": "Not yet, but I'm working on it.", "nextNodeId": "encouragement" },
          { "text": "Where can I find goblins?", "nextNodeId": "goblin_location" }
        ]
      },
      {
        "id": "encouragement",
        "text": "Keep at it. The town is counting on you."
      },
      {
        "id": "goblin_location",
        "text": "They've set up camp east of town, near the old ruins. Be careful out there."
      },
      {
        "id": "quest_complete",
        "text": "You've done it! Fifteen goblins slain. The roads will be safer thanks to you. Here's your reward - you've earned it.",
        "effect": "completeQuest:goblin_slayer"
      },
      {
        "id": "post_quest",
        "text": "The town owes you a debt, adventurer. The goblin attacks have decreased since your efforts."
      }
    ]
  }
}
```

---

## New Systems

### 1. QuestSystem

**Location**: `packages/shared/src/systems/shared/progression/QuestSystem.ts`

**Responsibilities**:
- Load quest definitions from manifest
- Track active quests per player
- Subscribe to `NPC_DIED` for kill quest progress
- Handle `startQuest` and `completeQuest` dialogue effects
- Emit `QUEST_STARTED`, `QUEST_PROGRESSED`, `QUEST_COMPLETED` events
- Award items on quest start/completion

**Key Methods**:
```typescript
class QuestSystem extends System {
  // Quest state management
  startQuest(playerId: string, questId: string): void
  getQuestStatus(playerId: string, questId: string): QuestStatus
  getActiveQuests(playerId: string): Quest[]

  // Progress tracking
  updateKillProgress(playerId: string, npcId: string): void
  checkStageCompletion(playerId: string, questId: string): boolean
  advanceStage(playerId: string, questId: string): void

  // Completion
  completeQuest(playerId: string, questId: string): void
  awardRewards(playerId: string, questId: string): void
}
```

**Event Subscriptions**:
- `NPC_DIED` → Update kill progress for active kill quests
- `DIALOGUE_EFFECT` → Handle `startQuest:*` and `completeQuest:*` effects

### 2. QuestRepository

**Location**: `packages/server/src/database/repositories/QuestRepository.ts`

**Methods**:
```typescript
class QuestRepository {
  getQuestProgress(playerId: string, questId: string): Promise<QuestProgress | null>
  getAllPlayerQuests(playerId: string): Promise<QuestProgress[]>
  getCompletedQuests(playerId: string): Promise<string[]>

  startQuest(playerId: string, questId: string): Promise<void>
  updateProgress(playerId: string, questId: string, stage: string, progress: object): Promise<void>
  completeQuest(playerId: string, questId: string): Promise<void>

  getQuestPoints(playerId: string): Promise<number>
  addQuestPoints(playerId: string, points: number): Promise<void>
}
```

---

## Type Definitions

### `packages/shared/src/types/game/quest-types.ts`

```typescript
export type QuestStatus = "not_started" | "in_progress" | "ready_to_complete" | "completed";
export type QuestDifficulty = "novice" | "intermediate" | "experienced" | "master" | "grandmaster";
export type QuestStageType = "dialogue" | "kill" | "gather" | "travel" | "interact";

export interface QuestRequirements {
  quests: string[];
  skills: Record<string, number>;
  items: string[];
}

export interface QuestStage {
  id: string;
  type: QuestStageType;
  description: string;
  npcId?: string;
  target?: string;
  count?: number;
  location?: { x: number; y: number; z: number; radius: number };
}

export interface QuestRewards {
  questPoints: number;
  items: Array<{ itemId: string; quantity: number }>;
  xp: Record<string, number>;
}

export interface QuestDefinition {
  id: string;
  name: string;
  description: string;
  difficulty: QuestDifficulty;
  questPoints: number;
  replayable: boolean;
  requirements: QuestRequirements;
  startNpc: string;
  stages: QuestStage[];
  onStart?: {
    items?: Array<{ itemId: string; quantity: number }>;
    dialogue?: string;
  };
  rewards: QuestRewards;
}

export interface QuestProgress {
  playerId: string;
  questId: string;
  status: QuestStatus;
  currentStage: string;
  stageProgress: Record<string, number>;
  startedAt?: Date;
  completedAt?: Date;
}

export interface PlayerQuestState {
  playerId: string;
  questPoints: number;
  activeQuests: Map<string, QuestProgress>;
  completedQuests: Set<string>;
}
```

### Event Payloads

Add to `packages/shared/src/types/events/event-payloads.ts`:

```typescript
[EventType.QUEST_STARTED]: {
  playerId: string;
  questId: string;
  questName: string;
};

[EventType.QUEST_PROGRESSED]: {
  playerId: string;
  questId: string;
  stage: string;
  progress: Record<string, number>;
  description: string;
};

[EventType.QUEST_COMPLETED]: {
  playerId: string;
  questId: string;
  questName: string;
  rewards: QuestRewards;
};
```

---

## UI Components (OSRS-Accurate)

**Note**: OSRS does NOT have a floating HUD tracker. Progress is only visible in the Quest Journal.

### 1. Quest Journal Panel

**Location**: `packages/client/src/components/ui/QuestJournal.tsx`

The primary interface for quest tracking, matching OSRS style:

**Quest List View:**
- List of all quests with color-coded status:
  - 🔴 Red = Not started
  - 🟡 Yellow = In progress
  - 🟢 Green = Completed
- Shows total quest points at top
- Click quest name to view details

**Quest Detail View:**
```
┌─────────────────────────────────────┐
│ Goblin Slayer                       │
│                                     │
│ ~~I should speak to Captain Rowan~~ │
│ ~~in Lumbridge.~~                   │
│                                     │
│ ~~Captain Rowan asked me to kill~~  │
│ ~~15 goblins threatening the town.~~│
│                                     │
│ ~~He gave me a bronze sword to~~    │
│ ~~help with the task.~~             │
│                                     │
│ Goblins killed: 12/15               │
│                                     │
│ I should return to Captain Rowan    │
│ when I've killed enough goblins.    │
└─────────────────────────────────────┘
```

- Completed steps shown with ~~strikethrough~~
- Current objective in normal text
- Dynamic progress counters where applicable

### 2. Quest Completion Screen

**Location**: `packages/client/src/components/ui/QuestCompleteScreen.tsx`

OSRS-style completion scroll (appears as modal overlay):
```
╔═══════════════════════════════════╗
║                                   ║
║       Congratulations!            ║
║    You have completed the         ║
║       Goblin Slayer quest!        ║
║                                   ║
║         1 Quest Point             ║
║                                   ║
║      XP Lamp (1000 XP)            ║
║                                   ║
╚═══════════════════════════════════╝
```

- Fanfare sound effect on display
- Click anywhere or press space to dismiss
- Rewards listed in center

### 3. Chat Messages (No Separate Component)

Progress feedback via existing chat system:
- Quest start: "You have started a new quest: Goblin Slayer"
- Objective complete: "You've killed enough goblins. Return to Captain Rowan."
- No per-kill notifications (OSRS doesn't spam these)

---

## Network Messages

### Server → Client

| Message | Payload | Purpose |
|---------|---------|---------|
| `questStarted` | `{ questId, name, currentStage, objectives }` | Quest began |
| `questProgress` | `{ questId, stage, progress, description }` | Objective updated |
| `questCompleted` | `{ questId, name, rewards }` | Show completion screen |
| `questList` | `{ active: [], completed: [], available: [] }` | Full quest state |

### Client → Server

| Message | Payload | Purpose |
|---------|---------|---------|
| `requestQuestList` | `{}` | Request quest journal data |

---

## Implementation Order

### Phase 1: Foundation
1. [ ] Create database migration for `quest_progress` table
2. [ ] Add `quest_points` column to characters table
3. [ ] Create `QuestRepository` with basic CRUD
4. [ ] Define quest types in `quest-types.ts`
5. [ ] Create `quests.json` manifest with Goblin Slayer quest

### Phase 2: Core System
6. [ ] Create `QuestSystem` skeleton
7. [ ] Implement quest start logic (dialogue effect handler)
8. [ ] Implement kill tracking integration (subscribe to `NPC_DIED`)
9. [ ] Implement stage progression
10. [ ] Implement quest completion and reward distribution

### Phase 3: Dialogue Integration
11. [ ] Add Captain Rowan NPC definition to `npcs.json`
12. [ ] Add Captain Rowan spawn point to `world-areas.json` (Central Haven)
13. [ ] Implement `questOverrides` in dialogue system (show different dialogue based on quest state)
14. [ ] Handle `startQuest:*` and `completeQuest:*` effects in DialogueSystem

### Phase 4: Items
15. [ ] Ensure `bronze_sword` item exists in item definitions
16. [ ] Create `xp_lamp_1000` item with "use" action that grants 1000 XP to chosen skill
17. [ ] Create skill selection UI for XP lamp usage
18. [ ] Test item granting on quest start/completion

### Phase 5: UI
19. [ ] Create `QuestJournal` panel (list view + detail view with strikethrough)
20. [ ] Create `QuestCompleteScreen` modal
21. [ ] Add quest completion sound effect
22. [ ] Integrate quest chat messages (start, objective complete)

### Phase 6: Data Loading & Polish
23. [ ] Load quest state on player login (PLAYER_REGISTERED handler)
24. [ ] Test full quest flow end-to-end
25. [ ] Write integration tests

---

## Files to Create

| File | Purpose |
|------|---------|
| `packages/server/world/assets/manifests/quests.json` | Quest definitions |
| `packages/shared/src/types/game/quest-types.ts` | Type definitions |
| `packages/shared/src/systems/shared/progression/QuestSystem.ts` | Core quest logic |
| `packages/server/src/database/repositories/QuestRepository.ts` | Database operations |
| `packages/server/src/database/migrations/0019_add_quest_progress.sql` | Schema migration |
| `packages/client/src/components/ui/QuestJournal.tsx` | Quest list + detail panel |
| `packages/client/src/components/ui/QuestCompleteScreen.tsx` | Completion scroll modal |
| `packages/client/src/components/ui/SkillSelectModal.tsx` | Skill selection for XP lamp (may be reusable) |

## Files to Modify

| File | Changes |
|------|---------|
| `packages/server/world/assets/manifests/npcs.json` | Add Captain Rowan NPC definition |
| `packages/server/world/assets/manifests/world-areas.json` | Add Captain Rowan spawn point in Central Haven |
| `packages/server/world/assets/manifests/items/misc.json` | Add `xp_lamp_1000` item |
| `packages/server/src/database/schema.ts` | Add quest_progress table, quest_points column |
| `packages/shared/src/types/events/event-payloads.ts` | Add quest event payloads |
| `packages/shared/src/systems/shared/interaction/DialogueSystem.ts` | Handle quest effects, quest-based dialogue overrides |
| `packages/server/src/systems/ServerNetwork/event-bridge.ts` | Route quest events to clients |
| `packages/shared/src/systems/index.ts` (or system registration) | Register QuestSystem |

---

## Testing Strategy

Following the project's "no mocks" philosophy:

1. **Integration Test**: Full quest flow with real server
   - Start server with test world
   - Create player, spawn Captain Rowan
   - Walk through dialogue, accept quest
   - Verify bronze sword in inventory
   - Spawn and kill 15 goblins
   - Verify progress updates
   - Return to NPC, complete quest
   - Verify rewards received
   - Verify quest not re-startable

2. **Visual Test**: Quest UI
   - Screenshot quest journal with strikethrough text
   - Screenshot completion screen
   - Verify fanfare plays

---

## Notes

- Kill tracking already works - we just need to query it from QuestSystem
- The `QUEST_COMPLETED` event is already handled by SkillsSystem for XP rewards (line 116)
- Dialogue system already supports effects - just need to add quest-specific handlers
- Follow existing patterns: manifest-driven, event-driven, server-authoritative

---

## Verification Notes (Code Review)

### Confirmed Working
- `npc_kills` table exists (`packages/server/src/database/schema.ts:685-699`)
- Quest events defined: `QUEST_STARTED`, `QUEST_PROGRESSED`, `QUEST_COMPLETED` (lines 272-274)
- `NPC_DIED` event exists (line 287) - QuestSystem can subscribe to track kills
- SkillsSystem subscribes to `QUEST_COMPLETED` for XP rewards
- `bronze_sword` item exists in `packages/server/world/assets/manifests/items/weapons.json`
- DialogueSystem has `startQuest` effect case (line 316) - currently logs TODO, needs implementation

### Needs Creation
- **`xp_lamp_1000` item** - Does not exist, must be created in items manifest
- **`progression` folder** - `packages/shared/src/systems/shared/progression/` does not exist, must be created
- **`completeQuest` effect** - DialogueSystem needs this effect added alongside `startQuest`

### Implementation Detail: DialogueSystem Effect
The effect handling is already in place at `DialogueSystem.ts:295-326`:
```typescript
case "startQuest":
  // Future: implement quest system integration
  this.logger.info(`TODO: Start quest ${params[0]} for player ${playerId}`);
  break;
```
This should emit a `QUEST_STARTED` event that QuestSystem handles, rather than calling QuestSystem directly (maintains decoupling).

### Inventory Integration
Use `InventorySystem.addItem()` pattern or emit `INVENTORY_ITEM_ADDED` event for giving items. The system already handles this for starter items and loot pickups.

### Dialogue Quest Overrides
The `questOverrides` feature in the NPC dialogue definition is **new functionality**. Currently DialogueSystem only uses `entryNodeId` directly. We need to modify `startDialogue()` to:
1. Check player's quest status for this NPC's quests
2. Override `entryNodeId` based on quest state
3. This requires QuestSystem to be queryable for player quest state

**Quest Override States:**
- `in_progress` - Quest started but current stage objective not complete
- `ready_to_complete` - Quest in progress AND current stage objective IS complete (e.g., killed 15/15 goblins)
- `completed` - Quest fully finished

DialogueSystem must query QuestSystem to determine:
```typescript
const status = questSystem.getQuestStatus(playerId, questId);
// Returns: "not_started" | "in_progress" | "ready_to_complete" | "completed"
```

This distinction is critical - without `ready_to_complete`, the player would see "progress_check" dialogue forever even after killing all 15 goblins.

### XP Lamp Item
The `xp_lamp_1000` item requires special handling:
1. Item type should be "consumable" or "useable"
2. On use, open a skill selection UI (dropdown or panel)
3. Player picks a skill, lamp is consumed, 1000 XP granted to that skill
4. This may require a new `ITEM_USE_LAMP` event and handler, plus a small client UI component

### NPC Spawn Location
Captain Rowan needs a spawn point in `world-areas.json`. Add to the `central_haven.npcs` array:
```json
{
  "id": "captain_rowan",
  "type": "quest_giver",
  "position": { "x": 10, "y": 0, "z": 5 }
}
```
Place him near the town entrance or main square for visibility.

### Quest State on Login
When a player connects, QuestSystem must load their quest progress from the database and send it to the client. Add to the `PLAYER_REGISTERED` or `PLAYER_DATA_LOADED` event handling:
1. Load all quest progress rows for player
2. Store in memory (playerQuestState map)
3. Send `questList` network message to client so Quest Journal can populate
