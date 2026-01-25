import React from "react";
import { useDragStore } from "../stores/dragStore";
import { useTheme } from "../stores/themeStore";

/**
 * Overlay component that renders a ghost element during drag operations
 *
 * @example
 * ```tsx
 * function App() {
 *   return (
 *     <DragProvider>
 *       <Windows />
 *       <DragOverlay />
 *     </DragProvider>
 *   );
 * }
 * ```
 */
export function DragOverlay(): React.ReactElement | null {
  const theme = useTheme();
  const isDragging = useDragStore((s) => s.isDragging);
  const item = useDragStore((s) => s.item);
  const current = useDragStore((s) => s.current);

  if (!isDragging || !item) {
    return null;
  }

  const overlayStyle: React.CSSProperties = {
    position: "fixed",
    left: current.x,
    top: current.y,
    transform: "translate(-50%, -50%)",
    pointerEvents: "none",
    zIndex: theme.zIndex.tooltip,
  };

  // Render different overlays based on drag type
  if (item.type === "tab") {
    return (
      <div style={overlayStyle}>
        <div
          style={{
            padding: `${theme.spacing.xs}px ${theme.spacing.sm}px`,
            backgroundColor: theme.colors.background.secondary,
            border: `1px solid ${theme.colors.accent.primary}`,
            borderRadius: theme.borderRadius.sm,
            color: theme.colors.text.primary,
            fontSize: theme.typography.fontSize.sm,
            boxShadow: theme.shadows.md,
          }}
        >
          {typeof item.data === "object" && item.data && "label" in item.data
            ? String((item.data as { label: string }).label)
            : "Tab"}
        </div>
      </div>
    );
  }

  // Windows now move in real-time, so no thumbnail overlay needed
  if (item.type === "window") {
    return null;
  }

  // Default overlay
  return (
    <div style={overlayStyle}>
      <div
        style={{
          width: 24,
          height: 24,
          backgroundColor: theme.colors.accent.primary,
          borderRadius: "50%",
          boxShadow: theme.shadows.sm,
        }}
      />
    </div>
  );
}
