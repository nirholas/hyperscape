/**
 * Player Routes Module - Player management endpoints
 *
 * Handles player-related HTTP endpoints including disconnect beacons
 * sent by clients during unload/beforeunload events.
 *
 * Endpoints:
 * - POST /api/player/disconnect - Disconnect player (beacon endpoint)
 *
 * Usage:
 * ```typescript
 * import { registerPlayerRoutes } from './routes/player-routes';
 * registerPlayerRoutes(fastify, world);
 * ```
 */

import type { FastifyInstance } from "fastify";
import type { World } from "@hyperscape/shared";

/**
 * Register player management endpoints
 *
 * Sets up endpoints for player lifecycle management.
 * Currently focused on disconnect handling via navigator.sendBeacon.
 *
 * @param fastify - Fastify server instance
 * @param world - Game world instance
 */
export function registerPlayerRoutes(
  fastify: FastifyInstance,
  world: World,
): void {
  // Minimal player disconnect endpoint for client beacons
  fastify.post("/api/player/disconnect", async (req, reply) => {
    try {
      const body = req.body as {
        playerId?: string;
        sessionId?: string;
        reason?: string;
      };

      fastify.log.info({ body }, "[API] player/disconnect");

      // Validate world and network exist
      if (!world?.network) {
        fastify.log.warn(
          "[API] player/disconnect - world.network not available",
        );
        return reply.send({ ok: true }); // Still return success to avoid client retries
      }

      const network =
        world.network as unknown as import("../../shared/types/index.js").ServerNetworkWithSockets;

      // Validate network has sockets map
      if (!network?.sockets || !body?.playerId) {
        fastify.log.warn(
          { hasSockets: !!network?.sockets, hasPlayerId: !!body?.playerId },
          "[API] player/disconnect - missing network.sockets or playerId",
        );
        return reply.send({ ok: true });
      }

      const socket = network.sockets.get(body.playerId);

      if (socket) {
        try {
          socket.close?.();
        } catch (error) {
          fastify.log.error(
            { error, playerId: body.playerId },
            "[API] player/disconnect - error closing socket",
          );
        }
      } else {
        fastify.log.debug(
          { playerId: body.playerId },
          "[API] player/disconnect - socket not found (may have already disconnected)",
        );
      }

      return reply.send({ ok: true });
    } catch (error) {
      fastify.log.error(
        { error, body: req.body },
        "[API] player/disconnect - unexpected error",
      );
      // Still return success to prevent client retries
      return reply.send({ ok: true });
    }
  });
}
