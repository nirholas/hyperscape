import React from "react";
import { createPortal } from "react-dom";
import {
  calculateCursorTooltipPosition,
  TOOLTIP_SIZE_ESTIMATES,
  useThemeStore,
} from "@/ui";
import { getItem } from "@hyperscape/shared";
import type { Item } from "../../../types";

/** Rarity colors shared across equipment UI */
export const RARITY_COLORS: Record<string, string> = {
  common: "#9d9d9d",
  uncommon: "#1eff00",
  rare: "#0070dd",
  epic: "#a335ee",
  legendary: "#ff8000",
  mythic: "#e6cc80",
};

export interface EquipmentSlotData {
  key: string;
  label: string;
  icon: React.ReactNode;
  item: Item | null;
}

export interface EquipmentHoverState {
  slot: EquipmentSlotData;
  position: { x: number; y: number };
}

interface EquipmentTooltipProps {
  hoverState: EquipmentHoverState | null;
}

/**
 * Enhanced equipment hover tooltip component.
 * Shows item stats, rarity, requirements, and hints.
 * Uses a portal to render at cursor position with edge detection.
 */
export const EquipmentTooltip = React.memo(function EquipmentTooltip({
  hoverState,
}: EquipmentTooltipProps) {
  const theme = useThemeStore((s) => s.theme);

  if (!hoverState) return null;

  const item = hoverState.slot.item;
  if (!item) return null;

  // Get full item data for additional info
  const itemData = getItem(item.id);
  const rarity = itemData?.rarity || "common";
  const equipSlot = itemData?.equipSlot || hoverState.slot.label;

  const rarityColor = RARITY_COLORS[rarity] || theme.colors.accent.primary;

  // Use tooltip positioning with edge detection
  const { left, top } = calculateCursorTooltipPosition(
    { x: hoverState.position.x, y: hoverState.position.y },
    TOOLTIP_SIZE_ESTIMATES.large,
    8,
  );

  const hasBonuses =
    item.bonuses &&
    ((item.bonuses.attack !== undefined && item.bonuses.attack !== 0) ||
      (item.bonuses.defense !== undefined && item.bonuses.defense !== 0) ||
      (item.bonuses.strength !== undefined && item.bonuses.strength !== 0));

  // Check for per-style bonuses (armor system)
  const b = item.bonuses ?? {};
  const hasPerStyleDefence =
    b.defenseStab !== undefined ||
    b.defenseSlash !== undefined ||
    b.defenseCrush !== undefined;
  const hasPerStyleAttack =
    b.attackStab !== undefined ||
    b.attackSlash !== undefined ||
    b.attackCrush !== undefined;
  const hasMagicBonuses =
    (b.attackMagic !== undefined && b.attackMagic !== 0) ||
    (b.defenseMagic !== undefined && b.defenseMagic !== 0);
  const hasRangedBonuses =
    (b.attackRanged !== undefined && b.attackRanged !== 0) ||
    (b.defenseRanged !== undefined && b.defenseRanged !== 0);
  const hasDetailedBonuses =
    hasPerStyleDefence ||
    hasPerStyleAttack ||
    hasMagicBonuses ||
    hasRangedBonuses;

  return createPortal(
    <div
      className="pointer-events-none"
      style={{
        position: "fixed",
        left,
        top,
        zIndex: theme.zIndex.tooltip,
        background: `linear-gradient(180deg, ${theme.colors.background.primary} 0%, ${theme.colors.background.secondary} 100%)`,
        border: `1px solid ${theme.colors.border.hover}`,
        borderRadius: `${theme.borderRadius.md}px`,
        padding: "10px 12px",
        boxShadow: "0 4px 16px rgba(0,0,0,0.5)",
        minWidth: "160px",
        maxWidth: "240px",
      }}
    >
      {/* Item name with rarity color */}
      <div
        style={{
          color: rarityColor,
          fontWeight: theme.typography.fontWeight.bold,
          fontSize: theme.typography.fontSize.sm,
          marginBottom: "2px",
        }}
      >
        {item.name}
      </div>

      {/* Item type and rarity */}
      <div
        style={{
          fontSize: "10px",
          color: theme.colors.text.muted,
          marginBottom: hasBonuses ? "8px" : "0",
          textTransform: "capitalize",
        }}
      >
        {equipSlot} • {rarity}
      </div>

      {/* Stat bonuses — detailed per-style for armor, simple for weapons */}
      {hasDetailedBonuses ? (
        <div
          style={{
            fontSize: "11px",
            borderTop: `1px solid ${theme.colors.border.default}40`,
            paddingTop: "6px",
            marginBottom: "6px",
          }}
        >
          {hasPerStyleDefence && (
            <div
              style={{
                color: theme.colors.text.secondary,
                marginBottom: "3px",
              }}
            >
              <div style={{ marginBottom: "1px" }}>
                <span style={{ color: theme.colors.text.muted }}>
                  Defence:{" "}
                </span>
                {[
                  b.defenseStab !== undefined &&
                    `${b.defenseStab >= 0 ? "+" : ""}${b.defenseStab} stab`,
                  b.defenseSlash !== undefined &&
                    `${b.defenseSlash >= 0 ? "+" : ""}${b.defenseSlash} slash`,
                  b.defenseCrush !== undefined &&
                    `${b.defenseCrush >= 0 ? "+" : ""}${b.defenseCrush} crush`,
                ]
                  .filter(Boolean)
                  .join(" / ")}
              </div>
              <div>
                <span style={{ color: theme.colors.text.muted }}>
                  {"         "}
                </span>
                {[
                  b.defenseMagic !== undefined && b.defenseMagic !== 0 && (
                    <span
                      key="mdef"
                      style={{
                        color:
                          b.defenseMagic < 0
                            ? theme.colors.state.danger
                            : theme.colors.state.success,
                      }}
                    >
                      {b.defenseMagic >= 0 ? "+" : ""}
                      {b.defenseMagic} magic
                    </span>
                  ),
                  b.defenseRanged !== undefined && (
                    <span key="rdef">
                      {b.defenseRanged >= 0 ? "+" : ""}
                      {b.defenseRanged} ranged
                    </span>
                  ),
                ]
                  .filter(Boolean)
                  .map((el, i) => (
                    <React.Fragment key={i}>
                      {i > 0 && " / "}
                      {el}
                    </React.Fragment>
                  ))}
              </div>
            </div>
          )}
          {(hasMagicBonuses || hasRangedBonuses || hasPerStyleAttack) && (
            <div style={{ color: theme.colors.text.secondary }}>
              <span style={{ color: theme.colors.text.muted }}>Attack: </span>
              {[
                hasPerStyleAttack &&
                  b.attackStab !== undefined &&
                  b.attackStab !== 0 &&
                  `${b.attackStab >= 0 ? "+" : ""}${b.attackStab} stab`,
                hasPerStyleAttack &&
                  b.attackSlash !== undefined &&
                  b.attackSlash !== 0 &&
                  `${b.attackSlash >= 0 ? "+" : ""}${b.attackSlash} slash`,
                hasPerStyleAttack &&
                  b.attackCrush !== undefined &&
                  b.attackCrush !== 0 &&
                  `${b.attackCrush >= 0 ? "+" : ""}${b.attackCrush} crush`,
                b.attackMagic !== undefined && b.attackMagic !== 0 && (
                  <span
                    key="matk"
                    style={{
                      color:
                        b.attackMagic < 0
                          ? theme.colors.state.danger
                          : theme.colors.state.success,
                    }}
                  >
                    {b.attackMagic >= 0 ? "+" : ""}
                    {b.attackMagic} magic
                  </span>
                ),
                b.attackRanged !== undefined && b.attackRanged !== 0 && (
                  <span
                    key="ratk"
                    style={{
                      color:
                        b.attackRanged < 0
                          ? theme.colors.state.danger
                          : theme.colors.state.success,
                    }}
                  >
                    {b.attackRanged >= 0 ? "+" : ""}
                    {b.attackRanged} ranged
                  </span>
                ),
              ]
                .filter(Boolean)
                .map((el, i) => (
                  <React.Fragment key={i}>
                    {i > 0 && " / "}
                    {el}
                  </React.Fragment>
                ))}
            </div>
          )}
        </div>
      ) : hasBonuses ? (
        <div
          style={{
            fontSize: "11px",
            borderTop: `1px solid ${theme.colors.border.default}40`,
            paddingTop: "6px",
            marginBottom: "6px",
          }}
        >
          {item.bonuses!.attack !== undefined && item.bonuses!.attack !== 0 && (
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                color: theme.colors.text.secondary,
                marginBottom: "2px",
              }}
            >
              <span>Attack</span>
              <span style={{ color: theme.colors.state.success }}>
                +{item.bonuses!.attack}
              </span>
            </div>
          )}
          {item.bonuses!.defense !== undefined &&
            item.bonuses!.defense !== 0 && (
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  color: theme.colors.text.secondary,
                  marginBottom: "2px",
                }}
              >
                <span>Defense</span>
                <span style={{ color: theme.colors.state.success }}>
                  +{item.bonuses!.defense}
                </span>
              </div>
            )}
          {item.bonuses!.strength !== undefined &&
            item.bonuses!.strength !== 0 && (
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  color: theme.colors.text.secondary,
                }}
              >
                <span>Strength</span>
                <span style={{ color: theme.colors.state.success }}>
                  +{item.bonuses!.strength}
                </span>
              </div>
            )}
        </div>
      ) : null}

      {/* Level requirements */}
      {itemData?.requirements?.level && (
        <div
          style={{
            fontSize: "10px",
            color: theme.colors.text.muted,
            marginBottom: "4px",
          }}
        >
          Requires Level {itemData.requirements.level}
        </div>
      )}
      {itemData?.requirements?.skills && !itemData?.requirements?.level && (
        <div
          style={{
            fontSize: "10px",
            color: theme.colors.text.muted,
            marginBottom: "4px",
          }}
        >
          Requires{" "}
          {Object.entries(
            itemData.requirements.skills as Record<string, number>,
          )
            .filter(([, lvl]) => lvl > 1)
            .map(
              ([skill, lvl]) =>
                `${lvl} ${skill.charAt(0).toUpperCase() + skill.slice(1)}`,
            )
            .join(", ")}
        </div>
      )}

      {/* Click hint */}
      <div
        style={{
          fontSize: "9px",
          color: theme.colors.text.muted,
          marginTop: "6px",
          paddingTop: "6px",
          borderTop: `1px solid ${theme.colors.border.default}30`,
          opacity: 0.7,
        }}
      >
        Click to unequip • Right-click for options
      </div>
    </div>,
    document.body,
  );
});
