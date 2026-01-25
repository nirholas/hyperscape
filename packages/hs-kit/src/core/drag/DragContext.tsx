import React, {
  createContext,
  useContext,
  useEffect,
  type ReactNode,
} from "react";
import { useDragStore } from "../../stores/dragStore";
import { dropTargetRegistry } from "./utils";

/** Drag context value */
interface DragContextValue {
  /** Whether a drag is currently in progress */
  isDragging: boolean;
}

const DragContextInternal = createContext<DragContextValue | null>(null);

/** Props for DragProvider */
interface DragProviderProps {
  children: ReactNode;
}

/**
 * Provider component for the drag-drop system
 *
 * Wrap your app (or the part that uses drag-drop) with this provider.
 * It handles cleanup and provides context for drag state.
 *
 * @example
 * ```tsx
 * function App() {
 *   return (
 *     <DragProvider>
 *       <YourWindows />
 *       <DragOverlay />
 *     </DragProvider>
 *   );
 * }
 * ```
 */
export function DragProvider({
  children,
}: DragProviderProps): React.ReactElement {
  const isDragging = useDragStore((s) => s.isDragging);
  const reset = useDragStore((s) => s.reset);

  // Reset drag state on unmount
  useEffect(() => {
    return () => {
      reset();
      dropTargetRegistry.clear();
    };
  }, [reset]);

  // Handle escape key to cancel drag
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isDragging) {
        reset();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isDragging, reset]);

  // Prevent text selection during drag
  useEffect(() => {
    if (isDragging) {
      document.body.style.userSelect = "none";
      document.body.style.cursor = "grabbing";
    } else {
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    }

    return () => {
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
  }, [isDragging]);

  const value: DragContextValue = {
    isDragging,
  };

  // React 19: Context can be used directly as a provider
  return <DragContextInternal value={value}>{children}</DragContextInternal>;
}

/**
 * Hook to access drag context
 *
 * Must be used within a DragProvider
 */
export function useDragContext(): DragContextValue {
  const context = useContext(DragContextInternal);
  if (!context) {
    throw new Error("useDragContext must be used within a DragProvider");
  }
  return context;
}

/** Alias for DragProvider for backwards compatibility */
export const DragContext = DragProvider;
