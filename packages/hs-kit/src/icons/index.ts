/**
 * hs-kit Icon System
 *
 * Pre-configured Lucide icons for game UI with consistent styling.
 * All icons are re-exported for convenience and type safety.
 *
 * @packageDocumentation
 */

import {
  // Inventory & Items
  Package,
  Backpack,
  Box,
  Archive,
  // Equipment & Gear
  Gem,
  Shield,
  ShieldHalf,
  Medal,
  // Stats & Info
  Activity,
  BarChart3,
  TrendingUp,
  Gauge,
  Heart,
  HeartPulse,
  // Skills & Abilities
  Wand2,
  Flame,
  Zap,
  Star,
  Brain,
  // Prayer & Spiritual
  Sparkles,
  HeartHandshake,
  Sun,
  Moon,
  // Combat
  Swords,
  Sword,
  Axe,
  Crosshair,
  Target,
  Skull,
  // Navigation & Maps
  Radar,
  Globe2,
  Map,
  MapPin,
  Compass,
  Navigation,
  // Social & Communication
  MessageCircle,
  MessageSquare,
  MessagesSquare,
  Users,
  Users2,
  UserPlus,
  // Account & Profile
  CircleUserRound,
  User,
  Crown,
  BadgeCheck,
  IdCard,
  // Settings & Config
  SlidersHorizontal,
  Settings,
  Settings2,
  Wrench,
  // Quests & Tasks
  ScrollText,
  ClipboardList,
  ListTodo,
  BookOpen,
  // Actions & Quick Access
  Play,
  FastForward,
  RotateCcw,
  RefreshCw,
  // Layout & Dashboard
  LayoutGrid,
  LayoutDashboard,
  Layers,
  Grid3X3,
  // Banking & Economy
  Landmark,
  Coins,
  Wallet,
  PiggyBank,
  // Crafting & Production
  Hammer,
  Pickaxe,
  FlaskConical,
  Anvil,
  // Misc UI
  Lock,
  Unlock,
  Eye,
  EyeOff,
  Bell,
  BellOff,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  X,
  Check,
  Plus,
  Minus,
  ChevronUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  type LucideIcon,
} from "lucide-react";

// Re-export LucideIcon type for consumers
export type { LucideIcon };

/**
 * Game UI icon presets - curated icons for common game panels
 * These are the recommended icons for each panel type
 */
export const GameIcons = {
  // Core panels
  inventory: Package,
  equipment: Gem,
  stats: Activity,
  skills: Wand2,
  prayer: Sparkles,
  combat: Swords,
  chat: MessageCircle,
  account: CircleUserRound,
  settings: SlidersHorizontal,

  // Navigation
  minimap: Radar,
  map: Globe2,
  compass: Compass,

  // Social
  friends: Users2,
  party: Users,
  guild: Crown,

  // Quests & Progress
  quests: ScrollText,
  achievements: Medal,
  journal: BookOpen,

  // Economy
  bank: Landmark,
  shop: Coins,
  trade: Wallet,

  // Actions
  action: Zap,
  abilities: Star,
  spells: Flame,

  // Crafting
  crafting: Hammer,
  mining: Pickaxe,
  alchemy: FlaskConical,

  // Dashboard
  dashboard: LayoutGrid,
  overview: LayoutDashboard,

  // Controls
  lock: Lock,
  unlock: Unlock,
  close: X,
  confirm: Check,
  add: Plus,
  remove: Minus,
  expand: Maximize,
  collapse: Minimize,
} as const;

/** Type for game icon names */
export type GameIconName = keyof typeof GameIcons;

/**
 * Get a game icon by name
 * @param name - The icon name from GameIcons
 * @returns The Lucide icon component
 */
export function getGameIcon(name: GameIconName): LucideIcon {
  return GameIcons[name];
}

/**
 * All individual icons re-exported for direct use
 */
export {
  // Inventory & Items
  Package,
  Backpack,
  Box,
  Archive,
  // Equipment & Gear
  Gem,
  Shield,
  ShieldHalf,
  Medal,
  // Stats & Info
  Activity,
  BarChart3,
  TrendingUp,
  Gauge,
  Heart,
  HeartPulse,
  // Skills & Abilities
  Wand2,
  Flame,
  Zap,
  Star,
  Brain,
  // Prayer & Spiritual
  Sparkles,
  HeartHandshake,
  Sun,
  Moon,
  // Combat
  Swords,
  Sword,
  Axe,
  Crosshair,
  Target,
  Skull,
  // Navigation & Maps
  Radar,
  Globe2,
  Map,
  MapPin,
  Compass,
  Navigation,
  // Social & Communication
  MessageCircle,
  MessageSquare,
  MessagesSquare,
  Users,
  Users2,
  UserPlus,
  // Account & Profile
  CircleUserRound,
  User,
  Crown,
  BadgeCheck,
  IdCard,
  // Settings & Config
  SlidersHorizontal,
  Settings,
  Settings2,
  Wrench,
  // Quests & Tasks
  ScrollText,
  ClipboardList,
  ListTodo,
  BookOpen,
  // Actions & Quick Access
  Play,
  FastForward,
  RotateCcw,
  RefreshCw,
  // Layout & Dashboard
  LayoutGrid,
  LayoutDashboard,
  Layers,
  Grid3X3,
  // Banking & Economy
  Landmark,
  Coins,
  Wallet,
  PiggyBank,
  // Crafting & Production
  Hammer,
  Pickaxe,
  FlaskConical,
  Anvil,
  // Misc UI
  Lock,
  Unlock,
  Eye,
  EyeOff,
  Bell,
  BellOff,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  X,
  Check,
  Plus,
  Minus,
  ChevronUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
};
