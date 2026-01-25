import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useChatState } from "../../src/core/chat/useChatState";

describe("useChatState", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("initialization", () => {
    it("should initialize with empty messages by default", () => {
      const { result } = renderHook(() => useChatState());
      expect(result.current.messages).toEqual([]);
      expect(result.current.messageCount).toBe(0);
    });

    it("should initialize with provided initial messages", () => {
      const initialMessages = [
        {
          id: "1",
          type: "player" as const,
          username: "Player1",
          role: "default" as const,
          content: "Hello",
          timestamp: Date.now(),
          hasLinks: false,
          hasEmojis: false,
        },
      ];

      const { result } = renderHook(() => useChatState({ initialMessages }));

      expect(result.current.messages).toEqual(initialMessages);
      expect(result.current.messageCount).toBe(1);
    });

    it("should start with no filter (show all)", () => {
      const { result } = renderHook(() => useChatState());
      expect(result.current.filter).toBeNull();
    });
  });

  describe("addMessage", () => {
    it("should add a new message", () => {
      const { result } = renderHook(() => useChatState());

      act(() => {
        result.current.addMessage({
          type: "player",
          username: "Player1",
          role: "default",
          content: "Hello world",
        });
      });

      expect(result.current.messages).toHaveLength(1);
      expect(result.current.messages[0].content).toBe("Hello world");
      expect(result.current.messages[0].username).toBe("Player1");
      expect(result.current.messages[0].type).toBe("player");
    });

    it("should generate unique IDs for messages", () => {
      const { result } = renderHook(() => useChatState());

      act(() => {
        result.current.addMessage({
          type: "player",
          username: "Player1",
          role: "default",
          content: "Message 1",
        });
        result.current.addMessage({
          type: "player",
          username: "Player1",
          role: "default",
          content: "Message 2",
        });
      });

      expect(result.current.messages[0].id).not.toBe(
        result.current.messages[1].id,
      );
    });

    it("should detect links in content", () => {
      const { result } = renderHook(() => useChatState());

      act(() => {
        result.current.addMessage({
          type: "player",
          username: "Player1",
          role: "default",
          content: "Check out https://example.com",
        });
      });

      expect(result.current.messages[0].hasLinks).toBe(true);
    });

    it("should detect emojis in content", () => {
      const { result } = renderHook(() => useChatState());

      act(() => {
        result.current.addMessage({
          type: "player",
          username: "Player1",
          role: "default",
          content: "Hello! \u{1F600}",
        });
      });

      expect(result.current.messages[0].hasEmojis).toBe(true);
    });

    it("should call onMessage callback when message is added", () => {
      const onMessage = vi.fn();
      const { result } = renderHook(() => useChatState({ onMessage }));

      act(() => {
        result.current.addMessage({
          type: "player",
          username: "Player1",
          role: "default",
          content: "Hello",
        });
      });

      expect(onMessage).toHaveBeenCalledTimes(1);
      expect(onMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          content: "Hello",
          username: "Player1",
        }),
      );
    });

    it("should respect maxMessages limit", () => {
      const { result } = renderHook(() => useChatState({ maxMessages: 3 }));

      act(() => {
        for (let i = 0; i < 5; i++) {
          result.current.addMessage({
            type: "player",
            username: "Player1",
            role: "default",
            content: `Message ${i}`,
          });
        }
      });

      expect(result.current.messages).toHaveLength(3);
      expect(result.current.messages[0].content).toBe("Message 2");
      expect(result.current.messages[2].content).toBe("Message 4");
    });
  });

  describe("addSystemMessage", () => {
    it("should add a system message", () => {
      const { result } = renderHook(() => useChatState());

      act(() => {
        result.current.addSystemMessage("Server is restarting...");
      });

      expect(result.current.messages).toHaveLength(1);
      expect(result.current.messages[0].type).toBe("system");
      expect(result.current.messages[0].content).toBe(
        "Server is restarting...",
      );
      expect(result.current.messages[0].username).toBe("");
    });
  });

  describe("clearMessages", () => {
    it("should clear all messages", () => {
      const { result } = renderHook(() => useChatState());

      act(() => {
        result.current.addMessage({
          type: "player",
          username: "Player1",
          role: "default",
          content: "Hello",
        });
        result.current.addMessage({
          type: "guild",
          username: "Player2",
          role: "default",
          content: "Hi",
        });
      });

      expect(result.current.messages).toHaveLength(2);

      act(() => {
        result.current.clearMessages();
      });

      expect(result.current.messages).toHaveLength(0);
    });
  });

  describe("clearMessagesByType", () => {
    it("should clear messages of a specific type", () => {
      const { result } = renderHook(() => useChatState());

      act(() => {
        result.current.addMessage({
          type: "player",
          username: "Player1",
          role: "default",
          content: "Hello",
        });
        result.current.addMessage({
          type: "guild",
          username: "Player2",
          role: "default",
          content: "Guild message",
        });
        result.current.addMessage({
          type: "player",
          username: "Player3",
          role: "default",
          content: "Another player message",
        });
      });

      act(() => {
        result.current.clearMessagesByType("player");
      });

      expect(result.current.messages).toHaveLength(1);
      expect(result.current.messages[0].type).toBe("guild");
    });
  });

  describe("filter", () => {
    it("should filter messages by type", () => {
      const { result } = renderHook(() => useChatState());

      act(() => {
        result.current.addMessage({
          type: "player",
          username: "Player1",
          role: "default",
          content: "Player message",
        });
        result.current.addMessage({
          type: "guild",
          username: "Player2",
          role: "default",
          content: "Guild message",
        });
        result.current.addMessage({
          type: "trade",
          username: "Player3",
          role: "default",
          content: "Trade message",
        });
      });

      act(() => {
        result.current.setFilter("guild");
      });

      expect(result.current.filteredMessages).toHaveLength(1);
      expect(result.current.filteredMessages[0].type).toBe("guild");
    });

    it("should show all messages when filter is null", () => {
      const { result } = renderHook(() => useChatState());

      act(() => {
        result.current.addMessage({
          type: "player",
          username: "Player1",
          role: "default",
          content: "Player message",
        });
        result.current.addMessage({
          type: "guild",
          username: "Player2",
          role: "default",
          content: "Guild message",
        });
      });

      act(() => {
        result.current.setFilter("guild");
      });

      expect(result.current.filteredMessages).toHaveLength(1);

      act(() => {
        result.current.setFilter(null);
      });

      expect(result.current.filteredMessages).toHaveLength(2);
    });
  });

  describe("getMessagesByType", () => {
    it("should return messages of a specific type", () => {
      const { result } = renderHook(() => useChatState());

      act(() => {
        result.current.addMessage({
          type: "player",
          username: "Player1",
          role: "default",
          content: "Player 1",
        });
        result.current.addMessage({
          type: "guild",
          username: "Player2",
          role: "default",
          content: "Guild",
        });
        result.current.addMessage({
          type: "player",
          username: "Player3",
          role: "default",
          content: "Player 2",
        });
      });

      const playerMessages = result.current.getMessagesByType("player");
      expect(playerMessages).toHaveLength(2);
      expect(playerMessages[0].content).toBe("Player 1");
      expect(playerMessages[1].content).toBe("Player 2");
    });
  });

  describe("unread counts", () => {
    it("should track unread messages per channel", async () => {
      const { result } = renderHook(() => useChatState());

      // Mark all as read initially
      act(() => {
        result.current.markAllAsRead();
      });

      // Wait a tiny bit to ensure timestamp difference
      await new Promise((resolve) => setTimeout(resolve, 10));

      act(() => {
        result.current.addMessage({
          type: "guild",
          username: "Player1",
          role: "default",
          content: "Guild message 1",
        });
        result.current.addMessage({
          type: "guild",
          username: "Player2",
          role: "default",
          content: "Guild message 2",
        });
        result.current.addMessage({
          type: "trade",
          username: "Player3",
          role: "default",
          content: "Trade message",
        });
      });

      expect(result.current.unreadCounts.guild).toBe(2);
      expect(result.current.unreadCounts.trade).toBe(1);
      expect(result.current.unreadCounts.player).toBe(0);
    });

    it("should mark channel as read", async () => {
      const { result } = renderHook(() => useChatState());

      act(() => {
        result.current.markAllAsRead();
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      act(() => {
        result.current.addMessage({
          type: "guild",
          username: "Player1",
          role: "default",
          content: "Guild message",
        });
      });

      expect(result.current.unreadCounts.guild).toBe(1);

      act(() => {
        result.current.markAsRead("guild");
      });

      expect(result.current.unreadCounts.guild).toBe(0);
    });

    it("should mark all channels as read", async () => {
      const { result } = renderHook(() => useChatState());

      act(() => {
        result.current.markAllAsRead();
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      act(() => {
        result.current.addMessage({
          type: "guild",
          username: "Player1",
          role: "default",
          content: "Guild message",
        });
        result.current.addMessage({
          type: "trade",
          username: "Player2",
          role: "default",
          content: "Trade message",
        });
      });

      expect(result.current.unreadCounts.guild).toBe(1);
      expect(result.current.unreadCounts.trade).toBe(1);

      act(() => {
        result.current.markAllAsRead();
      });

      expect(result.current.unreadCounts.guild).toBe(0);
      expect(result.current.unreadCounts.trade).toBe(0);
    });
  });
});
