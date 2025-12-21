"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  Clock,
  Bookmark,
  Sparkles,
  Box,
  User,
  Sword,
  TreePine,
  Music,
  Settings,
  FileText,
  History,
  Star,
  ArrowRight,
  Command,
  FolderOpen,
  Plus,
  Trash2,
  Copy,
  Edit3,
  RefreshCw,
  Gamepad2,
  Palette,
  Wand2,
  Image,
  Upload,
  Globe,
  Layers,
  Camera,
  Shield,
  Hammer,
  Crown,
  Database,
  ExternalLink,
  Building,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface CommandItem {
  id: string;
  title: string;
  description?: string;
  icon: React.ReactNode;
  category: "recent" | "saved" | "action" | "navigation";
  action: () => void;
  keywords?: string[];
}

interface SavedPrompt {
  id: string;
  prompt: string;
  category: string;
  createdAt: string;
}

interface RecentGeneration {
  id: string;
  name: string;
  category: string;
  prompt: string;
  thumbnailUrl?: string;
  createdAt: string;
}

interface MaterialPreset {
  id: string;
  name: string;
  displayName: string;
  category: string;
  tier: number;
  color: string;
  stylePrompt: string;
  description?: string;
}

interface GameStyleInfo {
  id: string;
  name: string;
  base: string;
  enhanced?: string;
  generation?: string;
}

const STORAGE_KEY_PROMPTS = "hyperforge-saved-prompts";
const STORAGE_KEY_RECENT = "hyperforge-recent-generations";
const STORAGE_KEY_INITIALIZED = "hyperforge-prompts-initialized";
const STORAGE_KEY_GAME_STYLE = "hyperforge-active-game-style";

type PaletteView =
  | "commands"
  | "prompts"
  | "prompt-editor"
  | "game-styles"
  | "materials";

// Hyperscape game-specific prompt categories
const PROMPT_CATEGORIES = [
  {
    value: "mob",
    label: "Mob / Enemy",
    desc: "Goblins, giants, dragons, undead",
  },
  {
    value: "npc",
    label: "NPC / Friendly",
    desc: "Shopkeepers, quest givers, guards",
  },
  {
    value: "boss",
    label: "Boss Monster",
    desc: "Dungeon bosses, raid encounters",
  },
  { value: "weapon", label: "Weapon", desc: "Swords, bows, staves, axes" },
  {
    value: "armor",
    label: "Armor / Clothing",
    desc: "Helmets, platebodies, robes",
  },
  {
    value: "item",
    label: "Item / Consumable",
    desc: "Potions, food, runes, tools",
  },
  {
    value: "resource",
    label: "Resource Node",
    desc: "Ore rocks, trees, fishing spots",
  },
  {
    value: "prop",
    label: "World Prop",
    desc: "Crates, barrels, signs, furniture",
  },
  {
    value: "building",
    label: "Building / Structure",
    desc: "Houses, towers, ruins",
  },
  {
    value: "environment",
    label: "Environment",
    desc: "Terrain, plants, decorations",
  },
] as const;

// Default Hyperscape-themed prompt templates
const DEFAULT_PROMPTS: SavedPrompt[] = [
  // Mobs
  {
    id: "default-goblin",
    prompt:
      "Low-poly fantasy goblin warrior, green skin, leather armor scraps, rusty dagger, menacing pose, classic MMORPG style, game-ready mesh",
    category: "mob",
    createdAt: new Date().toISOString(),
  },
  {
    id: "default-skeleton",
    prompt:
      "Stylized undead skeleton warrior, rusted chainmail, broken shield, glowing eye sockets, low-poly game asset, RuneScape aesthetic",
    category: "mob",
    createdAt: new Date().toISOString(),
  },
  {
    id: "default-dragon",
    prompt:
      "Medieval fantasy dragon, [COLOR] scales, large wings folded, fierce expression, low-poly stylized, MMORPG boss style",
    category: "boss",
    createdAt: new Date().toISOString(),
  },
  // NPCs
  {
    id: "default-shopkeeper",
    prompt:
      "Fantasy shopkeeper NPC, friendly expression, apron, medieval merchant clothing, holding a scroll, stylized low-poly game character",
    category: "npc",
    createdAt: new Date().toISOString(),
  },
  {
    id: "default-guard",
    prompt:
      "Medieval town guard, steel helmet and chainmail, holding spear, vigilant stance, low-poly MMORPG style character",
    category: "npc",
    createdAt: new Date().toISOString(),
  },
  // Weapons
  {
    id: "default-sword",
    prompt:
      "[MATERIAL] longsword, ornate crossguard, leather-wrapped handle, fantasy MMORPG weapon, game-ready low-poly asset",
    category: "weapon",
    createdAt: new Date().toISOString(),
  },
  {
    id: "default-staff",
    prompt:
      "Wizard's staff with [ELEMENT] crystal orb, carved wooden shaft, magical runes, fantasy RPG style, low-poly game asset",
    category: "weapon",
    createdAt: new Date().toISOString(),
  },
  // Armor
  {
    id: "default-helmet",
    prompt:
      "[MATERIAL] full helm, medieval fantasy design, ornate visor, game-ready armor piece, stylized low-poly",
    category: "armor",
    createdAt: new Date().toISOString(),
  },
  // Items
  {
    id: "default-potion",
    prompt:
      "Glass potion flask with [COLOR] liquid, cork stopper, magical glow effect, fantasy RPG consumable, low-poly game item",
    category: "item",
    createdAt: new Date().toISOString(),
  },
  // Resources
  {
    id: "default-ore",
    prompt:
      "[TYPE] ore rock deposit, embedded crystals, rough stone base, mining node, stylized fantasy game asset",
    category: "resource",
    createdAt: new Date().toISOString(),
  },
  // Props
  {
    id: "default-chest",
    prompt:
      "Wooden treasure chest with iron bands, ornate lock, slightly open lid with gold glint, fantasy RPG loot container",
    category: "prop",
    createdAt: new Date().toISOString(),
  },
];

export function CommandPalette() {
  const [isOpen, setIsOpen] = useState(false);
  const [view, setView] = useState<PaletteView>("commands");
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [savedPrompts, setSavedPrompts] = useState<SavedPrompt[]>([]);
  const [recentGenerations, setRecentGenerations] = useState<
    RecentGeneration[]
  >([]);
  const [editingPrompt, setEditingPrompt] = useState<SavedPrompt | null>(null);
  const [newPromptText, setNewPromptText] = useState("");
  const [newPromptCategory, setNewPromptCategory] = useState("mob");
  const [materialPresets, setMaterialPresets] = useState<MaterialPreset[]>([]);
  const [gameStyles, setGameStyles] = useState<Record<string, GameStyleInfo>>(
    {},
  );
  const [activeGameStyle, setActiveGameStyle] = useState<string>("runescape");
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  // Load saved prompts and recent generations from localStorage
  const loadData = useCallback(() => {
    if (typeof window === "undefined") return;

    try {
      // Check if we need to initialize with default prompts
      const initialized = localStorage.getItem(STORAGE_KEY_INITIALIZED);
      if (!initialized) {
        // First time - set default Hyperscape prompts
        localStorage.setItem(
          STORAGE_KEY_PROMPTS,
          JSON.stringify(DEFAULT_PROMPTS),
        );
        localStorage.setItem(STORAGE_KEY_INITIALIZED, "true");
        setSavedPrompts(DEFAULT_PROMPTS);
      } else {
        const prompts = localStorage.getItem(STORAGE_KEY_PROMPTS);
        if (prompts) setSavedPrompts(JSON.parse(prompts));
      }

      const recent = localStorage.getItem(STORAGE_KEY_RECENT);
      if (recent) setRecentGenerations(JSON.parse(recent));
    } catch {
      // Ignore parse errors
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [isOpen, loadData]);

  // Load material presets and game styles
  useEffect(() => {
    if (!isOpen) return;

    const loadPresets = async () => {
      try {
        const [materialsRes, stylesRes] = await Promise.all([
          fetch("/prompts/material-presets.json"),
          fetch("/prompts/game-style-prompts.json"),
        ]);

        if (materialsRes.ok) {
          const materials = await materialsRes.json();
          setMaterialPresets(materials);
        }

        if (stylesRes.ok) {
          const stylesData = await stylesRes.json();
          const allStyles: Record<string, GameStyleInfo> = {};
          if (stylesData.default) {
            Object.entries(stylesData.default).forEach(([id, style]) => {
              allStyles[id] = { id, ...(style as Omit<GameStyleInfo, "id">) };
            });
          }
          if (stylesData.custom) {
            Object.entries(stylesData.custom).forEach(([id, style]) => {
              allStyles[id] = { id, ...(style as Omit<GameStyleInfo, "id">) };
            });
          }
          setGameStyles(allStyles);
        }

        // Load active game style from storage
        const savedStyle = localStorage.getItem(STORAGE_KEY_GAME_STYLE);
        if (savedStyle) {
          setActiveGameStyle(savedStyle);
        }
      } catch {
        // Ignore errors
      }
    };

    loadPresets();
  }, [isOpen]);

  // Save active game style
  const setAndSaveGameStyle = useCallback((styleId: string) => {
    setActiveGameStyle(styleId);
    localStorage.setItem(STORAGE_KEY_GAME_STYLE, styleId);
  }, []);

  // Delete a saved prompt
  const deletePrompt = useCallback(
    (promptId: string) => {
      const updated = savedPrompts.filter((p) => p.id !== promptId);
      setSavedPrompts(updated);
      localStorage.setItem(STORAGE_KEY_PROMPTS, JSON.stringify(updated));
    },
    [savedPrompts],
  );

  // Save/update a prompt
  const saveOrUpdatePrompt = useCallback(() => {
    if (!newPromptText.trim()) return;

    let updated: SavedPrompt[];

    if (editingPrompt) {
      // Update existing
      updated = savedPrompts.map((p) =>
        p.id === editingPrompt.id
          ? { ...p, prompt: newPromptText, category: newPromptCategory }
          : p,
      );
    } else {
      // Add new
      const newPrompt: SavedPrompt = {
        id: `prompt_${Date.now()}`,
        prompt: newPromptText,
        category: newPromptCategory,
        createdAt: new Date().toISOString(),
      };
      updated = [newPrompt, ...savedPrompts];
    }

    setSavedPrompts(updated);
    localStorage.setItem(
      STORAGE_KEY_PROMPTS,
      JSON.stringify(updated.slice(0, 50)),
    );
    setView("prompts");
    setEditingPrompt(null);
    setNewPromptText("");
  }, [newPromptText, newPromptCategory, editingPrompt, savedPrompts]);

  // Keyboard shortcut to open palette
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+P or Cmd+P to open
      if ((e.ctrlKey || e.metaKey) && e.key === "p") {
        e.preventDefault();
        setIsOpen(true);
        setView("commands");
        setQuery("");
        setSelectedIndex(0);
      }

      // Escape to close or go back
      if (e.key === "Escape" && isOpen) {
        if (view === "prompt-editor") {
          setView("prompts");
          setEditingPrompt(null);
        } else if (view !== "commands") {
          setView("commands");
        } else {
          setIsOpen(false);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, view]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  // Build command items
  const commands = useMemo<CommandItem[]>(() => {
    const items: CommandItem[] = [];

    // Navigation actions
    items.push(
      {
        id: "nav-generate",
        title: "Generate New Asset",
        description: "Create a new 3D model from text or image",
        icon: <Sparkles className="w-4 h-4 text-cyan-400" />,
        category: "action",
        action: () => router.push("/generate"),
        keywords: ["create", "new", "model", "3d"],
      },
      {
        id: "nav-vault",
        title: "Open Asset Vault",
        description: "Browse your asset library",
        icon: <Box className="w-4 h-4 text-purple-400" />,
        category: "navigation",
        action: () => router.push("/"),
        keywords: ["library", "assets", "browse"],
      },
      {
        id: "nav-retarget",
        title: "Retarget Animations",
        description: "Convert models to VRM and test animations",
        icon: <User className="w-4 h-4 text-green-400" />,
        category: "navigation",
        action: () => router.push("/studio/retarget"),
        keywords: ["vrm", "animation", "avatar"],
      },
      {
        id: "nav-structures",
        title: "Structure Studio",
        description: "Build modular structures and buildings",
        icon: <Building className="w-4 h-4 text-amber-400" />,
        category: "navigation",
        action: () => router.push("/studio/structures"),
        keywords: ["building", "structure", "house", "modular", "wall", "door"],
      },
      {
        id: "nav-audio",
        title: "Audio Studio",
        description: "Generate voice, music, and sound effects",
        icon: <Music className="w-4 h-4 text-amber-400" />,
        category: "navigation",
        action: () => router.push("/audio"),
        keywords: ["voice", "music", "sfx", "sound"],
      },
      {
        id: "nav-content",
        title: "Content Generator",
        description: "Create NPC dialogue, quests, and lore",
        icon: <FileText className="w-4 h-4 text-blue-400" />,
        category: "navigation",
        action: () => router.push("/content"),
        keywords: ["dialogue", "npc", "quest", "lore"],
      },
      {
        id: "nav-settings",
        title: "Settings",
        description: "Configure API keys and preferences",
        icon: <Settings className="w-4 h-4 text-zinc-400" />,
        category: "navigation",
        action: () => router.push("/settings"),
        keywords: ["config", "api", "keys"],
      },
    );

    // Quick generation actions
    items.push(
      {
        id: "quick-npc",
        title: "Quick Generate: NPC",
        description: "Generate a new NPC character",
        icon: <User className="w-4 h-4 text-green-400" />,
        category: "action",
        action: () => router.push("/generate?type=npc"),
        keywords: ["character", "mob", "enemy"],
      },
      {
        id: "quick-weapon",
        title: "Quick Generate: Weapon",
        description: "Generate a new weapon",
        icon: <Sword className="w-4 h-4 text-red-400" />,
        category: "action",
        action: () => router.push("/generate?type=weapon"),
        keywords: ["sword", "axe", "bow"],
      },
      {
        id: "quick-environment",
        title: "Quick Generate: Environment",
        description: "Generate environment props",
        icon: <TreePine className="w-4 h-4 text-emerald-400" />,
        category: "action",
        action: () => router.push("/generate?type=environment"),
        keywords: ["tree", "rock", "building"],
      },
    );

    // Game actions - prioritized at top of actions
    items.unshift(
      {
        id: "open-game",
        title: "Open Game Client",
        description: "Launch Hyperscape (localhost:3333)",
        icon: <Gamepad2 className="w-4 h-4 text-green-400" />,
        category: "action",
        action: () => window.open("http://localhost:3333", "_blank"),
        keywords: ["play", "test", "game", "launch", "hyperscape", "browser"],
      },
      {
        id: "reload-server",
        title: "Reload Game Server",
        description: "Hot-reload world entities and assets",
        icon: <RefreshCw className="w-4 h-4 text-amber-400" />,
        category: "action",
        action: async () => {
          try {
            await fetch("http://localhost:5555/api/reload", { method: "POST" });
          } catch {
            // Server may not be running
          }
        },
        keywords: ["refresh", "restart", "reload", "server", "hot"],
      },
    );

    // Prompt Vault actions
    items.push(
      {
        id: "prompt-vault",
        title: "Open Prompt Vault",
        description: `Browse and manage ${savedPrompts.length} saved prompts`,
        icon: <FolderOpen className="w-4 h-4 text-amber-400" />,
        category: "action",
        action: () => setView("prompts"),
        keywords: ["prompts", "saved", "library", "vault"],
      },
      {
        id: "prompt-new",
        title: "Create New Prompt",
        description: "Save a new prompt template",
        icon: <Plus className="w-4 h-4 text-green-400" />,
        category: "action",
        action: () => {
          setEditingPrompt(null);
          setNewPromptText("");
          setNewPromptCategory("mob");
          setView("prompt-editor");
        },
        keywords: ["new", "add", "create", "prompt"],
      },
    );

    // Game Style & Material actions
    items.push(
      {
        id: "game-styles",
        title: "Game Styles",
        description: `Active: ${gameStyles[activeGameStyle]?.name || activeGameStyle}`,
        icon: <Sparkles className="w-4 h-4 text-amber-400" />,
        category: "action",
        action: () => setView("game-styles"),
        keywords: ["style", "runescape", "custom", "theme", "aesthetic"],
      },
      {
        id: "materials",
        title: "Material Presets",
        description: `${materialPresets.length} materials available`,
        icon: <Palette className="w-4 h-4 text-purple-400" />,
        category: "action",
        action: () => setView("materials"),
        keywords: [
          "material",
          "bronze",
          "iron",
          "steel",
          "mithril",
          "leather",
          "wood",
          "texture",
        ],
      },
    );

    // Quick material application (top materials as quick actions)
    materialPresets.slice(0, 4).forEach((material) => {
      items.push({
        id: `quick-material-${material.id}`,
        title: `Apply ${material.displayName} Material`,
        description: material.description || material.stylePrompt.slice(0, 50),
        icon: (
          <div
            className="w-4 h-4 rounded-sm border border-zinc-600"
            style={{ backgroundColor: material.color }}
          />
        ),
        category: "action",
        action: () => {
          // Copy material prompt to clipboard
          navigator.clipboard.writeText(material.stylePrompt);
          router.push(`/generate?material=${material.id}`);
        },
        keywords: ["material", material.name, material.category],
      });
    });

    // Utility actions
    items.push(
      {
        id: "screenshot",
        title: "Capture Viewport Screenshot",
        description: "Save current 3D view as PNG",
        icon: <Camera className="w-4 h-4 text-pink-400" />,
        category: "action",
        action: () => {
          const canvas = document.querySelector("canvas");
          if (canvas) {
            const link = document.createElement("a");
            link.download = `hyperforge-${Date.now().toString(36)}.png`;
            link.href = canvas.toDataURL("image/png");
            link.click();
          }
        },
        keywords: ["screenshot", "capture", "save", "image", "png"],
      },
      {
        id: "copy-asset-id",
        title: "Copy Selected Asset ID",
        description: "Copy asset ID to clipboard",
        icon: <Copy className="w-4 h-4 text-cyan-400" />,
        category: "action",
        action: () => {
          // Get asset ID from URL or state
          const urlParams = new URLSearchParams(window.location.search);
          const assetId = urlParams.get("asset");
          if (assetId) {
            navigator.clipboard.writeText(assetId);
          }
        },
        keywords: ["copy", "id", "asset", "clipboard"],
      },
      {
        id: "world-editor",
        title: "Open World Editor",
        description: "Edit world layout and spawn points",
        icon: <Globe className="w-4 h-4 text-blue-400" />,
        category: "navigation",
        action: () => router.push("/world"),
        keywords: ["world", "map", "editor", "spawn", "layout"],
      },
      {
        id: "bulk-generate",
        title: "Bulk Generation",
        description: "Generate multiple assets at once",
        icon: <Layers className="w-4 h-4 text-orange-400" />,
        category: "action",
        action: () => router.push("/generate?mode=bulk"),
        keywords: ["bulk", "batch", "multiple", "mass"],
      },
      {
        id: "quick-sprites",
        title: "Generate Sprites for Asset",
        description: "Create 2D sprites from 3D model",
        icon: <Image className="w-4 h-4 text-emerald-400" />,
        category: "action",
        action: async () => {
          const urlParams = new URLSearchParams(window.location.search);
          const assetId = urlParams.get("asset");
          if (assetId) {
            try {
              await fetch("/api/sprites/generate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  assetId,
                  views: ["front", "side", "back", "isometric"],
                  style: "clean",
                  updateThumbnail: true,
                }),
              });
            } catch {
              // Handle error
            }
          }
        },
        keywords: ["sprite", "2d", "icon", "thumbnail"],
      },
      {
        id: "export-all",
        title: "Export All Assets",
        description: "Export all local assets to game",
        icon: <Upload className="w-4 h-4 text-green-400" />,
        category: "action",
        action: async () => {
          try {
            await fetch("/api/export/all", { method: "POST" });
          } catch {
            // Handle error
          }
        },
        keywords: ["export", "all", "game", "deploy"],
      },
      {
        id: "graph-view",
        title: "Asset Graph View",
        description: "Visualize asset relationships",
        icon: <Database className="w-4 h-4 text-violet-400" />,
        category: "navigation",
        action: () => router.push("/graph"),
        keywords: ["graph", "relationships", "dependencies", "tree"],
      },
      {
        id: "open-supabase",
        title: "Open Supabase Dashboard",
        description: "Manage cloud storage",
        icon: <ExternalLink className="w-4 h-4 text-emerald-400" />,
        category: "action",
        action: () => window.open("https://supabase.com/dashboard", "_blank"),
        keywords: ["supabase", "storage", "cloud", "database"],
      },
    );

    // Recent generations - with Test in Game option
    recentGenerations.slice(0, 5).forEach((gen) => {
      // View asset action
      items.push({
        id: `recent-${gen.id}`,
        title: gen.name,
        description:
          gen.prompt.slice(0, 60) + (gen.prompt.length > 60 ? "..." : ""),
        icon: <Clock className="w-4 h-4 text-zinc-400" />,
        category: "recent",
        action: () => router.push(`/?asset=${gen.id}`),
        keywords: [gen.category, gen.prompt],
      });

      // Test in Game action for each recent generation
      items.push({
        id: `test-game-${gen.id}`,
        title: `Test "${gen.name}" in Game`,
        description: "Spawn near player and open game",
        icon: <Sparkles className="w-4 h-4 text-green-400" />,
        category: "action",
        action: async () => {
          try {
            const response = await fetch("/api/test-in-game", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                assetId: gen.id,
                assetName: gen.name,
                category: gen.category,
                source: "LOCAL",
                spawnPosition: { x: 2, y: 0, z: 2 },
                spawnArea: "central_haven",
              }),
            });
            const result = await response.json();
            if (response.ok) {
              setTimeout(() => {
                window.open(
                  result.gameUrl || "http://localhost:3333",
                  "_blank",
                );
              }, 300);
            }
          } catch {
            router.push(`/?asset=${gen.id}`);
          }
        },
        keywords: ["test", "game", "play", "spawn", gen.name, gen.category],
      });
    });

    // Saved prompts
    savedPrompts.slice(0, 5).forEach((prompt) => {
      items.push({
        id: `saved-${prompt.id}`,
        title:
          prompt.prompt.slice(0, 50) + (prompt.prompt.length > 50 ? "..." : ""),
        description: `${prompt.category} prompt`,
        icon: <Bookmark className="w-4 h-4 text-amber-400" />,
        category: "saved",
        action: () => {
          // Copy to clipboard and navigate to generate
          navigator.clipboard.writeText(prompt.prompt);
          router.push(`/generate?prompt=${encodeURIComponent(prompt.prompt)}`);
        },
        keywords: [prompt.category, prompt.prompt],
      });
    });

    return items;
  }, [
    router,
    recentGenerations,
    savedPrompts,
    materialPresets,
    gameStyles,
    activeGameStyle,
  ]);

  // Filter commands by query
  const filteredCommands = useMemo(() => {
    if (!query.trim()) return commands;

    const lowerQuery = query.toLowerCase();
    return commands.filter((cmd) => {
      const searchText = [cmd.title, cmd.description, ...(cmd.keywords || [])]
        .join(" ")
        .toLowerCase();
      return searchText.includes(lowerQuery);
    });
  }, [commands, query]);

  // Group commands by category
  const groupedCommands = useMemo(() => {
    const groups: Record<string, CommandItem[]> = {
      action: [],
      navigation: [],
      recent: [],
      saved: [],
    };

    filteredCommands.forEach((cmd) => {
      groups[cmd.category].push(cmd);
    });

    return groups;
  }, [filteredCommands]);

  // Handle keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (view !== "commands") return; // Only navigate in commands view

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, filteredCommands.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const cmd = filteredCommands[selectedIndex];
        if (cmd) {
          cmd.action();
          // Don't close if navigating to a sub-view
          if (!cmd.id.startsWith("prompt-")) {
            setIsOpen(false);
          }
        }
      }
    },
    [filteredCommands, selectedIndex, view],
  );

  // Reset selection when query changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  if (!isOpen) return null;

  let flatIndex = 0;

  // Render Prompt Vault View
  const renderPromptVault = () => (
    <>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-700/50">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setView("commands")}
            className="text-zinc-400 hover:text-white transition-colors"
          >
            <ArrowRight className="w-4 h-4 rotate-180" />
          </button>
          <FolderOpen className="w-5 h-5 text-amber-400" />
          <span className="text-white font-medium">Prompt Vault</span>
          <span className="text-xs text-zinc-500">
            ({savedPrompts.length} prompts)
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              if (
                window.confirm(
                  "Reset to default Hyperscape prompts? Your custom prompts will be removed.",
                )
              ) {
                localStorage.setItem(
                  STORAGE_KEY_PROMPTS,
                  JSON.stringify(DEFAULT_PROMPTS),
                );
                setSavedPrompts(DEFAULT_PROMPTS);
              }
            }}
            className="flex items-center gap-1.5 px-2 py-1 text-xs text-zinc-400 hover:text-white transition-colors"
            title="Reset to default prompts"
          >
            <History className="w-3 h-3" />
            Reset
          </button>
          <button
            onClick={() => {
              setEditingPrompt(null);
              setNewPromptText("");
              setNewPromptCategory("mob");
              setView("prompt-editor");
            }}
            className="flex items-center gap-1.5 px-2 py-1 text-xs bg-cyan-500/20 text-cyan-400 rounded hover:bg-cyan-500/30 transition-colors"
          >
            <Plus className="w-3 h-3" />
            New Prompt
          </button>
        </div>
      </div>

      {/* Prompt List */}
      <div className="max-h-[50vh] overflow-y-auto custom-scrollbar p-2">
        {savedPrompts.length === 0 ? (
          <div className="py-8 text-center text-zinc-500 text-sm">
            <Bookmark className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p>No saved prompts yet</p>
            <p className="text-xs mt-1">Create your first prompt template!</p>
          </div>
        ) : (
          savedPrompts.map((prompt) => {
            const categoryInfo = PROMPT_CATEGORIES.find(
              (c) => c.value === prompt.category,
            );
            const categoryColors: Record<string, string> = {
              mob: "bg-red-500/20 text-red-400",
              npc: "bg-green-500/20 text-green-400",
              boss: "bg-purple-500/20 text-purple-400",
              weapon: "bg-orange-500/20 text-orange-400",
              armor: "bg-blue-500/20 text-blue-400",
              item: "bg-cyan-500/20 text-cyan-400",
              resource: "bg-emerald-500/20 text-emerald-400",
              prop: "bg-zinc-500/20 text-zinc-300",
              building: "bg-amber-500/20 text-amber-400",
              environment: "bg-lime-500/20 text-lime-400",
            };
            const badgeClass =
              categoryColors[prompt.category] || "bg-zinc-800 text-zinc-400";

            return (
              <div
                key={prompt.id}
                className="group flex items-start gap-3 px-3 py-2 rounded-lg hover:bg-zinc-800/50 transition-colors"
              >
                <Bookmark className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-white truncate">
                    {prompt.prompt}
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <span
                      className={cn(
                        "text-xs px-1.5 py-0.5 rounded font-medium",
                        badgeClass,
                      )}
                    >
                      {categoryInfo?.label || prompt.category}
                    </span>
                    <span className="text-xs text-zinc-500">
                      {new Date(prompt.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(prompt.prompt);
                      router.push(
                        `/generate?prompt=${encodeURIComponent(prompt.prompt)}`,
                      );
                      setIsOpen(false);
                    }}
                    className="p-1.5 text-zinc-400 hover:text-cyan-400 hover:bg-zinc-700 rounded transition-colors"
                    title="Use this prompt"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(prompt.prompt);
                    }}
                    className="p-1.5 text-zinc-400 hover:text-white hover:bg-zinc-700 rounded transition-colors"
                    title="Copy to clipboard"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => {
                      setEditingPrompt(prompt);
                      setNewPromptText(prompt.prompt);
                      setNewPromptCategory(prompt.category);
                      setView("prompt-editor");
                    }}
                    className="p-1.5 text-zinc-400 hover:text-white hover:bg-zinc-700 rounded transition-colors"
                    title="Edit prompt"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => deletePrompt(prompt.id)}
                    className="p-1.5 text-zinc-400 hover:text-red-400 hover:bg-zinc-700 rounded transition-colors"
                    title="Delete prompt"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </>
  );

  // Render Prompt Editor View
  const renderPromptEditor = () => (
    <>
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-700/50">
        <button
          onClick={() => {
            setView("prompts");
            setEditingPrompt(null);
          }}
          className="text-zinc-400 hover:text-white transition-colors"
        >
          <ArrowRight className="w-4 h-4 rotate-180" />
        </button>
        <Edit3 className="w-5 h-5 text-cyan-400" />
        <span className="text-white font-medium">
          {editingPrompt ? "Edit Prompt" : "New Prompt"}
        </span>
      </div>

      {/* Editor */}
      <div className="p-4 space-y-4">
        <div>
          <label className="block text-xs font-medium text-zinc-400 mb-1.5">
            Asset Category
          </label>
          <select
            value={newPromptCategory}
            onChange={(e) => setNewPromptCategory(e.target.value)}
            className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white outline-none focus:border-cyan-500 transition-colors"
          >
            {PROMPT_CATEGORIES.map((cat) => (
              <option key={cat.value} value={cat.value}>
                {cat.label} - {cat.desc}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-zinc-400 mb-1.5">
            Prompt Template for Hyperscape
          </label>
          <textarea
            value={newPromptText}
            onChange={(e) => setNewPromptText(e.target.value)}
            placeholder="e.g., Low-poly fantasy [TYPE] warrior, medieval armor, stylized MMORPG character, game-ready mesh..."
            rows={4}
            className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white placeholder-zinc-500 outline-none focus:border-cyan-500 transition-colors resize-none"
          />
          <div className="mt-2 p-2 bg-zinc-800/50 rounded-lg border border-zinc-700/50">
            <p className="text-xs font-medium text-zinc-400 mb-1">
              Hyperscape Prompt Tips:
            </p>
            <ul className="text-xs text-zinc-500 space-y-0.5">
              <li>
                • Use <span className="text-amber-400">[BRACKETS]</span> for
                customizable parts: [COLOR], [MATERIAL], [TYPE], [ELEMENT]
              </li>
              <li>
                • Include style keywords:{" "}
                <span className="text-cyan-400">
                  low-poly, stylized, MMORPG, fantasy, medieval
                </span>
              </li>
              <li>
                • Add technical terms:{" "}
                <span className="text-green-400">
                  game-ready, mesh, RuneScape aesthetic
                </span>
              </li>
              <li>• Specify details: pose, expression, material type, size</li>
            </ul>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={() => {
              setView("prompts");
              setEditingPrompt(null);
            }}
            className="px-4 py-2 text-sm text-zinc-400 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={saveOrUpdatePrompt}
            disabled={!newPromptText.trim()}
            className="px-4 py-2 text-sm bg-cyan-500 text-white rounded-lg hover:bg-cyan-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {editingPrompt ? "Update Prompt" : "Save Prompt"}
          </button>
        </div>
      </div>
    </>
  );

  // Render Game Styles View
  const renderGameStyles = () => (
    <>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-700/50">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setView("commands")}
            className="text-zinc-400 hover:text-white transition-colors"
          >
            <ArrowRight className="w-4 h-4 rotate-180" />
          </button>
          <Sparkles className="w-5 h-5 text-amber-400" />
          <span className="text-white font-medium">Game Styles</span>
        </div>
        <span className="text-xs text-zinc-500">
          Active: {gameStyles[activeGameStyle]?.name || activeGameStyle}
        </span>
      </div>

      {/* Style Grid */}
      <div className="p-4 space-y-3 max-h-[50vh] overflow-y-auto custom-scrollbar">
        <p className="text-xs text-zinc-400">
          Select a game style to apply to all new generations. This affects the
          visual aesthetic and prompt styling.
        </p>

        <div className="grid grid-cols-2 gap-2">
          {Object.values(gameStyles).map((style) => (
            <button
              key={style.id}
              onClick={() => {
                setAndSaveGameStyle(style.id);
                setView("commands");
              }}
              className={cn(
                "p-3 rounded-lg border text-left transition-all",
                activeGameStyle === style.id
                  ? "border-amber-500/50 bg-amber-500/10"
                  : "border-zinc-700 bg-zinc-800/50 hover:border-amber-500/30",
              )}
            >
              <div className="flex items-center gap-2 mb-1">
                {activeGameStyle === style.id && (
                  <Crown className="w-3 h-3 text-amber-400" />
                )}
                <span className="text-sm font-medium text-white">
                  {style.name}
                </span>
              </div>
              <p className="text-xs text-zinc-500 line-clamp-2">{style.base}</p>
            </button>
          ))}
        </div>

        {/* Add Custom Style */}
        <div className="pt-3 border-t border-zinc-700/50">
          <p className="text-xs text-zinc-500 mb-2">
            Edit styles in{" "}
            <code className="text-amber-400">
              /public/prompts/game-style-prompts.json
            </code>
          </p>
          <button
            onClick={() =>
              window.open(
                "vscode://file" +
                  window.location.pathname.replace(/\/[^/]*$/, "") +
                  "/public/prompts/game-style-prompts.json",
                "_blank",
              )
            }
            className="flex items-center gap-2 px-3 py-2 text-xs bg-zinc-800 border border-zinc-700 rounded-lg hover:border-amber-500/50 transition-colors"
          >
            <Edit3 className="w-3 h-3" />
            Edit in VS Code
          </button>
        </div>
      </div>
    </>
  );

  // Render Materials View
  const renderMaterials = () => {
    // Group materials by category
    const materialsByCategory: Record<string, MaterialPreset[]> = {};
    materialPresets.forEach((mat) => {
      if (!materialsByCategory[mat.category]) {
        materialsByCategory[mat.category] = [];
      }
      materialsByCategory[mat.category].push(mat);
    });

    const categoryIcons: Record<string, React.ReactNode> = {
      metal: <Shield className="w-4 h-4 text-zinc-400" />,
      leather: <Box className="w-4 h-4 text-amber-700" />,
      wood: <TreePine className="w-4 h-4 text-amber-600" />,
      custom: <Wand2 className="w-4 h-4 text-purple-400" />,
    };

    return (
      <>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-700/50">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setView("commands")}
              className="text-zinc-400 hover:text-white transition-colors"
            >
              <ArrowRight className="w-4 h-4 rotate-180" />
            </button>
            <Palette className="w-5 h-5 text-purple-400" />
            <span className="text-white font-medium">Material Presets</span>
          </div>
          <span className="text-xs text-zinc-500">
            {materialPresets.length} materials
          </span>
        </div>

        {/* Material Grid by Category */}
        <div className="p-4 space-y-4 max-h-[50vh] overflow-y-auto custom-scrollbar">
          <p className="text-xs text-zinc-400">
            Click a material to copy its style prompt. Use in Regenerate panel
            to create material variants.
          </p>

          {Object.entries(materialsByCategory).map(([category, materials]) => (
            <div key={category}>
              <div className="flex items-center gap-2 mb-2">
                {categoryIcons[category] || (
                  <Hammer className="w-4 h-4 text-zinc-500" />
                )}
                <span className="text-xs font-medium text-zinc-400 uppercase tracking-wide">
                  {category}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {materials.map((material) => (
                  <button
                    key={material.id}
                    onClick={() => {
                      navigator.clipboard.writeText(material.stylePrompt);
                      setView("commands");
                    }}
                    className="p-2 rounded-lg border border-zinc-700 bg-zinc-800/50 hover:border-purple-500/50 transition-all text-left group"
                    title={material.stylePrompt}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <div
                        className="w-5 h-5 rounded border border-zinc-600"
                        style={{ backgroundColor: material.color }}
                      />
                      <span className="text-xs font-medium text-white truncate">
                        {material.displayName}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-zinc-500">
                        Tier {material.tier}
                      </span>
                      <Copy className="w-3 h-3 text-zinc-600 group-hover:text-purple-400 transition-colors" />
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))}

          {/* Add Custom Material */}
          <div className="pt-3 border-t border-zinc-700/50">
            <p className="text-xs text-zinc-500 mb-2">
              Edit materials in{" "}
              <code className="text-purple-400">
                /public/prompts/material-presets.json
              </code>
            </p>
            <button
              onClick={() =>
                window.open(
                  "vscode://file" +
                    window.location.pathname.replace(/\/[^/]*$/, "") +
                    "/public/prompts/material-presets.json",
                  "_blank",
                )
              }
              className="flex items-center gap-2 px-3 py-2 text-xs bg-zinc-800 border border-zinc-700 rounded-lg hover:border-purple-500/50 transition-colors"
            >
              <Edit3 className="w-3 h-3" />
              Edit in VS Code
            </button>
          </div>
        </div>
      </>
    );
  };

  // Render Commands View (default)
  const renderCommands = () => (
    <>
      {/* Search Input */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-700/50">
        <Search className="w-5 h-5 text-zinc-400" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search commands, prompts, or recent generations..."
          className="flex-1 bg-transparent text-white placeholder-zinc-500 outline-none text-sm"
        />
        <div className="flex items-center gap-1 text-xs text-zinc-500">
          <kbd className="px-1.5 py-0.5 bg-zinc-800 rounded border border-zinc-700">
            esc
          </kbd>
          <span>to close</span>
        </div>
      </div>

      {/* Results */}
      <div className="max-h-[50vh] overflow-y-auto custom-scrollbar p-2">
        {filteredCommands.length === 0 ? (
          <div className="py-8 text-center text-zinc-500 text-sm">
            No results found for "{query}"
          </div>
        ) : (
          <>
            {/* Actions */}
            {groupedCommands.action.length > 0 && (
              <div className="mb-2">
                <div className="px-2 py-1 text-xs font-medium text-zinc-500 uppercase tracking-wider">
                  Actions
                </div>
                {groupedCommands.action.map((cmd) => {
                  const index = flatIndex++;
                  return (
                    <CommandRow
                      key={cmd.id}
                      command={cmd}
                      isSelected={index === selectedIndex}
                      onClick={() => {
                        cmd.action();
                        // Don't close if navigating to prompt vault views
                        if (!cmd.id.startsWith("prompt-")) {
                          setIsOpen(false);
                        }
                      }}
                    />
                  );
                })}
              </div>
            )}

            {/* Navigation */}
            {groupedCommands.navigation.length > 0 && (
              <div className="mb-2">
                <div className="px-2 py-1 text-xs font-medium text-zinc-500 uppercase tracking-wider">
                  Navigation
                </div>
                {groupedCommands.navigation.map((cmd) => {
                  const index = flatIndex++;
                  return (
                    <CommandRow
                      key={cmd.id}
                      command={cmd}
                      isSelected={index === selectedIndex}
                      onClick={() => {
                        cmd.action();
                        setIsOpen(false);
                      }}
                    />
                  );
                })}
              </div>
            )}

            {/* Recent Generations */}
            {groupedCommands.recent.length > 0 && (
              <div className="mb-2">
                <div className="px-2 py-1 text-xs font-medium text-zinc-500 uppercase tracking-wider flex items-center gap-2">
                  <History className="w-3 h-3" />
                  Recent Generations
                </div>
                {groupedCommands.recent.map((cmd) => {
                  const index = flatIndex++;
                  return (
                    <CommandRow
                      key={cmd.id}
                      command={cmd}
                      isSelected={index === selectedIndex}
                      onClick={() => {
                        cmd.action();
                        setIsOpen(false);
                      }}
                    />
                  );
                })}
              </div>
            )}

            {/* Saved Prompts */}
            {groupedCommands.saved.length > 0 && (
              <div className="mb-2">
                <div className="px-2 py-1 text-xs font-medium text-zinc-500 uppercase tracking-wider flex items-center gap-2">
                  <Star className="w-3 h-3" />
                  Saved Prompts
                </div>
                {groupedCommands.saved.map((cmd) => {
                  const index = flatIndex++;
                  return (
                    <CommandRow
                      key={cmd.id}
                      command={cmd}
                      isSelected={index === selectedIndex}
                      onClick={() => {
                        cmd.action();
                        setIsOpen(false);
                      }}
                    />
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-4 py-2 border-t border-zinc-700/50 bg-zinc-800/50 text-xs text-zinc-500">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 bg-zinc-700 rounded">↑↓</kbd>
            navigate
          </span>
          <span className="flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 bg-zinc-700 rounded">↵</kbd>
            select
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Command className="w-3 h-3" />
          <span>+</span>
          <kbd className="px-1.5 py-0.5 bg-zinc-700 rounded">P</kbd>
          <span>to open</span>
        </div>
      </div>
    </>
  );

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-start justify-center pt-[15vh]"
      onClick={() => setIsOpen(false)}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      {/* Palette */}
      <div
        className="relative w-full max-w-xl bg-zinc-900/95 border border-zinc-700/50 rounded-xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {view === "commands" && renderCommands()}
        {view === "prompts" && renderPromptVault()}
        {view === "prompt-editor" && renderPromptEditor()}
        {view === "game-styles" && renderGameStyles()}
        {view === "materials" && renderMaterials()}
      </div>
    </div>
  );
}

function CommandRow({
  command,
  isSelected,
  onClick,
}: {
  command: CommandItem;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors",
        isSelected
          ? "bg-cyan-500/20 text-white"
          : "text-zinc-300 hover:bg-zinc-800/50",
      )}
    >
      <div className="flex-shrink-0">{command.icon}</div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{command.title}</div>
        {command.description && (
          <div className="text-xs text-zinc-500 truncate">
            {command.description}
          </div>
        )}
      </div>
      {isSelected && (
        <ArrowRight className="w-4 h-4 text-cyan-400 flex-shrink-0" />
      )}
    </button>
  );
}

// Helper functions to save prompts and recent generations
export function savePrompt(prompt: string, category: string) {
  if (typeof window === "undefined") return;

  try {
    const existing = localStorage.getItem(STORAGE_KEY_PROMPTS);
    const prompts: SavedPrompt[] = existing ? JSON.parse(existing) : [];

    const newPrompt: SavedPrompt = {
      id: `prompt_${Date.now()}`,
      prompt,
      category,
      createdAt: new Date().toISOString(),
    };

    // Add to beginning, limit to 20
    prompts.unshift(newPrompt);
    localStorage.setItem(
      STORAGE_KEY_PROMPTS,
      JSON.stringify(prompts.slice(0, 20)),
    );
  } catch {
    // Ignore storage errors
  }
}

export function addRecentGeneration(gen: Omit<RecentGeneration, "createdAt">) {
  if (typeof window === "undefined") return;

  try {
    const existing = localStorage.getItem(STORAGE_KEY_RECENT);
    const recent: RecentGeneration[] = existing ? JSON.parse(existing) : [];

    const newGen: RecentGeneration = {
      ...gen,
      createdAt: new Date().toISOString(),
    };

    // Remove duplicates, add to beginning, limit to 20
    const filtered = recent.filter((r) => r.id !== gen.id);
    filtered.unshift(newGen);
    localStorage.setItem(
      STORAGE_KEY_RECENT,
      JSON.stringify(filtered.slice(0, 20)),
    );
  } catch {
    // Ignore storage errors
  }
}

/**
 * Get the currently active game style from localStorage
 * Falls back to "runescape" if not set
 */
export function getActiveGameStyle(): string {
  if (typeof window === "undefined") return "runescape";
  return localStorage.getItem(STORAGE_KEY_GAME_STYLE) || "runescape";
}

/**
 * Set the active game style in localStorage
 */
export function setActiveGameStyle(styleId: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY_GAME_STYLE, styleId);
}
