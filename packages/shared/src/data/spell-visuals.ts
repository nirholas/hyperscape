/**
 * Spell Visual Configuration
 *
 * Defines visual properties for combat spell projectiles.
 * Used by ProjectileRenderer to render element-appropriate effects.
 *
 * Properties:
 * - color: Base hex color for the spell orb
 * - coreColor: Bright center color (defaults to white)
 * - size: Base sprite size in world units
 * - glowIntensity: Additive blending strength (0-1)
 * - trailLength: Number of trail sprites (0 = no trail)
 * - trailFade: How quickly trail fades (higher = faster fade)
 * - pulseSpeed: Oscillation speed for size pulsing (0 = no pulse)
 * - pulseAmount: Size variation amount (0.1 = 10% size change)
 */

export interface SpellVisualConfig {
  /** Base hex color for spell orb */
  color: number;
  /** Core/center color (default: white) */
  coreColor?: number;
  /** Base size in world units */
  size: number;
  /** Additive blending intensity (0-1) */
  glowIntensity: number;
  /** Number of trail sprites (0 = none) */
  trailLength?: number;
  /** Trail fade rate (higher = faster) */
  trailFade?: number;
  /** Size pulse oscillation speed */
  pulseSpeed?: number;
  /** Size pulse amount (0.1 = 10%) */
  pulseAmount?: number;
}

/**
 * Arrow Visual Configuration
 */
export interface ArrowVisualConfig {
  /** Shaft color (brown wood) */
  shaftColor: number;
  /** Arrowhead color (metal) */
  headColor: number;
  /** Fletching color (feathers) */
  fletchingColor: number;
  /** Arrow length in world units */
  length: number;
  /** Arrow width in world units */
  width: number;
  /** Whether to rotate sprite to face travel direction */
  rotateToDirection: boolean;
  /** Arc height multiplier (higher = more arc) */
  arcHeight: number;
}

/**
 * Strike spells - Level 1-13, weakest tier
 * Small projectiles with subtle glow
 */
const STRIKE_BASE: Partial<SpellVisualConfig> = {
  size: 0.5,
  glowIntensity: 0.7,
  trailLength: 4,
  trailFade: 0.5,
  pulseSpeed: 0,
  pulseAmount: 0,
};

/**
 * Bolt spells - Level 17-35, medium tier
 * Larger projectiles with more glow and trails
 */
const BOLT_BASE: Partial<SpellVisualConfig> = {
  size: 0.7,
  glowIntensity: 0.8,
  trailLength: 5,
  trailFade: 0.4,
  pulseSpeed: 5,
  pulseAmount: 0.2,
};

/**
 * Spell visual configurations by spell ID
 */
export const SPELL_VISUALS: Readonly<Record<string, SpellVisualConfig>> =
  Object.freeze({
    // Strike spells (Level 1-13)
    wind_strike: {
      ...STRIKE_BASE,
      color: 0xcccccc, // Light gray/white
      coreColor: 0xffffff,
      glowIntensity: 0.6,
    } as SpellVisualConfig,

    water_strike: {
      ...STRIKE_BASE,
      color: 0x3b82f6, // Blue
      coreColor: 0x93c5fd,
      glowIntensity: 0.75,
    } as SpellVisualConfig,

    earth_strike: {
      ...STRIKE_BASE,
      color: 0x8b4513, // Brown
      coreColor: 0xd2691e,
      glowIntensity: 0.6,
    } as SpellVisualConfig,

    fire_strike: {
      ...STRIKE_BASE,
      color: 0xff4500, // Orange-red
      coreColor: 0xffff00,
      glowIntensity: 0.85,
    } as SpellVisualConfig,

    // Bolt spells (Level 17-35)
    wind_bolt: {
      ...BOLT_BASE,
      color: 0xcccccc,
      coreColor: 0xffffff,
      glowIntensity: 0.7,
    } as SpellVisualConfig,

    water_bolt: {
      ...BOLT_BASE,
      color: 0x3b82f6,
      coreColor: 0x93c5fd,
      glowIntensity: 0.8,
    } as SpellVisualConfig,

    earth_bolt: {
      ...BOLT_BASE,
      color: 0x8b4513,
      coreColor: 0xd2691e,
      glowIntensity: 0.7,
    } as SpellVisualConfig,

    fire_bolt: {
      ...BOLT_BASE,
      color: 0xff4500,
      coreColor: 0xffff00,
      glowIntensity: 0.9,
    } as SpellVisualConfig,
  });

/**
 * Arrow visual configuration by arrow type
 */
export const ARROW_VISUALS: Readonly<Record<string, ArrowVisualConfig>> =
  Object.freeze({
    default: {
      shaftColor: 0x8b4513, // Brown wood
      headColor: 0xa0a0a0, // Gray metal
      fletchingColor: 0xffffff, // White feathers
      length: 0.35,
      width: 0.08,
      rotateToDirection: true,
      arcHeight: 0, // Straight line trajectory
    },

    bronze_arrow: {
      shaftColor: 0x8b4513,
      headColor: 0xcd7f32, // Bronze
      fletchingColor: 0xffffff,
      length: 0.35,
      width: 0.08,
      rotateToDirection: true,
      arcHeight: 0,
    },

    iron_arrow: {
      shaftColor: 0x8b4513,
      headColor: 0x71797e, // Iron gray
      fletchingColor: 0xffffff,
      length: 0.35,
      width: 0.08,
      rotateToDirection: true,
      arcHeight: 0,
    },

    steel_arrow: {
      shaftColor: 0x8b4513,
      headColor: 0xb0b0b0, // Steel
      fletchingColor: 0xffffff,
      length: 0.35,
      width: 0.08,
      rotateToDirection: true,
      arcHeight: 0,
    },

    mithril_arrow: {
      shaftColor: 0x8b4513,
      headColor: 0x4169e1, // Mithril blue
      fletchingColor: 0xe0e0ff,
      length: 0.35,
      width: 0.08,
      rotateToDirection: true,
      arcHeight: 0,
    },

    adamant_arrow: {
      shaftColor: 0x8b4513,
      headColor: 0x228b22, // Adamant green
      fletchingColor: 0xe0ffe0,
      length: 0.35,
      width: 0.08,
      rotateToDirection: true,
      arcHeight: 0,
    },
  });

/**
 * Get spell visual config, with fallback to element-based default
 */
export function getSpellVisual(spellId: string): SpellVisualConfig {
  // Direct lookup
  if (spellId in SPELL_VISUALS) {
    return SPELL_VISUALS[spellId];
  }

  // Element-based fallback
  if (spellId.includes("wind") || spellId.includes("air")) {
    return SPELL_VISUALS.wind_strike;
  }
  if (spellId.includes("water")) {
    return SPELL_VISUALS.water_strike;
  }
  if (spellId.includes("earth")) {
    return SPELL_VISUALS.earth_strike;
  }
  if (spellId.includes("fire")) {
    return SPELL_VISUALS.fire_strike;
  }

  // Ultimate fallback - purple magic
  return {
    color: 0x9966ff,
    coreColor: 0xccaaff,
    size: 0.3,
    glowIntensity: 0.4,
    trailLength: 4,
    trailFade: 0.35,
  };
}

/**
 * Get arrow visual config by arrow item ID
 */
export function getArrowVisual(arrowId: string): ArrowVisualConfig {
  // Direct lookup
  if (arrowId in ARROW_VISUALS) {
    return ARROW_VISUALS[arrowId];
  }

  // Pattern matching for arrow types
  if (arrowId.includes("bronze")) {
    return ARROW_VISUALS.bronze_arrow;
  }
  if (arrowId.includes("iron")) {
    return ARROW_VISUALS.iron_arrow;
  }
  if (arrowId.includes("steel")) {
    return ARROW_VISUALS.steel_arrow;
  }
  if (arrowId.includes("mithril")) {
    return ARROW_VISUALS.mithril_arrow;
  }
  if (arrowId.includes("adamant")) {
    return ARROW_VISUALS.adamant_arrow;
  }

  // Default arrow
  return ARROW_VISUALS.default;
}
