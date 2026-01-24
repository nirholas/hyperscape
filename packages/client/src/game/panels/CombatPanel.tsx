import React, { useEffect, useState, useMemo } from "react";
import { useThemeStore, useMobileLayout } from "@/ui";
import { EventType, getAvailableStyles, WeaponType } from "@hyperscape/shared";
import type {
  ClientWorld,
  PlayerStats,
  PlayerEquipmentItems,
  PlayerHealth,
} from "../../types";

/** Icons for attack styles */
const STYLE_ICONS: Record<string, string> = {
  accurate: "🎯",
  aggressive: "💥",
  defensive: "🛡️",
  controlled: "⚖️",
};

/** Compact combat stats row - inline horizontal layout */
const CombatStatsRow = React.memo(function CombatStatsRow({
  attackLevel,
  strengthLevel,
  defenseLevel,
  isMobile,
}: {
  attackLevel: number;
  strengthLevel: number;
  defenseLevel: number;
  isMobile: boolean;
}) {
  const theme = useThemeStore((s) => s.theme);
  const stats = [
    { key: "attack", icon: "⚔️", value: attackLevel },
    { key: "strength", icon: "💪", value: strengthLevel },
    { key: "defense", icon: "🛡️", value: defenseLevel },
  ];

  return (
    <div className="flex gap-1">
      {stats.map((stat) => (
        <div
          key={stat.key}
          className="flex-1 flex items-center justify-center gap-1 rounded"
          style={{
            background: theme.colors.slot.filled,
            border: `1px solid ${theme.colors.border.default}60`,
            padding: isMobile ? "6px 4px" : "4px 3px",
          }}
        >
          <span style={{ fontSize: isMobile ? "12px" : "11px" }}>
            {stat.icon}
          </span>
          <span
            style={{
              fontSize: isMobile ? "13px" : "12px",
              color: theme.colors.text.accent,
              fontWeight: 700,
            }}
          >
            {stat.value}
          </span>
        </div>
      ))}
    </div>
  );
});

// Event data interfaces for type-safe event handling
interface StyleUpdateEvent {
  playerId: string;
  currentStyle: { id: string };
}

interface TargetChangedEvent {
  targetId: string | null;
  targetName?: string;
  targetHealth?: PlayerHealth;
}

interface TargetHealthEvent {
  targetId: string;
  health: PlayerHealth;
}

interface AutoRetaliateEvent {
  playerId: string;
  enabled: boolean;
}

// Type guards for runtime validation
function isStyleUpdateEvent(data: unknown): data is StyleUpdateEvent {
  if (typeof data !== "object" || data === null) return false;
  const d = data as Record<string, unknown>;
  return (
    typeof d.playerId === "string" &&
    typeof d.currentStyle === "object" &&
    d.currentStyle !== null &&
    typeof (d.currentStyle as Record<string, unknown>).id === "string"
  );
}

function isTargetChangedEvent(data: unknown): data is TargetChangedEvent {
  if (typeof data !== "object" || data === null) return false;
  const d = data as Record<string, unknown>;
  return d.targetId === null || typeof d.targetId === "string";
}

function isTargetHealthEvent(data: unknown): data is TargetHealthEvent {
  if (typeof data !== "object" || data === null) return false;
  const d = data as Record<string, unknown>;
  return (
    typeof d.targetId === "string" &&
    typeof d.health === "object" &&
    d.health !== null
  );
}

function isAutoRetaliateEvent(data: unknown): data is AutoRetaliateEvent {
  if (typeof data !== "object" || data === null) return false;
  const d = data as Record<string, unknown>;
  return typeof d.playerId === "string" && typeof d.enabled === "boolean";
}

interface CombatPanelProps {
  world: ClientWorld;
  stats: PlayerStats | null;
  equipment: PlayerEquipmentItems | null;
}

// Client-side cache for combat style state (persists across panel opens/closes)
// This enables instant display when reopening panel (RuneScape pattern)
const combatStyleCache = new Map<string, string>();
const autoRetaliateCache = new Map<string, boolean>();

export function CombatPanel({ world, stats, equipment }: CombatPanelProps) {
  const theme = useThemeStore((s) => s.theme);
  const { shouldUseMobileUI } = useMobileLayout();
  // Initialize from cache if available, otherwise default to "accurate"
  // Check order: module cache > network cache > default
  const [style, setStyle] = useState<string>(() => {
    const playerId = world.entities?.player?.id;
    // 1. Check module cache (for instant display on panel reopen)
    if (playerId && combatStyleCache.has(playerId)) {
      return combatStyleCache.get(playerId)!;
    }
    // 2. Check network cache (for fresh page loads - packet arrived before UI mounted)
    const networkCache =
      world.network?.lastAttackStyleByPlayerId?.[playerId || ""];
    if (networkCache?.currentStyle?.id) {
      // Also update module cache for future panel reopens
      if (playerId) {
        combatStyleCache.set(playerId, networkCache.currentStyle.id);
      }
      return networkCache.currentStyle.id;
    }
    return "accurate";
  });
  const [cooldown, setCooldown] = useState<number>(0);
  const [targetName, setTargetName] = useState<string | null>(null);
  const [targetHealth, setTargetHealth] = useState<PlayerHealth | null>(null);
  // Auto-retaliate state (OSRS default is ON)
  const [autoRetaliate, setAutoRetaliate] = useState<boolean>(() => {
    const player = world.entities?.player;
    const playerId = player?.id;
    // First check cache (for instant display on panel reopen)
    if (playerId && autoRetaliateCache.has(playerId)) {
      return autoRetaliateCache.get(playerId)!;
    }
    // Read directly from player entity (set from server data during entity creation)
    const playerCombat = (player as { combat?: { autoRetaliate?: boolean } })
      ?.combat;
    if (typeof playerCombat?.autoRetaliate === "boolean") {
      return playerCombat.autoRetaliate;
    }
    return true; // OSRS default: ON
  });

  // Calculate combat level using OSRS formula (melee-only MVP)
  const combatLevel = stats?.skills
    ? (() => {
        const s = stats.skills;
        const base =
          0.25 * ((s.defense?.level || 1) + (s.constitution?.level || 10));
        const melee =
          0.325 * ((s.attack?.level || 1) + (s.strength?.level || 1));
        return Math.floor(base + melee);
      })()
    : 1;
  const inCombat = stats?.inCombat || false;
  const health = stats?.health || { current: 100, max: 100 };
  const attackLevel = stats?.skills?.attack?.level || 1;
  const strengthLevel = stats?.skills?.strength?.level || 1;
  const defenseLevel = stats?.skills?.defense?.level || 1;

  useEffect(() => {
    const playerId = world.entities?.player?.id;
    if (!playerId) return;

    // Immediately sync from network cache (handles fresh page loads)
    // The packet may have arrived before this component mounted
    const networkCache = world.network?.lastAttackStyleByPlayerId?.[playerId];
    if (networkCache?.currentStyle?.id) {
      combatStyleCache.set(playerId, networkCache.currentStyle.id);
      setStyle(networkCache.currentStyle.id);
    }

    const actions = world.getSystem("actions") as {
      actionMethods?: {
        getAttackStyleInfo?: (
          id: string,
          cb: (info: { style: string; cooldown?: number }) => void,
        ) => void;
        changeAttackStyle?: (id: string, style: string) => void;
        getAutoRetaliate?: (id: string, cb: (enabled: boolean) => void) => void;
        setAutoRetaliate?: (id: string, enabled: boolean) => void;
      };
    } | null;

    actions?.actionMethods?.getAttackStyleInfo?.(
      playerId,
      (info: { style: string; cooldown?: number }) => {
        if (info) {
          // Update cache for instant display on panel reopen
          combatStyleCache.set(playerId, info.style);
          setStyle(info.style);
          setCooldown(info.cooldown || 0);
        }
      },
    );

    // Initialize auto-retaliate state from server
    actions?.actionMethods?.getAutoRetaliate?.(playerId, (enabled: boolean) => {
      autoRetaliateCache.set(playerId, enabled);
      setAutoRetaliate(enabled);
    });

    // Direct fallback: read from player entity if callback doesn't fire
    // This ensures we get the correct value even if the event system has issues
    const player = world.entities?.player;
    if (player) {
      const playerCombat = (player as { combat?: { autoRetaliate?: boolean } })
        ?.combat;
      if (typeof playerCombat?.autoRetaliate === "boolean") {
        autoRetaliateCache.set(playerId, playerCombat.autoRetaliate);
        setAutoRetaliate(playerCombat.autoRetaliate);
      }
    }

    const onUpdate = (data: unknown) => {
      if (!isStyleUpdateEvent(data)) return;
      if (data.playerId !== playerId) return;
      // Update cache for instant display on panel reopen
      combatStyleCache.set(playerId, data.currentStyle.id);
      setStyle(data.currentStyle.id);
    };
    const onChanged = (data: unknown) => {
      if (!isStyleUpdateEvent(data)) return;
      if (data.playerId !== playerId) return;
      // Update cache for instant display on panel reopen
      combatStyleCache.set(playerId, data.currentStyle.id);
      setStyle(data.currentStyle.id);
    };

    // Listen for combat target updates
    const onTargetChanged = (data: unknown) => {
      if (!isTargetChangedEvent(data)) return;
      if (data.targetId) {
        setTargetName(data.targetName || data.targetId);
        setTargetHealth(data.targetHealth || null);
      } else {
        setTargetName(null);
        setTargetHealth(null);
      }
    };

    const onTargetHealthUpdate = (data: unknown) => {
      if (!isTargetHealthEvent(data)) return;
      if (data.targetId && targetName) {
        setTargetHealth(data.health);
      }
    };

    // Listen for auto-retaliate changes from server
    const onAutoRetaliateChanged = (data: unknown) => {
      if (!isAutoRetaliateEvent(data)) return;
      if (data.playerId !== playerId) return;
      autoRetaliateCache.set(playerId, data.enabled);
      setAutoRetaliate(data.enabled);
    };

    world.on(EventType.UI_ATTACK_STYLE_UPDATE, onUpdate, undefined);
    world.on(EventType.UI_ATTACK_STYLE_CHANGED, onChanged, undefined);
    world.on(
      EventType.UI_AUTO_RETALIATE_CHANGED,
      onAutoRetaliateChanged,
      undefined,
    );
    world.on(EventType.UI_COMBAT_TARGET_CHANGED, onTargetChanged, undefined);
    world.on(
      EventType.UI_COMBAT_TARGET_HEALTH,
      onTargetHealthUpdate,
      undefined,
    );

    return () => {
      world.off(
        EventType.UI_ATTACK_STYLE_UPDATE,
        onUpdate,
        undefined,
        undefined,
      );
      world.off(
        EventType.UI_ATTACK_STYLE_CHANGED,
        onChanged,
        undefined,
        undefined,
      );
      world.off(
        EventType.UI_AUTO_RETALIATE_CHANGED,
        onAutoRetaliateChanged,
        undefined,
        undefined,
      );
      world.off(
        EventType.UI_COMBAT_TARGET_CHANGED,
        onTargetChanged,
        undefined,
        undefined,
      );
      world.off(
        EventType.UI_COMBAT_TARGET_HEALTH,
        onTargetHealthUpdate,
        undefined,
        undefined,
      );
    };
  }, [world, targetName]);

  const changeStyle = (next: string) => {
    const playerId = world.entities?.player?.id;
    if (!playerId) return;

    const actions = world.getSystem("actions") as {
      actionMethods?: {
        changeAttackStyle?: (id: string, style: string) => void;
      };
    } | null;

    if (!actions?.actionMethods?.changeAttackStyle) return;

    actions.actionMethods.changeAttackStyle(playerId, next);
  };

  const toggleAutoRetaliate = () => {
    const playerId = world.entities?.player?.id;
    if (!playerId) return;

    const actions = world.getSystem("actions") as {
      actionMethods?: {
        setAutoRetaliate?: (id: string, enabled: boolean) => void;
      };
    } | null;

    if (!actions?.actionMethods?.setAutoRetaliate) return;

    actions.actionMethods.setAutoRetaliate(playerId, !autoRetaliate);
  };

  // All possible combat styles with their XP training info and colors
  const allStyles: Array<{
    id: string;
    label: string;
    xp: string;
    color: string;
  }> = [
    { id: "accurate", label: "Accurate", xp: "Attack", color: "#ef4444" },
    { id: "aggressive", label: "Aggressive", xp: "Strength", color: "#f59e0b" },
    { id: "defensive", label: "Defensive", xp: "Defense", color: "#3b82f6" },
    { id: "controlled", label: "Controlled", xp: "All", color: "#a855f7" },
  ];

  // Filter styles based on equipped weapon (OSRS-accurate restrictions)
  const styles = useMemo(() => {
    const weaponType = equipment?.weapon?.weaponType
      ? (equipment.weapon.weaponType.toLowerCase() as WeaponType)
      : WeaponType.NONE;
    const availableStyleIds = getAvailableStyles(weaponType);
    return allStyles.filter((s) =>
      (availableStyleIds as readonly string[]).includes(s.id),
    );
  }, [equipment?.weapon?.weaponType]);

  const healthPercent = Math.round((health.current / health.max) * 100);
  const targetHealthPercent = targetHealth
    ? Math.round((targetHealth.current / targetHealth.max) * 100)
    : 0;

  // Responsive padding/sizing
  const p = shouldUseMobileUI
    ? { outer: 4, inner: 6, gap: 4 }
    : { outer: 3, inner: 4, gap: 3 };

  return (
    <div
      className="flex flex-col h-full overflow-auto"
      style={{ padding: `${p.outer}px`, gap: `${p.gap}px` }}
    >
      {/* Inline CSS animations */}
      <style>{`
        @keyframes combat-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.6; } }
        .combat-pulse { animation: combat-pulse 1.5s ease-in-out infinite; }
      `}</style>

      {/* HP + Combat Level Row */}
      <div
        className="rounded"
        style={{
          background: theme.colors.slot.filled,
          border: inCombat
            ? `1px solid ${theme.colors.state.danger}60`
            : `1px solid ${theme.colors.border.default}60`,
          padding: `${p.inner}px`,
          boxShadow: inCombat
            ? `0 0 8px ${theme.colors.state.danger}20`
            : "none",
        }}
      >
        {/* HP Header Row */}
        <div
          className="flex items-center justify-between"
          style={{ marginBottom: "4px" }}
        >
          <div className="flex items-center gap-1.5">
            <span style={{ fontSize: shouldUseMobileUI ? "14px" : "12px" }}>
              ❤️
            </span>
            <span
              style={{
                fontSize: shouldUseMobileUI ? "12px" : "11px",
                color: theme.colors.text.accent,
                fontWeight: 600,
              }}
            >
              HP
            </span>
            {inCombat && (
              <span
                className="combat-pulse"
                style={{
                  fontSize: "9px",
                  color: theme.colors.state.danger,
                  fontWeight: 600,
                  background: `${theme.colors.state.danger}20`,
                  padding: "1px 4px",
                  borderRadius: "3px",
                  marginLeft: "2px",
                }}
              >
                ⚔️
              </span>
            )}
          </div>
          <span
            style={{
              fontSize: shouldUseMobileUI ? "12px" : "11px",
              color:
                healthPercent > 50
                  ? theme.colors.state.success
                  : healthPercent > 25
                    ? theme.colors.state.warning
                    : theme.colors.state.danger,
              fontWeight: 700,
              fontFamily: theme.typography.fontFamily.mono,
            }}
          >
            {health.current}/{health.max}
          </span>
        </div>

        {/* HP Bar */}
        <div
          style={{
            width: "100%",
            height: shouldUseMobileUI ? "10px" : "8px",
            background: theme.colors.background.primary,
            borderRadius: "4px",
            overflow: "hidden",
            border: `1px solid ${theme.colors.border.default}40`,
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${healthPercent}%`,
              borderRadius: "3px",
              transition: "width 0.2s ease",
              background:
                healthPercent > 50
                  ? "linear-gradient(180deg, #4ade80, #22c55e)"
                  : healthPercent > 25
                    ? "linear-gradient(180deg, #fbbf24, #f59e0b)"
                    : "linear-gradient(180deg, #f87171, #ef4444)",
            }}
          />
        </div>

        {/* Combat Level - inline below HP */}
        <div
          className="flex items-center justify-between"
          style={{
            marginTop: "6px",
            paddingTop: "6px",
            borderTop: `1px solid ${theme.colors.border.default}30`,
          }}
        >
          <span
            style={{
              fontSize: shouldUseMobileUI ? "11px" : "10px",
              color: theme.colors.text.muted,
            }}
          >
            Combat Lvl
          </span>
          <span
            style={{
              fontSize: shouldUseMobileUI ? "14px" : "13px",
              color: theme.colors.state.danger,
              fontWeight: 700,
            }}
          >
            {combatLevel}
          </span>
        </div>
      </div>

      {/* Target (only when in combat) */}
      {targetName && targetHealth && (
        <div
          className="rounded"
          style={{
            background: `${theme.colors.state.danger}10`,
            border: `1px solid ${theme.colors.state.danger}30`,
            padding: `${p.inner}px`,
          }}
        >
          <div
            className="flex items-center justify-between"
            style={{ marginBottom: "3px" }}
          >
            <span
              style={{
                fontSize: shouldUseMobileUI ? "11px" : "10px",
                color: theme.colors.state.danger,
                fontWeight: 600,
              }}
            >
              🎯 {targetName}
            </span>
            <span
              style={{
                fontSize: shouldUseMobileUI ? "11px" : "10px",
                color: theme.colors.state.danger,
                fontWeight: 700,
              }}
            >
              {targetHealth.current}/{targetHealth.max}
            </span>
          </div>
          <div
            style={{
              width: "100%",
              height: shouldUseMobileUI ? "8px" : "6px",
              background: theme.colors.background.primary,
              borderRadius: "3px",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${targetHealthPercent}%`,
                borderRadius: "3px",
                background: "linear-gradient(180deg, #f87171, #dc2626)",
              }}
            />
          </div>
        </div>
      )}

      {/* Stats Row */}
      <CombatStatsRow
        attackLevel={attackLevel}
        strengthLevel={strengthLevel}
        defenseLevel={defenseLevel}
        isMobile={shouldUseMobileUI}
      />

      {/* Attack Styles - 2 column grid */}
      <div
        className="rounded"
        style={{
          background: theme.colors.slot.filled,
          border: `1px solid ${theme.colors.border.default}60`,
          padding: `${p.inner}px`,
        }}
      >
        <div
          className="grid gap-1.5"
          style={{ gridTemplateColumns: "repeat(2, 1fr)" }}
        >
          {styles.map((s) => {
            const isActive = style === s.id;
            return (
              <button
                key={s.id}
                onClick={() => changeStyle(s.id)}
                disabled={cooldown > 0}
                aria-pressed={isActive}
                className="rounded focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-amber-400/60"
                style={{
                  padding: shouldUseMobileUI ? "8px 6px" : "6px 5px",
                  minHeight: shouldUseMobileUI ? "40px" : "36px",
                  cursor: cooldown > 0 ? "not-allowed" : "pointer",
                  transition: "all 0.1s ease",
                  fontSize: shouldUseMobileUI ? "12px" : "11px",
                  fontWeight: isActive ? 600 : 500,
                  background: isActive
                    ? `${s.color}20`
                    : theme.colors.slot.empty,
                  border: isActive
                    ? `2px solid ${s.color}70`
                    : `1px solid ${theme.colors.border.default}50`,
                  color: isActive ? s.color : theme.colors.text.secondary,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "2px",
                  touchAction: "manipulation",
                  opacity: cooldown > 0 ? 0.5 : 1,
                }}
              >
                <div className="flex items-center gap-1">
                  <span
                    style={{ fontSize: shouldUseMobileUI ? "12px" : "11px" }}
                  >
                    {STYLE_ICONS[s.id]}
                  </span>
                  <span>{s.label}</span>
                </div>
                <span style={{ fontSize: "9px", opacity: 0.7 }}>+{s.xp}</span>
              </button>
            );
          })}
        </div>

        {cooldown > 0 && (
          <div
            className="text-center"
            style={{
              marginTop: "4px",
              fontSize: "10px",
              color: theme.colors.state.warning,
              background: `${theme.colors.state.warning}15`,
              padding: "2px 6px",
              borderRadius: "3px",
            }}
          >
            ⏱️ {Math.ceil(cooldown / 1000)}s
          </div>
        )}
      </div>

      {/* Auto Retaliate - compact toggle */}
      <button
        onClick={toggleAutoRetaliate}
        className="rounded w-full focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-amber-400/60"
        style={{
          padding: shouldUseMobileUI ? "8px 10px" : "6px 8px",
          minHeight: shouldUseMobileUI ? "40px" : "34px",
          cursor: "pointer",
          transition: "all 0.1s ease",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontSize: shouldUseMobileUI ? "12px" : "11px",
          touchAction: "manipulation",
          background: autoRetaliate
            ? `${theme.colors.state.success}15`
            : theme.colors.slot.filled,
          border: autoRetaliate
            ? `1px solid ${theme.colors.state.success}40`
            : `1px solid ${theme.colors.border.default}60`,
          color: autoRetaliate
            ? theme.colors.state.success
            : theme.colors.text.muted,
        }}
      >
        <div className="flex items-center gap-1.5">
          <span style={{ fontSize: shouldUseMobileUI ? "12px" : "11px" }}>
            {autoRetaliate ? "🔄" : "🚫"}
          </span>
          <span style={{ fontWeight: 500 }}>Auto Retaliate</span>
        </div>
        <span
          style={{
            padding: "2px 8px",
            borderRadius: "3px",
            fontSize: "10px",
            fontWeight: 700,
            background: autoRetaliate
              ? `${theme.colors.state.success}30`
              : `${theme.colors.state.danger}25`,
            color: autoRetaliate
              ? theme.colors.state.success
              : theme.colors.state.danger,
          }}
        >
          {autoRetaliate ? "ON" : "OFF"}
        </span>
      </button>
    </div>
  );
}
