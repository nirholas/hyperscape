import { useEffect, useState, useMemo } from "react";
import { COLORS } from "../../constants";
import { EventType, getAvailableStyles, WeaponType } from "@hyperscape/shared";
import type {
  ClientWorld,
  PlayerStats,
  PlayerEquipmentItems,
  PlayerHealth,
} from "../../types";

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
  // Initialize from cache if available, otherwise default to "accurate"
  const [style, setStyle] = useState<string>(() => {
    const playerId = world.entities?.player?.id;
    if (playerId && combatStyleCache.has(playerId)) {
      return combatStyleCache.get(playerId)!;
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
    <div className="flex flex-col gap-1.5">
      {/* Player Health Bar */}
      <div className="flex flex-col gap-0.5">
        <div
          className="flex items-center justify-between text-[10px]"
          style={{ color: COLORS.ACCENT }}
        >
          <span className="font-semibold">Hitpoints</span>
          <span>
            {health.current}/{health.max}
          </span>
        </div>
        <div className="w-full bg-black/50 rounded-full h-2.5 border border-white/20 overflow-hidden">
          <div
            className="h-full transition-all duration-300 rounded-full"
            style={{
              width: `${healthPercent}%`,
              background:
                healthPercent > 50
                  ? "linear-gradient(90deg, #22c55e, #16a34a)"
                  : healthPercent > 25
                    ? "linear-gradient(90deg, #f59e0b, #d97706)"
                    : "linear-gradient(90deg, #ef4444, #dc2626)",
            }}
          />
        </div>
      </div>

      {/* Combat Status */}
      {inCombat && (
        <div
          className="bg-red-900/30 border border-red-500/50 rounded-md p-1 flex items-center gap-1"
          style={{ color: "#fca5a5" }}
        >
          <span className="text-[10px] font-semibold">⚔️ In Combat</span>
        </div>
      )}

      {/* Target Info (when in combat with a target) */}
      {targetName && targetHealth && (
        <div className="flex flex-col gap-0.5 bg-red-900/20 border border-red-500/30 rounded-md p-1">
          <div
            className="flex items-center justify-between text-[9px]"
            style={{ color: "#fca5a5" }}
          >
            <span className="font-semibold">Target: {targetName}</span>
            <span>
              {targetHealth.current}/{targetHealth.max}
            </span>
          </div>
          <div className="w-full bg-black/50 rounded-full h-2 border border-red-500/30 overflow-hidden">
            <div
              className="h-full transition-all duration-300 rounded-full"
              style={{
                width: `${targetHealthPercent}%`,
                background: "linear-gradient(90deg, #ef4444, #dc2626)",
              }}
            />
          </div>
        </div>
      )}

      {/* Combat Stats */}
      <div className="grid grid-cols-3 gap-1">
        <div
          className="bg-black/35 border rounded-md p-1 flex flex-col items-center justify-center"
          style={{ borderColor: "rgba(242, 208, 138, 0.3)" }}
        >
          <div className="text-[9px] text-gray-400">Attack</div>
          <div
            className="font-semibold text-xs"
            style={{ color: COLORS.ACCENT }}
          >
            {attackLevel}
          </div>
        </div>
        <div
          className="bg-black/35 border rounded-md p-1 flex flex-col items-center justify-center"
          style={{ borderColor: "rgba(242, 208, 138, 0.3)" }}
        >
          <div className="text-[9px] text-gray-400">Strength</div>
          <div
            className="font-semibold text-xs"
            style={{ color: COLORS.ACCENT }}
          >
            {strengthLevel}
          </div>
        </div>
        <div
          className="bg-black/35 border rounded-md p-1 flex flex-col items-center justify-center"
          style={{ borderColor: "rgba(242, 208, 138, 0.3)" }}
        >
          <div className="text-[9px] text-gray-400">Defense</div>
          <div
            className="font-semibold text-xs"
            style={{ color: COLORS.ACCENT }}
          >
            {defenseLevel}
          </div>
        </div>
      </div>

      {/* Combat Level */}
      <div
        className="bg-black/35 border rounded-md p-1 flex items-center justify-between text-[10px]"
        style={{
          borderColor: "rgba(242, 208, 138, 0.3)",
          color: COLORS.ACCENT,
        }}
      >
        <div className="font-semibold">Combat level</div>
        <div>{combatLevel}</div>
      </div>

      {/* Attack Style */}
      <div
        className="font-semibold mt-0.5 text-[10px]"
        style={{ color: COLORS.ACCENT }}
      >
        Attack style
      </div>
      <div
        className={`grid gap-1 ${styles.length === 4 ? "grid-cols-2" : "grid-cols-3"}`}
      >
        {styles.map((s) => (
          <button
            key={s.id}
            onClick={() => changeStyle(s.id)}
            disabled={cooldown > 0}
            className="rounded-md py-1 px-1 cursor-pointer transition-all text-[10px] hover:brightness-110"
            style={{
              backgroundColor:
                style === s.id
                  ? "rgba(242, 208, 138, 0.2)"
                  : "rgba(0, 0, 0, 0.35)",
              borderWidth: "1px",
              borderStyle: "solid",
              borderColor:
                style === s.id
                  ? "rgba(242, 208, 138, 0.8)"
                  : "rgba(242, 208, 138, 0.3)",
              color: style === s.id ? COLORS.ACCENT : "#d1d5db",
              fontWeight: style === s.id ? "bold" : "normal",
            }}
          >
            {s.label}
          </button>
        ))}
      </div>
      {/* Show which skill is being trained */}
      <div className="text-[9px] text-gray-400 italic">
        Training:{" "}
        {styles.find((s) => s.id === style)?.xp ??
          allStyles.find((s) => s.id === style)?.xp ??
          "Attack"}{" "}
        + Hitpoints
      </div>
      {cooldown > 0 && (
        <div
          className="text-[9px]"
          style={{ color: "rgba(242, 208, 138, 0.6)" }}
        >
          Style change available in {Math.ceil(cooldown / 1000)}s
        </div>
      )}

      {/* Auto Retaliate Toggle (OSRS-style) */}
      <button
        onClick={toggleAutoRetaliate}
        className="mt-1 w-full rounded-md py-1.5 px-2 cursor-pointer transition-all text-[10px] hover:brightness-110 flex items-center justify-between"
        style={{
          backgroundColor: autoRetaliate
            ? "rgba(34, 197, 94, 0.2)"
            : "rgba(0, 0, 0, 0.35)",
          borderWidth: "1px",
          borderStyle: "solid",
          borderColor: autoRetaliate
            ? "rgba(34, 197, 94, 0.8)"
            : "rgba(242, 208, 138, 0.3)",
          color: autoRetaliate ? "#86efac" : "#d1d5db",
        }}
      >
        <span className="font-semibold">Auto Retaliate</span>
        <span
          className="px-1.5 py-0.5 rounded text-[9px] font-bold"
          style={{
            backgroundColor: autoRetaliate
              ? "rgba(34, 197, 94, 0.3)"
              : "rgba(239, 68, 68, 0.3)",
            color: autoRetaliate ? "#86efac" : "#fca5a5",
          }}
        >
          {autoRetaliate ? "ON" : "OFF"}
        </span>
      </button>
    </div>
  );
}
