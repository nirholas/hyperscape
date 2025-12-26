# Combat System TODO

> Generated from comprehensive audit on 2025-12-22
> Overall System Score: 8.97/10

---

## Critical (Future Phases)

These are core OSRS systems planned for future implementation phases.

### Special Attack System
- **Status**: Not implemented
- **OSRS Reference**: https://oldschool.runescape.wiki/w/Special_attack
- **Description**: Weapons have unique special attacks consuming special attack energy (0-100%)
- **Examples**: Dragon dagger (25% energy, double hit), AGS (50% energy, high damage)
- **Dependencies**: Weapon system, energy bar UI

### Prayer/Protection System
- **Status**: Not implemented
- **OSRS Reference**: https://oldschool.runescape.wiki/w/Prayer
- **Description**: Overhead prayers reduce damage by 40%, drain prayer points
- **Key Prayers**: Protect from Melee/Ranged/Magic, Piety, Rigour
- **Dependencies**: Prayer skill, prayer UI, prayer drain mechanics

### Ranged Combat
- **Status**: Removed for MVP (melee-only)
- **OSRS Reference**: https://oldschool.runescape.wiki/w/Ranged
- **Code Reference**: `CombatSystem.ts:623` - `// MVP: handleRangedAttack removed`
- **Dependencies**: Hit delay system, projectile system, ammo system

### Magic Combat
- **Status**: Removed for MVP (melee-only)
- **OSRS Reference**: https://oldschool.runescape.wiki/w/Magic
- **Dependencies**: Hit delay system, spell system, rune system

---

## High Priority

Address these before next major release.

### ~~1. Magic Numbers in Death System~~ ✅ COMPLETED
- **Status**: DONE (2025-12-24)
- **Location**: `PlayerDeathSystem.ts`, `CombatConstants.ts`
- **Resolution**: Added tick-based `COMBAT_CONSTANTS.DEATH` section with 6 constants:
  - `ANIMATION_TICKS`, `COOLDOWN_TICKS`, `RECONNECT_RESPAWN_DELAY_TICKS`
  - `STALE_LOCK_AGE_TICKS`, `DEFAULT_RESPAWN_POSITION`, `DEFAULT_RESPAWN_TOWN`
- **Cleanup** (2025-12-24): Deleted all deprecated MS constants:
  - Removed `ATTACK_COOLDOWN_MS`, `COMBAT_TIMEOUT_MS` from CombatConstants
  - Removed `RESPAWN_TIME`, `DEATH_ITEM_DESPAWN_TIME` from world-structure.ts
  - Removed unused `CONSTANTS` object from types/index.ts
  - Removed unused `HEALTH_REGEN_COOLDOWN/INTERVAL` from GameConstants
  - Removed unused `isAttackOnCooldown()`, `shouldCombatTimeout()` functions
  - Migrated all usages to tick-based with `ticksToMs()` at point of use

### 2. Metrics/Monitoring Integration
- **Status**: TODO
- **Location**: `CombatAntiCheat.ts:146-157`
- **Issue**: `onViolation`, `onKick`, `onBan` callbacks exist but not wired
- **Missing**:
  - [ ] Prometheus counters for violations
  - [ ] Kick/ban rate metrics
  - [ ] Active combat session gauge
  - [ ] Attack rate histograms
  - [ ] Structured logs for SIEM
- **Fix**: Create `CombatMetrics.ts` service, wire callbacks in `CombatSystem.ts`
- **Effort**: 4-6 hours

### 3. Hit Delay System Implementation
- **Status**: Constants defined, not implemented
- **Location**: `CombatConstants.ts:56-65`
- **Issue**: Ranged/magic require delayed damage application
- **OSRS Formulas**:
  ```
  Ranged: 1 + floor((3 + distance) / 6) ticks
  Magic:  1 + floor((1 + distance) / 3) ticks
  Melee:  0 ticks (instant)
  ```
- **Blocks**: Ranged and Magic combat implementation
- **Fix**: Create `HitDelaySystem.ts` with pending hit queue
- **Effort**: 3-4 hours

### 4. Combat Level Integration
- **Status**: Calculator exists, not wired
- **Location**: `CombatLevelCalculator.ts` (if exists)
- **Issue**: Player combat level not:
  - [ ] Displayed on nameplate
  - [ ] Used for aggro level checks
  - [ ] Used for wilderness PvP restrictions
- **OSRS Formula**:
  ```
  Base = 0.25 * (Defence + Hitpoints + floor(Prayer / 2))
  Melee = 0.325 * (Attack + Strength)
  Combat = floor(Base + max(Melee, Ranged, Magic))
  ```
- **Fix**: Wire to `PlayerSystem.ts`, `AggroSystem.ts`, client UI
- **Effort**: 4-5 hours

---

## Medium Priority

Plan for upcoming sprints.

### 5. Inconsistent Dependency Injection
- **Status**: TODO
- **Location**: `CombatSystem.ts:161-177`
- **Issue**: Direct `world.getSystem()` calls vs constructor injection
- **Current Pattern**:
  ```typescript
  this.mobSystem = this.world.getSystem<MobNPCSystem>("mob-npc");
  this.playerSystem = this.world.getSystem<PlayerSystem>("player");
  ```
- **Fix**: Pass dependencies via constructor or use DI container
- **Effort**: 2-3 hours

### 6. Attack Type Handler Pattern
- **Status**: TODO
- **Location**: `CombatSystem.ts`
- **Issue**: Adding ranged/magic will require switch statements
- **Fix**: Create `AttackHandler` interface similar to `DamageHandler`:
  ```typescript
  interface AttackHandler {
    canAttack(attacker, target, tick): boolean;
    execute(attacker, target, tick): AttackResult;
    getHitDelay(distance: number): number;
    getProjectile?(): ProjectileConfig;
  }
  ```
- **Effort**: 4-6 hours

### 7. Multi-Combat Zone Support
- **Status**: Not implemented
- **OSRS Reference**: https://oldschool.runescape.wiki/w/Multicombat_area
- **Description**: Areas where multiple players/mobs can attack same target
- **Requirements**:
  - [ ] Zone definition system
  - [ ] Combat restriction checks
  - [ ] UI indicator (crossed swords icon)
- **Effort**: 6-8 hours

### ~~8. Combat XP Gain System~~ ✅ COMPLETED
- **Status**: DONE (2025-12-24)
- **OSRS Reference**: https://oldschool.runescape.wiki/w/Combat#Experience
- **Resolution**: Implemented in `SkillsSystem.ts` with OSRS-accurate formulas:
  - Focused styles: 4 XP/damage to combat skill + 1.33 XP/damage to HP
  - Controlled: 1.33 XP/damage to each of 4 skills (Attack, Strength, Defence, Constitution)
  - Constants in `COMBAT_CONSTANTS.XP`: `COMBAT_XP_PER_DAMAGE`, `HITPOINTS_XP_PER_DAMAGE`, `CONTROLLED_XP_PER_DAMAGE`
  - 19 unit tests in `SkillsSystem.xp.test.ts`

### 9. Poison/Venom System
- **Status**: Not implemented
- **OSRS Reference**: https://oldschool.runescape.wiki/w/Poison
- **Description**: DoT damage that ticks down over time
- **Poison**: Starts at max, decreases by 1 each hit
- **Venom**: Starts low, increases each hit (caps at 20)
- **Requirements**:
  - [ ] Status effect system
  - [ ] Antidote items
  - [ ] Visual indicators
- **Effort**: 6-8 hours

---

## Low Priority

Backlog items for future consideration.

### 10. Feature Flags/A/B Testing
- **Description**: Gradually roll out combat changes
- **Effort**: 4-6 hours

### 11. Documentation Gaps
- **Description**: Add JSDoc to all private methods
- **Location**: Various helper methods lack documentation
- **Effort**: 2-3 hours

### 12. Mixed File Patterns
- **Description**: Standardize on class-based exports
- **Effort**: 2-3 hours

### 13. Combat Achievements/Statistics
- **Description**: Track kills, damage dealt, K/D ratio
- **Effort**: 4-6 hours

### 14. Skull System for PvP
- **OSRS Reference**: https://oldschool.runescape.wiki/w/Skull_(status)
- **Description**: Attacking players first gives skull (lose all items on death)
- **Effort**: 4-6 hours

### 15. Splashing Mechanic
- **Description**: Intentional 0 accuracy for magic XP training
- **Effort**: 1-2 hours

### 16. Map Iterator Optimization
- **Location**: `CombatSystem.ts:1420-1421`
- **Issue**: Creates array from map entries each tick
- **Fix**: Maintain sorted array incrementally
- **Effort**: 2-3 hours

### 17. Combat Dummy/Training Mode
- **Description**: Test damage formulas in-game
- **Effort**: 3-4 hours

---

## Completed

Items that have been implemented and verified.

- [x] OSRS-accurate tick-based combat (600ms ticks)
- [x] Deterministic RNG via SeededRandom
- [x] PID shuffle system (Fisher-Yates every 60-150s)
- [x] Anti-cheat with violation tiers (kick at 50, ban at 150)
- [x] Rate limiting (3 attacks/tick, 5/second)
- [x] Entity ID validation (null byte, path traversal prevention)
- [x] Object pooling for tiles and quaternions
- [x] Strategy pattern for damage handlers
- [x] Event sourcing for replay (EventStore)
- [x] OSRS-accurate aggro mechanics (hunt range, aggression range)
- [x] Tolerance system (21x21 regions, 10 min timer)
- [x] Auto-retaliate with AFK disable (20 min)
- [x] Combat timeout (8 ticks after last hit)
- [x] Retaliation delay formula: `ceil(speed/2) + 1`
- [x] Cardinal-only melee for range 1, diagonal for range 2+
- [x] Death/gravestone system with ground items
- [x] Debug logging cleanup (removed DEBUG_MOB_ATTACK)
- [x] Combat XP gain system (OSRS-accurate 4/1.33 formulas, all 4 styles)
- [x] Death system constants extracted to COMBAT_CONSTANTS.DEATH (tick-based)
- [x] Combat styles system (WeaponStyleConfig, style bonuses, UI)
- [x] MS-based constant cleanup (removed all deprecated ms constants, dead code)

---

## Priority Legend

| Priority | Action | Criteria |
|----------|--------|----------|
| Critical | Future phases | Core OSRS systems, high effort |
| High | Before release | Production readiness, blocks features |
| Medium | Next sprint | Architecture improvements, OSRS accuracy |
| Low | Backlog | Polish, edge cases, optimizations |

---

## Notes

- Combat system lines: ~11,000+ across all files
- Test coverage: 22 test files exist
- Last audit: 2025-12-22
- Auditor: Claude Opus 4.5
