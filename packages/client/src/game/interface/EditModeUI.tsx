/**
 * Edit Mode UI
 *
 * Components for edit mode functionality including:
 * - EditModeOverlay with action bar creation
 * - Hold-to-edit lock indicator
 *
 * @packageDocumentation
 */

import React, { useCallback } from "react";
import { EditModeOverlay, type WindowConfig, type WindowState } from "@/ui";
import { snapToGrid, MAX_ACTION_BARS } from "./types";
import { getResponsivePanelSizing } from "./DefaultLayoutFactory";

/** Props for EditModeOverlayManager */
interface EditModeOverlayManagerProps {
  /** All window configurations */
  windows: WindowState[];
  /** Whether multiple action bars feature is enabled */
  multipleActionBarsEnabled: boolean;
  /** Function to create a new window */
  createWindow: (config?: WindowConfig) => WindowState;
}

/**
 * Manages the edit mode overlay with action bar creation
 */
export function EditModeOverlayManager({
  windows,
  multipleActionBarsEnabled,
  createWindow,
}: EditModeOverlayManagerProps): React.ReactElement {
  const actionBarCount = windows.filter(
    (w) => w.id?.startsWith("actionbar-") && w.id?.endsWith("-window"),
  ).length;

  const handleAddActionBar = useCallback(() => {
    const existingIds = new Set(
      windows.filter((w) => w.id?.startsWith("actionbar-")).map((w) => w.id!),
    );

    let nextId = 0;
    while (
      existingIds.has(`actionbar-${nextId}-window`) &&
      nextId < MAX_ACTION_BARS
    ) {
      nextId++;
    }

    if (nextId < MAX_ACTION_BARS) {
      const viewport =
        typeof window !== "undefined"
          ? { width: window.innerWidth, height: window.innerHeight }
          : { width: 1920, height: 1080 };

      const actionbarSizing = getResponsivePanelSizing("actionbar", viewport);

      createWindow({
        id: `actionbar-${nextId}-window`,
        position: {
          x: snapToGrid(100 + nextId * 50),
          y: snapToGrid(
            viewport.height - actionbarSizing.size.height - 10 - nextId * 60,
          ),
        },
        size: actionbarSizing.size,
        minSize: actionbarSizing.minSize,
        maxSize: actionbarSizing.maxSize,
        tabs: [
          {
            id: `actionbar-${nextId}`,
            label: `Action Bar ${nextId + 1}`,
            content: `actionbar-${nextId}`,
            closeable: false,
            icon: "⚡",
          },
        ],
        transparency: 0,
      });
    }
  }, [windows, createWindow]);

  return (
    <EditModeOverlay
      actionBarCount={actionBarCount}
      maxActionBars={MAX_ACTION_BARS}
      onAddActionBar={
        multipleActionBarsEnabled ? handleAddActionBar : undefined
      }
    />
  );
}

/** Props for HoldToEditIndicator */
interface HoldToEditIndicatorProps {
  /** Whether user is currently holding the edit key */
  isHolding: boolean;
  /** Progress of hold (0-100) */
  holdProgress: number;
  /** Whether edit mode is currently unlocked */
  isUnlocked: boolean;
  /** Whether edit mode feature is enabled */
  editModeEnabled: boolean;
}

/**
 * Visual indicator shown while holding L key to toggle edit mode
 */
export function HoldToEditIndicator({
  isHolding,
  holdProgress,
  isUnlocked,
  editModeEnabled,
}: HoldToEditIndicatorProps): React.ReactElement {
  // Determine colors based on state
  const progressColor = !editModeEnabled
    ? "#6b7280"
    : isUnlocked
      ? "#ef4444"
      : "#22c55e";

  const glowColor = !editModeEnabled
    ? "rgba(107, 114, 128, 0.6)"
    : isUnlocked
      ? "rgba(239, 68, 68, 0.6)"
      : "rgba(34, 197, 94, 0.6)";

  const gradientColor = !editModeEnabled
    ? "rgba(107, 114, 128, 0.2)"
    : isUnlocked
      ? "rgba(239, 68, 68, 0.2)"
      : "rgba(34, 197, 94, 0.2)";

  const statusText = !editModeEnabled
    ? "Edit Mode (Advanced)"
    : isUnlocked
      ? "Locking..."
      : "Unlocking...";

  // Calculate stroke dash offset for progress
  const circumference = 2 * Math.PI * 58;
  const strokeDashoffset = circumference * (1 - holdProgress / 100);

  return (
    <div
      className="fixed inset-0 flex items-center justify-center pointer-events-none z-[9999]"
      style={{
        backgroundColor: isHolding ? "rgba(0, 0, 0, 0.4)" : "transparent",
        opacity: isHolding ? 1 : 0,
        transition: "opacity 0.15s ease-out, background-color 0.15s ease-out",
        visibility: isHolding ? "visible" : "hidden",
      }}
    >
      <div
        className="relative flex items-center justify-center"
        style={{
          width: 140,
          height: 140,
          transform: isHolding ? "scale(1)" : "scale(0.8)",
          transition: "transform 0.15s ease-out",
        }}
      >
        {/* Background glow */}
        <div
          style={{
            position: "absolute",
            width: 100,
            height: 100,
            borderRadius: "50%",
            background: `radial-gradient(circle, ${gradientColor} 0%, transparent 70%)`,
          }}
        />

        {/* Progress ring */}
        <svg
          width="140"
          height="140"
          viewBox="0 0 140 140"
          style={{ position: "absolute" }}
        >
          {/* Track circle */}
          <circle
            cx="70"
            cy="70"
            r="58"
            fill="none"
            stroke="rgba(255, 255, 255, 0.15)"
            strokeWidth="8"
          />
          {/* Progress circle */}
          <circle
            cx="70"
            cy="70"
            r="58"
            fill="none"
            stroke={progressColor}
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            transform="rotate(-90 70 70)"
            style={{ filter: `drop-shadow(0 0 6px ${glowColor})` }}
          />
        </svg>

        {/* Lock icon container */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            color: "#fff",
          }}
        >
          {/* SVG lock icon */}
          <svg
            width="36"
            height="36"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#fbbf24"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ filter: "drop-shadow(0 2px 4px rgba(0, 0, 0, 0.3))" }}
          >
            {isUnlocked ? (
              <>
                {/* Unlocked padlock */}
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 9.9-1" />
              </>
            ) : (
              <>
                {/* Locked padlock */}
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </>
            )}
          </svg>
          <span
            style={{
              fontSize: 12,
              marginTop: 8,
              opacity: 0.9,
              fontWeight: 500,
              textShadow: "0 1px 2px rgba(0, 0, 0, 0.5)",
              letterSpacing: "0.5px",
            }}
          >
            {statusText}
          </span>
        </div>
      </div>
    </div>
  );
}
