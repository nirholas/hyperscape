/**
 * Chat Handler
 *
 * Handles chat message broadcasting to all connected clients
 */

import type { ServerSocket, ChatMessage } from "../../../shared/types";
import type { World } from "@hyperscape/shared";

export function handleChatAdded(
  socket: ServerSocket,
  data: unknown,
  world: World,
  sendFn: (name: string, data: unknown, ignoreSocketId?: string) => void,
): void {
  const msg = data as ChatMessage;

  // Ensure message has a type (default to "chat" for player messages)
  if (!msg.type) {
    msg.type = "chat";
  }

  // Add message to chat if method exists
  if (world.chat.add) {
    world.chat.add(msg, false);
  }
  sendFn("chatAdded", msg, socket.id);
}
