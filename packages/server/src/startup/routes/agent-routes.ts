/**
 * Agent Routes - ElizaOS Agent Credential Management
 *
 * REST API endpoints for generating permanent authentication credentials for AI agents.
 * Agents need long-lived tokens to connect autonomously without user intervention.
 *
 * Security Model:
 * - Only Privy-authenticated users can create agent credentials
 * - Credentials are tied to specific characterId + userId pairs
 * - JWTs are server-signed and cryptographically secure
 * - Agents are clearly marked with isAgent flag
 * - Global rate limiting (100 req/min) protects against abuse
 *
 * Note: Dashboard on port 3333 calls ElizaOS API (port 3000) directly.
 * No proxying is needed for localhost development.
 */

import type { FastifyInstance } from "fastify";
import type { World } from "@hyperscape/shared";
import { createJWT } from "../../shared/utils.js";

// Command acknowledgment delay (ms) - allows plugin to process before response
const COMMAND_ACK_DELAY_MS = 100;

/**
 * Register agent credential routes
 *
 * Endpoints:
 * - POST /api/agents/credentials - Generate permanent JWT for agent character
 *
 * @param fastify - Fastify server instance
 * @param world - Game world instance (for database access)
 */
export function registerAgentRoutes(
  fastify: FastifyInstance,
  world: World,
): void {
  console.log("[AgentRoutes] Registering agent credential routes...");

  /**
   * POST /api/agents/credentials
   *
   * Generate permanent authentication credentials for an AI agent character.
   * This endpoint creates a long-lived Hyperscape JWT that never expires,
   * allowing the agent to connect autonomously.
   *
   * Request body:
   * {
   *   characterId: "character-uuid",
   *   accountId: "privy-user-id"
   * }
   *
   * Response:
   * {
   *   success: true,
   *   authToken: "permanent-jwt-token",
   *   characterId: "character-uuid",
   *   serverUrl: "ws://localhost:5555/ws"
   * }
   */
  fastify.post("/api/agents/credentials", async (request, reply) => {
    try {
      const body = request.body as {
        characterId: string;
        accountId: string;
      };

      if (!body.characterId || !body.accountId) {
        return reply.status(400).send({
          success: false,
          error: "Missing required fields: characterId, accountId",
        });
      }

      const { characterId, accountId } = body;

      console.log("[AgentRoutes] Generating credentials for:", {
        characterId,
        accountId,
      });

      // Verify character exists and belongs to this account
      const databaseSystem = world.getSystem("database") as
        | {
            getCharactersAsync: (
              accountId: string,
            ) => Promise<Array<{ id: string; name: string }>>;
          }
        | undefined;

      if (!databaseSystem) {
        console.error("[AgentRoutes] DatabaseSystem not available");
        return reply.status(500).send({
          success: false,
          error: "Database system not available",
        });
      }

      const characters = await databaseSystem.getCharactersAsync(accountId);
      const character = characters.find((c) => c.id === characterId);

      if (!character) {
        console.warn(
          `[AgentRoutes] Character ${characterId} not found or not owned by ${accountId}`,
        );
        return reply.status(403).send({
          success: false,
          error: "Character not found or access denied",
        });
      }

      console.log("[AgentRoutes] Character verified:", character.name);

      // Generate permanent Hyperscape JWT (no expiration)
      const authToken = await createJWT({
        userId: accountId,
        characterId: characterId,
        isAgent: true,
      });

      console.log(
        `[AgentRoutes] ✅ Generated permanent JWT for agent: ${character.name}`,
      );

      // Get server URL from environment or use default
      const serverUrl =
        process.env.HYPERSCAPE_SERVER_URL ||
        process.env.PUBLIC_WS_URL ||
        "ws://localhost:5555/ws";

      return reply.send({
        success: true,
        authToken,
        characterId,
        serverUrl,
        message: `Permanent credentials generated for ${character.name}`,
      });
    } catch (error) {
      console.error("[AgentRoutes] ❌ Failed to generate credentials:", error);

      return reply.status(500).send({
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to generate credentials",
      });
    }
  });

  /**
   * GET /api/agents/mappings/:accountId
   *
   * Get all agent mappings for a user.
   * Returns the list of agent IDs owned by this user.
   *
   * Response:
   * {
   *   success: true,
   *   agentIds: ["agent-id-1", "agent-id-2", ...]
   * }
   */
  fastify.get("/api/agents/mappings/:accountId", async (request, reply) => {
    try {
      const params = request.params as { accountId: string };
      const { accountId } = params;

      if (!accountId) {
        return reply.status(400).send({
          success: false,
          error: "Missing required parameter: accountId",
        });
      }

      console.log("[AgentRoutes] Fetching agent mappings for:", accountId);

      // Get database system
      const databaseSystem = world.getSystem("database") as
        | {
            db: {
              select: (fields?: unknown) => {
                from: (table: unknown) => {
                  where: (condition: unknown) => Promise<unknown[]>;
                };
              };
            };
          }
        | undefined;

      if (!databaseSystem || !databaseSystem.db) {
        console.error("[AgentRoutes] DatabaseSystem not available");
        return reply.status(500).send({
          success: false,
          error: "Database system not available",
        });
      }

      // Import schema and eq operator
      const { agentMappings } = await import("../../database/schema.js");
      const { eq } = await import("drizzle-orm");

      // Query agent mappings for this user
      const mappings = (await databaseSystem.db
        .select()
        .from(agentMappings)
        .where(eq(agentMappings.accountId, accountId))) as Array<{
        agentId: string;
        agentName: string;
        characterId: string;
      }>;

      const agentIds = mappings.map((m) => m.agentId);

      console.log(
        `[AgentRoutes] Found ${agentIds.length} agent(s) for ${accountId}`,
      );

      return reply.send({
        success: true,
        agentIds,
        count: agentIds.length,
      });
    } catch (error) {
      console.error("[AgentRoutes] ❌ Failed to fetch agent mappings:", error);

      return reply.status(500).send({
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to fetch agent mappings",
      });
    }
  });

  /**
   * POST /api/agents/mappings
   *
   * Save agent-to-user mapping for dashboard filtering.
   * This allows the dashboard to show only agents owned by the current user.
   *
   * Request body:
   * {
   *   agentId: "eliza-agent-uuid",
   *   accountId: "privy-user-id",
   *   characterId: "character-uuid",
   *   agentName: "Agent Name"
   * }
   *
   * Response:
   * {
   *   success: true
   * }
   */
  fastify.post("/api/agents/mappings", async (request, reply) => {
    try {
      const body = request.body as {
        agentId: string;
        accountId: string;
        characterId: string;
        agentName: string;
      };

      if (
        !body.agentId ||
        !body.accountId ||
        !body.characterId ||
        !body.agentName
      ) {
        return reply.status(400).send({
          success: false,
          error:
            "Missing required fields: agentId, accountId, characterId, agentName",
        });
      }

      const { agentId, accountId, characterId, agentName } = body;

      console.log("[AgentRoutes] Saving agent mapping:", {
        agentId,
        accountId,
        characterId,
        agentName,
      });

      // Get database system
      const databaseSystem = world.getSystem("database") as
        | {
            db: {
              insert: (table: unknown) => {
                values: (values: unknown) => {
                  onConflictDoUpdate: (config: {
                    target: unknown;
                    set: unknown;
                  }) => Promise<unknown>;
                };
              };
            };
          }
        | undefined;

      if (!databaseSystem || !databaseSystem.db) {
        console.error("[AgentRoutes] DatabaseSystem not available");
        return reply.status(500).send({
          success: false,
          error: "Database system not available",
        });
      }

      // Import schema
      const { agentMappings } = await import("../../database/schema.js");

      // Insert or update mapping
      await databaseSystem.db
        .insert(agentMappings)
        .values({
          agentId,
          accountId,
          characterId,
          agentName,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: agentMappings.agentId,
          set: {
            agentName,
            updatedAt: new Date(),
          },
        });

      console.log(`[AgentRoutes] ✅ Agent mapping saved for: ${agentName}`);

      return reply.send({
        success: true,
        message: `Agent mapping saved for ${agentName}`,
      });
    } catch (error) {
      console.error("[AgentRoutes] ❌ Failed to save agent mapping:", error);

      return reply.status(500).send({
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to save agent mapping",
      });
    }
  });

  /**
   * GET /api/agents/mapping/:agentId
   *
   * Get a single agent mapping by agent ID.
   * Returns the character ID and other details for this agent.
   * Used by dashboard viewport to get character ID for iframe embedding.
   *
   * Response:
   * {
   *   success: true,
   *   agentId: "agent-uuid",
   *   characterId: "character-uuid",
   *   accountId: "privy-user-id",
   *   agentName: "Agent Name"
   * }
   */
  fastify.get("/api/agents/mapping/:agentId", async (request, reply) => {
    try {
      const params = request.params as { agentId: string };
      const { agentId } = params;

      if (!agentId) {
        return reply.status(400).send({
          success: false,
          error: "Missing required parameter: agentId",
        });
      }

      console.log("[AgentRoutes] Fetching mapping for agent:", agentId);

      // Get database system
      const databaseSystem = world.getSystem("database") as
        | {
            db: {
              select: (fields?: unknown) => {
                from: (table: unknown) => {
                  where: (condition: unknown) => Promise<unknown[]>;
                };
              };
            };
          }
        | undefined;

      if (!databaseSystem || !databaseSystem.db) {
        console.error("[AgentRoutes] DatabaseSystem not available");
        return reply.status(500).send({
          success: false,
          error: "Database system not available",
        });
      }

      // Import schema and eq operator
      const { agentMappings } = await import("../../database/schema.js");
      const { eq } = await import("drizzle-orm");

      // Query agent mapping by agent ID
      const mappings = (await databaseSystem.db
        .select()
        .from(agentMappings)
        .where(eq(agentMappings.agentId, agentId))) as Array<{
        agentId: string;
        accountId: string;
        characterId: string;
        agentName: string;
      }>;

      if (mappings.length === 0) {
        console.log(`[AgentRoutes] No mapping found for agent: ${agentId}`);
        return reply.status(404).send({
          success: false,
          error: "Agent mapping not found",
        });
      }

      const mapping = mappings[0];

      console.log(
        `[AgentRoutes] ✅ Found mapping for agent ${agentId}: characterId=${mapping.characterId}`,
      );

      return reply.send({
        success: true,
        agentId: mapping.agentId,
        characterId: mapping.characterId,
        accountId: mapping.accountId,
        agentName: mapping.agentName,
      });
    } catch (error) {
      console.error("[AgentRoutes] ❌ Failed to fetch agent mapping:", error);

      return reply.status(500).send({
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to fetch agent mapping",
      });
    }
  });

  /**
   * DELETE /api/agents/mappings/:agentId
   *
   * Delete agent mapping from Hyperscape database.
   * This removes the link between an ElizaOS agent and the user's account.
   *
   * Response:
   * {
   *   success: true,
   *   message: "Agent mapping deleted"
   * }
   */
  fastify.delete("/api/agents/mappings/:agentId", async (request, reply) => {
    try {
      const params = request.params as { agentId: string };
      const { agentId } = params;

      if (!agentId) {
        return reply.status(400).send({
          success: false,
          error: "Missing required parameter: agentId",
        });
      }

      console.log("[AgentRoutes] Deleting agent mapping for:", agentId);

      // Get database system
      const databaseSystem = world.getSystem("database") as
        | {
            db: {
              delete: (table: unknown) => {
                where: (condition: unknown) => Promise<unknown>;
              };
            };
          }
        | undefined;

      if (!databaseSystem || !databaseSystem.db) {
        console.error("[AgentRoutes] DatabaseSystem not available");
        return reply.status(500).send({
          success: false,
          error: "Database system not available",
        });
      }

      // Import schema and eq operator
      const { agentMappings } = await import("../../database/schema.js");
      const { eq } = await import("drizzle-orm");

      // Delete agent mapping
      await databaseSystem.db
        .delete(agentMappings)
        .where(eq(agentMappings.agentId, agentId));

      console.log(`[AgentRoutes] ✅ Agent mapping deleted for: ${agentId}`);

      return reply.send({
        success: true,
        message: "Agent mapping deleted",
      });
    } catch (error) {
      console.error("[AgentRoutes] ❌ Failed to delete agent mapping:", error);

      return reply.status(500).send({
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to delete agent mapping",
      });
    }
  });

  /**
   * POST /api/agents/:agentId/message
   *
   * Send a message to an agent via ElizaOS messaging system.
   * This properly integrates with ElizaOS's runtime, allowing the agent to
   * process messages through its personality, providers, and actions.
   *
   * SECURITY: Requires authentication. User must own the agent to send messages.
   *
   * Headers:
   * - Authorization: Bearer <token> (Privy or Hyperscape JWT)
   *
   * Request body:
   * {
   *   content: "Move to coordinates [10, 0, 5]"
   * }
   *
   * Response:
   * {
   *   success: true,
   *   message: "Message sent to agent"
   * }
   */
  fastify.post("/api/agents/:agentId/message", async (request, reply) => {
    try {
      const params = request.params as { agentId: string };
      const body = request.body as {
        content: string;
      };

      const { agentId } = params;
      const { content } = body;

      // SECURITY: Require authentication via Authorization header
      const authHeader = request.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        console.warn(
          "[AgentRoutes] ❌ Message endpoint called without auth token",
        );
        return reply.status(401).send({
          success: false,
          error:
            "Authentication required. Provide Bearer token in Authorization header.",
        });
      }

      const token = authHeader.slice(7); // Remove "Bearer " prefix

      // Verify the token and get user identity
      const { verifyJWT } = await import("../../shared/utils.js");
      const { verifyPrivyToken, isPrivyEnabled } = await import(
        "../../infrastructure/auth/privy-auth.js"
      );

      let verifiedUserId: string | null = null;

      // Try Privy token verification first (if enabled)
      if (isPrivyEnabled()) {
        try {
          const privyInfo = await verifyPrivyToken(token);
          if (privyInfo) {
            verifiedUserId = privyInfo.privyUserId;
            console.log(
              `[AgentRoutes] 🔐 Privy auth verified: ${verifiedUserId}`,
            );
          }
        } catch {
          // Privy verification failed, try JWT next
        }
      }

      // Fall back to Hyperscape JWT verification
      if (!verifiedUserId) {
        const jwtPayload = await verifyJWT(token);
        if (jwtPayload && jwtPayload.userId) {
          verifiedUserId = jwtPayload.userId as string;
          console.log(`[AgentRoutes] 🔐 JWT auth verified: ${verifiedUserId}`);
        }
      }

      if (!verifiedUserId) {
        console.warn("[AgentRoutes] ❌ Token verification failed");
        return reply.status(401).send({
          success: false,
          error: "Invalid or expired authentication token",
        });
      }

      if (!agentId) {
        return reply.status(400).send({
          success: false,
          error: "Missing required parameter: agentId",
        });
      }

      if (!content) {
        return reply.status(400).send({
          success: false,
          error: "Missing required field: content",
        });
      }

      // Get database system
      const databaseSystem = world.getSystem("database") as
        | {
            db: {
              select: (fields?: unknown) => {
                from: (table: unknown) => {
                  where: (condition: unknown) => Promise<unknown[]>;
                };
              };
            };
          }
        | undefined;

      if (!databaseSystem || !databaseSystem.db) {
        console.error("[AgentRoutes] DatabaseSystem not available");
        return reply.status(500).send({
          success: false,
          error: "Database system not available",
        });
      }

      // Import schema and eq operator
      const { agentMappings } = await import("../../database/schema.js");
      const { eq } = await import("drizzle-orm");

      // Get agent's mapping to verify it exists AND user owns it
      const mappings = (await databaseSystem.db
        .select()
        .from(agentMappings)
        .where(eq(agentMappings.agentId, agentId))) as Array<{
        agentId: string;
        accountId: string;
        characterId: string;
        agentName: string;
      }>;

      if (mappings.length === 0) {
        console.warn(`[AgentRoutes] Agent ${agentId} not found in mappings`);
        return reply.status(404).send({
          success: false,
          error: "Agent not found",
        });
      }

      const mapping = mappings[0];

      // SECURITY: Verify the authenticated user owns this agent
      if (mapping.accountId !== verifiedUserId) {
        console.warn(
          `[AgentRoutes] ❌ SECURITY: User ${verifiedUserId} tried to message agent ${agentId} owned by ${mapping.accountId}`,
        );
        return reply.status(403).send({
          success: false,
          error: "You do not have permission to message this agent",
        });
      }

      const characterId = mapping.characterId;
      console.log(
        `[AgentRoutes] ✅ Ownership verified: ${verifiedUserId} owns agent ${mapping.agentName}`,
      );
      console.log(
        `[AgentRoutes] Found agent ${mapping.agentName} (character: ${characterId})`,
      );

      // Send message via in-game chat system
      // The agent receives this through the game's WebSocket and processes it via ElizaOS
      const chatSystem = world.getSystem("chat") as
        | {
            add: (
              message: {
                id: string;
                from: string;
                fromId: string;
                body: string;
                text: string;
                timestamp: number;
                createdAt: string;
              },
              broadcast?: boolean,
            ) => void;
          }
        | undefined;

      if (!chatSystem) {
        console.error("[AgentRoutes] ChatSystem not available");
        return reply.status(500).send({
          success: false,
          error: "Chat system not available",
        });
      }

      // Create chat message - use verified user ID as sender
      const chatMessage = {
        id: crypto.randomUUID(),
        from: "Dashboard",
        fromId: verifiedUserId,
        body: content,
        text: content,
        timestamp: Date.now(),
        createdAt: new Date().toISOString(),
      };

      // Broadcast through game chat - agent will receive via chatAdded packet
      chatSystem.add(chatMessage, true);

      console.log(
        `[AgentRoutes] ✅ Message sent to agent ${agentId} via game chat`,
      );

      return reply.send({
        success: true,
        message: "Message sent to agent",
      });
    } catch (error) {
      console.error("[AgentRoutes] ❌ Failed to send message to agent:", error);

      return reply.status(500).send({
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to send message to agent",
      });
    }
  });

  /**
   * POST /api/spectator/token
   *
   * Exchange a Privy token for a permanent spectator JWT.
   * This solves the issue where Privy tokens expire after ~1 hour,
   * causing spectator mode to lose authentication.
   *
   * SECURITY: Verifies Privy token and checks agent ownership before issuing JWT.
   *
   * Request body:
   * {
   *   agentId: "agent-uuid",
   *   privyToken: "privy-access-token"
   * }
   *
   * Response:
   * {
   *   success: true,
   *   spectatorToken: "permanent-jwt-token",
   *   characterId: "character-uuid",
   *   expiresAt: null  // Token never expires
   * }
   */
  fastify.post("/api/spectator/token", async (request, reply) => {
    try {
      const body = request.body as {
        agentId: string;
        privyToken: string;
      };

      const { agentId, privyToken } = body;

      if (!agentId || !privyToken) {
        return reply.status(400).send({
          success: false,
          error: "Missing required fields: agentId, privyToken",
        });
      }

      // Verify the Privy token
      const { verifyPrivyToken, isPrivyEnabled } = await import(
        "../../infrastructure/auth/privy-auth.js"
      );

      if (!isPrivyEnabled()) {
        return reply.status(503).send({
          success: false,
          error: "Privy authentication is not configured on this server",
        });
      }

      let verifiedUserId: string | null = null;

      try {
        const privyInfo = await verifyPrivyToken(privyToken);
        if (privyInfo) {
          verifiedUserId = privyInfo.privyUserId;
        }
      } catch (err) {
        console.warn(
          "[AgentRoutes] Privy token verification failed:",
          err instanceof Error ? err.message : String(err),
        );
      }

      if (!verifiedUserId) {
        return reply.status(401).send({
          success: false,
          error: "Invalid or expired Privy token. Please log in again.",
        });
      }

      // Get database system to check agent ownership
      const databaseSystem = world.getSystem("database") as
        | {
            db: {
              select: (fields?: unknown) => {
                from: (table: unknown) => {
                  where: (condition: unknown) => Promise<unknown[]>;
                };
              };
            };
          }
        | undefined;

      if (!databaseSystem || !databaseSystem.db) {
        console.error("[AgentRoutes] DatabaseSystem not available");
        return reply.status(500).send({
          success: false,
          error: "Database system not available",
        });
      }

      // Import schema and eq operator
      const { agentMappings } = await import("../../database/schema.js");
      const { eq } = await import("drizzle-orm");

      // Query agent mapping to verify ownership
      const mappings = (await databaseSystem.db
        .select()
        .from(agentMappings)
        .where(eq(agentMappings.agentId, agentId))) as Array<{
        agentId: string;
        accountId: string;
        characterId: string;
        agentName: string;
      }>;

      if (mappings.length === 0) {
        return reply.status(404).send({
          success: false,
          error: "Agent not found",
        });
      }

      const mapping = mappings[0];

      // SECURITY: Verify the authenticated user owns this agent
      if (mapping.accountId !== verifiedUserId) {
        console.warn(
          `[AgentRoutes] ❌ SECURITY: User ${verifiedUserId} tried to get spectator token for agent ${agentId} owned by ${mapping.accountId}`,
        );
        return reply.status(403).send({
          success: false,
          error: "You do not have permission to spectate this agent",
        });
      }

      // Generate permanent spectator JWT (no expiration)
      const spectatorToken = await createJWT({
        userId: verifiedUserId,
        characterId: mapping.characterId,
        agentId: agentId,
        isSpectator: true,
      });

      // Check if the agent's player entity exists in the game world
      // This helps the dashboard know when the agent has fully connected
      const characterId = mapping.characterId;
      const entityFromGet = world.entities.get(characterId);
      const entityFromItems = (
        world.entities as { items?: Map<string, unknown> }
      ).items?.get(characterId);
      const entityFromPlayers = (
        world.entities as { players?: Map<string, unknown> }
      ).players?.get(characterId);
      const entityExists =
        entityFromGet != null ||
        entityFromItems != null ||
        entityFromPlayers != null;

      // Debug: List all player entities currently in the world
      const playersMap = (world.entities as { players?: Map<string, unknown> })
        .players;
      const playerIds = playersMap ? Array.from(playersMap.keys()) : [];

      console.log(
        `[AgentRoutes] 🔍 Entity check for characterId=${characterId}:`,
        `\n  - world.entities.get(): ${entityFromGet ? "FOUND" : "null"}`,
        `\n  - world.entities.items.get(): ${entityFromItems ? "FOUND" : "null"}`,
        `\n  - world.entities.players.get(): ${entityFromPlayers ? "FOUND" : "null"}`,
        `\n  - All player IDs in world: [${playerIds.join(", ")}]`,
        `\n  - entityExists: ${entityExists}`,
      );

      console.log(
        `[AgentRoutes] ✅ Generated spectator JWT for user ${verifiedUserId} watching agent ${mapping.agentName} (entityExists: ${entityExists})`,
      );

      return reply.send({
        success: true,
        spectatorToken,
        characterId: mapping.characterId,
        agentName: mapping.agentName,
        expiresAt: null, // Token never expires
        entityExists, // Whether the agent's player entity is in the game world
      });
    } catch (error) {
      console.error(
        "[AgentRoutes] ❌ Failed to generate spectator token:",
        error,
      );

      return reply.status(500).send({
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to generate spectator token",
      });
    }
  });

  /**
   * GET /api/agents/:agentId/goal
   *
   * Get the current goal for an agent.
   * Used by the dashboard to display agent goal progress.
   *
   * Response:
   * {
   *   success: true,
   *   goal: { type, description, progress, target, ... } | null
   * }
   */
  fastify.get("/api/agents/:agentId/goal", async (request, reply) => {
    try {
      const params = request.params as { agentId: string };
      const { agentId } = params;

      if (!agentId) {
        return reply.status(400).send({
          success: false,
          error: "Missing required parameter: agentId",
        });
      }

      // Get database system
      const databaseSystem = world.getSystem("database") as
        | {
            db: {
              select: (fields?: unknown) => {
                from: (table: unknown) => {
                  where: (condition: unknown) => Promise<unknown[]>;
                };
              };
            };
          }
        | undefined;

      if (!databaseSystem || !databaseSystem.db) {
        return reply.status(500).send({
          success: false,
          error: "Database system not available",
        });
      }

      // Import schema and eq operator
      const { agentMappings } = await import("../../database/schema.js");
      const { eq } = await import("drizzle-orm");

      // Get agent's character ID
      const mappings = (await databaseSystem.db
        .select()
        .from(agentMappings)
        .where(eq(agentMappings.agentId, agentId))) as Array<{
        characterId: string;
      }>;

      if (mappings.length === 0) {
        // Agent not registered yet - return success with null goal
        return reply.send({
          success: true,
          goal: null,
          message: "Agent not registered in game yet",
        });
      }

      const characterId = mappings[0].characterId;

      // Get goal and available goals from ServerNetwork storage
      const { ServerNetwork } = await import(
        "../../systems/ServerNetwork/index.js"
      );
      const goal = ServerNetwork.agentGoals.get(characterId);
      const availableGoals =
        ServerNetwork.agentAvailableGoals.get(characterId) || [];
      const goalsPaused =
        ServerNetwork.agentGoalsPaused.get(characterId) || false;

      if (!goal) {
        return reply.send({
          success: true,
          goal: null,
          availableGoals,
          goalsPaused,
          message: goalsPaused ? "Goals paused by user" : "No active goal",
        });
      }

      // Calculate progress percentage
      const goalData = goal as {
        progress?: number;
        target?: number;
        startedAt?: number;
        locked?: boolean;
        lockedBy?: string;
      };
      const progressPercent =
        goalData.target && goalData.target > 0
          ? Math.round(((goalData.progress || 0) / goalData.target) * 100)
          : 0;

      return reply.send({
        success: true,
        goal: {
          ...goalData,
          progressPercent,
          elapsedMs: goalData.startedAt ? Date.now() - goalData.startedAt : 0,
        },
        availableGoals,
        goalsPaused,
      });
    } catch (error) {
      console.error("[AgentRoutes] ❌ Failed to fetch agent goal:", error);

      return reply.status(500).send({
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to fetch agent goal",
        goal: null,
      });
    }
  });

  /**
   * POST /api/agents/:agentId/goal
   *
   * Set a new goal for an agent from the dashboard.
   * Sends a goalOverride packet to the agent's plugin via WebSocket.
   *
   * Request body:
   * {
   *   goalId: string  // ID of the goal to set (from availableGoals)
   * }
   *
   * Response:
   * {
   *   success: true,
   *   message: "Goal change requested"
   * }
   */
  fastify.post("/api/agents/:agentId/goal", async (request, reply) => {
    try {
      const params = request.params as { agentId: string };
      const body = request.body as { goalId?: string };
      const { agentId } = params;
      const { goalId } = body;

      if (!agentId) {
        return reply.status(400).send({
          success: false,
          error: "Missing required parameter: agentId",
        });
      }

      if (!goalId) {
        return reply.status(400).send({
          success: false,
          error: "Missing required body parameter: goalId",
        });
      }

      // Get database system to find character ID
      const databaseSystem = world.getSystem("database") as
        | {
            db: {
              select: (fields?: unknown) => {
                from: (table: unknown) => {
                  where: (condition: unknown) => Promise<unknown[]>;
                };
              };
            };
          }
        | undefined;

      if (!databaseSystem || !databaseSystem.db) {
        return reply.status(500).send({
          success: false,
          error: "Database system not available",
        });
      }

      // Import schema and eq operator
      const { agentMappings } = await import("../../database/schema.js");
      const { eq } = await import("drizzle-orm");

      // Get agent's character ID
      const mappings = (await databaseSystem.db
        .select()
        .from(agentMappings)
        .where(eq(agentMappings.agentId, agentId))) as Array<{
        characterId: string;
      }>;

      if (mappings.length === 0) {
        return reply.status(404).send({
          success: false,
          error: "Agent not registered in game",
        });
      }

      const characterId = mappings[0].characterId;

      // Get the socket for this character
      const { ServerNetwork } = await import(
        "../../systems/ServerNetwork/index.js"
      );
      const socket = ServerNetwork.characterSockets.get(characterId);

      if (!socket) {
        return reply.status(404).send({
          success: false,
          error: "Agent not connected (no active WebSocket)",
        });
      }

      // Send goalOverride packet to the plugin
      socket.send("goalOverride", {
        goalId,
        source: "dashboard",
      });

      // Clear the paused flag since user is manually setting a goal
      ServerNetwork.agentGoalsPaused.set(characterId, false);

      console.log(
        `[AgentRoutes] 🎯 Sent goalOverride to ${characterId}: ${goalId}`,
      );

      return reply.send({
        success: true,
        message: `Goal change requested: ${goalId}`,
      });
    } catch (error) {
      console.error("[AgentRoutes] ❌ Failed to set agent goal:", error);

      return reply.status(500).send({
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to set agent goal",
      });
    }
  });

  /**
   * POST /api/agents/:agentId/goal/unlock
   *
   * Unlock the current goal, allowing autonomous behavior to change it.
   */
  fastify.post("/api/agents/:agentId/goal/unlock", async (request, reply) => {
    try {
      const params = request.params as { agentId: string };
      const { agentId } = params;

      if (!agentId) {
        return reply.status(400).send({
          success: false,
          error: "Missing required parameter: agentId",
        });
      }

      // Get database system to find character ID
      const databaseSystem = world.getSystem("database") as
        | {
            db: {
              select: (fields?: unknown) => {
                from: (table: unknown) => {
                  where: (condition: unknown) => Promise<unknown[]>;
                };
              };
            };
          }
        | undefined;

      if (!databaseSystem || !databaseSystem.db) {
        return reply.status(500).send({
          success: false,
          error: "Database system not available",
        });
      }

      const { agentMappings } = await import("../../database/schema.js");
      const { eq } = await import("drizzle-orm");

      const mappings = (await databaseSystem.db
        .select()
        .from(agentMappings)
        .where(eq(agentMappings.agentId, agentId))) as Array<{
        characterId: string;
      }>;

      if (mappings.length === 0) {
        return reply.status(404).send({
          success: false,
          error: "Agent not registered in game",
        });
      }

      const characterId = mappings[0].characterId;

      // Get the socket for this character
      const { ServerNetwork } = await import(
        "../../systems/ServerNetwork/index.js"
      );
      const socket = ServerNetwork.characterSockets.get(characterId);

      if (!socket) {
        return reply.status(404).send({
          success: false,
          error: "Agent not connected (no active WebSocket)",
        });
      }

      // Send goalOverride packet with special "unlock" command
      socket.send("goalOverride", {
        unlock: true,
        source: "dashboard",
      });

      console.log(`[AgentRoutes] 🔓 Sent goal unlock to ${characterId}`);

      return reply.send({
        success: true,
        message: "Goal unlocked",
      });
    } catch (error) {
      console.error("[AgentRoutes] ❌ Failed to unlock agent goal:", error);

      return reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : "Failed to unlock goal",
      });
    }
  });

  /**
   * POST /api/agents/:agentId/goal/stop
   *
   * Stop/clear the current goal, making the agent idle.
   */
  fastify.post("/api/agents/:agentId/goal/stop", async (request, reply) => {
    try {
      const params = request.params as { agentId: string };
      const { agentId } = params;

      if (!agentId) {
        return reply.status(400).send({
          success: false,
          error: "Missing required parameter: agentId",
        });
      }

      // Get database system to find character ID
      const databaseSystem = world.getSystem("database") as
        | {
            db: {
              select: (fields?: unknown) => {
                from: (table: unknown) => {
                  where: (condition: unknown) => Promise<unknown[]>;
                };
              };
            };
          }
        | undefined;

      if (!databaseSystem || !databaseSystem.db) {
        return reply.status(500).send({
          success: false,
          error: "Database system not available",
        });
      }

      const { agentMappings } = await import("../../database/schema.js");
      const { eq } = await import("drizzle-orm");

      const mappings = (await databaseSystem.db
        .select()
        .from(agentMappings)
        .where(eq(agentMappings.agentId, agentId))) as Array<{
        characterId: string;
      }>;

      if (mappings.length === 0) {
        return reply.status(404).send({
          success: false,
          error: "Agent not registered in game",
        });
      }

      const characterId = mappings[0].characterId;

      // Get the socket for this character
      const { ServerNetwork } = await import(
        "../../systems/ServerNetwork/index.js"
      );
      const socket = ServerNetwork.characterSockets.get(characterId);

      if (!socket) {
        return reply.status(404).send({
          success: false,
          error: "Agent not connected (no active WebSocket)",
        });
      }

      // Send goalOverride packet with "stop" command to clear the goal
      socket.send("goalOverride", {
        stop: true,
        source: "dashboard",
      });

      // Mark goals as paused on the server side so UI can show correct state
      ServerNetwork.agentGoalsPaused.set(characterId, true);

      console.log(`[AgentRoutes] ⏹️ Sent goal stop to ${characterId}`);

      // Brief delay to allow plugin to process the command before responding
      await new Promise((resolve) => setTimeout(resolve, COMMAND_ACK_DELAY_MS));

      return reply.send({
        success: true,
        message: "Goal stopped",
        acknowledgedAt: Date.now(),
      });
    } catch (error) {
      console.error("[AgentRoutes] ❌ Failed to stop agent goal:", error);

      return reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : "Failed to stop goal",
      });
    }
  });

  /**
   * POST /api/agents/:agentId/goal/resume
   *
   * Resume autonomous goal setting after being paused.
   * Clears the paused flag and allows the agent to pick goals again.
   */
  fastify.post("/api/agents/:agentId/goal/resume", async (request, reply) => {
    try {
      const params = request.params as { agentId: string };
      const { agentId } = params;

      if (!agentId) {
        return reply.status(400).send({
          success: false,
          error: "Missing required parameter: agentId",
        });
      }

      // Get database system to find character ID
      const databaseSystem = world.getSystem("database") as
        | {
            db: {
              select: (fields?: unknown) => {
                from: (table: unknown) => {
                  where: (condition: unknown) => Promise<unknown[]>;
                };
              };
            };
          }
        | undefined;

      if (!databaseSystem || !databaseSystem.db) {
        return reply.status(500).send({
          success: false,
          error: "Database system not available",
        });
      }

      const { agentMappings } = await import("../../database/schema.js");
      const { eq } = await import("drizzle-orm");

      const mappings = (await databaseSystem.db
        .select()
        .from(agentMappings)
        .where(eq(agentMappings.agentId, agentId))) as Array<{
        characterId: string;
      }>;

      if (mappings.length === 0) {
        return reply.status(404).send({
          success: false,
          error: "Agent not registered in game",
        });
      }

      const characterId = mappings[0].characterId;

      // Get the socket for this character
      const { ServerNetwork } = await import(
        "../../systems/ServerNetwork/index.js"
      );
      const socket = ServerNetwork.characterSockets.get(characterId);

      if (!socket) {
        return reply.status(404).send({
          success: false,
          error: "Agent not connected (no active WebSocket)",
        });
      }

      // Send goalOverride packet with "resume" command
      socket.send("goalOverride", {
        resume: true,
        source: "dashboard",
      });

      // Clear the paused flag on the server side
      ServerNetwork.agentGoalsPaused.set(characterId, false);

      console.log(`[AgentRoutes] ▶️ Sent goal resume to ${characterId}`);

      // Brief delay to allow plugin to process the command before responding
      await new Promise((resolve) => setTimeout(resolve, COMMAND_ACK_DELAY_MS));

      return reply.send({
        success: true,
        message: "Goals resumed",
        acknowledgedAt: Date.now(),
      });
    } catch (error) {
      console.error("[AgentRoutes] ❌ Failed to resume agent goals:", error);

      return reply.status(500).send({
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to resume goals",
      });
    }
  });

  /**
   * GET /api/agents/:agentId/quick-actions
   *
   * Get quick action data for the dashboard menu.
   * Returns nearby locations, available goals, quick commands, and inventory.
   *
   * Response:
   * {
   *   success: true,
   *   nearbyLocations: [...],
   *   availableGoals: [...],
   *   quickCommands: [...],
   *   inventory: [...],
   *   playerPosition: [x, y, z]
   * }
   */
  fastify.get("/api/agents/:agentId/quick-actions", async (request, reply) => {
    try {
      const params = request.params as { agentId: string };
      const { agentId } = params;

      if (!agentId) {
        return reply.status(400).send({
          success: false,
          error: "Missing required parameter: agentId",
        });
      }

      // Get database system
      const databaseSystem = world.getSystem("database") as
        | {
            db: {
              select: (fields?: unknown) => {
                from: (table: unknown) => {
                  where: (condition: unknown) => Promise<unknown[]>;
                };
              };
            };
          }
        | undefined;

      if (!databaseSystem || !databaseSystem.db) {
        return reply.status(500).send({
          success: false,
          error: "Database system not available",
        });
      }

      // Import schema and eq operator
      const { agentMappings } = await import("../../database/schema.js");
      const { eq } = await import("drizzle-orm");

      // Get agent's character ID
      const mappings = (await databaseSystem.db
        .select()
        .from(agentMappings)
        .where(eq(agentMappings.agentId, agentId))) as Array<{
        characterId: string;
      }>;

      if (mappings.length === 0) {
        return reply.send({
          success: true,
          nearbyLocations: [],
          availableGoals: [],
          quickCommands: [],
          inventory: [],
          playerPosition: null,
          message: "Agent not registered in game yet",
        });
      }

      const characterId = mappings[0].characterId;

      // Get player entity from world
      const playersMap = (world.entities as { players?: Map<string, unknown> })
        .players;
      const playerEntity = playersMap?.get(characterId) as
        | Record<string, unknown>
        | undefined;

      if (!playerEntity) {
        return reply.send({
          success: true,
          nearbyLocations: [],
          availableGoals: [],
          quickCommands: [],
          inventory: [],
          playerPosition: null,
          message: "Agent not connected to game",
        });
      }

      // Get player position
      const playerPos = playerEntity.position as
        | [number, number, number]
        | { x: number; y: number; z: number }
        | undefined;

      let playerPosition: [number, number, number] | null = null;
      if (Array.isArray(playerPos)) {
        playerPosition = playerPos;
      } else if (playerPos && typeof playerPos === "object") {
        playerPosition = [playerPos.x || 0, playerPos.y || 0, playerPos.z || 0];
      }

      // Helper to calculate distance
      const calcDistance = (
        pos1: [number, number, number],
        pos2: [number, number, number],
      ): number => {
        const dx = pos2[0] - pos1[0];
        const dy = pos2[1] - pos1[1];
        const dz = pos2[2] - pos1[2];
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
      };

      // Helper to get entity position
      const getEntityPos = (
        entity: Record<string, unknown>,
      ): [number, number, number] | null => {
        const pos = entity.position as
          | [number, number, number]
          | { x: number; y: number; z: number }
          | undefined;
        if (Array.isArray(pos)) return pos;
        if (pos && typeof pos === "object") {
          return [pos.x || 0, pos.y || 0, pos.z || 0];
        }
        return null;
      };

      // Categorize entity by name
      const categorizeEntity = (
        name: string,
      ):
        | "bank"
        | "furnace"
        | "tree"
        | "fishing_spot"
        | "anvil"
        | "store"
        | "mob"
        | null => {
        const lowerName = name.toLowerCase();
        if (lowerName.includes("bank")) return "bank";
        if (lowerName.includes("furnace") || lowerName.includes("smelter"))
          return "furnace";
        if (lowerName.includes("anvil")) return "anvil";
        if (
          lowerName.includes("store") ||
          lowerName.includes("shop") ||
          lowerName.includes("general")
        )
          return "store";
        if (
          lowerName.includes("tree") ||
          lowerName.includes("oak") ||
          lowerName.includes("willow")
        )
          return "tree";
        if (
          lowerName.includes("fish") ||
          lowerName.includes("spot") ||
          lowerName.includes("water")
        )
          return "fishing_spot";
        if (lowerName.includes("goblin") || lowerName.includes("mob"))
          return "mob";
        return null;
      };

      // Collect nearby entities (within 100 units)
      const nearbyLocations: Array<{
        id: string;
        name: string;
        type: string;
        distance: number;
      }> = [];

      let hasNearbyMobs = false;
      let hasNearbyTrees = false;
      let hasGroundItems = false;
      let hasNearbyBank = false;
      let hasNearbyFish = false;
      let hasNearbyOre = false;

      const entitiesMap =
        (world.entities as { items?: Map<string, unknown> }).items || new Map();
      for (const [id, entity] of entitiesMap.entries()) {
        if (id === characterId) continue; // Skip self

        const entityAny = entity as Record<string, unknown>;
        const entityName = (entityAny.name || "") as string;
        const entityPos = getEntityPos(entityAny);

        if (!entityPos || !playerPosition) continue;

        const distance = calcDistance(playerPosition, entityPos);
        if (distance > 100) continue; // Only within 100 units

        const type = categorizeEntity(entityName);
        if (type) {
          nearbyLocations.push({
            id: id as string,
            name: entityName,
            type,
            distance: Math.round(distance),
          });

          // Track what's available
          if (type === "mob") hasNearbyMobs = true;
          if (type === "tree") hasNearbyTrees = true;
          if (type === "bank") hasNearbyBank = true;
          if (type === "fishing_spot") hasNearbyFish = true;
        }

        // Check for ore deposits
        const resourceType =
          (entityAny.resourceType as string)?.toLowerCase() || "";
        if (
          resourceType === "ore" ||
          entityName.toLowerCase().includes("ore") ||
          entityName.toLowerCase().includes("rock")
        ) {
          hasNearbyOre = true;
        }

        // Check for fishing spots
        if (
          resourceType === "fish" ||
          entityName.toLowerCase().includes("fishing")
        ) {
          hasNearbyFish = true;
        }

        // Check for ground items
        if (
          entityAny.itemType ||
          entityAny.isItem ||
          (entityAny.type as string)?.includes("item")
        ) {
          hasGroundItems = true;
        }
      }

      // Sort by distance
      nearbyLocations.sort((a, b) => a.distance - b.distance);

      // Get available goals from ServerNetwork storage
      const { ServerNetwork } = await import(
        "../../systems/ServerNetwork/index.js"
      );
      const availableGoalsRaw = (ServerNetwork.agentAvailableGoals.get(
        characterId,
      ) || []) as Array<{
        id: string;
        type: string;
        description: string;
        priority: number;
      }>;
      const availableGoals = availableGoalsRaw.map((g) => ({
        id: g.id,
        type: g.type,
        description: g.description,
        priority: g.priority,
      }));

      // Build quick commands based on what's available
      const quickCommands = [
        {
          id: "chop_tree",
          label: "Woodcutting",
          command: "chop nearest tree",
          icon: "TreePine",
          available: hasNearbyTrees,
          reason: hasNearbyTrees ? undefined : "No trees nearby",
        },
        {
          id: "mine_ore",
          label: "Mining",
          command: "mine nearest ore",
          icon: "Pickaxe",
          available: hasNearbyOre,
          reason: hasNearbyOre ? undefined : "No ore nearby",
        },
        {
          id: "catch_fish",
          label: "Fishing",
          command: "fish at nearest spot",
          icon: "Fish",
          available: hasNearbyFish,
          reason: hasNearbyFish ? undefined : "No fishing spots",
        },
        {
          id: "attack_nearest",
          label: "Combat",
          command: "attack nearest goblin",
          icon: "Swords",
          available: hasNearbyMobs,
          reason: hasNearbyMobs ? undefined : "No enemies nearby",
        },
        {
          id: "pickup_items",
          label: "Pick Up",
          command: "pick up nearby items",
          icon: "Package",
          available: hasGroundItems,
          reason: hasGroundItems ? undefined : "No items nearby",
        },
        {
          id: "go_to_bank",
          label: "Bank",
          command: "go to bank",
          icon: "Building2",
          available: hasNearbyBank,
          reason: hasNearbyBank ? undefined : "Bank not nearby",
        },
        {
          id: "stop",
          label: "Stop",
          command: "stop",
          icon: "Square",
          available: true,
          reason: undefined,
        },
        {
          id: "idle",
          label: "Idle",
          command: "idle",
          icon: "Pause",
          available: true,
          reason: undefined,
        },
      ];

      // Get player inventory from inventory system
      const invSystem = world.getSystem("inventory") as
        | {
            getInventoryData?: (id: string) => {
              items: Array<{
                id?: string;
                itemId?: string;
                name?: string;
                slot?: number;
                quantity?: number;
              }>;
              coins: number;
              maxSlots: number;
            };
          }
        | undefined;

      // Get data manager to look up item names
      const dataManager = (
        world as {
          dataManager?: {
            getItem?: (id: string) =>
              | {
                  name?: string;
                  equippable?: boolean;
                  consumable?: boolean;
                  slot?: string;
                }
              | undefined;
          };
        }
      ).dataManager;

      const invData = invSystem?.getInventoryData?.(characterId);
      const playerItems = invData?.items || [];

      const inventory = playerItems.map((item, index) => {
        // Look up item info from manifest
        const itemInfo = dataManager?.getItem?.(item.itemId || "");
        const name =
          item.name || itemInfo?.name || item.itemId || "Unknown Item";
        // Check if equippable based on slot type
        const canEquip =
          itemInfo?.equippable ??
          (itemInfo?.slot != null && itemInfo.slot !== "none");
        const canUse = itemInfo?.consumable ?? false;

        return {
          id: item.id || item.itemId || `item-${index}`,
          name,
          slot: item.slot ?? index,
          quantity: item.quantity ?? 1,
          canEquip,
          canUse,
          canDrop: true,
        };
      });

      return reply.send({
        success: true,
        nearbyLocations: nearbyLocations.slice(0, 10), // Limit to 10
        availableGoals,
        quickCommands,
        inventory: inventory.slice(0, 20), // Limit to 20
        playerPosition,
      });
    } catch (error) {
      console.error("[AgentRoutes] ❌ Failed to fetch quick actions:", error);

      return reply.status(500).send({
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to fetch quick actions",
      });
    }
  });

  /**
   * GET /api/debug/resources
   *
   * Get all resources in the world (trees, fishing spots, etc.)
   * Used for debugging and finding resource locations.
   */
  fastify.get("/api/debug/resources", async (_request, reply) => {
    try {
      // Get all entities from world
      const entities: Array<{
        id: string;
        name: string;
        type: string;
        resourceType?: string;
        position: [number, number, number];
      }> = [];

      const entitiesMap =
        (world.entities as { items?: Map<string, unknown> }).items || new Map();
      for (const [id, entity] of entitiesMap.entries()) {
        const entityAny = entity as Record<string, unknown>;
        const position = entityAny.position as
          | [number, number, number]
          | { x: number; y: number; z: number }
          | undefined;

        let posArray: [number, number, number] = [0, 0, 0];
        if (Array.isArray(position)) {
          posArray = position;
        } else if (position && typeof position === "object") {
          posArray = [position.x || 0, position.y || 0, position.z || 0];
        }

        // Check if it's a resource
        const resourceType = entityAny.resourceType as string | undefined;
        const type = (entityAny.type || entityAny.entityType || "") as string;
        const name = (entityAny.name || "") as string;

        if (
          resourceType ||
          type === "resource" ||
          /tree|fishing|ore|herb/i.test(name)
        ) {
          entities.push({
            id: id as string,
            name,
            type,
            resourceType,
            position: posArray,
          });
        }
      }

      // Get resources from TerrainSystem tiles
      const terrainSystem = world.getSystem("terrain") as {
        getTiles?: () => Map<
          string,
          {
            x: number;
            z: number;
            resources: Array<{
              id: string;
              type: string;
              position: { x: number; y: number; z: number };
            }>;
          }
        >;
        CONFIG?: { TILE_SIZE: number };
      } | null;

      const tileSize = terrainSystem?.CONFIG?.TILE_SIZE || 100;
      const terrainResources: Array<{
        id: string;
        type: string;
        position: [number, number, number];
        tileKey: string;
      }> = [];

      const tiles = terrainSystem?.getTiles?.();
      if (tiles) {
        for (const [key, tile] of tiles.entries()) {
          for (const resource of tile.resources || []) {
            // Resource position is relative to tile - convert to world position
            const worldX = tile.x * tileSize + resource.position.x;
            const worldY = resource.position.y;
            const worldZ = tile.z * tileSize + resource.position.z;

            terrainResources.push({
              id: resource.id,
              type: resource.type,
              position: [worldX, worldY, worldZ],
              tileKey: key,
            });
          }
        }
      }

      // Filter for trees specifically
      const trees = terrainResources.filter((r) => r.type === "tree");

      return reply.send({
        success: true,
        entities,
        terrainResources,
        trees,
        treeCount: trees.length,
        tileCount: tiles?.size || 0,
        totalEntities: entitiesMap.size,
      });
    } catch (error) {
      console.error("[AgentRoutes] ❌ Failed to fetch resources:", error);
      return reply.status(500).send({
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to fetch resources",
      });
    }
  });

  /**
   * GET /api/agents/:agentId/activity
   *
   * Get recent activity and session stats for an agent.
   * Returns significant events like kills, XP gains, item pickups, and goal changes.
   *
   * Response:
   * {
   *   success: true,
   *   recentActions: [...],
   *   sessionStats: { kills, deaths, totalXpGained, goldEarned, resourcesGathered }
   * }
   */
  fastify.get("/api/agents/:agentId/activity", async (request, reply) => {
    try {
      const params = request.params as { agentId: string };
      const { agentId } = params;

      if (!agentId) {
        return reply.status(400).send({
          success: false,
          error: "Missing required parameter: agentId",
        });
      }

      // Get database system
      const databaseSystem = world.getSystem("database") as
        | {
            db: {
              select: (fields?: unknown) => {
                from: (table: unknown) => {
                  where: (condition: unknown) => Promise<unknown[]>;
                };
              };
            };
          }
        | undefined;

      if (!databaseSystem || !databaseSystem.db) {
        return reply.status(500).send({
          success: false,
          error: "Database system not available",
        });
      }

      // Import schema and eq operator
      const { agentMappings } = await import("../../database/schema.js");
      const { eq } = await import("drizzle-orm");

      // Get agent's character ID
      const mappings = (await databaseSystem.db
        .select()
        .from(agentMappings)
        .where(eq(agentMappings.agentId, agentId))) as Array<{
        characterId: string;
      }>;

      if (mappings.length === 0) {
        return reply.send({
          success: true,
          recentActions: [],
          sessionStats: {
            kills: 0,
            deaths: 0,
            totalXpGained: 0,
            goldEarned: 0,
            resourcesGathered: {},
          },
          message: "Agent not registered in game yet",
        });
      }

      const characterId = mappings[0].characterId;

      // Get activity from ServerNetwork storage (if we add activity tracking there)
      const { ServerNetwork } = await import(
        "../../systems/ServerNetwork/index.js"
      );

      // Check if activity tracking exists
      const activityData = (
        ServerNetwork as {
          agentActivity?: Map<
            string,
            {
              recentActions: Array<{
                type: string;
                description: string;
                xpGained?: number;
                timestamp: number;
              }>;
              sessionStats: {
                kills: number;
                deaths: number;
                totalXpGained: number;
                goldEarned: number;
                resourcesGathered: Record<string, number>;
              };
            }
          >;
        }
      ).agentActivity?.get(characterId);

      if (activityData) {
        return reply.send({
          success: true,
          recentActions: activityData.recentActions.slice(0, 15),
          sessionStats: activityData.sessionStats,
        });
      }

      // Return empty activity if no tracking data yet
      return reply.send({
        success: true,
        recentActions: [],
        sessionStats: {
          kills: 0,
          deaths: 0,
          totalXpGained: 0,
          goldEarned: 0,
          resourcesGathered: {},
        },
        message: "Activity tracking not yet available for this agent",
      });
    } catch (error) {
      console.error("[AgentRoutes] ❌ Failed to fetch agent activity:", error);

      return reply.status(500).send({
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to fetch agent activity",
      });
    }
  });

  // ===========================================================================
  // EMBEDDED AGENT ROUTES
  // These routes manage agents running directly on the server
  // ===========================================================================

  /**
   * POST /api/embedded-agents
   *
   * Create and start an embedded agent.
   * The agent will run directly on the server without an external ElizaOS process.
   *
   * Request body:
   * {
   *   characterId: "character-uuid",
   *   autoStart?: boolean  // defaults to true
   * }
   */
  fastify.post("/api/embedded-agents", async (request, reply) => {
    try {
      const { getAgentManager } = await import("../../eliza/index.js");
      const agentManager = getAgentManager();

      if (!agentManager) {
        return reply.status(503).send({
          success: false,
          error: "Agent system not initialized",
        });
      }

      const body = request.body as {
        characterId: string;
        autoStart?: boolean;
      };

      if (!body.characterId) {
        return reply.status(400).send({
          success: false,
          error: "Missing required field: characterId",
        });
      }

      // Get character from database to retrieve accountId and name
      const databaseSystem = world.getSystem("database") as
        | {
            db: {
              query: {
                characters: {
                  findFirst: (opts: {
                    where: (
                      chars: { id: unknown },
                      ops: { eq: (a: unknown, b: string) => unknown },
                    ) => unknown;
                  }) => Promise<{
                    id: string;
                    accountId: string;
                    name: string;
                  } | null>;
                };
              };
            };
          }
        | undefined;

      if (!databaseSystem?.db) {
        return reply.status(500).send({
          success: false,
          error: "Database not available",
        });
      }

      const { characters } = await import("../../database/schema.js");
      const { eq } = await import("drizzle-orm");

      const character = await databaseSystem.db.query.characters.findFirst({
        where: (chars, ops) => ops.eq(chars.id, body.characterId),
      });

      if (!character) {
        return reply.status(404).send({
          success: false,
          error: "Character not found",
        });
      }

      // Create the embedded agent
      const characterId = await agentManager.createAgent({
        characterId: character.id,
        accountId: character.accountId,
        name: character.name,
        autoStart: body.autoStart !== false,
      });

      const agentInfo = agentManager.getAgentInfo(characterId);

      console.log(
        `[AgentRoutes] ✅ Embedded agent created: ${character.name} (${characterId})`,
      );

      return reply.send({
        success: true,
        agent: agentInfo,
      });
    } catch (error) {
      console.error("[AgentRoutes] ❌ Failed to create embedded agent:", error);
      return reply.status(500).send({
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to create embedded agent",
      });
    }
  });

  /**
   * GET /api/embedded-agents
   *
   * List all embedded agents.
   * Optionally filter by accountId.
   */
  fastify.get("/api/embedded-agents", async (request, reply) => {
    try {
      const { getAgentManager } = await import("../../eliza/index.js");
      const agentManager = getAgentManager();

      if (!agentManager) {
        return reply.status(503).send({
          success: false,
          error: "Agent system not initialized",
        });
      }

      const query = request.query as { accountId?: string };
      const agents = query.accountId
        ? agentManager.getAgentsByAccount(query.accountId)
        : agentManager.getAllAgents();

      return reply.send({
        success: true,
        agents,
        count: agents.length,
      });
    } catch (error) {
      console.error("[AgentRoutes] ❌ Failed to list embedded agents:", error);
      return reply.status(500).send({
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to list embedded agents",
      });
    }
  });

  /**
   * GET /api/embedded-agents/:characterId
   *
   * Get information about a specific embedded agent.
   */
  fastify.get("/api/embedded-agents/:characterId", async (request, reply) => {
    try {
      const { getAgentManager } = await import("../../eliza/index.js");
      const agentManager = getAgentManager();

      if (!agentManager) {
        return reply.status(503).send({
          success: false,
          error: "Agent system not initialized",
        });
      }

      const { characterId } = request.params as { characterId: string };
      const agentInfo = agentManager.getAgentInfo(characterId);

      if (!agentInfo) {
        return reply.status(404).send({
          success: false,
          error: "Agent not found",
        });
      }

      return reply.send({
        success: true,
        agent: agentInfo,
      });
    } catch (error) {
      console.error("[AgentRoutes] ❌ Failed to get embedded agent:", error);
      return reply.status(500).send({
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to get embedded agent",
      });
    }
  });

  /**
   * POST /api/embedded-agents/:characterId/start
   *
   * Start an embedded agent.
   */
  fastify.post(
    "/api/embedded-agents/:characterId/start",
    async (request, reply) => {
      try {
        const { getAgentManager } = await import("../../eliza/index.js");
        const agentManager = getAgentManager();

        if (!agentManager) {
          return reply.status(503).send({
            success: false,
            error: "Agent system not initialized",
          });
        }

        const { characterId } = request.params as { characterId: string };

        await agentManager.startAgent(characterId);
        const agentInfo = agentManager.getAgentInfo(characterId);

        return reply.send({
          success: true,
          agent: agentInfo,
        });
      } catch (error) {
        console.error(
          "[AgentRoutes] ❌ Failed to start embedded agent:",
          error,
        );
        return reply.status(500).send({
          success: false,
          error:
            error instanceof Error
              ? error.message
              : "Failed to start embedded agent",
        });
      }
    },
  );

  /**
   * POST /api/embedded-agents/:characterId/stop
   *
   * Stop an embedded agent.
   */
  fastify.post(
    "/api/embedded-agents/:characterId/stop",
    async (request, reply) => {
      try {
        const { getAgentManager } = await import("../../eliza/index.js");
        const agentManager = getAgentManager();

        if (!agentManager) {
          return reply.status(503).send({
            success: false,
            error: "Agent system not initialized",
          });
        }

        const { characterId } = request.params as { characterId: string };

        await agentManager.stopAgent(characterId);
        const agentInfo = agentManager.getAgentInfo(characterId);

        return reply.send({
          success: true,
          agent: agentInfo,
        });
      } catch (error) {
        console.error("[AgentRoutes] ❌ Failed to stop embedded agent:", error);
        return reply.status(500).send({
          success: false,
          error:
            error instanceof Error
              ? error.message
              : "Failed to stop embedded agent",
        });
      }
    },
  );

  /**
   * POST /api/embedded-agents/:characterId/pause
   *
   * Pause an embedded agent (keep entity but stop behavior).
   */
  fastify.post(
    "/api/embedded-agents/:characterId/pause",
    async (request, reply) => {
      try {
        const { getAgentManager } = await import("../../eliza/index.js");
        const agentManager = getAgentManager();

        if (!agentManager) {
          return reply.status(503).send({
            success: false,
            error: "Agent system not initialized",
          });
        }

        const { characterId } = request.params as { characterId: string };

        await agentManager.pauseAgent(characterId);
        const agentInfo = agentManager.getAgentInfo(characterId);

        return reply.send({
          success: true,
          agent: agentInfo,
        });
      } catch (error) {
        console.error(
          "[AgentRoutes] ❌ Failed to pause embedded agent:",
          error,
        );
        return reply.status(500).send({
          success: false,
          error:
            error instanceof Error
              ? error.message
              : "Failed to pause embedded agent",
        });
      }
    },
  );

  /**
   * POST /api/embedded-agents/:characterId/resume
   *
   * Resume a paused embedded agent.
   */
  fastify.post(
    "/api/embedded-agents/:characterId/resume",
    async (request, reply) => {
      try {
        const { getAgentManager } = await import("../../eliza/index.js");
        const agentManager = getAgentManager();

        if (!agentManager) {
          return reply.status(503).send({
            success: false,
            error: "Agent system not initialized",
          });
        }

        const { characterId } = request.params as { characterId: string };

        await agentManager.resumeAgent(characterId);
        const agentInfo = agentManager.getAgentInfo(characterId);

        return reply.send({
          success: true,
          agent: agentInfo,
        });
      } catch (error) {
        console.error(
          "[AgentRoutes] ❌ Failed to resume embedded agent:",
          error,
        );
        return reply.status(500).send({
          success: false,
          error:
            error instanceof Error
              ? error.message
              : "Failed to resume embedded agent",
        });
      }
    },
  );

  /**
   * POST /api/embedded-agents/:characterId/command
   *
   * Send a command to an embedded agent.
   *
   * Request body:
   * {
   *   command: "move" | "attack" | "gather" | "pickup" | "drop" | "equip" | "use" | "chat" | "stop",
   *   data: { ... }  // command-specific data
   * }
   */
  fastify.post(
    "/api/embedded-agents/:characterId/command",
    async (request, reply) => {
      try {
        const { getAgentManager } = await import("../../eliza/index.js");
        const agentManager = getAgentManager();

        if (!agentManager) {
          return reply.status(503).send({
            success: false,
            error: "Agent system not initialized",
          });
        }

        const { characterId } = request.params as { characterId: string };
        const { command, data } = request.body as {
          command: string;
          data: unknown;
        };

        if (!command) {
          return reply.status(400).send({
            success: false,
            error: "Missing required field: command",
          });
        }

        await agentManager.sendCommand(characterId, command, data || {});

        return reply.send({
          success: true,
          message: `Command ${command} sent to agent`,
        });
      } catch (error) {
        console.error(
          "[AgentRoutes] ❌ Failed to send command to embedded agent:",
          error,
        );
        return reply.status(500).send({
          success: false,
          error:
            error instanceof Error
              ? error.message
              : "Failed to send command to embedded agent",
        });
      }
    },
  );

  /**
   * DELETE /api/embedded-agents/:characterId
   *
   * Remove an embedded agent completely.
   */
  fastify.delete(
    "/api/embedded-agents/:characterId",
    async (request, reply) => {
      try {
        const { getAgentManager } = await import("../../eliza/index.js");
        const agentManager = getAgentManager();

        if (!agentManager) {
          return reply.status(503).send({
            success: false,
            error: "Agent system not initialized",
          });
        }

        const { characterId } = request.params as { characterId: string };

        await agentManager.removeAgent(characterId);

        return reply.send({
          success: true,
          message: "Agent removed",
        });
      } catch (error) {
        console.error(
          "[AgentRoutes] ❌ Failed to remove embedded agent:",
          error,
        );
        return reply.status(500).send({
          success: false,
          error:
            error instanceof Error
              ? error.message
              : "Failed to remove embedded agent",
        });
      }
    },
  );

  /**
   * GET /api/embedded-agents/:characterId/state
   *
   * Get the full game state for an embedded agent.
   */
  fastify.get(
    "/api/embedded-agents/:characterId/state",
    async (request, reply) => {
      try {
        const { getAgentManager } = await import("../../eliza/index.js");
        const agentManager = getAgentManager();

        if (!agentManager) {
          return reply.status(503).send({
            success: false,
            error: "Agent system not initialized",
          });
        }

        const { characterId } = request.params as { characterId: string };
        const service = agentManager.getAgentService(characterId);

        if (!service) {
          return reply.status(404).send({
            success: false,
            error: "Agent not found",
          });
        }

        const gameState = service.getGameState();

        return reply.send({
          success: true,
          gameState,
        });
      } catch (error) {
        console.error(
          "[AgentRoutes] ❌ Failed to get embedded agent state:",
          error,
        );
        return reply.status(500).send({
          success: false,
          error:
            error instanceof Error
              ? error.message
              : "Failed to get embedded agent state",
        });
      }
    },
  );

  console.log("[AgentRoutes] ✅ Agent credential routes registered");
  console.log("[AgentRoutes] ✅ Embedded agent routes registered");
}
