import React, { useState, useRef, useEffect } from "react";
import {
  // Combat & Action
  Swords,
  Zap,
  // Skills & Magic
  Wand2,
  BookOpen,
  // Inventory & Equipment
  Package,
  Gem,
  // Stats & Info
  Activity,
  // Prayer & Spiritual
  Sparkles,
  // Navigation
  Radar,
  Globe2,
  // Social
  MessageCircle,
  Users2,
  // Account & Settings
  CircleUserRound,
  SlidersHorizontal,
  // Quests
  ScrollText,
  // Dashboard
  LayoutGrid,
  type LucideIcon,
} from "lucide-react";
import { useThemeStore } from "@/ui";
import { animation } from "../../constants";

/** Available icon names for menu buttons */
export type MenuIconName =
  | "combat"
  | "skills"
  | "prayer"
  | "spells"
  | "inventory"
  | "equipment"
  | "stats"
  | "settings"
  | "account"
  | "minimap"
  | "map"
  | "chat"
  | "friends"
  | "quests"
  | "dashboard"
  | "action";

/**
 * Map of icon names to Lucide components - RPG themed
 * Using creative, thematic icons that match the game aesthetic
 */
const ICON_MAP: Record<MenuIconName, LucideIcon> = {
  inventory: Package, // Loot package/bag
  equipment: Gem, // Precious gear/items
  stats: Activity, // Vital signs/stats pulse
  skills: Wand2, // Magic wand for abilities
  prayer: Sparkles, // Divine sparkles
  spells: BookOpen, // Spellbook for magic
  combat: Swords, // Crossed swords
  chat: MessageCircle, // Speech bubble
  account: CircleUserRound, // Profile avatar
  settings: SlidersHorizontal, // Modern sliders
  minimap: Radar, // Radar sweep
  map: Globe2, // World globe
  friends: Users2, // Group of people
  quests: ScrollText, // Quest scroll
  dashboard: LayoutGrid, // Grid layout
  action: Zap, // Quick action lightning
};

/** Size presets for ring-integrated buttons */
const SIZE_CONFIG = {
  compact: { size: 30, iconSize: 16, borderWidth: 2, strokeWidth: 2 },
  small: { size: 36, iconSize: 18, borderWidth: 2, strokeWidth: 1.75 },
  normal: { size: 42, iconSize: 22, borderWidth: 2, strokeWidth: 1.5 },
} as const;

/** Calculate icon size relative to button size */
function calculateIconSize(buttonSize: number): number {
  // Icon is approximately 53% of button size, clamped to reasonable bounds
  return Math.max(12, Math.min(32, Math.round(buttonSize * 0.53)));
}

/** Calculate stroke width relative to icon size */
function calculateStrokeWidth(iconSize: number): number {
  // Stroke width inversely proportional to icon size for visual balance
  if (iconSize <= 14) return 2.25;
  if (iconSize <= 18) return 2;
  if (iconSize <= 22) return 1.75;
  return 1.5;
}

interface MenuButtonProps {
  /** Icon name from the preset list */
  iconName: MenuIconName;
  /** Tooltip label */
  label: string;
  /** Whether the button is currently active/selected */
  active: boolean;
  /** Click handler */
  onClick: () => void;
  /** Size variant (used when customSize is not provided) */
  size?: "compact" | "small" | "normal";
  /** Custom size in pixels (overrides size preset) */
  customSize?: number;
  /** Fluid mode - button fills container (100% width/height), icon scales to fit */
  fluid?: boolean;
  /** Panel ID for test selectors (optional) */
  panelId?: string;
}

export function MenuButton({
  iconName,
  label,
  active,
  onClick,
  size = "normal",
  customSize,
  fluid = false,
  panelId,
}: MenuButtonProps) {
  const theme = useThemeStore((s) => s.theme);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [measuredSize, setMeasuredSize] = useState(30); // Default fallback

  // Measure button size for fluid mode icon scaling
  useEffect(() => {
    if (!fluid || !buttonRef.current) return;

    const measureSize = () => {
      if (buttonRef.current) {
        const rect = buttonRef.current.getBoundingClientRect();
        // Use the smaller dimension to keep icon square
        const buttonSize = Math.min(rect.width, rect.height);
        if (buttonSize > 0) {
          setMeasuredSize(buttonSize);
        }
      }
    };

    // Initial measurement
    measureSize();

    // Re-measure on resize
    const observer = new ResizeObserver(measureSize);
    observer.observe(buttonRef.current);

    return () => observer.disconnect();
  }, [fluid]);

  // Determine config based on mode
  const config = fluid
    ? {
        size: undefined, // Will use 100%
        iconSize: calculateIconSize(measuredSize),
        borderWidth: 2,
        strokeWidth: calculateStrokeWidth(calculateIconSize(measuredSize)),
      }
    : customSize
      ? {
          size: customSize,
          iconSize: calculateIconSize(customSize),
          borderWidth: 2,
          strokeWidth: calculateStrokeWidth(calculateIconSize(customSize)),
        }
      : SIZE_CONFIG[size];

  const IconComponent = ICON_MAP[iconName];
  const [isHovered, setIsHovered] = useState(false);
  const [isPressed, setIsPressed] = useState(false);

  // Compute transform based on state (hover only, focus handled via CSS :focus-visible)
  const transform = isPressed
    ? "scale(0.95)"
    : isHovered
      ? "scale(1.1)"
      : "scale(1)";

  // Border color: gold when hovered or active, subtle default otherwise
  const borderColor =
    isHovered || active
      ? theme.colors.accent.primary
      : theme.colors.border.default;

  // Background: darker to match inventory panel slots
  const backgroundColor =
    isHovered || active
      ? `linear-gradient(180deg, ${theme.colors.accent.secondary}22 0%, ${theme.colors.background.primary} 100%)`
      : `linear-gradient(180deg, ${theme.colors.background.secondary} 0%, ${theme.colors.background.primary} 100%)`;

  return (
    <button
      ref={buttonRef}
      onClick={onClick}
      title={label}
      data-panel-id={panelId}
      className="focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:scale-110"
      style={{
        width: fluid ? "100%" : config.size,
        height: fluid ? "100%" : config.size,
        borderRadius: 4, // Slightly rounded to match inventory slots
        color: theme.colors.accent.primary, // Icons always gold
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        transition: `all ${animation.duration.base} ${animation.easing.easeOut}`,
        WebkitTapHighlightColor: "transparent",
        touchAction: "manipulation",
        position: "relative",
        border: `${config.borderWidth}px solid ${borderColor}`,
        background: backgroundColor,
        boxShadow: active
          ? `0 0 12px ${theme.colors.accent.primary}80, inset 0 0 8px ${theme.colors.accent.primary}33`
          : `inset 0 2px 4px rgba(0, 0, 0, 0.4), ${theme.shadows.sm}`,
        transform,
        outline: "none", // Focus ring handled via :focus-visible class
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => {
        setIsHovered(false);
        setIsPressed(false);
      }}
      onPointerDown={() => setIsPressed(true)}
      onPointerUp={() => setIsPressed(false)}
      onPointerCancel={() => setIsPressed(false)}
      onBlur={() => setIsPressed(false)}
    >
      <IconComponent size={config.iconSize} strokeWidth={config.strokeWidth} />
    </button>
  );
}
