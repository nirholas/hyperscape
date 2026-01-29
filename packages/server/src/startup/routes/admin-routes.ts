/**
 * Admin Routes - User management, activity tracking, and combat debugging
 * Protected by x-admin-code header authentication.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { World } from "@hyperscape/shared";
import { CombatSystem } from "@hyperscape/shared";
import type { ServerConfig } from "../config.js";
import type { DatabaseSystem } from "../../systems/DatabaseSystem/index.js";
import { eq, like, sql, desc, and, type SQL } from "drizzle-orm";
import * as schema from "../../database/schema.js";

/** Safely parse int with NaN protection */
function safeParseInt(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

/** Parse optional timestamp - returns undefined if missing/invalid */
function parseOptionalTimestamp(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/** Parse pagination params with bounds and NaN protection */
function parsePagination(
  query: { page?: string; limit?: string },
  maxLimit = 100,
  defaultLimit = 50,
) {
  const page = Math.max(1, safeParseInt(query.page, 1));
  const limit = Math.min(
    maxLimit,
    Math.max(1, safeParseInt(query.limit, defaultLimit)),
  );
  return { page, limit, offset: (page - 1) * limit };
}

export function registerAdminRoutes(
  fastify: FastifyInstance,
  world: World,
  config: ServerConfig,
): void {
  const requireAdmin = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> => {
    // Always require admin code - if not configured, admin panel is disabled
    if (!config.adminCode) {
      return reply.code(403).send({ error: "Admin panel not configured" });
    }
    if (request.headers["x-admin-code"] !== config.adminCode) {
      return reply.code(403).send({ error: "Unauthorized" });
    }
  };

  /** Get database system or return error response */
  const getDb = (reply: FastifyReply) => {
    const dbSystem = world.getSystem<DatabaseSystem>("database");
    if (!dbSystem) {
      reply.code(500).send({ error: "DatabaseSystem not found" });
      return null;
    }
    const db = dbSystem.getDb();
    if (!db) {
      reply.code(500).send({ error: "Database not initialized" });
      return null;
    }
    return { dbSystem, db };
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
      const startTick = safeParseInt(
        request.query.startTick,
        world.currentTick - 500,
      );
      const endTick = safeParseInt(request.query.endTick, world.currentTick);

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
      const startTick = safeParseInt(
        request.query.startTick,
        world.currentTick - 500,
      );
      const endTick = safeParseInt(request.query.endTick, world.currentTick);
      const maxDamage = safeParseInt(request.query.maxDamage, 50);

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
      const startTick = parseInt(request.params.startTick, 10);
      const endTick = parseInt(request.params.endTick, 10);

      if (Number.isNaN(startTick) || Number.isNaN(endTick)) {
        return reply.code(400).send({
          error: "Invalid tick range - startTick and endTick must be numbers",
        });
      }

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

  // ============================================================================
  // ADMIN PANEL ENDPOINTS
  // ============================================================================

  /** GET /admin/users - List users with search/pagination */
  fastify.get<{
    Querystring: {
      page?: string;
      limit?: string;
      search?: string;
      role?: string;
    };
  }>("/admin/users", { preHandler: requireAdmin }, async (request, reply) => {
    const ctx = getDb(reply);
    if (!ctx) return;
    const { db } = ctx;

    const { page, limit, offset } = parsePagination(request.query, 100, 50);
    const { search, role: roleFilter } = request.query;

    const conditions: SQL<unknown>[] = [];
    if (search) conditions.push(like(schema.users.name, `%${search}%`));
    if (roleFilter)
      conditions.push(like(schema.users.roles, `%${roleFilter}%`));

    let countQuery = db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.users);
    if (conditions.length)
      countQuery = countQuery.where(and(...conditions)) as typeof countQuery;
    const total = (await countQuery)[0]?.count ?? 0;

    let usersQuery = db
      .select({
        id: schema.users.id,
        name: schema.users.name,
        roles: schema.users.roles,
        createdAt: schema.users.createdAt,
        avatar: schema.users.avatar,
        wallet: schema.users.wallet,
      })
      .from(schema.users)
      .orderBy(desc(schema.users.createdAt))
      .limit(limit)
      .offset(offset);

    if (conditions.length)
      usersQuery = usersQuery.where(and(...conditions)) as typeof usersQuery;

    return reply.send({
      users: await usersQuery,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  });

  /** GET /admin/users/:userId - User details with characters */
  fastify.get<{ Params: { userId: string } }>(
    "/admin/users/:userId",
    { preHandler: requireAdmin },
    async (request, reply) => {
      const ctx = getDb(reply);
      if (!ctx) return;
      const { db } = ctx;
      const { userId } = request.params;

      const userResult = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, userId))
        .limit(1);
      if (userResult.length === 0)
        return reply.code(404).send({ error: "User not found" });

      const [user, characters, activeBan] = await Promise.all([
        Promise.resolve(userResult[0]),
        db
          .select({
            id: schema.characters.id,
            name: schema.characters.name,
            combatLevel: schema.characters.combatLevel,
            createdAt: schema.characters.createdAt,
            lastLogin: schema.characters.lastLogin,
            isAgent: schema.characters.isAgent,
            avatar: schema.characters.avatar,
          })
          .from(schema.characters)
          .where(eq(schema.characters.accountId, userId)),
        db
          .select()
          .from(schema.userBans)
          .where(
            and(
              eq(schema.userBans.bannedUserId, userId),
              eq(schema.userBans.active, 1),
            ),
          )
          .limit(1),
      ]);

      return reply.send({
        user: { ...user, roles: (user.roles ?? "").split(",").filter(Boolean) },
        characters,
        ban: activeBan[0] ?? null,
      });
    },
  );

  /** GET /admin/players/:playerId - Full player details */
  fastify.get<{ Params: { playerId: string } }>(
    "/admin/players/:playerId",
    { preHandler: requireAdmin },
    async (request, reply) => {
      const ctx = getDb(reply);
      if (!ctx) return;
      const { db } = ctx;
      const { playerId } = request.params;

      const charResult = await db
        .select()
        .from(schema.characters)
        .where(eq(schema.characters.id, playerId))
        .limit(1);
      if (charResult.length === 0)
        return reply.code(404).send({ error: "Player not found" });
      const character = charResult[0];

      // Parallel fetch all related data
      const [inventory, equipment, bank, npcKills, sessions, accountResult] =
        await Promise.all([
          db
            .select()
            .from(schema.inventory)
            .where(eq(schema.inventory.playerId, playerId))
            .orderBy(schema.inventory.slotIndex),
          db
            .select()
            .from(schema.equipment)
            .where(eq(schema.equipment.playerId, playerId)),
          db
            .select()
            .from(schema.bankStorage)
            .where(eq(schema.bankStorage.playerId, playerId))
            .orderBy(schema.bankStorage.tabIndex, schema.bankStorage.slot),
          db
            .select()
            .from(schema.npcKills)
            .where(eq(schema.npcKills.playerId, playerId)),
          db
            .select()
            .from(schema.playerSessions)
            .where(eq(schema.playerSessions.playerId, playerId))
            .orderBy(desc(schema.playerSessions.sessionStart))
            .limit(10),
          db
            .select({
              id: schema.users.id,
              name: schema.users.name,
              roles: schema.users.roles,
            })
            .from(schema.users)
            .where(eq(schema.users.id, character.accountId))
            .limit(1),
        ]);

      // Build skills from character columns
      const skillDef = (
        lvl: number | null,
        xp: number | null,
        defaultLvl = 1,
        defaultXp = 0,
      ) => ({
        level: lvl ?? defaultLvl,
        xp: xp ?? defaultXp,
      });

      return reply.send({
        player: {
          id: character.id,
          name: character.name,
          accountId: character.accountId,
          combatLevel: character.combatLevel,
          health: character.health,
          maxHealth: character.maxHealth,
          coins: character.coins,
          position: {
            x: character.positionX,
            y: character.positionY,
            z: character.positionZ,
          },
          attackStyle: character.attackStyle,
          autoRetaliate: character.autoRetaliate === 1,
          isAgent: character.isAgent === 1,
          createdAt: character.createdAt,
          lastLogin: character.lastLogin,
        },
        account: accountResult[0] ?? null,
        skills: {
          attack: skillDef(character.attackLevel, character.attackXp),
          strength: skillDef(character.strengthLevel, character.strengthXp),
          defense: skillDef(character.defenseLevel, character.defenseXp),
          constitution: skillDef(
            character.constitutionLevel,
            character.constitutionXp,
            10,
            1154,
          ),
          ranged: skillDef(character.rangedLevel, character.rangedXp),
          prayer: skillDef(character.prayerLevel, character.prayerXp),
          magic: skillDef(character.magicLevel, character.magicXp),
          woodcutting: skillDef(
            character.woodcuttingLevel,
            character.woodcuttingXp,
          ),
          mining: skillDef(character.miningLevel, character.miningXp),
          fishing: skillDef(character.fishingLevel, character.fishingXp),
          firemaking: skillDef(
            character.firemakingLevel,
            character.firemakingXp,
          ),
          cooking: skillDef(character.cookingLevel, character.cookingXp),
          smithing: skillDef(character.smithingLevel, character.smithingXp),
        },
        inventory: inventory.map((i) => {
          let metadata = null;
          if (i.metadata) {
            try {
              metadata = JSON.parse(i.metadata);
            } catch {
              /* invalid JSON, leave as null */
            }
          }
          return {
            itemId: i.itemId,
            quantity: i.quantity,
            slotIndex: i.slotIndex,
            metadata,
          };
        }),
        equipment: equipment.map((e) => ({
          slotType: e.slotType,
          itemId: e.itemId,
          quantity: e.quantity,
        })),
        bank: bank.map((b) => ({
          itemId: b.itemId,
          quantity: b.quantity,
          slot: b.slot,
          tabIndex: b.tabIndex,
        })),
        npcKills: npcKills.map((k) => ({
          npcId: k.npcId,
          killCount: k.killCount,
        })),
        sessions: sessions.map((s) => ({
          id: s.id,
          sessionStart: s.sessionStart,
          sessionEnd: s.sessionEnd,
          playtimeMinutes: s.playtimeMinutes,
          reason: s.reason,
        })),
      });
    },
  );

  /** GET /admin/players/:playerId/activity - Player activity history */
  fastify.get<{
    Params: { playerId: string };
    Querystring: {
      page?: string;
      limit?: string;
      eventType?: string;
      from?: string;
      to?: string;
    };
  }>(
    "/admin/players/:playerId/activity",
    { preHandler: requireAdmin },
    async (request, reply) => {
      const ctx = getDb(reply);
      if (!ctx) return;
      const { dbSystem } = ctx;

      const { page, limit, offset } = parsePagination(request.query);
      const options = {
        playerId: request.params.playerId,
        eventType: request.query.eventType,
        fromTimestamp: parseOptionalTimestamp(request.query.from),
        toTimestamp: parseOptionalTimestamp(request.query.to),
        limit,
        offset,
      };

      const [activities, total] = await Promise.all([
        dbSystem.queryActivitiesAsync(options),
        dbSystem.countActivitiesAsync(options),
      ]);

      return reply.send({
        activities,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      });
    },
  );

  /** GET /admin/players/:playerId/trades - Player trade history */
  fastify.get<{
    Params: { playerId: string };
    Querystring: { page?: string; limit?: string; from?: string; to?: string };
  }>(
    "/admin/players/:playerId/trades",
    { preHandler: requireAdmin },
    async (request, reply) => {
      const ctx = getDb(reply);
      if (!ctx) return;
      const { dbSystem } = ctx;

      const { page, limit, offset } = parsePagination(request.query);
      const options = {
        playerId: request.params.playerId,
        fromTimestamp: parseOptionalTimestamp(request.query.from),
        toTimestamp: parseOptionalTimestamp(request.query.to),
        limit,
        offset,
      };

      const [trades, total] = await Promise.all([
        dbSystem.queryTradesAsync(options),
        dbSystem.countTradesAsync(options),
      ]);

      return reply.send({
        trades,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      });
    },
  );

  /** GET /admin/activity - Query all activity logs */
  fastify.get<{
    Querystring: {
      page?: string;
      limit?: string;
      eventType?: string;
      from?: string;
      to?: string;
    };
  }>(
    "/admin/activity",
    { preHandler: requireAdmin },
    async (request, reply) => {
      const ctx = getDb(reply);
      if (!ctx) return;
      const { dbSystem } = ctx;

      const { page, limit, offset } = parsePagination(request.query);
      const options = {
        eventTypes: request.query.eventType?.split(",").filter(Boolean),
        fromTimestamp: parseOptionalTimestamp(request.query.from),
        toTimestamp: parseOptionalTimestamp(request.query.to),
        limit,
        offset,
      };

      const [activities, total] = await Promise.all([
        dbSystem.queryActivitiesAsync(options),
        dbSystem.countActivitiesAsync(options),
      ]);

      return reply.send({
        activities,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      });
    },
  );

  /** GET /admin/activity/types - Event types for filter dropdown */
  fastify.get(
    "/admin/activity/types",
    { preHandler: requireAdmin },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const ctx = getDb(reply);
      if (!ctx) return;
      return reply.send({
        eventTypes: await ctx.dbSystem.getActivityEventTypesAsync(),
      });
    },
  );

  /** GET /admin/stats - Dashboard statistics */
  fastify.get(
    "/admin/stats",
    { preHandler: requireAdmin },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const ctx = getDb(reply);
      if (!ctx) return;
      const { db } = ctx;

      const [users, characters, active, banned] = await Promise.all([
        db.select({ count: sql<number>`count(*)::int` }).from(schema.users),
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(schema.characters),
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(schema.playerSessions)
          .where(sql`${schema.playerSessions.sessionEnd} IS NULL`),
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(schema.userBans)
          .where(eq(schema.userBans.active, 1)),
      ]);

      return reply.send({
        totalUsers: users[0]?.count ?? 0,
        totalCharacters: characters[0]?.count ?? 0,
        activeSessions: active[0]?.count ?? 0,
        bannedUsers: banned[0]?.count ?? 0,
      });
    },
  );
}
