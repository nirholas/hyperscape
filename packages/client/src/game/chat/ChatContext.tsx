import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
} from "react";

interface ChatContextType {
  collapsed: boolean;
  setCollapsed: (collapsed: boolean) => void;
  active: boolean;
  setActive: (active: boolean) => void;
  hasOpenWindows: boolean;
  setHasOpenWindows: (hasOpenWindows: boolean) => void;
}

const ChatContext = createContext<ChatContextType | undefined>(undefined);

export function ChatProvider({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(true);
  const [active, setActive] = useState(false);
  const [hasOpenWindows, setHasOpenWindows] = useState(false);

  // Listen for postMessage from parent (dashboard iframe)
  // SECURITY: Validate origin to prevent XSS attacks via malicious postMessage
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      // Validate origin - only accept messages from same origin or known parent origins
      // In production, this should be restricted to specific trusted domains
      const trustedOrigins = [
        window.location.origin, // Same origin
        // Add other trusted origins here if needed (e.g., dashboard domain)
      ];

      // Allow same-origin messages (null origin from file:// or data: URLs)
      const isSameOrigin =
        event.origin === window.location.origin || event.origin === "null";

      // Check if origin is trusted
      const isTrusted = isSameOrigin || trustedOrigins.includes(event.origin);

      if (!isTrusted) {
        console.warn(
          "[ChatContext] Ignoring postMessage from untrusted origin:",
          event.origin,
        );
        return;
      }

      if (event.data?.type === "OPEN_CHAT") {
        setCollapsed(false);
        setActive(true);
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  return (
    <ChatContext.Provider
      value={{
        collapsed,
        setCollapsed,
        active,
        setActive,
        hasOpenWindows,
        setHasOpenWindows,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
}

export function useChatContext() {
  const context = useContext(ChatContext);
  if (!context) {
    throw new Error("useChatContext must be used within ChatProvider");
  }
  return context;
}
