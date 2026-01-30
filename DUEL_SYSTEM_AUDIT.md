# Duel System Technical Audit & Implementation Plan

**Date:** 2026-01-29 (Updated after double-check review)
**Branch:** `feat/trading-system-upgrade`
**Current Score:** 6.5 / 10 (revised from 8.3 → 7.8 → 7.6 → 7.1 → 6.8 → 6.5 after auditing dependency chain)
**Target Score:** 9.0+ / 10

---

## System Overview

The duel system spans **3,146 lines of server logic** across 7 files, **2,609 lines of client UI** across 9 components, **~1,500 lines of network handlers** across 7 handler files, and **~570 lines of shared types**. It implements an OSRS-accurate duel arena with a 6-state state machine, 6 pre-allocated arenas, item staking, rule negotiation, equipment restrictions, and combat resolution.

### Architecture

```
packages/server/src/systems/DuelSystem/
├── index.ts                 (1,664 lines) — Main orchestrator, state machine
├── DuelCombatResolver.ts      (334 lines) — Combat resolution, stake transfer, teleportation
├── DuelSessionManager.ts      (293 lines) — Session CRUD
├── ArenaPoolManager.ts        (260 lines) — Arena pooling & collision
├── PendingDuelManager.ts      (313 lines) — Challenge lifecycle
├── config.ts                  (195 lines) — Constants & timing
├── validation.ts               (87 lines) — Event payload type guards
└── __tests__/
    ├── DuelSystem.test.ts    (1,067 lines)
    ├── PendingDuelManager.test.ts (457 lines)
    └── ArenaPoolManager.test.ts   (234 lines)

packages/server/src/systems/ServerNetwork/handlers/duel/
├── index.ts         (36 lines) — Barrel export
├── challenge.ts    (428 lines) — Challenge initiation & response
├── rules.ts        (314 lines) — Rules negotiation
├── stakes.ts       (353 lines) — Item staking
├── confirmation.ts (111 lines) — Final confirmation
├── combat.ts        (60 lines) — Forfeit handling
└── helpers.ts      (213 lines) — Shared validation utilities

packages/client/src/game/panels/DuelPanel/
├── DuelPanel.tsx           (258 lines) — Screen orchestration
├── RulesScreen.tsx         (300 lines) — Rules & equipment UI
├── StakesScreen.tsx        (583 lines) — Staking UI
├── ConfirmScreen.tsx       (401 lines) — Final review
├── DuelChallengeModal.tsx  (203 lines) — Incoming challenge modal
├── DuelCountdown.tsx       (222 lines) — 3-2-1-FIGHT overlay
├── DuelHUD.tsx             (303 lines) — In-combat HUD
└── DuelResultModal.tsx     (339 lines) — Results screen

packages/shared/src/types/game/duel-types.ts  (570 lines) — Shared type definitions
packages/shared/src/data/duel-manifest.ts      — Data-driven config
```

---

## Current Scores

| Category | Score | Key Strength | Key Gap |
|----------|-------|-------------|---------|
| Production Quality | 8.5 | Self-documenting code, comprehensive error handling | `unknown` types in system interface |
| Best Practices | 7.5 | Excellent SRP across 7 files | Testing gaps, handler boilerplate 10×, magic strings |
| OWASP Security | 6.0 | Rate limiting, zone checks, damage is server-side | **12+ handlers lack duel checks: equip, shop, pickup, altar, dialogue, etc.** |
| SOLID Principles | 9.0 | Each file has one reason to change | Interface could be split |
| GRASP Principles | 9.0 | Event-driven, low coupling, high cohesion | — |
| Clean Code | 7.5 | Meaningful names, single abstraction level | **Acceptance logic 3×, ternary 7×, dead method, formatting utils 3×** |
| Law of Demeter | 8.0 | Manager delegation pattern | Framework-inherent chain access |
| Memory & Allocation | 8.0 | Pre-allocated arenas, dual-map lookups | **Disconnect timer memory leak on resolution** |
| Game Patterns | 9.0 | State machine with exhaustive switch | No arena exhaustion handling |
| Server Authority | 5.5 | Core combat (damage, death, cooldowns, state) is solid | **Equipment re-equip, food, prayer, altar, shop, pickup, special atk, ranged, magic — all bypassable** |
| Economic Integrity | 4.0 | PostgreSQL transaction with FOR UPDATE locks | **CRITICAL: Item duplication via staked food; integer overflow in settlement; 6 handlers remove staked items; no retry; no idempotency** |
| Anti-Cheat | 5.0 | Rate limiting, state machine validation | **Duel isolation is fundamentally incomplete — 12+ non-combat handlers unaware of duel state** |
| Event Bus Trust | 5.0 | Synchronous, FIFO ordering guaranteed | **PLAYER_RESPAWNED unconditionally heals; no listener registration verification; silent settlement failure** |
| Tick System | 8.5 | Tick-based constants via `ticksToMs()` | `setTimeout` not tick-aligned |
| Testing | 6.0 | Good state machine coverage | CombatResolver untested, no E2E |
| Persistence | 8.0 | In-memory appropriate for real-time | No duel history |
| Client UI | 7.5 | BankPanel pattern, anti-scam features | **StakesScreen monolith (583 lines), 3× copy-paste formatting, timer leak** |
| **Overall** | **6.5** | | |

> **Score revision notes:**
> - Initial review scored 8.3.
> - Double-check revealed 6 unenforced rule gaps (Findings 9-13): -0.5 → 7.8.
> - Code quality review revealed DRY violations, dead code, memory leak, monolith (Findings 14-20): -0.2 → 7.6.
> - **Server authority audit revealed systemic isolation failure** (Findings 21-28): Equipment re-equip
>   bypasses restrictions, altar prayer restoration, noSpecialAttack unenforced, shop/pickup/dialogue
>   all unblocked during duels, home teleport uses wrong check. This drops Server Authority to 5.5
>   and Anti-Cheat to 5.0 because the **duel arena is not a sealed environment** — the server only
>   blocks drops, trades, and staked item moves. Every other handler is duel-unaware: -0.5 → 7.1.
> - **Item duplication/loss audit revealed critical economic vulnerabilities** (Findings 29-33):
>   Settlement uses `stake.quantity` (original staked amount) not `dbItem.quantity` (actual remaining)
>   when giving items to the winner — enabling duplication when staked food is consumed during combat.
>   6 handlers can remove staked items without checking `getStakedSlots()`. No settlement retry or
>   idempotency guard. Bank overflow during settlement causes silent rollback. This drops Economic
>   Integrity from 8.0 to **4.5**: -0.3 → 6.8.
> - The **core combat loop** (damage, death, cooldowns, state machine, identity) is rock-solid.
>   The problem is the **perimeter** — all the non-combat handlers that should respect duel state but don't.
> - The **transaction infrastructure** is solid (PostgreSQL BEGIN/COMMIT/ROLLBACK, FOR UPDATE locks),
>   but the **business logic within the transaction** has critical gaps in quantity validation.
> - **Dependency chain audit revealed systemic event bus trust issues** (Findings 34-41):
>   PLAYER_RESPAWNED unconditionally heals any player to full HP without context checks.
>   Integer overflow possible in settlement stack merges. Arena collision walls never cleaned up.
>   Database schema lacks quantity safety constraints. No deadlock retry in settlement.
>   Coin pouch withdrawal and XP lamp usage unblocked during duels. No listener registration
>   verification for the critical stakes settlement event. This adds Event Bus Trust (5.0)
>   as a new category and drops Economic Integrity further to 4.0: -0.3 → 6.5.
> - Architecture and separation of concerns remain strong. The fix pattern is consistent: add
>   `isPlayerInDuel()` or `isPlayerInActiveDuel()` checks to ~12 handlers, validate quantities at settlement,
>   add overflow checks, and add context validation to event handlers.

---

## Detailed Findings

### Finding 1: DuelCombatResolver Has Zero Tests (Testing: 6.0)

The most economically critical code path — stake transfer, health restoration, teleportation — has no dedicated test coverage. This is the file that moves items between players.

**Files:** `DuelCombatResolver.ts` (334 lines, 0 tests)

**Risk:** A bug in stake transfer logic could duplicate or destroy items with no test to catch it.

---

### Finding 2: No Settlement-Time Inventory Verification (Economic Integrity: 8.5)

When a duel completes, `DuelCombatResolver.resolveDuel()` transfers stakes based on the in-memory `session.challengerStakes` / `session.targetStakes` arrays. There is no verification that the staked items still exist in the player's inventory at the moment of transfer.

The crash-safe design means items stay in inventory during staking, and `getStakedSlots()` blocks other systems (trade, drop, bank) from moving staked items. However, if a bug in any of those blocking systems allows an item to leave inventory while staked, the settlement would transfer a phantom item.

**Files:**
- `DuelCombatResolver.ts:106` — `transferStakes()` trusts session data
- `DuelSystem/index.ts` — `getStakedSlots()` provides blocking, but no final check

---

### Finding 3: setTimeout Instead of Tick-Based Scheduling (Tick System: 8.5)

`handlePlayerDeath()` uses `setTimeout(callback, ticksToMs(DEATH_RESOLUTION_DELAY_TICKS))` for the death animation delay. `startDisconnectTimer()` uses `setTimeout(callback, ticksToMs(DISCONNECT_TIMEOUT_TICKS))`. These fire at wall-clock time, not game time. If the server lags or the tick rate drops, these timers are misaligned with game state.

**Files:**
- `DuelSystem/index.ts:1473` — Death resolution delay
- `DuelSystem/index.ts:1409` — Disconnect timeout

---

### Finding 4: System Interface Uses `unknown` and `string` (Production Quality: 8.5)

The `DuelSystem` interface in `system-interfaces.ts` uses `unknown` return types for `getDuelSession()`, `getPlayerDuel()`, and `getPlayerDuelRules()`. Parameters `rule` and `slot` in `toggleRule()` and `toggleEquipmentRestriction()` use `string` instead of the type-safe `keyof DuelRules` and `EquipmentSlotRestriction`.

**File:** `packages/shared/src/types/systems/system-interfaces.ts:465-586`

---

### Finding 5: No Race Condition Tests (Testing: 6.0)

No tests exercise:
- Simultaneous death (both players die in the same tick)
- Disconnect during death resolution delay
- Concurrent accept calls (both players accept at same millisecond)
- Forfeit while opponent is dying

The state machine handles most of these correctly in code (FINISHED guard, acceptance tracking), but this is unverified by tests.

---

### Finding 6: Dead Code and Minor DRY Violations (Clean Code: 8.5)

- `POSITION_TOLERANCE` is imported at `index.ts:54` but never used (hardcoded `0.5` at line 1634).
- Rotation calculation (`Math.atan2(dx, dz)`) is duplicated at lines ~1294 and ~1607 of index.ts.
- ID generation pattern (`duel_${Date.now()}_${random}`) is duplicated between `DuelSessionManager` and `PendingDuelManager`.

---

### Finding 7: cleanupExpiredSessions Matches FINISHED State (Reliability)

`cleanupExpiredSessions()` at line 1618 cancels sessions where `session.state !== "FIGHTING"`. This includes `FINISHED` state. While the `cancelDuel()` state guard now blocks this (from our recent fix), the cleanup logic semantically should exclude `FINISHED` explicitly rather than relying on `cancelDuel` rejecting it.

**File:** `DuelSystem/index.ts:1618`

---

### Finding 8: No Duel History Persistence (Persistence: 8.0)

Completed duels are not saved to database. There is no way to:
- Review past duel outcomes for dispute resolution
- Track player win/loss statistics
- Detect suspicious patterns (always winning, always same opponents)

---

### ⚠️ CRITICAL Finding 9: noFood / noPrayer / noPotion Rules NOT Enforced Server-Side (Server Authority: 7.5)

**Severity: CRITICAL — Exploitable by modified client**

The DuelSystem defines rule enforcement methods that are **never called** from their respective network handlers:

- `canEatFood(playerId)` — defined at `DuelSystem/index.ts:1063-1065`, checks `noFood` rule
- `canUsePrayer(playerId)` — defined at `DuelSystem/index.ts:1049-1051`, checks `noPrayer` rule
- `canUsePotions(playerId)` — defined at `DuelSystem/index.ts:1056-1058`, checks `noPotions` rule

**Food handler** (`handlers/inventory.ts:425-475`): `handleUseItem()` processes food consumption with rate limiting and validation, but **never checks** if the player is in a duel with `noFood` enabled. A player who agreed to "no food" can eat food freely by sending the consume packet.

**Prayer handler** (`handlers/prayer.ts:47-107`): `handlePrayerToggle()` validates prayer IDs and applies rate limiting, but **never checks** if the player is in a duel with `noPrayer` enabled. A player can activate Protect from Melee during a "no prayer" duel.

**Impact:** In OSRS, these rules are hard-enforced — you literally cannot eat food in a no-food duel. Here, the enforcement is client-only. Any player with a modified client can eat food, drink potions, and use prayers while their opponent cannot (if their opponent's client correctly hides the UI). This is a **competitive integrity violation** in staked duels.

---

### ⚠️ CRITICAL Finding 10: noRanged / noMagic Rules NOT Enforced in Combat Handler (Server Authority: 7.5)

**Severity: CRITICAL — Exploitable by modified client**

The combat handler at `handlers/combat.ts:128-176` only enforces `noMelee`:

```typescript
// Line 163 — ONLY melee is checked:
if (duelSystem.canUseMelee && !duelSystem.canUseMelee(attackerId)) {
  sendCombatError(socket, "Melee attacks are disabled in this duel.");
  return;
}
```

The methods `canUseRanged()` (line 1021-1023) and `canUseMagic()` (line 1035-1037) are **defined in DuelSystem** and even **typed in the handler's destructuring** at lines 138-139, but **never called**. A player can use ranged/magic attacks in a "no ranged" or "no magic" duel.

**Impact:** Same as Finding 9 — competitive integrity violation. In OSRS, switching to a ranged weapon in a melee-only duel does nothing. Here, a modified client can freely use any attack type.

---

### ⚠️ HIGH Finding 11: Bank Access NOT Blocked During Duels (Anti-Cheat: 6.5)

**Severity: HIGH**

The bank handlers at `handlers/bank/core.ts` have **no duel checks**:

- `handleBankOpen()` (lines 58-123) — no `isPlayerInDuel()` check
- `handleBankDeposit()` (lines 146-350) — no staked-slot protection
- `handleBankWithdraw()` (lines 370-710) — no duel state check
- `handleBankDepositAll()` (lines 722-925) — no duel state check

While the crash-safe stake design means items stay in inventory during staking (and `getStakedSlots()` blocks the inventory move handler), the **bank deposit handler does NOT check `getStakedSlots()`**. A player could potentially deposit a staked item into their bank during a duel, then lose the duel, and the settlement would attempt to transfer an item that no longer exists in inventory.

The inventory `handleMoveItem()` at lines 590-602 correctly blocks staked slots, and `handleDropItem()` at lines 323-330 blocks all drops during duels. But bank deposit bypasses this protection.

**Additionally:** Players should not be able to access their bank mid-duel at all. In OSRS, the duel arena is a completely isolated experience — no banking, no trading, no teleporting out.

---

### ⚠️ HIGH Finding 12: Attack During COUNTDOWN Not Explicitly Blocked (Anti-Cheat: 6.5)

**Severity: HIGH**

The `isPlayerInActiveDuel()` method at `DuelSystem/index.ts:995-999` returns `true` only for `FIGHTING` and `FINISHED` states:

```typescript
isPlayerInActiveDuel(playerId: string): boolean {
  const session = this.getPlayerDuel(playerId);
  return session?.state === "FIGHTING" || session?.state === "FINISHED";
}
```

During `COUNTDOWN` state (the 3-2-1-FIGHT animation), players have a duel session but `isPlayerInActiveDuel()` returns `false`. The combat handler uses `isPlayerInActiveDuel()` to determine if duel-specific rules apply. This means:

1. During countdown, the combat handler's duel-opponent-only check doesn't apply
2. A player could potentially attack their opponent before "FIGHT!" appears
3. The first-hitter advantage is significant in OSRS-style combat

In OSRS, players are physically unable to attack during the countdown — the game engine blocks all combat actions until the fight begins.

---

### Finding 13: Outside Players Can Attack Duelists — No Server-Side Rule (Anti-Cheat: 6.5)

**Severity: MEDIUM** (mitigated by arena collision walls)

The combat handler enforces that **duelists can only attack their opponent** (lines 144-176), but there is no reverse check: **a non-dueling player is not explicitly prevented from attacking a duelist**. The arena collision walls physically prevent this in normal gameplay, but if a player somehow clips through walls or if arena bounds are incorrectly configured, they could interfere with a duel.

In OSRS, duel arena combat is fully isolated — outside players cannot interact with duelists at all.

**Mitigation:** Arena collision walls registered by `ArenaPoolManager.ts` provide physical isolation. This is a defense-in-depth gap rather than an active vulnerability.

---

### Finding 14: Acceptance Logic Duplicated 3× (Clean Code / DRY)

**Severity: MODERATE**

The accept-and-advance pattern is copy-pasted across three methods in `DuelSystem/index.ts`:

- `acceptRules()` (~line 607-638)
- `acceptStakes()` (~line 798-849)
- `acceptFinal()` (~line 858-944)

Each repeats:
```typescript
if (playerId === session.challengerId) {
  session.challengerAccepted = true;
} else if (playerId === session.targetId) {
  session.targetAccepted = true;
}

if (session.challengerAccepted && session.targetAccepted) {
  session.state = "NEXT_STATE";
  session.challengerAccepted = false;
  session.targetAccepted = false;
  this.world.emit("duel:state:changed", { ... });
} else {
  this.world.emit("duel:acceptance:updated", { ... });
}
```

If acceptance logic ever needs to change (e.g., add timeout, add logging), it must be updated in 3 places.

**Fix:** Extract to a private helper:
```typescript
private handleAcceptance(session, playerId, nextState): { bothAccepted: boolean }
```

Additionally, the **challenger-vs-target ternary** appears 7+ times throughout the file:
```typescript
const stakes = isChallenger ? session.challengerStakes : session.targetStakes;
```
Should be a `getPlayerStakes(session, playerId)` helper.

---

### Finding 15: Disconnect Timer Not Cleared on Resolution — Memory Leak (Reliability)

**Severity: MODERATE**

When `resolveDuel()` fires at `index.ts:~1536`, it cleans up the session and arena but **never clears the disconnect timer** from the `disconnectTimers` Map. The orphaned `setTimeout` callback will fire later, find no session (it was deleted), and exit safely — but the timer reference stays in the Map forever.

This is both a **memory leak** and **temporal coupling**: the code depends on the callback detecting stale state rather than explicitly cleaning up. If the guard check in the callback is ever modified, this becomes a double-resolution bug.

**Files:** `DuelSystem/index.ts:~1536-1564` (resolveDuel), `~1412-1456` (startDisconnectTimer)

**Fix:** At the top of `resolveDuel()`:
```typescript
[session.challengerId, session.targetId].forEach(pid => {
  const timer = this.disconnectTimers.get(pid);
  if (timer) {
    clearTimeout(timer);
    this.disconnectTimers.delete(pid);
  }
});
```

---

### Finding 16: Dead Method `enforceArenaBounds()` (Clean Code)

**Severity: MODERATE**

`enforceArenaBounds()` at `index.ts:1587-1621` is a 34-line method that is **never called anywhere** in the codebase. Arena bounds are enforced by collision walls registered in `ArenaPoolManager.ts` instead.

This creates confusion for maintainers: is it intentionally unused? Was it meant to be called from `processTick()`? Is the collision-wall approach a replacement?

**Fix:** Delete the method entirely. Arena bounds enforcement via collision walls is the intended approach per `ArenaPoolManager.ts`.

---

### Finding 17: No Arena Exhaustion Handling (Reliability)

**Severity: MODERATE**

When `acceptFinal()` at `index.ts:~895-906` fails to reserve an arena, it resets both players' acceptance and returns an error. But there is:
- No retry limit or backoff
- No logging of arena pool exhaustion
- No player-facing feedback about *why* it failed (just "No arena available")
- Players could get stuck in an accept → fail → accept → fail loop with 6 concurrent duels

**Fix:** Log a warning when arena pool is exhausted, and consider adding a brief cooldown before re-acceptance is allowed.

---

### Finding 18: Client — StakesScreen Monolith & Copy-Paste (Client UI)

**Severity: HIGH (DRY) / MODERATE (monolith)**

**StakesScreen.tsx** at 583 lines is the largest client component and handles too many responsibilities:
- Two stake grids (mine + theirs)
- Inventory panel
- Context menu state and rendering
- Value calculations
- Direct DOM manipulation for hover (`e.currentTarget.style.background = ...`)

`renderStakeItem` and `renderInventoryItem` are ~80% identical — should be a shared `<SlotItem>` component.

**Cross-file duplication:** `formatQuantity()`, `formatGoldValue()`, and `calculateTotalValue()` are **identically copy-pasted** across 3 files:
- `StakesScreen.tsx:64-82`
- `ConfirmScreen.tsx:63-81`
- `DuelResultModal.tsx:87-95`

**Fix:**
1. Extract shared formatting to `DuelPanel/utils/formatting.ts`
2. Extract `<SlotItem>` component shared between stake grid and inventory
3. Split StakesScreen into `<StakeGrid>`, `<InventoryPanel>`, and `<StakeContextMenu>` sub-components

---

### Finding 19: Handler Auth Boilerplate Repeated 10× & Magic Strings (Best Practices)

**Severity: MODERATE**

Every duel handler starts with the same ~10-line auth check:
```typescript
const playerId = getPlayerId(socket);
if (!playerId) {
  sendDuelError(socket, "Not authenticated", "NOT_AUTHENTICATED");
  return;
}
const duelSystem = getDuelSystem(world);
if (!duelSystem) {
  sendDuelError(socket, "Duel system unavailable", "SYSTEM_ERROR");
  return;
}
```

This appears 10+ times across handler files. Not incorrect, but a `withDuelAuth(handler)` middleware pattern would eliminate it.

Additionally, **magic event/packet name strings** are scattered across handlers:
- `"duelSessionStarted"`, `"chatAdded"`, `"duelChallengeSent"`, `"duel_challenge"`, etc.
- No centralized `DUEL_EVENTS` constant — typos in refactoring would silently break packet routing.

**Files:** All 7 handler files in `handlers/duel/`

**Fix:**
1. Create `withDuelAuth()` middleware or shared validation function
2. Create `DUEL_PACKET_NAMES` constant object in helpers.ts or config

---

### Finding 20: DuelHUD Timer Memory Leak (Client UI)

**Severity: MEDIUM**

`DuelHUD.tsx:~84` uses `setTimeout` for forfeit confirmation reset without cleanup:
```typescript
setTimeout(() => setForfeitConfirm(false), 3000);
```

If the component unmounts during the 3-second timeout (e.g., duel ends), the callback fires on an unmounted component. React will warn in dev mode and this is a memory leak.

**Fix:** Use `useEffect` with a cleanup return, or store the timer ref and clear on unmount.

---

### ⚠️ CRITICAL Finding 21: Equipment Re-Equip Bypasses Duel Restrictions (Server Authority)

**Severity: CRITICAL — Exploitable by modified client**

Equipment restrictions (noHelmet, noShield, noGloves, etc.) are **only enforced once at duel start** via `applyEquipmentRestrictions()` at `DuelSystem/index.ts:1309-1324`. This method emits `duel:equipment:restrict` which unequips restricted items from both players during COUNTDOWN.

However, `handleEquipItem()` at `inventory.ts:359-407` has **no duel check whatsoever**. A player can immediately re-equip their shield after the server unequips it. The server will process the equip request without checking equipment restrictions.

**Files:**
- `handlers/inventory.ts:359-407` — `handleEquipItem()` — NO duel restriction check
- `handlers/inventory.ts:488-526` — `handleUnequipItem()` — NO duel check
- `DuelSystem/index.ts:1309-1324` — `applyEquipmentRestrictions()` — one-time only

**Impact:** All equipment restrictions are cosmetic. In OSRS, restricted equipment slots are hard-locked — you physically cannot equip items in those slots during the fight. Here, a modified client re-equips immediately.

---

### ⚠️ CRITICAL Finding 22: Altar Prayer Restoration During Duels (Server Authority)

**Severity: CRITICAL — Exploitable**

`handleAltarPray()` at `prayer.ts:117-159` has **no duel check**. This handler fully restores prayer points when a player prays at an altar. If an altar exists within reach of the duel arena (or the arena's movement rules allow walking to one), a player can:

1. Walk to altar during fight (if `noMovement` is not enabled)
2. Send `altarPray` packet
3. Fully restore prayer to 100%
4. Walk back and continue fighting with full prayer vs depleted opponent

This is separate from Finding 9 (prayer toggle) — this is **full prayer point restoration**, not just activating a prayer. Even if prayer toggle is eventually blocked, altar restoration would still work.

**In OSRS:** Duel arena is physically isolated — no altars accessible during combat.

---

### ⚠️ CRITICAL Finding 23: noSpecialAttack Rule Not Enforced (Server Authority)

**Severity: CRITICAL — Same pattern as Findings 10**

`canUseSpecialAttack()` at `DuelSystem/index.ts:1042-1044` checks the `noSpecialAttack` rule but is **never called** from the combat handler. It's typed at `combat.ts:140` but has no call site — identical to the noRanged/noMagic gap.

**Impact:** Players can use special attacks in "no special attack" duels. Special attacks in OSRS are some of the most powerful combat options (Dragon dagger spec, AGS spec, etc.) — this completely breaks the competitive integrity of spec-restricted duels.

---

### ⚠️ HIGH Finding 24: Shop Access Not Blocked During Duels (Server Authority)

**Severity: HIGH**

`handleStoreOpen()`, `handleStoreBuy()`, and `handleStoreSell()` at `store.ts` have **no duel state checks**. A player can open shops, buy items (weapons, food, potions, equipment), and sell items while in any duel state.

**Impact:** Buy food during a "no food" duel. Buy a better weapon mid-fight. Sell staked items before settlement.

---

### ⚠️ HIGH Finding 25: Item Pickup Not Blocked During Duels (Server Authority)

**Severity: HIGH**

`handlePickupItem()` at `inventory.ts:150-243` has **no duel check**. Ground items in or near the arena can be picked up mid-fight.

**Impact:** Players could drop items before the duel, then pick them up during combat for extra supplies. Or pick up items dropped by other systems.

**Note:** `handleDropItem()` correctly blocks drops during duels (line 323-330), but pickup is unblocked — asymmetric protection.

---

### Finding 26: NPC Dialogue Not Blocked During Duels (Server Authority)

**Severity: MEDIUM**

`handleDialogueResponse()` and `handleDialogueContinue()` at `dialogue.ts:37-96` have **no duel checks**. If any NPC near the arena offers healing, buffs, items, or prayer restoration through dialogue, players can access them mid-fight.

**Impact:** Depends on NPC placement near arenas. Lower severity than direct handlers (altar, shop) since it requires an NPC within interaction range.

---

### Finding 27: Home Teleport Uses Combat Check, Not Duel Check (Server Authority)

**Severity: MEDIUM**

`home-teleport.ts:90-93` blocks teleportation by checking `combatSystem.isInCombat()`:
```typescript
const combatSystem = this.world.getSystem("combat") as CombatSystem | null;
if (combatSystem?.stateService?.isInCombat(playerId)) {
  return "You can't teleport during combat!";
}
```

This does NOT check `duelSystem.isPlayerInActiveDuel()`. If duel combat doesn't set the combat system's `isInCombat` flag (or if the flag clears before the duel fully resolves), a player could home teleport during setup phases (RULES, STAKES, CONFIRMING) to escape a duel they agreed to.

**In OSRS:** Cannot teleport once you've entered the duel setup screen.

---

### Finding 28: Resource Gathering Not Blocked During Duels (Server Authority)

**Severity: LOW**

`handleResourceGather()` at `resources.ts:19-54` has **no duel check**. Players can gather resources during any duel state. Low impact since resources are unlikely near arenas, but violates isolation principle.

---

### ⚠️ CRITICAL Finding 29: Item Duplication via Staked Food Consumption (Economic Integrity)

**Severity: CRITICAL — Active item duplication vector**

The settlement code at `ServerNetwork/index.ts:3116-3215` uses `stake.quantity` (the original staked amount at the time of staking) when inserting items into the winner's inventory, **not** `dbItem.quantity` (the actual remaining quantity in the loser's inventory at settlement time).

Combined with the fact that `handleUseItem()` has **no `getStakedSlots()` check** (Finding 9), this creates a concrete item duplication attack:

**Attack chain:**
1. Player A stakes 10 lobsters (slot 5) in a duel
2. `session.challengerStakes` records `{ slot: 5, itemId: "lobster", quantity: 10 }`
3. During the fight, Player A eats 5 lobsters via `handleUseItem()` → slot 5 now has 5
4. Player A loses the duel
5. Settlement runs: `SELECT ... FOR UPDATE` finds slot 5 with `dbItem.quantity = 5`
6. Loser removal: `DELETE` fires because `dbItem.quantity (5) <= stake.quantity (10)` → loser loses 5
7. Winner insertion: **always uses `stake.quantity = 10`** → winner receives 10

**Result:** 5 lobsters created from nothing. Loser had 5, lost 5. Winner received 10.

**Files:**
- `ServerNetwork/index.ts:3082-3087` — `SELECT ... FOR UPDATE` reads `dbItem.quantity`
- `ServerNetwork/index.ts:3116-3127` — Loser removal uses `DELETE if dbItem.quantity <= stake.quantity`
- `ServerNetwork/index.ts:3129-3215` — Winner insertion **always uses `stake.quantity`**, never `dbItem.quantity`
- `handlers/inventory.ts:425-475` — `handleUseItem()` has no staked slot check

**Fix:** Winner must receive `Math.min(stake.quantity, dbItem.quantity)` — the **actual remaining amount**, not the original staked amount. Additionally, `handleUseItem()` must check `getStakedSlots()` to prevent consuming staked items at all (belt-and-suspenders).

---

### ⚠️ CRITICAL Finding 30: Six Handlers Can Remove Staked Items Without Protection (Economic Integrity)

**Severity: CRITICAL — Multiple paths to staked item removal**

Only 3 handlers check `getStakedSlots()` before modifying inventory:
- `handleDropItem()` — blocks all drops during duels ✅
- `handleMoveItem()` — blocks staked slot moves ✅
- Trade item handlers — blocks staked slots ✅

**Six handlers do NOT check `getStakedSlots()` and can remove staked items:**

| Handler | File | Action | Impact |
|---------|------|--------|--------|
| `handleUseItem()` | `inventory.ts:425-475` | Consume food/potions | **Eat staked lobsters → duplication (Finding 29)** |
| `handleEquipItem()` | `inventory.ts:359-407` | Equip from inventory | Equipping staked weapon moves it from slot → settlement fails |
| `handleBankDeposit()` | `bank/core.ts:146-350` | Deposit to bank | **Deposit staked item → settlement attempts phantom transfer** |
| `handleBankDepositAll()` | `bank/core.ts:722-925` | Deposit all items | **Deposits all including staked → phantom transfer** |
| `handleStoreSell()` | `store.ts:370-563` | Sell to shop | **Sell staked item for gold → item gone at settlement** |
| `handlePickupItem()` | `inventory.ts:150-243` | Pick up ground item | Could overwrite staked slot if inventory management allows |

These are the concrete pathways that enable Finding 29's duplication attack and additional item loss scenarios.

**Fix:** Add `getStakedSlots()` check to all 6 handlers. For handlers that should be fully blocked during duels (bank, shop, pickup), the `isPlayerInDuel()` check from Phase 0 covers these. For `handleUseItem()` and `handleEquipItem()`, a targeted `getStakedSlots()` check is needed as belt-and-suspenders even after duel isolation is enforced.

---

### ⚠️ HIGH Finding 31: Bank Full During Settlement Overflow → Silent Loss (Economic Integrity)

**Severity: HIGH — Potential item loss**

When the winner's inventory is full, settlement at `ServerNetwork/index.ts:3160-3204` attempts to send overflow items to the bank. However:

1. **No bank capacity check** — if the bank is also full, the item is silently lost
2. **ROLLBACK on any error** — if bank insertion fails and throws, the entire transaction rolls back. The duel appears complete (FINISHED state, teleported, events emitted), but **no items actually transferred**. The loser keeps their items, the winner receives nothing — but the winner was told they won.
3. **No client notification on settlement failure** — `executeDuelStakeTransfer()` only sends socket notifications on error (lines 3237-3257), but these are best-effort and don't guarantee the player sees them.

**Files:**
- `ServerNetwork/index.ts:3160-3204` — Bank overflow path
- `ServerNetwork/index.ts:3218` — COMMIT (only reached if no errors)
- `ServerNetwork/index.ts:3230` — ROLLBACK on error

**Fix:**
1. Check bank capacity before inserting overflow items
2. If bank is full, keep items in a temporary overflow queue or guarantee the winner slot by dropping a less valuable item
3. Always notify both players of settlement result (success or failure)

---

### Finding 32: Fire-and-Forget Settlement with No Retry (Economic Integrity)

**Severity: MEDIUM**

The `duel:stakes:settle` event listener at `ServerNetwork/index.ts:794` calls `executeDuelStakeTransfer()` without `await` (fire-and-forget). If the function fails:

- The PostgreSQL transaction rolls back
- The error is logged
- Best-effort socket notification is sent
- **No retry mechanism exists** — the transfer is permanently lost
- **No dead letter queue** — failed transfers cannot be replayed

In a production MMORPG, item transfers are often the most critical economic operations and typically have retry/recovery mechanisms.

**Files:**
- `ServerNetwork/index.ts:794-830` — Event listener (fire-and-forget)
- `ServerNetwork/index.ts:3006-3263` — `executeDuelStakeTransfer()` (no retry)

**Fix:** Add a retry mechanism (2-3 attempts with exponential backoff) and a dead letter table for permanently failed transfers that can be manually resolved by admins.

---

### Finding 33: No Idempotency Guard on Settlement Event (Economic Integrity)

**Severity: MEDIUM**

The `duel:stakes:settle` event has no deduplication. If the event were to fire twice for the same duel (e.g., due to a bug in event emission or a retry mechanism added later), the settlement would execute twice, transferring items twice — duplicating them.

The current code has no mechanism to prevent this:
- No `processedDuelIds` set to track completed settlements
- No database-level unique constraint on duel settlement
- The `FOR UPDATE` lock prevents concurrent execution but not sequential re-execution

**Files:**
- `ServerNetwork/index.ts:794-830` — Event listener (no dedup check)
- `ServerNetwork/index.ts:3006-3263` — No processed duel tracking

**Fix:** Add an idempotency guard:
```typescript
private processedSettlements = new Set<string>();

// In event listener:
if (this.processedSettlements.has(duelId)) {
  Logger.warn("ServerNetwork", "Duplicate settlement attempt", { duelId });
  return;
}
this.processedSettlements.add(duelId);
```

Clean up the set when sessions are garbage-collected.

---

### ⚠️ CRITICAL Finding 34: PLAYER_RESPAWNED Event Unconditionally Heals to Full HP (Event Bus Trust)

**Severity: CRITICAL — Systemic trust vulnerability**

`PlayerSystem.handlePlayerRespawn()` at `PlayerSystem.ts:860-896` unconditionally sets `health.current = health.max` when it receives a `PLAYER_RESPAWNED` event. It performs **no context checks**:
- Does NOT verify the player is actually dead
- Does NOT check who emitted the event (no source authentication)
- Does NOT check if the player is in a duel
- Does NOT check if healing is appropriate in the current state

The duel system legitimately emits `PLAYER_RESPAWNED` in `DuelCombatResolver.restorePlayerHealth()` at the end of a duel to restore both players. But ANY system or bug that accidentally emits this event with a player ID will heal that player to full health mid-combat.

**Attack surface:** A bug in any server system that emits `PLAYER_RESPAWNED` (e.g., a quest completion, a zone transition, a respawn timer glitch) would fully heal a player mid-duel, completely breaking competitive integrity.

**Files:**
- `packages/shared/src/systems/shared/character/PlayerSystem.ts:860-896` — unconditional heal
- `packages/server/src/systems/DuelSystem/DuelCombatResolver.ts:308` — legitimate duel emit
- Multiple other listeners also respond to this event (ServerNetwork, event-bridge, GameTickProcessor)

**Fix:** Add a context check to `handlePlayerRespawn()`:
```typescript
// Only restore health if player is actually dead or if explicitly allowed
if (!player.alive || data.forcedBySystem) {
  player.health.current = player.health.max;
}
```
Or: Add a `source` field to the event payload and only honor respawns from authorized sources (DuelSystem, PlayerDeathSystem).

---

### ⚠️ HIGH Finding 35: No Integer Overflow Check in Duel Settlement (Economic Integrity)

**Severity: HIGH — Item quantity corruption**

`executeDuelStakeTransfer()` at `ServerNetwork/index.ts:3147-3151` adds to existing stacks in the winner's inventory without calling `wouldOverflow()`. Other systems properly check:
- `handleCoinPouchWithdraw` uses `wouldOverflow()` before adding
- Bank handlers validate before deposit
- Store handlers validate before purchase

But duel settlement directly executes:
```sql
UPDATE inventory SET quantity = quantity + $1 WHERE ...
```

If a winner already has 2,000,000,000 lobsters and wins 200,000,000 more, the signed 32-bit integer (`integer` type in PostgreSQL, max 2,147,483,647) wraps to a **negative number**, corrupting the stack.

**Files:**
- `ServerNetwork/index.ts:3147-3151` — winner stack merge (no overflow check)
- `ServerNetwork/index.ts:2954-2964` — `addStakedItemsToInventory` (same issue)
- `ServerNetwork/services/InputValidation.ts` — `wouldOverflow()` exists but is not called here

**Fix:** Before any `quantity = quantity + N` UPDATE in settlement, check `wouldOverflow(existingQuantity, addQuantity)`. If overflow would occur, split into a new stack or reject the merge.

---

### ⚠️ HIGH Finding 36: Arena Collision Walls Never Removed (Data Leak)

**Severity: HIGH — Permanent collision state**

`ArenaPoolManager.registerArenaWallCollision()` at `ArenaPoolManager.ts:225-259` registers `CollisionFlag.BLOCKED` on tiles surrounding each arena. These flags are **never removed** — `releaseArena()` only sets `inUse = false` and `currentDuelId = null`. There is no `removeArenaWallCollision()` method.

**Impact:**
- Arena tiles are permanently blocked in the collision matrix for the server's lifetime
- This is technically a memory/data leak in the collision matrix
- Ironically, containment is always active (players can never walk through arena walls, even when no duel is happening)
- If arenas are ever repositioned or the pool is dynamically resized, old walls remain

**Files:**
- `ArenaPoolManager.ts:225-259` — wall registration (init-time only)
- `ArenaPoolManager.ts:133-141` — `releaseArena()` (no wall cleanup)

**Fix:** Add `removeArenaWallCollision()` method and call it if arenas are ever dynamically deallocated. For the current static pool design, this is acceptable (walls should persist), but document the assumption explicitly.

---

### Finding 37: Database Schema Lacks Quantity Safety Constraints (Economic Integrity)

**Severity: MEDIUM**

The inventory table at `database/migrations/schema.ts:219-236` has no database-level constraints on quantity:
- No `CHECK (quantity >= 1)` — quantity can be 0 or negative
- No unique index on `(playerId, slotIndex)` — duplicate slots are theoretically possible
- `quantity` column is nullable (`integer().default(1)`) — NULL quantities could cause NaN in calculations

The application layer prevents most of these, but if any code path bypasses validation (e.g., raw SQL in settlement), the database won't catch it.

**Files:**
- `packages/server/src/database/migrations/schema.ts:219-236` — inventory table definition

**Fix:** Add database-level constraints:
```sql
ALTER TABLE inventory ADD CONSTRAINT quantity_positive CHECK (quantity >= 1);
CREATE UNIQUE INDEX idx_inventory_player_slot ON inventory("playerId", "slotIndex") WHERE "slotIndex" >= 0;
```

---

### Finding 38: No Deadlock Retry in executeDuelStakeTransfer (Reliability)

**Severity: MEDIUM**

`InventoryRepository.savePlayerInventoryAsync()` at `InventoryRepository.ts:79-150` has retry logic for PostgreSQL deadlock error `40P01` with exponential backoff (50ms, 100ms, 200ms). However, `executeDuelStakeTransfer()` at `ServerNetwork/index.ts:3006-3263` does NOT implement deadlock retry.

If two duels resolve simultaneously and their settlement transactions deadlock (e.g., Player A won items from Player B, Player C won items from Player A), one transaction fails permanently. Combined with Finding 32 (no settlement retry), this means items are lost.

**Files:**
- `ServerNetwork/index.ts:3006-3263` — no deadlock retry
- `database/repositories/InventoryRepository.ts:79-150` — has retry (consistent standard exists)

**Fix:** Add `40P01` retry logic to `executeDuelStakeTransfer()` matching the pattern in `InventoryRepository`.

---

### Finding 39: Coin Pouch Withdrawal Has No Duel Check (Server Authority)

**Severity: MEDIUM**

`handleCoinPouchWithdraw()` at `inventory.ts:664-862` processes gold withdrawals from coin pouch to inventory without checking `isPlayerInDuel()`. A player in a duel could withdraw gold from their coin pouch, potentially gaining resources mid-duel.

**Files:**
- `packages/server/src/systems/ServerNetwork/handlers/inventory.ts:664-862`

**Fix:** Add `isPlayerInDuel()` check at the top of `handleCoinPouchWithdraw()`.

---

### Finding 40: XP Lamp Usage During Duels Has No Check (Server Authority)

**Severity: LOW**

XP lamp usage at `inventory.ts:901-1018` removes the lamp item via event without checking duel state. If a lamp is in a staked slot, using it could remove the staked item before settlement.

**Files:**
- `packages/server/src/systems/ServerNetwork/handlers/inventory.ts:901-1018`

**Fix:** Add `getStakedSlots()` check before lamp consumption.

---

### Finding 41: No Listener Registration Verification for Critical Events (Event Bus Reliability)

**Severity: MEDIUM**

The `duel:stakes:settle` event is the most economically critical event in the duel system. It is emitted by `DuelCombatResolver.ts:279` and listened by `ServerNetwork/index.ts:794`. However:

- There is **no assertion or health check** that the listener was successfully registered
- If `ServerNetwork.initializeManagers()` fails or is skipped, the listener is never registered
- `DuelCombatResolver` will emit the event, nobody processes it, and stakes are **silently never transferred**
- The winner gets nothing, the loser keeps their items, but the duel appears complete (FINISHED state, teleported, completion event fired)

Additionally, 10+ duel events are emitted but have **no listeners at all** (challenge:expired, challenge:cancelled, rules:updated, etc.). While these are informational, the pattern of emitting events with no guarantee of consumption is fragile.

**Files:**
- `DuelCombatResolver.ts:279` — emits critical event
- `ServerNetwork/index.ts:794` — listener (registered during init)
- `ServerNetwork/index.ts:366-935` — `initializeManagers()` (where listener is registered)

**Fix:** Add a startup assertion that verifies all critical duel event listeners are registered:
```typescript
// In DuelSystem.init() or a post-init verification step:
const settleListeners = this.world.listenerCount("duel:stakes:settle");
if (settleListeners === 0) {
  Logger.error("DuelSystem", "CRITICAL: No listener for duel:stakes:settle — settlements will fail silently");
  throw new Error("DuelSystem cannot operate without stakes settlement listener");
}
```

---

### Dependency Chain — What IS Properly Designed (Verified)

In addition to the server authority table below, the following dependency chains were audited and found secure:

| Dependency | Status | Notes |
|-----------|--------|-------|
| CombatSystem damage calculation | ✅ Secure | Server-authoritative, capped at current health |
| CombatSystem attack cooldowns | ✅ Secure | Server-tracked `nextAttackTicks` Map, weapon swap doesn't reset |
| CombatSystem hit/miss rolls | ✅ Secure | Seeded server-side RNG, no client influence |
| PlayerDeathSystem duel handling | ✅ Secure | Skips loot/gravestone for duelists, delegates to DuelSystem |
| Passive health regeneration | ✅ Secure | Protected by `!inCombat` check, can't regen during duel |
| Movement: `canMove()` | ✅ Secure | Blocks COUNTDOWN + noMovement, checked per-request |
| Movement: collision walls | ✅ Secure | Physical tile-level blocking, pathfinding-aware |
| Movement: noMovement enforcement | ✅ Secure | Dual-layer: `canMove()` + tick-based teleport-back |
| SQL parameterization | ✅ Secure | All DB queries use $1/$2 params or Drizzle template literals |
| FOR UPDATE row locks | ✅ Secure | Prevents concurrent modification of inventory rows |
| Transaction atomicity | ✅ Secure | BEGIN/COMMIT/ROLLBACK wraps all settlement operations |
| Event ordering | ✅ Guaranteed | EventEmitter3 fires listeners in registration order (FIFO) |
| System init order | ✅ Correct | ServerNetwork listeners registered before DuelSystem is active |
| Tick processing order | ✅ Correct | DuelSystem.processTick() runs before movement validation |

---

### Server Authority — What IS Properly Enforced (Verified)

For completeness, these systems were verified as correctly server-authoritative:

| System | File | Status |
|--------|------|--------|
| Damage calculation | `CombatSystem.ts:2736` | ✅ Server calculates, client can't send damage |
| Death detection | `PlayerDeathSystem.ts:315-320` | ✅ Server detects health ≤ 0 |
| Health manipulation | No client handler exists | ✅ No way to set health from client |
| Attack speed/cooldown | `CombatSystem.ts:726-802` | ✅ `nextAttackTicks` map enforced |
| Hit/miss determination | `CombatSystem.ts:2747-2777` | ✅ Server rolls accuracy |
| State transitions | `DuelSystem:588-944` | ✅ Bilateral acceptance required |
| Forfeit identity | `combat.ts:39` via `getPlayerId(socket)` | ✅ Can't forfeit for opponent |
| Accept/decline identity | All handlers use socket identity | ✅ Can't accept for opponent |
| Stake validation | `stakes.ts:89-125` | ✅ Item existence, quantity, value all server-side |
| Movement during duel | `tile-movement.ts:268-272` | ✅ `canMove()` check |
| Arena collision walls | `ArenaPoolManager.ts:225` | ✅ Server-side boundaries |
| Drop blocking | `inventory.ts:323-330` | ✅ `isPlayerInDuel()` check |
| Staked item moves | `inventory.ts:590-602` | ✅ `getStakedSlots()` check |
| Trade blocking | `trade/request.ts:89-100` | ✅ Both players checked |
| Challenge blocking | `DuelSystem.createChallenge()` | ✅ Both players' duel state checked |

---

---

## Implementation Plan: 7.1 → 9.0+

### Phase 0: URGENT — Seal the Duel Environment (Server Authority & Anti-Cheat)

The core problem is that the duel arena is **not a sealed environment**. The DuelSystem correctly manages combat, state transitions, and staking, but ~12 non-combat handlers are completely unaware of duel state. A modified client can eat food, pray at altars, re-equip restricted gear, buy from shops, pick up items, and more — all during an active duel.

The fix pattern is consistent: add `isPlayerInDuel()` or `isPlayerInActiveDuel()` checks to each handler.

**Approach:** Rather than scattering duel checks across 12+ individual handlers, consider also adding a **duel interaction guard** — a centralized check that blocks most non-combat actions when `isPlayerInActiveDuel()` is true. Individual handlers can opt out if needed (e.g., chat should still work). This mirrors OSRS's approach where the duel arena disables almost all non-combat interactions globally.

#### Task 0.1: Enforce noFood / noPrayer / noPotion in Handlers

**Files to modify:**
- `packages/server/src/systems/ServerNetwork/handlers/inventory.ts` — `handleUseItem()` (line ~430)
- `packages/server/src/systems/ServerNetwork/handlers/prayer.ts` — `handlePrayerToggle()` (line ~50)
- `packages/server/src/systems/ServerNetwork/handlers/prayer.ts` — `handleAltarPray()` (line ~117) ← **NEW: Finding 22**

**Changes:**

In `handleUseItem()`, before processing food/potion consumption:
```typescript
const duelSystem = world.getSystem("duel") as DuelSystem | undefined;
if (duelSystem) {
  const isFood = /* determine if item is food */;
  const isPotion = /* determine if item is potion */;
  if (isFood && !duelSystem.canEatFood(playerId)) {
    sendError(socket, "You cannot eat food in this duel.");
    return;
  }
  if (isPotion && !duelSystem.canUsePotions(playerId)) {
    sendError(socket, "You cannot use potions in this duel.");
    return;
  }
}
```

In `handlePrayerToggle()`, before processing prayer activation:
```typescript
const duelSystem = world.getSystem("duel") as DuelSystem | undefined;
if (duelSystem && !duelSystem.canUsePrayer(playerId)) {
  sendError(socket, "Prayer is disabled in this duel.");
  return;
}
```

In `handleAltarPray()`, block entirely during active duels:
```typescript
const duelSystem = world.getSystem("duel") as DuelSystem | undefined;
if (duelSystem?.isPlayerInActiveDuel(playerId)) {
  sendError(socket, "You cannot pray at an altar during a duel.");
  return;
}
```

#### Task 0.2: Enforce noRanged / noMagic / noSpecialAttack in Combat Handler

**File:** `packages/server/src/systems/ServerNetwork/handlers/combat.ts` (after line 163)

Add the missing checks that mirror the existing `canUseMelee` check:
```typescript
// Line ~163 already has canUseMelee check

// ADD these checks:
if (duelSystem.canUseRanged && !duelSystem.canUseRanged(attackerId)) {
  sendCombatError(socket, "Ranged attacks are disabled in this duel.");
  return;
}
if (duelSystem.canUseMagic && !duelSystem.canUseMagic(attackerId)) {
  sendCombatError(socket, "Magic attacks are disabled in this duel.");
  return;
}
if (duelSystem.canUseSpecialAttack && !duelSystem.canUseSpecialAttack(attackerId)) {
  sendCombatError(socket, "Special attacks are disabled in this duel.");
  return;
}
```

#### Task 0.3: Block Bank Access During Duels

**File:** `packages/server/src/systems/ServerNetwork/handlers/bank/core.ts`

Add duel check at the top of `handleBankOpen()` (line ~60):
```typescript
const duelSystem = world.getSystem("duel") as DuelSystem | undefined;
if (duelSystem?.isPlayerInDuel(playerId)) {
  sendError(socket, "You cannot access your bank during a duel.");
  return;
}
```

Defense-in-depth: also add checks to `handleBankDeposit()` and `handleBankWithdraw()`.

#### Task 0.4: Block Equipment Re-Equip of Restricted Gear During Duels

**File:** `packages/server/src/systems/ServerNetwork/handlers/inventory.ts` — `handleEquipItem()` (line ~359)

Add a duel equipment restriction check:
```typescript
const duelSystem = world.getSystem("duel") as DuelSystem | undefined;
if (duelSystem?.isPlayerInActiveDuel(playerId)) {
  // Check if the target equipment slot is restricted in this duel
  const restrictedSlots = duelSystem.getRestrictedEquipmentSlots?.(playerId);
  if (restrictedSlots?.has(targetSlot)) {
    sendError(socket, "That equipment slot is restricted in this duel.");
    return;
  }
}
```

**Note:** May need to add `getRestrictedEquipmentSlots(playerId)` method to DuelSystem if it doesn't exist. This returns the set of equipment slots that are restricted by the current duel's rules.

#### Task 0.5: Block Shop Access During Duels

**File:** `packages/server/src/systems/ServerNetwork/handlers/store.ts`

Add duel check to `handleStoreOpen()`:
```typescript
const duelSystem = world.getSystem("duel") as DuelSystem | undefined;
if (duelSystem?.isPlayerInDuel(playerId)) {
  sendError(socket, "You cannot access shops during a duel.");
  return;
}
```

#### Task 0.6: Block Item Pickup During Active Duels

**File:** `packages/server/src/systems/ServerNetwork/handlers/inventory.ts` — `handlePickupItem()` (line ~150)

```typescript
const duelSystem = world.getSystem("duel") as DuelSystem | undefined;
if (duelSystem?.isPlayerInActiveDuel(playerId)) {
  sendError(socket, "You cannot pick up items during a duel.");
  return;
}
```

#### Task 0.7: Block NPC Dialogue During Active Duels

**File:** `packages/server/src/systems/ServerNetwork/handlers/dialogue.ts` — `handleDialogueResponse()` (line ~37)

```typescript
const duelSystem = world.getSystem("duel") as DuelSystem | undefined;
if (duelSystem?.isPlayerInActiveDuel(playerId)) {
  sendError(socket, "You cannot interact with NPCs during a duel.");
  return;
}
```

#### Task 0.8: Add Explicit Duel Check to Home Teleport

**File:** `packages/server/src/systems/ServerNetwork/handlers/home-teleport.ts` — `startCasting()` (line ~76)

The current check only uses `combatSystem.isInCombat()`. Add an explicit duel check:
```typescript
const duelSystem = world.getSystem("duel") as DuelSystem | undefined;
if (duelSystem?.isPlayerInDuel(playerId)) {
  return "You can't teleport during a duel!";
}
```

Use `isPlayerInDuel()` (not `isPlayerInActiveDuel()`) to block teleport during ALL duel phases including setup.

#### Task 0.9: Block Combat During COUNTDOWN State

**File:** `packages/server/src/systems/DuelSystem/index.ts`

Add a `canAttackInDuel(playerId)` method that returns `true` only during FIGHTING:
```typescript
canAttackInDuel(playerId: string): boolean {
  const session = this.getPlayerDuel(playerId);
  return session?.state === "FIGHTING";
}
```

Update `isPlayerInActiveDuel()` to include COUNTDOWN for protection checks:
```typescript
isPlayerInActiveDuel(playerId: string): boolean {
  const session = this.getPlayerDuel(playerId);
  return session?.state === "COUNTDOWN" || session?.state === "FIGHTING" || session?.state === "FINISHED";
}
```

#### Task 0.10: Prevent Non-Duelists from Attacking Duelists (Defense-in-Depth)

**File:** `packages/server/src/systems/ServerNetwork/handlers/combat.ts`

Add reverse check:
```typescript
if (!attackerInDuel && targetInDuel) {
  sendCombatError(socket, "You cannot attack a player who is dueling.");
  return;
}
```

#### Task 0.11: CRITICAL — Fix Settlement Quantity Validation (Item Duplication)

**File:** `packages/server/src/systems/ServerNetwork/index.ts` — `executeDuelStakeTransfer()` (line ~3129)

The winner insertion currently uses `stake.quantity` unconditionally. Change to use `Math.min(stake.quantity, dbItem.quantity)`:

```typescript
// Line ~3129: Winner receives actual remaining amount, not original staked amount
const actualQuantity = Math.min(stake.quantity, dbItem.quantity);
// Use actualQuantity for all winner insertion logic below
```

Also add a discrepancy log when quantities don't match:
```typescript
if (dbItem.quantity < stake.quantity) {
  Logger.error("DuelSettlement", "Staked quantity mismatch - possible exploitation", {
    duelId,
    loserId,
    slot: stake.slot,
    itemId: stake.itemId,
    stakedQuantity: stake.quantity,
    actualQuantity: dbItem.quantity,
    discrepancy: stake.quantity - dbItem.quantity,
  });
  AuditLogger.getInstance().logSecurityEvent("DUEL_QUANTITY_MISMATCH", { ... });
}
```

This is the **single most critical fix** — it closes the item duplication vector.

#### Task 0.12: CRITICAL — Add getStakedSlots() Check to handleUseItem()

**File:** `packages/server/src/systems/ServerNetwork/handlers/inventory.ts` — `handleUseItem()` (line ~430)

Before processing item consumption, check if the inventory slot is staked:
```typescript
const duelSystem = world.getSystem("duel") as DuelSystem | undefined;
const stakedSlots = duelSystem?.getStakedSlots?.(playerId);
if (stakedSlots?.has(inventorySlot)) {
  sendError(socket, "You cannot use a staked item.");
  return;
}
```

This is belt-and-suspenders with Task 0.11: even if settlement quantity validation catches the discrepancy, preventing consumption of staked items at the source is the correct first line of defense.

#### Task 0.13: Add getStakedSlots() Check to handleEquipItem()

**File:** `packages/server/src/systems/ServerNetwork/handlers/inventory.ts` — `handleEquipItem()` (line ~359)

```typescript
const duelSystem = world.getSystem("duel") as DuelSystem | undefined;
const stakedSlots = duelSystem?.getStakedSlots?.(playerId);
if (stakedSlots?.has(inventorySlot)) {
  sendError(socket, "You cannot equip a staked item.");
  return;
}
```

This prevents moving staked items out of their expected inventory slot before settlement.

#### Task 0.14: Add Settlement Idempotency Guard

**File:** `packages/server/src/systems/ServerNetwork/index.ts` — `executeDuelStakeTransfer()` (line ~3006)

Add deduplication to prevent double-settlement:
```typescript
// Class-level:
private processedSettlements = new Set<string>();

// At top of executeDuelStakeTransfer():
if (this.processedSettlements.has(duelId)) {
  Logger.warn("ServerNetwork", "Duplicate settlement attempt blocked", { duelId });
  return;
}
this.processedSettlements.add(duelId);
// Clean up after 60 seconds to prevent memory leak:
setTimeout(() => this.processedSettlements.delete(duelId), 60_000);
```

#### Task 0.15: Add getStakedSlots() Check to Bank Deposit Handlers (Defense-in-Depth)

**Files:**
- `packages/server/src/systems/ServerNetwork/handlers/bank/core.ts` — `handleBankDeposit()` (line ~146)
- `packages/server/src/systems/ServerNetwork/handlers/bank/core.ts` — `handleBankDepositAll()` (line ~722)

Even though Task 0.3 blocks bank access entirely during duels, add staked slot protection as defense-in-depth:
```typescript
// In handleBankDeposit():
const duelSystem = world.getSystem("duel") as DuelSystem | undefined;
const stakedSlots = duelSystem?.getStakedSlots?.(playerId);
if (stakedSlots?.has(inventorySlot)) {
  sendError(socket, "You cannot deposit a staked item.");
  return;
}

// In handleBankDepositAll():
// Filter out staked slots from the deposit set
const stakedSlots = duelSystem?.getStakedSlots?.(playerId) ?? new Set();
const depositable = inventorySlots.filter(slot => !stakedSlots.has(slot));
```

#### Task 0.16: Add getStakedSlots() Check to Store Sell Handler (Defense-in-Depth)

**File:** `packages/server/src/systems/ServerNetwork/handlers/store.ts` — `handleStoreSell()` (line ~370)

Even though Task 0.5 blocks shop access entirely during duels, add staked slot protection:
```typescript
const duelSystem = world.getSystem("duel") as DuelSystem | undefined;
const stakedSlots = duelSystem?.getStakedSlots?.(playerId);
if (stakedSlots?.has(inventorySlot)) {
  sendError(socket, "You cannot sell a staked item.");
  return;
}
```

#### Task 0.17: CRITICAL — Add Integer Overflow Check to Settlement Stack Merge

**File:** `packages/server/src/systems/ServerNetwork/index.ts` — `executeDuelStakeTransfer()` (line ~3147)

Before merging into an existing stack, check for integer overflow:
```typescript
import { wouldOverflow } from "./services/InputValidation";

// Before: UPDATE inventory SET quantity = quantity + $1
const existingQty = existingStack.quantity;
if (wouldOverflow(existingQty, stake.quantity)) {
  // Split into new slot instead of merging
  Logger.warn("DuelSettlement", "Stack overflow avoided", {
    duelId, winnerId, itemId: stake.itemId,
    existing: existingQty, adding: stake.quantity,
  });
  // Insert as new stack instead of merging
  // ... (use the new-slot insertion path)
} else {
  // Safe to merge
  await pool.query(`UPDATE inventory SET quantity = quantity + $1 ...`);
}
```

Also add the same check to `addStakedItemsToInventory()` at lines 2954-2964.

#### Task 0.18: Add Context Check to PLAYER_RESPAWNED Handler

**File:** `packages/shared/src/systems/shared/character/PlayerSystem.ts` — `handlePlayerRespawn()` (line ~860)

Add a death-state check before restoring health:
```typescript
private handlePlayerRespawn(data: { playerId: string; spawnPosition: ...; }): void {
  const player = this.players.get(data.playerId);
  if (!player) return;

  // Only restore health if player is actually dead
  // Prevents accidental mid-combat healing from stale/duplicate events
  if (player.alive && player.health.current > 0) {
    Logger.warn("PlayerSystem", "PLAYER_RESPAWNED received for alive player - ignoring health restore", {
      playerId: data.playerId,
      currentHealth: player.health.current,
    });
    return;
  }

  player.alive = true;
  player.health.current = player.health.max;
  player.position = data.spawnPosition;
  // ... rest of method
}
```

**Note:** This is a change to a shared system (PlayerSystem), not just the duel system. It protects ALL combat, not just duels.

#### Task 0.19: Add Listener Registration Verification

**File:** `packages/server/src/systems/DuelSystem/index.ts` — `init()` method

After all systems are initialized, verify that critical event listeners exist:
```typescript
// In init() or a post-init hook:
private verifyEventListeners(): void {
  const critical = ["duel:stakes:settle", "player:teleport"];
  for (const event of critical) {
    const count = this.world.listenerCount?.(event) ?? 0;
    if (count === 0) {
      Logger.error("DuelSystem", `CRITICAL: No listener for ${event} — duel settlement will fail silently`);
    }
  }
}
```

#### Task 0.20: Block Coin Pouch Withdrawal During Duels

**File:** `packages/server/src/systems/ServerNetwork/handlers/inventory.ts` — `handleCoinPouchWithdraw()` (line ~664)

```typescript
const duelSystem = world.getSystem("duel") as DuelSystem | undefined;
if (duelSystem?.isPlayerInDuel(playerId)) {
  sendError(socket, "You cannot withdraw gold during a duel.");
  return;
}
```

#### Task 0.21: Add getStakedSlots() Check to XP Lamp Usage

**File:** `packages/server/src/systems/ServerNetwork/handlers/inventory.ts` — XP lamp handler (line ~901)

```typescript
const duelSystem = world.getSystem("duel") as DuelSystem | undefined;
const stakedSlots = duelSystem?.getStakedSlots?.(playerId);
if (stakedSlots?.has(inventorySlot)) {
  sendError(socket, "You cannot use a staked item.");
  return;
}
```

---

### Phase 1: Critical — Testing & Economic Safety

#### Task 1.1: Add DuelCombatResolver Tests

**File:** `packages/server/src/systems/DuelSystem/__tests__/DuelCombatResolver.test.ts` (new)

Test cases to add:
- `resolveDuel()` sets session to FINISHED state with correct winnerId and timestamp
- `resolveDuel()` emits `duel:stakes:transfer` with correct winner/loser stakes
- `resolveDuel()` emits `duel:stakes:settle` with combined own + won stakes
- `resolveDuel()` emits `PLAYER_RESPAWNED` for both players with correct positions
- `resolveDuel()` emits `PLAYER_SET_DEAD` with `isDead: false` for both players
- `resolveDuel()` emits `player:teleport` with LOBBY_SPAWN_WINNER for winner
- `resolveDuel()` emits `player:teleport` with LOBBY_SPAWN_LOSER for loser
- `resolveDuel()` calls `AuditLogger.logDuelComplete()` with correct parameters
- `resolveDuel()` returns correct `DuelResolutionResult` shape
- **Error resilience:** stake transfer throws → teleports still execute
- **Error resilience:** health restoration throws → teleports still execute
- **Error resilience:** winner teleport throws → loser teleport still executes
- **Error resilience:** completion event throws → audit log still fires
- `returnStakedItems()` logs when stakes exist
- `returnStakedItems()` does nothing when no stakes

#### Task 1.2: Add Race Condition Tests

**File:** `packages/server/src/systems/DuelSystem/__tests__/DuelSystem.test.ts` (extend)

Test cases to add:
- Both players die in the same tick → only one resolution fires (FINISHED guard)
- Player disconnects during FINISHED state (death delay) → session is NOT cancelled
- `cancelDuel()` rejects FINISHED sessions → returns error
- Player forfeits while state is already FINISHED → rejected
- Disconnect + reconnect during death delay → resolution still fires
- Both players disconnect during death delay → resolution still fires (session not deleted)
- Concurrent `acceptRules()` calls → only transitions once

#### Task 1.3: Add Settlement-Time Inventory Verification

**File:** `packages/server/src/systems/DuelSystem/DuelCombatResolver.ts`

Before emitting `duel:stakes:settle`, verify each staked item still exists in the player's inventory by emitting a verification event that the inventory system can validate. If any item is missing, log an error and exclude it from transfer.

```
// In transferStakes(), before emitting duel:stakes:settle:
// Emit duel:stakes:verify event
// Inventory system listener returns verified stakes
// Only transfer verified items
// Log discrepancies as errors
```

This adds a safety net without changing the crash-safe design. Items that somehow left inventory are caught before phantom transfers occur.

**Note:** Task 0.11 fixes the immediate duplication vector at the settlement SQL level. This task adds a higher-level verification as defense-in-depth.

#### Task 1.4: Add Settlement Retry Mechanism

**File:** `packages/server/src/systems/ServerNetwork/index.ts` — `executeDuelStakeTransfer()` and event listener (line ~794)

Wrap settlement execution with a retry mechanism (2-3 attempts with exponential backoff):

```typescript
// In event listener:
const MAX_RETRIES = 3;
const RETRY_DELAYS = [0, 1000, 3000]; // immediate, 1s, 3s

async function attemptSettlement(attempt: number = 0): Promise<void> {
  try {
    await executeDuelStakeTransfer(data);
  } catch (err) {
    if (attempt < MAX_RETRIES - 1) {
      Logger.warn("ServerNetwork", `Settlement attempt ${attempt + 1} failed, retrying`, {
        duelId: data.duelId,
        error: err instanceof Error ? err.message : String(err),
      });
      setTimeout(() => attemptSettlement(attempt + 1), RETRY_DELAYS[attempt + 1]);
    } else {
      Logger.error("ServerNetwork", "Settlement permanently failed after retries", {
        duelId: data.duelId,
        attempts: MAX_RETRIES,
      });
      // TODO: Write to dead letter table for manual admin resolution
    }
  }
}

attemptSettlement();
```

#### Task 1.5: Notify Both Players of Settlement Result

**File:** `packages/server/src/systems/ServerNetwork/index.ts` — `executeDuelStakeTransfer()` (line ~3218)

After COMMIT, send a confirmation to both players:
```typescript
// After COMMIT:
const winnerSocket = getSocketByPlayerId(winnerId);
const loserSocket = getSocketByPlayerId(loserId);
winnerSocket?.emit("tradeComplete", { success: true, received: winnerReceives });
loserSocket?.emit("tradeComplete", { success: true, lost: loserLoses });
```

On ROLLBACK failure, notify both players that settlement failed:
```typescript
// After ROLLBACK:
winnerSocket?.emit("tradeComplete", { success: false, error: "Settlement failed" });
loserSocket?.emit("tradeComplete", { success: false, error: "Settlement failed" });
```

#### Task 1.6: Add Deadlock Retry to executeDuelStakeTransfer

**File:** `packages/server/src/systems/ServerNetwork/index.ts` — `executeDuelStakeTransfer()` (line ~3006)

Add `40P01` (deadlock detected) retry logic matching the pattern in `InventoryRepository.savePlayerInventoryAsync()`:
```typescript
const MAX_RETRIES = 3;
const RETRY_DELAYS = [50, 100, 200]; // exponential backoff

for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
  try {
    // ... existing transaction logic ...
    break; // Success
  } catch (err) {
    if (err.code === '40P01' && attempt < MAX_RETRIES - 1) {
      Logger.warn("DuelSettlement", `Deadlock detected, retry ${attempt + 1}/${MAX_RETRIES}`, { duelId });
      await new Promise(r => setTimeout(r, RETRY_DELAYS[attempt]));
      continue;
    }
    throw err; // Non-deadlock error or final attempt
  }
}
```

#### Task 1.7: Add Database-Level Quantity Constraints

**File:** New migration in `packages/server/src/database/migrations/`

Add safety constraints to the inventory table:
```sql
ALTER TABLE inventory ADD CONSTRAINT quantity_positive CHECK (quantity >= 1);
CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_player_slot
  ON inventory("playerId", "slotIndex") WHERE "slotIndex" >= 0;
```

This provides database-level defense against negative quantities and duplicate slots, catching bugs that bypass application-level validation.

---

### Phase 2: High — Timing & Type Safety

#### Task 2.1: Replace setTimeout with Tick-Based Scheduling

**File:** `packages/server/src/systems/DuelSystem/index.ts`

Replace `setTimeout` in `handlePlayerDeath()` and `startDisconnectTimer()` with tick-counted scheduling processed in `processTick()`.

Add to `DuelSession`:
```typescript
// Pending resolution tracking
pendingResolution?: {
  winnerId: string;
  loserId: string;
  reason: "death" | "forfeit";
  resolveAtTick: number;  // Current tick + DEATH_RESOLUTION_DELAY_TICKS
};

// Pending disconnect tracking
pendingDisconnect?: {
  playerId: string;
  forfeitAtTick: number;  // Current tick + DISCONNECT_TIMEOUT_TICKS
};
```

In `processTick()`, check each FINISHED session for `pendingResolution.resolveAtTick <= currentTick` and call `resolveDuel()`. This aligns death resolution with game time.

For disconnect timers, check `pendingDisconnect.forfeitAtTick <= currentTick` and auto-forfeit.

This eliminates all `setTimeout` usage from the duel system, making timing deterministic and debuggable.

#### Task 2.2: Strengthen System Interface Types

**File:** `packages/shared/src/types/systems/system-interfaces.ts`

Replace:
```typescript
getDuelSession(duelId: string): unknown | undefined;
getPlayerDuel(playerId: string): unknown | undefined;
getPlayerDuelRules(playerId: string): unknown | null;
toggleRule(duelId: string, playerId: string, rule: string): DuelOperationResult;
toggleEquipmentRestriction(duelId: string, playerId: string, slot: string): DuelOperationResult;
```

With:
```typescript
getDuelSession(duelId: string): DuelSession | undefined;
getPlayerDuel(playerId: string): DuelSession | undefined;
getPlayerDuelRules(playerId: string): DuelRules | null;
toggleRule(duelId: string, playerId: string, rule: keyof DuelRules): DuelOperationResult;
toggleEquipmentRestriction(duelId: string, playerId: string, slot: EquipmentSlotRestriction): DuelOperationResult;
```

Import `DuelSession`, `DuelRules`, and `EquipmentSlotRestriction` from `duel-types.ts`.

---

### Phase 3: Medium — Cleanup & Hardening

#### Task 3.1: Fix cleanupExpiredSessions State Filter

**File:** `packages/server/src/systems/DuelSystem/index.ts:1618`

Change:
```typescript
if (session.state !== "FIGHTING" && now - session.createdAt > ticksToMs(SESSION_MAX_AGE_TICKS))
```

To:
```typescript
if (session.state !== "FIGHTING" && session.state !== "FINISHED" && now - session.createdAt > ticksToMs(SESSION_MAX_AGE_TICKS))
```

This explicitly excludes FINISHED sessions from cleanup, rather than relying on `cancelDuel()` rejecting them. Defense in depth.

#### Task 3.2: Remove Dead Code and DRY Violations

**File:** `packages/server/src/systems/DuelSystem/index.ts`

1. **Delete `enforceArenaBounds()` method** (lines 1587-1621) — never called, arena bounds enforced by collision walls
2. Remove unused `POSITION_TOLERANCE` import (line 54)
3. Extract rotation calculation into a helper:
   ```typescript
   private calculateFacingAngle(from: {x: number, z: number}, to: {x: number, z: number}): number {
     return Math.atan2(to.x - from.x, to.z - from.z);
   }
   ```
4. Replace both inline `Math.atan2()` calls with the helper
5. Extract challenger-vs-target resolution into a helper:
   ```typescript
   private getPlayerStakes(session: DuelSession, playerId: string): StakedItem[] {
     return playerId === session.challengerId
       ? session.challengerStakes
       : session.targetStakes;
   }
   ```
6. Replace the 7+ inline ternaries with the helper

**File:** `packages/server/src/systems/DuelSystem/DuelSessionManager.ts` + `PendingDuelManager.ts`

Extract shared ID generation to config.ts:
```typescript
export function generateDuelId(): string {
  return `duel_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}
```

#### Task 3.3: Extract Acceptance Helper to Eliminate 3× Duplication

**File:** `packages/server/src/systems/DuelSystem/index.ts`

Extract the shared acceptance logic from `acceptRules()`, `acceptStakes()`, and `acceptFinal()` into a private helper:

```typescript
private handleAcceptance(
  session: DuelSession,
  playerId: string,
  nextState: DuelState,
  eventName: string,
): { bothAccepted: boolean } {
  if (playerId === session.challengerId) {
    session.challengerAccepted = true;
  } else if (playerId === session.targetId) {
    session.targetAccepted = true;
  }

  if (session.challengerAccepted && session.targetAccepted) {
    session.state = nextState;
    session.challengerAccepted = false;
    session.targetAccepted = false;
    this.world.emit("duel:state:changed", { duelId: session.duelId, state: nextState });
    return { bothAccepted: true };
  }

  this.world.emit("duel:acceptance:updated", { ... });
  return { bothAccepted: false };
}
```

Then each accept method becomes a thin wrapper that validates state, calls `handleAcceptance()`, and does any phase-specific follow-up.

#### Task 3.4: Clear Disconnect Timers on Resolution — Fix Memory Leak

**File:** `packages/server/src/systems/DuelSystem/index.ts`

At the top of `resolveDuel()` (~line 1536), add:
```typescript
// Clear any pending disconnect timers — prevents memory leak and
// eliminates temporal coupling with the setTimeout callback
[session.challengerId, session.targetId].forEach(pid => {
  const timer = this.disconnectTimers.get(pid);
  if (timer) {
    clearTimeout(timer);
    this.disconnectTimers.delete(pid);
  }
});
```

#### Task 3.5: Add Handler Auth Middleware & Event Name Constants

**File:** `packages/server/src/systems/ServerNetwork/handlers/duel/helpers.ts`

1. Add auth middleware to eliminate 10× boilerplate:
```typescript
export function withDuelAuth(
  socket: Socket,
  world: World,
): { playerId: string; duelSystem: DuelSystem } | null {
  const playerId = getPlayerId(socket);
  if (!playerId) {
    sendDuelError(socket, "Not authenticated", "NOT_AUTHENTICATED");
    return null;
  }
  const duelSystem = getDuelSystem(world);
  if (!duelSystem) {
    sendDuelError(socket, "Duel system unavailable", "SYSTEM_ERROR");
    return null;
  }
  return { playerId, duelSystem };
}
```

2. Add packet name constants:
```typescript
export const DUEL_PACKETS = {
  SESSION_STARTED: "duelSessionStarted",
  CHALLENGE_SENT: "duelChallengeSent",
  CHALLENGE_RECEIVED: "duelChallengeReceived",
  CHAT_ADDED: "chatAdded",
  ERROR: "duelError",
} as const;
```

Replace all magic strings across handler files.

#### Task 3.6: Add Duel Completion Logging Event

**File:** `packages/server/src/systems/DuelSystem/DuelCombatResolver.ts`

The audit logger already captures duel completions. Enhance the `duel:completed` event payload to include a summary suitable for future persistence:

```typescript
this.world.emit("duel:completed", {
  // ... existing fields ...
  summary: {
    duration: session.finishedAt! - (session.fightStartedAt || session.createdAt),
    rules: session.rules,
    challengerStakeValue: winnerIsChallenger ? winnerOwnValue : winnerReceivesValue,
    targetStakeValue: winnerIsChallenger ? winnerReceivesValue : winnerOwnValue,
  },
});
```

This does not add persistence (YAGNI for now) but ensures the data is available for a future listener to save to database without modifying the resolver.

#### Task 3.7: Add Arena Exhaustion Logging

**File:** `packages/server/src/systems/DuelSystem/index.ts`

In `acceptFinal()` when `reserveArena()` returns null (~line 895), add a warning log:
```typescript
Logger.warn("DuelSystem", "Arena pool exhausted - all arenas in use", {
  duelId,
  totalArenas: ARENA_COUNT,
});
```

---

### Phase 4: Low — Polish (Server)

#### Task 4.1: Use Configured Position Tolerance

**File:** `packages/server/src/systems/DuelSystem/index.ts:1634`

Replace hardcoded `0.5` with imported `POSITION_TOLERANCE` constant from config.ts (which is already defined but unused).

#### Task 4.2: Add Anti-Harassment Cooldown

**File:** `packages/server/src/systems/DuelSystem/PendingDuelManager.ts`

Track last challenge time per target. Prevent challenging the same player within 10 seconds of a declined/expired challenge:

```typescript
private challengeCooldowns: Map<string, number> = new Map(); // targetId → cooldown expiry

// In createChallenge():
const cooldownKey = `${challengerId}:${targetId}`;
const cooldown = this.challengeCooldowns.get(cooldownKey);
if (cooldown && Date.now() < cooldown) {
  return { success: false, error: "Please wait before challenging this player again." };
}

// On decline/expire:
this.challengeCooldowns.set(cooldownKey, Date.now() + 10_000);
```

---

### Phase 5: Low — Client Cleanup

#### Task 5.1: Extract Shared Formatting Utilities

**Create:** `packages/client/src/game/panels/DuelPanel/utils/formatting.ts`

Move the 3× duplicated functions into a single shared file:
```typescript
export function formatQuantity(quantity: number): string { ... }
export function formatGoldValue(value: number): string { ... }
export function calculateTotalValue(stakes: StakedItem[]): number { ... }
```

**Update imports in:**
- `StakesScreen.tsx` — delete lines 64-82, import from utils
- `ConfirmScreen.tsx` — delete lines 63-81, import from utils
- `DuelResultModal.tsx` — delete lines 87-95, import from utils

#### Task 5.2: Split StakesScreen into Sub-Components

**Current:** `StakesScreen.tsx` (583 lines, monolith)

**Split into:**
```
components/
├── SlotItem.tsx          — Shared slot renderer (replaces renderStakeItem + renderInventoryItem)
├── StakeGrid.tsx         — Grid of staked items (mine or theirs)
├── StakeInventoryPanel.tsx — Inventory panel for staking
└── StakeContextMenu.tsx  — Right-click context menu
```

**Key changes:**
- Extract `renderStakeItem` and `renderInventoryItem` into a shared `<SlotItem>` component
- Replace direct DOM manipulation (`e.currentTarget.style.background`) with React state or CSS `:hover`
- StakesScreen becomes an orchestration component (~200 lines)

#### Task 5.3: Fix DuelHUD Timer Memory Leak

**File:** `packages/client/src/game/panels/DuelPanel/DuelHUD.tsx`

Replace:
```typescript
setTimeout(() => setForfeitConfirm(false), 3000);
```

With:
```typescript
const timerRef = useRef<ReturnType<typeof setTimeout>>();

useEffect(() => {
  return () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  };
}, []);

// In handler:
timerRef.current = setTimeout(() => setForfeitConfirm(false), FORFEIT_CONFIRM_TIMEOUT);
```

---

## Expected Score After Implementation

| Category | Before | After | Change |
|----------|--------|-------|--------|
| Production Quality | 8.5 | 9.0 | +0.5 (strong types) |
| Best Practices | 7.5 | 9.0 | +1.5 (tests, DRY, auth middleware, event constants) |
| OWASP Security | 6.0 | 9.0 | +3.0 (all handlers duel-aware, sealed environment) |
| SOLID Principles | 9.0 | 9.0 | — |
| GRASP Principles | 9.0 | 9.0 | — |
| Clean Code | 7.5 | 9.0 | +1.5 (dead code removed, acceptance helper, ternary helper, DRY) |
| Law of Demeter | 8.0 | 8.0 | — (framework-inherent) |
| Memory & Allocation | 8.0 | 9.0 | +1.0 (disconnect timer leak fixed) |
| Game Patterns | 9.0 | 9.5 | +0.5 (tick scheduling, arena exhaustion logging) |
| Server Authority | 5.5 | 9.5 | +4.0 (all rules enforced, equipment locked, shop/bank/pickup/dialogue blocked, teleport guarded, coin pouch) |
| Economic Integrity | 4.0 | 9.5 | +5.5 (quantity validation, overflow check, staked slot protection, idempotency, retry, deadlock handling, DB constraints) |
| Anti-Cheat | 5.0 | 9.0 | +4.0 (sealed duel environment — 12+ handlers now duel-aware) |
| Event Bus Trust | 5.0 | 9.0 | +4.0 (PLAYER_RESPAWNED context check, listener verification, source validation) |
| Tick System | 8.5 | 9.5 | +1.0 (tick-based timers) |
| Testing | 6.0 | 8.5 | +2.5 (resolver + race tests) |
| Persistence | 8.0 | 8.5 | +0.5 (completion events) |
| Client UI | 7.5 | 9.0 | +1.5 (split StakesScreen, shared utils, timer fix) |
| **Overall** | **6.5** | **9.1** | **+2.6** |

---

## Implementation Order

| # | Task | Phase | Impact | Files Changed |
|---|------|-------|--------|---------------|
| **1** | **⚠️ Fix settlement quantity validation (item duplication)** | **Phase 0** | **Economic +2.0** | **ServerNetwork/index.ts** |
| **2** | **⚠️ Add integer overflow check to settlement stack merge** | **Phase 0** | **Economic +1.0** | **ServerNetwork/index.ts** |
| **3** | **⚠️ Add getStakedSlots() to handleUseItem()** | **Phase 0** | **Economic +1.0** | **inventory.ts** |
| **4** | **⚠️ Add getStakedSlots() to handleEquipItem()** | **Phase 0** | **Economic +0.5** | **inventory.ts** |
| **5** | **⚠️ Add settlement idempotency guard** | **Phase 0** | **Economic +0.5** | **ServerNetwork/index.ts** |
| **6** | **⚠️ Add context check to PLAYER_RESPAWNED handler** | **Phase 0** | **Event Bus +2.0** | **PlayerSystem.ts** |
| **7** | **⚠️ Add listener registration verification** | **Phase 0** | **Event Bus +1.0** | **DuelSystem/index.ts** |
| **8** | **Enforce noFood/noPrayer/noPotion + altar block** | **Phase 0** | **Server Authority +1.0** | inventory.ts, prayer.ts |
| **9** | **Enforce noRanged/noMagic/noSpecialAttack** | **Phase 0** | **Server Authority +0.5** | combat.ts |
| **10** | **Block bank access during duels** | **Phase 0** | **Anti-Cheat +0.5** | bank/core.ts |
| **11** | **Block equipment re-equip of restricted gear** | **Phase 0** | **Server Authority +1.0** | inventory.ts, DuelSystem |
| **12** | **Block shop access during duels** | **Phase 0** | **Anti-Cheat +0.5** | store.ts |
| **13** | **Block item pickup during active duels** | **Phase 0** | **Anti-Cheat +0.3** | inventory.ts |
| **14** | **Block NPC dialogue during active duels** | **Phase 0** | **Anti-Cheat +0.3** | dialogue.ts |
| **15** | **Add explicit duel check to home teleport** | **Phase 0** | **Server Authority +0.3** | home-teleport.ts |
| **16** | **Block combat during COUNTDOWN** | **Phase 0** | **Anti-Cheat +0.3** | index.ts, combat.ts |
| **17** | **Prevent non-duelists attacking duelists** | **Phase 0** | **Anti-Cheat +0.3** | combat.ts |
| **18** | **Add getStakedSlots() to bank deposit handlers** | **Phase 0** | **Economic +0.3** | bank/core.ts |
| **19** | **Add getStakedSlots() to store sell handler** | **Phase 0** | **Economic +0.3** | store.ts |
| **20** | **Block coin pouch withdrawal during duels** | **Phase 0** | **Server Authority +0.2** | inventory.ts |
| **21** | **Add getStakedSlots() to XP lamp usage** | **Phase 0** | **Economic +0.1** | inventory.ts |
| 22 | DuelCombatResolver tests | Phase 1 | Testing +1.5 | 1 new test file |
| 23 | Race condition tests | Phase 1 | Testing +1.0 | 1 existing test file |
| 24 | Settlement-time verification | Phase 1 | Economic +0.5 | DuelCombatResolver.ts |
| 25 | Settlement retry mechanism | Phase 1 | Economic +0.5 | ServerNetwork/index.ts |
| 26 | Settlement result notifications | Phase 1 | Economic +0.3 | ServerNetwork/index.ts |
| 27 | Add deadlock retry to settlement | Phase 1 | Economic +0.3 | ServerNetwork/index.ts |
| 28 | Add database quantity constraints | Phase 1 | Economic +0.3 | New migration |
| 29 | Replace setTimeout with ticks | Phase 2 | Tick System +1.0 | index.ts, DuelSessionManager.ts |
| 30 | Strengthen interface types | Phase 2 | Production +0.5 | system-interfaces.ts |
| 31 | Fix cleanup state filter | Phase 3 | Reliability | index.ts |
| 32 | Remove dead code / DRY / helpers | Phase 3 | Clean Code +0.5 | index.ts, config.ts, managers |
| 33 | Extract acceptance helper (3× → 1×) | Phase 3 | Clean Code +0.5 | index.ts |
| 34 | Fix disconnect timer memory leak | Phase 3 | Memory +1.0 | index.ts |
| 35 | Handler auth middleware + event constants | Phase 3 | Best Practices +0.5 | helpers.ts, all handlers |
| 36 | Completion logging event | Phase 3 | Persistence +0.5 | DuelCombatResolver.ts |
| 37 | Arena exhaustion logging | Phase 3 | Reliability | index.ts |
| 38 | Position tolerance config | Phase 4 | Clean Code | index.ts |
| 39 | Anti-harassment cooldown | Phase 4 | Anti-Cheat +0.5 | PendingDuelManager.ts |
| 40 | Extract shared formatting utils | Phase 5 | Client DRY +0.5 | 3 client files + new utils |
| 41 | Split StakesScreen monolith | Phase 5 | Client SOLID +0.5 | StakesScreen.tsx → 4 files |
| 42 | Fix DuelHUD timer memory leak | Phase 5 | Client Memory | DuelHUD.tsx |

---

## Verification Checklist

After all phases:

**Phase 0 — Item Duplication & Economic Safety (HIGHEST PRIORITY):**

*Item duplication prevention:*
- [ ] Settlement uses `Math.min(stake.quantity, dbItem.quantity)` for winner insertion
- [ ] Discrepancy logging fires when `dbItem.quantity < stake.quantity`
- [ ] Settlement stack merge checks `wouldOverflow()` before UPDATE
- [ ] `handleUseItem()` checks `getStakedSlots()` — cannot consume staked food
- [ ] `handleEquipItem()` checks `getStakedSlots()` — cannot equip staked items
- [ ] `handleBankDeposit()` checks `getStakedSlots()` — cannot deposit staked items
- [ ] `handleBankDepositAll()` filters out staked slots
- [ ] `handleStoreSell()` checks `getStakedSlots()` — cannot sell staked items
- [ ] `handleCoinPouchWithdraw()` blocks during duels
- [ ] XP lamp usage checks `getStakedSlots()`
- [ ] Settlement idempotency guard blocks duplicate `duel:stakes:settle` events
- [ ] Manual test: stake 10 lobsters, eat 5, lose duel → winner receives 5 (not 10)
- [ ] Manual test: try to eat staked food → server blocks with error message
- [ ] Manual test: try to equip staked weapon → server blocks with error message
- [ ] Manual test: try to bank-deposit staked item → server blocks
- [ ] Manual test: try to sell staked item → server blocks
- [ ] Manual test: try to withdraw coin pouch during duel → server blocks

*Event bus safety:*
- [ ] `PLAYER_RESPAWNED` handler checks `player.alive` before healing — doesn't heal alive players
- [ ] Listener registration verification runs at DuelSystem init
- [ ] Startup logs confirm `duel:stakes:settle` listener is registered
- [ ] Manual test: emit PLAYER_RESPAWNED for alive player → health NOT restored

**Phase 0 — Seal the Duel Environment:**

*Rule enforcement:*
- [ ] Manual test: noFood duel → eating food is blocked server-side with error message
- [ ] Manual test: noPrayer duel → activating prayer is blocked server-side with error message
- [ ] Manual test: noPotions duel → drinking potions is blocked server-side with error message
- [ ] Manual test: noRanged duel → ranged attacks blocked with error message
- [ ] Manual test: noMagic duel → magic attacks blocked with error message
- [ ] Manual test: noSpecialAttack duel → special attacks blocked with error message
- [ ] Grep verify: `canEatFood` called in inventory handler
- [ ] Grep verify: `canUsePrayer` called in prayer handler
- [ ] Grep verify: `canUseRanged` called in combat handler
- [ ] Grep verify: `canUseMagic` called in combat handler
- [ ] Grep verify: `canUseSpecialAttack` called in combat handler

*Environment isolation:*
- [ ] Manual test: cannot open bank while in any duel state
- [ ] Manual test: cannot re-equip restricted gear (e.g., shield in "no shield" duel)
- [ ] Manual test: cannot access shops while in any duel state
- [ ] Manual test: cannot pick up ground items during active duel
- [ ] Manual test: cannot interact with NPCs during active duel
- [ ] Manual test: cannot pray at altar during active duel
- [ ] Manual test: cannot home teleport during any duel state
- [ ] Manual test: cannot attack during COUNTDOWN state (before "FIGHT!")
- [ ] Manual test: non-dueling player cannot attack a duelist
- [ ] Grep verify: `isPlayerInDuel` called in bank, shop, home-teleport handlers
- [ ] Grep verify: `isPlayerInActiveDuel` called in equip, pickup, dialogue handlers

**Phase 1-2 — Testing, Timing, Types:**
- [ ] `bun run build` passes (shared + server + client)
- [ ] `npm test` passes (all existing + new tests)
- [ ] New `DuelCombatResolver.test.ts` has 15+ test cases
- [ ] Race condition tests cover death, disconnect, concurrent accept
- [ ] No `unknown` types in DuelSystem interface
- [ ] No `setTimeout` in DuelSystem (all tick-based)
- [ ] Settlement emits verification event before transfer
- [ ] Settlement retry fires on failure (2-3 attempts with backoff)
- [ ] Settlement has deadlock retry for 40P01 error
- [ ] Both players notified of settlement success/failure
- [ ] Database `CHECK (quantity >= 1)` constraint added
- [ ] Database unique index on `(playerId, slotIndex)` added
- [ ] Manual test: complete duel → both players teleported
- [ ] Manual test: disconnect during death delay → duel still resolves
- [ ] Manual test: forfeit → correct player wins

**Phase 3 — Code Quality & DRY:**
- [ ] `enforceArenaBounds()` method deleted (dead code)
- [ ] No dead imports in index.ts
- [ ] `cleanupExpiredSessions` excludes FINISHED state explicitly
- [ ] Acceptance logic uses shared `handleAcceptance()` helper (not 3× copy-paste)
- [ ] Challenger-vs-target resolution uses `getPlayerStakes()` helper (not 7× ternary)
- [ ] Disconnect timers cleared in `resolveDuel()` — no orphaned setTimeout refs
- [ ] Handler auth uses `withDuelAuth()` middleware — no 10× boilerplate
- [ ] Packet names use `DUEL_PACKETS` constant — no magic strings
- [ ] Arena exhaustion logs a warning
- [ ] Grep verify: no `enforceArenaBounds` references remain

**Phase 5 — Client Cleanup:**
- [ ] `formatQuantity`, `formatGoldValue`, `calculateTotalValue` exist in ONE file (utils/formatting.ts)
- [ ] StakesScreen.tsx is under 300 lines
- [ ] `<SlotItem>` component shared between stake grids and inventory
- [ ] No direct DOM manipulation (`e.currentTarget.style`) in DuelPanel components
- [ ] DuelHUD forfeit timer uses `useEffect` cleanup — no memory leak
- [ ] `bun run build` still passes after client refactor
