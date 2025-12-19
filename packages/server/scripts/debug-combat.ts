#!/usr/bin/env bun
/**
 * Combat Debug Script
 *
 * Usage:
 *   bun scripts/debug-combat.ts <playerId> [tickNumber]
 *
 * Examples:
 *   bun scripts/debug-combat.ts player-abc-123
 *   bun scripts/debug-combat.ts player-abc-123 5000
 *
 * This script connects to a running server and pulls combat history
 * for investigation. Run this when a player reports suspicious combat.
 */

import { CombatReplayService } from "@hyperscape/shared/systems/shared/combat/CombatReplayService";
import {
  EventStore,
  GameEventType,
} from "@hyperscape/shared/systems/shared/EventStore";

// Parse command line args
const args = process.argv.slice(2);

if (args.length === 0) {
  console.log(`
╔════════════════════════════════════════════════════════════════╗
║                    COMBAT DEBUG TOOL                           ║
╠════════════════════════════════════════════════════════════════╣
║                                                                ║
║  Usage:                                                        ║
║    bun scripts/debug-combat.ts <playerId> [aroundTick]         ║
║                                                                ║
║  Examples:                                                     ║
║    bun scripts/debug-combat.ts player-abc-123                  ║
║    bun scripts/debug-combat.ts player-abc-123 5000             ║
║                                                                ║
║  What this does:                                               ║
║    1. Pulls combat history for the player                      ║
║    2. Shows all damage dealt and received                      ║
║    3. Flags suspicious events (high damage, rapid attacks)     ║
║    4. Exports JSON for further analysis                        ║
║                                                                ║
╚════════════════════════════════════════════════════════════════╝

NOTE: This script needs access to the server's EventStore.
      For now, it demonstrates the API with mock data.
      In production, you'd expose an admin endpoint.
`);
  process.exit(0);
}

const playerId = args[0];
const aroundTick = args[1] ? parseInt(args[1]) : 1000;

console.log(`\n🔍 Investigating combat for: ${playerId}`);
console.log(`   Around tick: ${aroundTick}\n`);

// In production, you'd fetch this from your running server
// For now, we'll demonstrate with a mock EventStore
const eventStore = new EventStore();
const replayService = new CombatReplayService(eventStore);

// Configure what counts as "suspicious"
replayService.configure({
  maxExpectedDamage: 50, // Flag damage above 50
  maxExpectedHitsPerSecond: 3, // Flag more than 3 hits/second
});

// Check if we have any events (in real usage, the server would have these)
const stats = {
  eventCount: eventStore.getEventCount(),
  oldestTick: eventStore.getOldestEventTick(),
  newestTick: eventStore.getNewestEventTick(),
};

if (stats.eventCount === 0) {
  console.log(`⚠️  No events in EventStore.`);
  console.log(`\n📋 To use this in production, you need to either:`);
  console.log(
    `   1. Add an admin API endpoint to your server that exposes combat history`,
  );
  console.log(`   2. Export events to a file periodically`);
  console.log(`\n   Example admin endpoint:\n`);
  console.log(`   // In your server routes`);
  console.log(`   app.get('/admin/combat-debug/:playerId', (req, res) => {`);
  console.log(`     const combatSystem = world.getSystem('combat');`);
  console.log(`     const events = combatSystem.getCombatEventHistory(`);
  console.log(`       req.params.playerId,`);
  console.log(`       parseInt(req.query.startTick),`);
  console.log(`       parseInt(req.query.endTick)`);
  console.log(`     );`);
  console.log(`     res.json(events);`);
  console.log(`   });`);
  process.exit(0);
}

// If we have events, analyze them
console.log(`📊 Event Store Stats:`);
console.log(`   Total events: ${stats.eventCount}`);
console.log(`   Tick range: ${stats.oldestTick} - ${stats.newestTick}\n`);

// Get investigation report
const startTick = aroundTick - 200;
const endTick = aroundTick + 200;
const report = replayService.investigateEntity(playerId, startTick, endTick);

console.log(`═══════════════════════════════════════════════════════════════`);
console.log(`                    INVESTIGATION REPORT`);
console.log(`═══════════════════════════════════════════════════════════════`);
console.log(`Player: ${report.entityId}`);
console.log(
  `Time Range: tick ${report.timeRange.startTick} - ${report.timeRange.endTick}`,
);
console.log(`\n📈 Combat Stats:`);
console.log(`   Total Damage Dealt: ${report.totalDamageDealt}`);
console.log(`   Total Damage Taken: ${report.totalDamageTaken}`);
console.log(`   Max Single Hit: ${report.maxDamageDealt}`);
console.log(`   Average Damage/Hit: ${report.averageDamagePerHit.toFixed(1)}`);
console.log(`   Combat Sessions: ${report.combatSessions.length}`);

if (report.suspiciousEvents.length > 0) {
  console.log(`\n⚠️  SUSPICIOUS EVENTS (${report.suspiciousEvents.length}):`);
  for (const sus of report.suspiciousEvents) {
    console.log(`   ❌ ${sus.reason}`);
    console.log(`      Tick: ${sus.event.tick}`);
    console.log(`      Attacker: ${sus.event.entityId}`);
    if (sus.event.damage) {
      console.log(`      Damage: ${sus.event.damage}`);
    }
  }
} else {
  console.log(`\n✅ No suspicious events detected`);
}

// Show combat sessions
if (report.combatSessions.length > 0) {
  console.log(`\n📜 Combat Sessions:`);
  for (const session of report.combatSessions) {
    console.log(`\n   ${session.attackerId} vs ${session.targetId}`);
    console.log(`   Ticks: ${session.startTick} - ${session.endTick}`);
    console.log(
      `   Damage Dealt: ${session.totalDamageDealt} (${session.hitCount} hits, ${session.missCount} misses)`,
    );
    console.log(`   Damage Taken: ${session.totalDamageTaken}`);
  }
}

console.log(
  `\n═══════════════════════════════════════════════════════════════\n`,
);
