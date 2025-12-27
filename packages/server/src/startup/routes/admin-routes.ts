/**
 * Admin Routes Module - Combat debugging and investigation endpoints
 *
 * Provides endpoints for investigating player combat complaints:
 * - GET /admin/combat/:playerId - Get combat history for a player
 * - GET /admin/combat/:playerId/report - Get full investigation report
 * - GET /admin/combat/stats - Get EventStore statistics
 *
 * SECURITY: These routes should be protected by admin authentication.
 * Add your auth middleware before registering these routes.
 *
 * Usage:
 * ```typescript
 * import { registerAdminRoutes } from './routes/admin-routes';
 * registerAdminRoutes(fastify, world, config);
 * ```
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { World } from "@hyperscape/shared";
import { CombatSystem } from "@hyperscape/shared";
import type { ServerConfig } from "../config.js";

/**
 * Register admin endpoints for combat debugging
 *
 * @param fastify - Fastify server instance
 * @param world - Game world instance
 * @param config - Server configuration
 */
export function registerAdminRoutes(
  fastify: FastifyInstance,
  world: World,
  config: ServerConfig,
): void {
  // Middleware to check admin auth (customize this for your auth system)
  const requireAdmin = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> => {
    const adminCode = request.headers["x-admin-code"];
    if (config.adminCode && adminCode !== config.adminCode) {
      return reply.code(403).send({ error: "Unauthorized" });
    }
  };

  /**
   * GET /admin/combat/stats
   * Get EventStore statistics
   */
  fastify.get(
    "/admin/combat/stats",
    { preHandler: requireAdmin },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const combatSystem = world.getSystem<CombatSystem>("combat");
      if (!combatSystem) {
        return reply.code(500).send({ error: "CombatSystem not found" });
      }

      // Access event store stats directly via public eventStore
      const eventStore = combatSystem.eventStore;
      const stats = {
        eventCount: eventStore.getEventCount(),
        snapshotCount: eventStore.getSnapshotCount(),
        oldestTick: eventStore.getOldestEventTick(),
        newestTick: eventStore.getNewestEventTick(),
      };
      // Access anti-cheat stats directly via public antiCheat
      const antiCheatStats = combatSystem.antiCheat.getStats();

      return reply.send({
        eventStore: stats,
        antiCheat: antiCheatStats,
        currentTick: world.currentTick,
      });
    },
  );

  /**
   * GET /admin/combat/:playerId
   * Get raw combat events for a player
   *
   * Query params:
   * - startTick: Start of range (default: currentTick - 500)
   * - endTick: End of range (default: currentTick)
   */
  fastify.get<{
    Params: { playerId: string };
    Querystring: { startTick?: string; endTick?: string };
  }>(
    "/admin/combat/:playerId",
    { preHandler: requireAdmin },
    async (request, reply) => {
      const { playerId } = request.params;
      const startTick = request.query.startTick
        ? parseInt(request.query.startTick)
        : world.currentTick - 500;
      const endTick = request.query.endTick
        ? parseInt(request.query.endTick)
        : world.currentTick;

      const combatSystem = world.getSystem<CombatSystem>("combat");
      if (!combatSystem) {
        return reply.code(500).send({ error: "CombatSystem not found" });
      }

      // Access event store directly via public eventStore
      const events = combatSystem.eventStore.getEntityEvents(
        playerId,
        startTick,
        endTick,
      );

      return reply.send({
        playerId,
        tickRange: { startTick, endTick },
        eventCount: events.length,
        events,
      });
    },
  );

  /**
   * GET /admin/combat/:playerId/report
   * Get full investigation report with suspicious event detection
   *
   * Query params:
   * - startTick: Start of range (default: currentTick - 500)
   * - endTick: End of range (default: currentTick)
   * - maxDamage: Threshold for suspicious damage (default: 50)
   */
  fastify.get<{
    Params: { playerId: string };
    Querystring: {
      startTick?: string;
      endTick?: string;
      maxDamage?: string;
    };
  }>(
    "/admin/combat/:playerId/report",
    { preHandler: requireAdmin },
    async (request, reply) => {
      const { playerId } = request.params;
      const startTick = request.query.startTick
        ? parseInt(request.query.startTick)
        : world.currentTick - 500;
      const endTick = request.query.endTick
        ? parseInt(request.query.endTick)
        : world.currentTick;
      const maxDamage = request.query.maxDamage
        ? parseInt(request.query.maxDamage)
        : 50;

      const combatSystem = world.getSystem<CombatSystem>("combat");
      if (!combatSystem) {
        return reply.code(500).send({ error: "CombatSystem not found" });
      }

      // Access event store directly via public eventStore
      const events = combatSystem.eventStore.getEntityEvents(
        playerId,
        startTick,
        endTick,
      );

      // Build a simple report from the events
      let totalDamageDealt = 0;
      let totalDamageTaken = 0;
      let maxDamageDealt = 0;
      let hitCount = 0;
      const suspiciousEvents: Array<{
        tick: number;
        reason: string;
        damage?: number;
        entityId: string;
      }> = [];

      for (const event of events) {
        const payload = event.payload as {
          damage?: number;
          targetId?: string;
        };

        if (event.type === "COMBAT_DAMAGE") {
          const damage = payload.damage ?? 0;

          if (event.entityId === playerId) {
            // Player dealt damage
            totalDamageDealt += damage;
            maxDamageDealt = Math.max(maxDamageDealt, damage);
            hitCount++;
          } else if (payload.targetId === playerId) {
            // Player took damage
            totalDamageTaken += damage;
          }

          // Check for suspicious damage
          if (damage > maxDamage) {
            suspiciousEvents.push({
              tick: event.tick,
              reason: `Damage ${damage} exceeds threshold ${maxDamage}`,
              damage,
              entityId: event.entityId,
            });
          }
        }
      }

      return reply.send({
        playerId,
        tickRange: { startTick, endTick },
        stats: {
          totalDamageDealt,
          totalDamageTaken,
          maxDamageDealt,
          hitCount,
          averageDamagePerHit: hitCount > 0 ? totalDamageDealt / hitCount : 0,
        },
        suspiciousEvents,
        eventCount: events.length,
      });
    },
  );

  /**
   * GET /admin/combat/range/:startTick/:endTick
   * Get all combat events in a tick range (for investigating specific incidents)
   */
  fastify.get<{
    Params: { startTick: string; endTick: string };
  }>(
    "/admin/combat/range/:startTick/:endTick",
    { preHandler: requireAdmin },
    async (request, reply) => {
      const startTick = parseInt(request.params.startTick);
      const endTick = parseInt(request.params.endTick);

      const combatSystem = world.getSystem<CombatSystem>("combat");
      if (!combatSystem) {
        return reply.code(500).send({ error: "CombatSystem not found" });
      }

      const events = combatSystem.eventStore.getCombatEvents(
        startTick,
        endTick,
      );

      return reply.send({
        tickRange: { startTick, endTick },
        eventCount: events.length,
        events,
      });
    },
  );

  /**
   * GET /admin/anticheat/flagged
   * Get players flagged by anti-cheat system
   */
  fastify.get(
    "/admin/anticheat/flagged",
    { preHandler: requireAdmin },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const combatSystem = world.getSystem<CombatSystem>("combat");
      if (!combatSystem) {
        return reply.code(500).send({ error: "CombatSystem not found" });
      }

      const flaggedPlayers = combatSystem.antiCheat.getPlayersRequiringReview();
      const reports = flaggedPlayers.map((playerId) => ({
        playerId,
        ...combatSystem.antiCheat.getPlayerReport(playerId),
      }));

      return reply.send({
        flaggedCount: flaggedPlayers.length,
        players: reports,
      });
    },
  );
}
