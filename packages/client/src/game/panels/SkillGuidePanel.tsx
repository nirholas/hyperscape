/**
 * Skill Guide Panel
 * OSRS-style popup showing skill unlocks at each level
 */

import React, { useEffect } from "react";
import { createPortal } from "react-dom";
import type { SkillUnlock } from "@hyperscape/shared";

interface SkillGuidePanelProps {
  visible: boolean;
  skillLabel: string;
  skillIcon: string;
  playerLevel: number;
  unlocks: readonly SkillUnlock[];
  isLoading: boolean;
  onClose: () => void;
}

interface UnlockRowProps {
  unlock: SkillUnlock;
  isUnlocked: boolean;
  isNext: boolean;
}

function UnlockRow({ unlock, isUnlocked, isNext }: UnlockRowProps) {
  // Determine row styling based on state
  const getRowStyle = () => {
    if (isUnlocked) {
      return {
        background: "rgba(34, 197, 94, 0.1)",
        border: "1px solid rgba(34, 197, 94, 0.3)",
        opacity: 1,
      };
    }
    if (isNext) {
      return {
        background: "rgba(251, 191, 36, 0.15)",
        border: "1px solid rgba(251, 191, 36, 0.5)",
        opacity: 1,
      };
    }
    return {
      background: "rgba(0, 0, 0, 0.2)",
      border: "1px solid transparent",
      opacity: 0.6,
    };
  };

  const rowStyle = getRowStyle();

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "8px",
        padding: "8px",
        borderRadius: "4px",
        background: rowStyle.background,
        border: rowStyle.border,
        opacity: rowStyle.opacity,
        transition: "all 0.2s ease",
      }}
    >
      {/* Status Icon */}
      <span
        style={{
          color: isUnlocked ? "#22c55e" : isNext ? "#fbbf24" : "#6b7280",
          fontSize: "14px",
          width: "16px",
          textAlign: "center",
        }}
      >
        {isUnlocked ? "✓" : isNext ? "➤" : "🔒"}
      </span>

      {/* Level Badge */}
      <span
        style={{
          width: "48px",
          textAlign: "center",
          fontSize: "12px",
          fontWeight: "bold",
          color: isUnlocked ? "#ffff00" : isNext ? "#fbbf24" : "#9ca3af",
        }}
      >
        Lvl {unlock.level}
      </span>

      {/* Description */}
      <span
        style={{
          flex: 1,
          fontSize: "12px",
          color: isUnlocked ? "#ffffff" : isNext ? "#fef3c7" : "#9ca3af",
        }}
      >
        {unlock.description}
      </span>

      {/* Next Badge */}
      {isNext && (
        <span
          style={{
            fontSize: "9px",
            padding: "2px 4px",
            borderRadius: "3px",
            background: "rgba(251, 191, 36, 0.3)",
            color: "#fbbf24",
            fontWeight: "bold",
          }}
        >
          NEXT
        </span>
      )}

      {/* Type Badge */}
      <span
        style={{
          fontSize: "10px",
          padding: "2px 6px",
          borderRadius: "4px",
          background:
            unlock.type === "item"
              ? "rgba(59, 130, 246, 0.3)"
              : "rgba(147, 51, 234, 0.3)",
          color: unlock.type === "item" ? "#93c5fd" : "#c4b5fd",
        }}
      >
        {unlock.type}
      </span>
    </div>
  );
}

export function SkillGuidePanel({
  visible,
  skillLabel,
  skillIcon,
  playerLevel,
  unlocks,
  isLoading,
  onClose,
}: SkillGuidePanelProps) {
  // Close on ESC key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    if (visible) {
      window.addEventListener("keydown", handleKeyDown);
      return () => window.removeEventListener("keydown", handleKeyDown);
    }
  }, [visible, onClose]);

  // Inject animation keyframes
  useEffect(() => {
    const styleId = "skill-guide-panel-animations";
    if (document.getElementById(styleId)) return;

    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = `
      @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      @keyframes slideUp {
        from {
          opacity: 0;
          transform: translateY(20px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }
      .skill-guide-scroll::-webkit-scrollbar {
        width: 8px;
      }
      .skill-guide-scroll::-webkit-scrollbar-track {
        background: rgba(0, 0, 0, 0.3);
        border-radius: 4px;
      }
      .skill-guide-scroll::-webkit-scrollbar-thumb {
        background: rgba(139, 69, 19, 0.6);
        border-radius: 4px;
      }
      .skill-guide-scroll::-webkit-scrollbar-thumb:hover {
        background: rgba(139, 69, 19, 0.8);
      }
      @keyframes spin {
        to { transform: rotate(360deg); }
      }
    `;
    document.head.appendChild(style);
  }, []);

  if (!visible) return null;

  const sortedUnlocks = [...unlocks].sort((a, b) => a.level - b.level);
  const unlockedCount = unlocks.filter((u) => u.level <= playerLevel).length;

  // Find the next unlock (first one above player's level)
  const nextUnlock = sortedUnlocks.find((u) => u.level > playerLevel);
  const levelsToNext = nextUnlock ? nextUnlock.level - playerLevel : 0;

  return createPortal(
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {/* Backdrop with fade-in animation */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(0, 0, 0, 0.5)",
          animation: "fadeIn 0.15s ease-out",
        }}
        onClick={onClose}
      />

      {/* Panel with slide-up and fade-in animation */}
      <div
        style={{
          position: "relative",
          background: "rgba(20, 15, 10, 0.98)",
          border: "2px solid rgba(139, 69, 19, 0.8)",
          borderRadius: "8px",
          boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.5)",
          width: "400px",
          maxHeight: "500px",
          display: "flex",
          flexDirection: "column",
          animation: "slideUp 0.2s ease-out",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "12px",
            borderBottom: "1px solid rgba(139, 69, 19, 0.5)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ fontSize: "24px" }}>{skillIcon}</span>
            <span
              style={{
                color: "#c9b386",
                fontWeight: "bold",
                fontSize: "14px",
              }}
            >
              {skillLabel} Guide
            </span>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              color: "#c9b386",
              cursor: "pointer",
              fontSize: "18px",
              padding: "4px",
              lineHeight: 1,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "#ffffff")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "#c9b386")}
          >
            ✕
          </button>
        </div>

        {/* Current Level */}
        <div
          style={{
            padding: "8px 12px",
            fontSize: "12px",
            color: "#c9b386",
            borderBottom: "1px solid rgba(139, 69, 19, 0.3)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span>
            Your Level:{" "}
            <span style={{ color: "#ffff00", fontWeight: "bold" }}>
              {playerLevel}
            </span>
          </span>
          <span style={{ fontSize: "11px", color: "#9ca3af" }}>
            {unlockedCount}/{unlocks.length} unlocked
          </span>
        </div>

        {/* Next Unlock Info */}
        {nextUnlock && (
          <div
            style={{
              padding: "6px 12px",
              fontSize: "11px",
              background: "rgba(251, 191, 36, 0.1)",
              borderBottom: "1px solid rgba(139, 69, 19, 0.3)",
              color: "#fbbf24",
              display: "flex",
              alignItems: "center",
              gap: "4px",
            }}
          >
            <span>➤</span>
            <span>
              {levelsToNext} more level{levelsToNext !== 1 ? "s" : ""} to
              unlock:{" "}
              <span style={{ color: "#fef3c7" }}>{nextUnlock.description}</span>
            </span>
          </div>
        )}

        {/* Unlocks List */}
        <div
          className="skill-guide-scroll"
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "8px",
            display: "flex",
            flexDirection: "column",
            gap: "4px",
          }}
        >
          {isLoading ? (
            <div
              style={{
                textAlign: "center",
                color: "#c9b386",
                padding: "24px",
                fontSize: "12px",
              }}
            >
              <div
                style={{
                  display: "inline-block",
                  width: "20px",
                  height: "20px",
                  border: "2px solid rgba(139, 69, 19, 0.3)",
                  borderTopColor: "#c9b386",
                  borderRadius: "50%",
                  animation: "spin 0.8s linear infinite",
                }}
              />
              <div style={{ marginTop: "8px" }}>Loading unlocks...</div>
            </div>
          ) : sortedUnlocks.length === 0 ? (
            <div
              style={{
                textAlign: "center",
                color: "#9ca3af",
                padding: "16px",
                fontSize: "12px",
              }}
            >
              No unlock data available for this skill.
            </div>
          ) : (
            sortedUnlocks.map((unlock, idx) => (
              <UnlockRow
                key={idx}
                unlock={unlock}
                isUnlocked={playerLevel >= unlock.level}
                isNext={nextUnlock?.level === unlock.level}
              />
            ))
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
