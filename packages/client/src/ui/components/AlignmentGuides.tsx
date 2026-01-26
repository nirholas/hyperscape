import React from "react";
import { useTheme } from "../stores/themeStore";
import type { AlignmentGuidesProps } from "../types";

/**
 * Visual alignment guides shown during window dragging
 *
 * @example
 * ```tsx
 * function WindowDragHandler({ windowId }: { windowId: string }) {
 *   const { windows } = useWindowManager();
 *   const [guides, setGuides] = useState<AlignmentGuide[]>([]);
 *
 *   // Update guides during drag...
 *
 *   return <AlignmentGuides guides={guides} />;
 * }
 * ```
 */
export function AlignmentGuides({
  guides,
  className,
  style,
}: AlignmentGuidesProps): React.ReactElement | null {
  const theme = useTheme();

  if (guides.length === 0) {
    return null;
  }

  const containerStyle: React.CSSProperties = {
    position: "fixed",
    inset: 0,
    pointerEvents: "none",
    zIndex: theme.zIndex.overlay - 1,
    ...style,
  };

  return (
    <div className={className} style={containerStyle}>
      {guides.map((guide, index) => {
        const isVertical =
          guide.edge === "left" ||
          guide.edge === "right" ||
          guide.edge === "centerX";
        const isCenter = guide.type === "center";
        const isViewport = guide.targetWindowId === "viewport";

        // Use different colors for different types:
        // - Viewport center: accent/gold
        // - Window center alignment: cyan
        // - Edge alignment: green
        const guideColor = isViewport
          ? theme.colors.accent.primary
          : isCenter
            ? "#00bcd4" // Cyan for center alignment
            : "#4CAF50"; // Green for edge alignment

        const lineStyle: React.CSSProperties = isVertical
          ? {
              position: "absolute",
              left: guide.position,
              top: 0,
              width: 2,
              height: "100%",
              backgroundColor: guideColor,
              boxShadow: `0 0 8px ${guideColor}, 0 0 16px ${guideColor}40`,
              opacity: 0.9,
            }
          : {
              position: "absolute",
              left: 0,
              top: guide.position,
              width: "100%",
              height: 2,
              backgroundColor: guideColor,
              boxShadow: `0 0 8px ${guideColor}, 0 0 16px ${guideColor}40`,
              opacity: 0.9,
            };

        return (
          <div
            key={`${guide.edge}-${guide.position}-${index}`}
            style={lineStyle}
          />
        );
      })}
    </div>
  );
}
