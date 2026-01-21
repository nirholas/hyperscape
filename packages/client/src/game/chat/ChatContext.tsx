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
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
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
