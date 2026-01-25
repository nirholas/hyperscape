import React, { useEffect, useState, useMemo } from "react";
import { useThemeStore, useMobileLayout } from "hs-kit";
import { EventType, getAvailableStyles, WeaponType } from "@hyperscape/shared";
import { MOBILE_COMBAT } from "../../constants";
import type {
  ClientWorld,
  PlayerStats,
  PlayerEquipmentItems,
  PlayerHealth,
} from "../../types";

/** Memoized combat stats row component - the component itself is memoized, so no need for useMemo on the array */
const CombatStatsRow = React.memo(function CombatStatsRow({
  attackLevel,
  strengthLevel,
  defenseLevel,
}: {
  attackLevel: number;
  strengthLevel: number;
  defenseLevel: number;
}) {
  const theme = useThemeStore((s) => s.theme);
  // Plain array - React.memo on the component handles render optimization
  const stats = [
    { label: "Atk", value: attackLevel },
    { label: "Str", value: strengthLevel },
    { label: "Def", value: defenseLevel },
  ];

  return (
    <div
      className="rounded"
      style={{
        background: theme.colors.background.tertiary,
        border: `1px solid ${theme.colors.border.default}`,
        padding: `${theme.spacing.xs}px`,
      }}
    >
      <div className="flex gap-1">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="flex-1 text-center rounded"
            style={{
              background: theme.colors.background.overlay,
              padding: `${theme.spacing.xs}px`,
            }}
          >
            <div
              style={{
                fontSize: theme.typography.fontSize.xs,
                color: theme.colors.text.muted,
              }}
            >
              {stat.label}
            </div>
            <div
              style={{
                fontSize: theme.typography.fontSize.sm,
                color: theme.colors.accent.primary,
                fontWeight: theme.typography.fontWeight.semibold,
              }}
            >
              {stat.value}
            </div>
          </div>
        ))}
      </div>
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

  // All possible combat styles with their XP training info
  const allStyles: Array<{ id: string; label: string; xp: string }> = [
    { id: "accurate", label: "Accurate", xp: "Attack" },
    { id: "aggressive", label: "Aggressive", xp: "Strength" },
    { id: "defensive", label: "Defensive", xp: "Defense" },
    { id: "controlled", label: "Controlled", xp: "All" },
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

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        padding: "4px",
      }}
    >
      {/* Health Bar - Compact */}
      <div
        className="rounded"
        style={{
          background: theme.colors.background.secondary,
          border: inCombat
            ? `1px solid ${theme.colors.state.danger}99`
            : `1px solid ${theme.colors.border.default}`,
          padding: `${theme.spacing.sm}px`,
          transition: theme.transitions.normal,
          boxShadow: inCombat
            ? `0 0 8px ${theme.colors.state.danger}4d`
            : "none",
        }}
      >
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <span
              style={{
                fontSize: theme.typography.fontSize.xs,
                color: theme.colors.accent.primary,
                fontWeight: theme.typography.fontWeight.semibold,
              }}
            >
              HP
            </span>
            {inCombat && (
              <span
                style={{
                  fontSize: theme.typography.fontSize.xs,
                  color: theme.colors.state.danger,
                  fontWeight: theme.typography.fontWeight.semibold,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  animation: "pulse 1.5s ease-in-out infinite",
                }}
              >
                In Combat
              </span>
            )}
          </div>
          <span
            style={{
              fontSize: theme.typography.fontSize.xs,
              color: theme.colors.accent.primary,
            }}
          >
            {health.current}/{health.max}
          </span>
        </div>
        {/* Inline CSS animation for in-combat pulse */}
        {inCombat && (
          <style>{`
            @keyframes pulse {
              0%, 100% { opacity: 1; }
              50% { opacity: 0.5; }
            }
          `}</style>
        )}
        <div
          style={{
            width: "100%",
            // Mobile: thicker bar (16px), Desktop: 8px
            height: shouldUseMobileUI
              ? `${MOBILE_COMBAT.healthBarHeight}px`
              : "8px",
            background: theme.colors.background.overlay,
            borderRadius: `${theme.borderRadius.md}px`,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${healthPercent}%`,
              borderRadius: `${theme.borderRadius.md}px`,
              transition: theme.transitions.normal,
              background:
                healthPercent > 50
                  ? `linear-gradient(90deg, ${theme.colors.state.success}, ${theme.colors.status.energy})`
                  : healthPercent > 25
                    ? `linear-gradient(90deg, ${theme.colors.state.warning}, ${theme.colors.status.adrenaline})`
                    : `linear-gradient(90deg, ${theme.colors.state.danger}, ${theme.colors.status.hp})`,
            }}
          />
        </div>

        {/* Combat Level inline */}
        <div
          className="flex items-center justify-between mt-2"
          style={{
            paddingTop: `${theme.spacing.xs}px`,
            borderTop: `1px solid ${theme.colors.border.default}`,
          }}
        >
          <span
            style={{
              fontSize: theme.typography.fontSize.xs,
              color: theme.colors.text.muted,
            }}
          >
            Combat Lvl
          </span>
          <span
            style={{
              fontSize: theme.typography.fontSize.xs,
              color: theme.colors.accent.primary,
              fontWeight: theme.typography.fontWeight.semibold,
            }}
          >
            {combatLevel}
          </span>
        </div>
      </div>

      {/* Target Info (when in combat) */}
      {targetName && targetHealth && (
        <div
          className="rounded"
          style={{
            background: `${theme.colors.state.danger}33`,
            border: `1px solid ${theme.colors.state.danger}4d`,
            padding: `${theme.spacing.xs}px ${theme.spacing.sm}px`,
          }}
        >
          <div className="flex items-center justify-between mb-1">
            <span
              style={{
                fontSize: theme.typography.fontSize.xs,
                color: theme.colors.state.danger,
                fontWeight: theme.typography.fontWeight.medium,
              }}
            >
              {targetName}
            </span>
            <span
              style={{
                fontSize: theme.typography.fontSize.xs,
                color: theme.colors.state.danger,
              }}
            >
              {targetHealth.current}/{targetHealth.max}
            </span>
          </div>
          <div
            style={{
              width: "100%",
              // Mobile: thicker bar (12px), Desktop: 6px
              height: shouldUseMobileUI
                ? `${MOBILE_COMBAT.targetBarHeight}px`
                : "6px",
              background: theme.colors.background.overlay,
              borderRadius: `${theme.borderRadius.sm}px`,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${targetHealthPercent}%`,
                borderRadius: `${theme.borderRadius.sm}px`,
                transition: theme.transitions.normal,
                background: `linear-gradient(90deg, ${theme.colors.state.danger}, ${theme.colors.status.hp})`,
              }}
            />
          </div>
        </div>
      )}

      {/* Combat Stats - Compact Row */}
      <CombatStatsRow
        attackLevel={attackLevel}
        strengthLevel={strengthLevel}
        defenseLevel={defenseLevel}
      />

      {/* Attack Style - Compact */}
      <div
        className="rounded"
        style={{
          background: theme.colors.background.secondary,
          border: `1px solid ${theme.colors.border.default}`,
          padding: `${theme.spacing.xs}px`,
        }}
      >
        <div
          style={{
            fontSize: theme.typography.fontSize.xs,
            color: theme.colors.text.muted,
            marginBottom: `${theme.spacing.xs}px`,
          }}
        >
          Attack Style
        </div>
        <div className="flex flex-col gap-1">
          {styles.map((s) => (
            <button
              key={s.id}
              onClick={() => changeStyle(s.id)}
              disabled={cooldown > 0}
              aria-pressed={style === s.id}
              aria-label={`${s.label} - trains ${s.xp}`}
              className="rounded attack-style-btn focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60"
              style={{
                padding: `${theme.spacing.sm}px ${theme.spacing.md}px`,
                // Mobile: larger buttons (52px), Desktop: 44px minimum
                minHeight: shouldUseMobileUI
                  ? MOBILE_COMBAT.styleButtonHeight
                  : 44,
                cursor: cooldown > 0 ? "not-allowed" : "pointer",
                transition: theme.transitions.fast,
                fontSize: shouldUseMobileUI
                  ? theme.typography.fontSize.base
                  : theme.typography.fontSize.sm,
                fontWeight:
                  style === s.id
                    ? theme.typography.fontWeight.semibold
                    : theme.typography.fontWeight.normal,
                background:
                  style === s.id
                    ? `${theme.colors.state.success}33`
                    : theme.colors.background.overlay,
                border:
                  style === s.id
                    ? `2px solid ${theme.colors.state.success}80`
                    : `1px solid ${theme.colors.border.default}`,
                color:
                  style === s.id
                    ? theme.colors.state.success
                    : theme.colors.text.secondary,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                touchAction: "manipulation",
                // Mobile: stronger highlight for active style
                boxShadow:
                  style === s.id && shouldUseMobileUI
                    ? `0 0 8px ${theme.colors.state.success}40`
                    : "none",
              }}
            >
              <span>{s.label}</span>
              <span
                style={{ fontSize: theme.typography.fontSize.xs, opacity: 0.6 }}
              >
                +{s.xp}
              </span>
            </button>
          ))}
        </div>
        {cooldown > 0 && (
          <div
            style={{
              fontSize: theme.typography.fontSize.xs,
              color: theme.colors.text.muted,
              marginTop: `${theme.spacing.xs}px`,
            }}
          >
            Cooldown: {Math.ceil(cooldown / 1000)}s
          </div>
        )}
      </div>

      {/* Auto Retaliate - Touch-friendly Toggle */}
      <button
        onClick={toggleAutoRetaliate}
        className="rounded"
        style={{
          padding: `${theme.spacing.sm}px ${theme.spacing.md}px`,
          minHeight: 44, // Touch-friendly minimum
          cursor: "pointer",
          transition: theme.transitions.fast,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontSize: theme.typography.fontSize.sm,
          touchAction: "manipulation",
          background: autoRetaliate
            ? `${theme.colors.state.success}26`
            : theme.colors.background.secondary,
          border: autoRetaliate
            ? `1px solid ${theme.colors.state.success}4d`
            : `1px solid ${theme.colors.border.default}`,
          color: autoRetaliate
            ? theme.colors.state.success
            : theme.colors.text.muted,
        }}
      >
        <span style={{ fontWeight: theme.typography.fontWeight.medium }}>
          Auto Retaliate
        </span>
        <span
          style={{
            padding: `2px ${theme.spacing.xs}px`,
            borderRadius: `${theme.borderRadius.sm}px`,
            fontSize: theme.typography.fontSize.xs,
            fontWeight: theme.typography.fontWeight.semibold,
            background: autoRetaliate
              ? `${theme.colors.state.success}4d`
              : `${theme.colors.state.danger}33`,
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
