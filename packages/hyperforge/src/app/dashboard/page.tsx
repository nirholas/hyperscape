"use client";

/**
 * HyperForge Dashboard
 *
 * Central hub for asset management:
 * - Overview of all asset types
 * - Quick access to studios
 * - Recent activity
 * - Export status
 */

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  Box,
  Image as ImageIcon,
  Music,
  MessageSquare,
  ArrowRight,
  Plus,
  Palette,
  Users,
  Scroll,
  Map as MapIcon,
  Sparkles,
  FolderOpen,
  TrendingUp,
  Zap,
  CheckCircle2,
  RefreshCw,
  Package,
  TreePine,
  Store,
  Swords,
  Shield,
  Hand,
  GitGraph,
} from "lucide-react";
import { StudioPageLayout } from "@/components/layout/StudioPageLayout";
import { GlassPanel } from "@/components/ui/glass-panel";
import { cn, logger } from "@/lib/utils";

const log = logger.child("Dashboard");

// =============================================================================
// TYPES
// =============================================================================

interface AssetCounts {
  models: number;
  images: number;
  audio: number;
  content: number;
}

interface GameDataCounts {
  items: number;
  npcs: number;
  resources: number;
  stores: number;
  music: number;
  buildings: number;
  areas: number;
}

interface StudioLink {
  id: string;
  name: string;
  description: string;
  href: string;
  icon: React.ReactNode;
  color: string;
}

// =============================================================================
// DASHBOARD PAGE
// =============================================================================

export default function DashboardPage() {
  const [assetCounts, setAssetCounts] = useState<AssetCounts>({
    models: 0,
    images: 0,
    audio: 0,
    content: 0,
  });
  const [gameDataCounts, setGameDataCounts] = useState<GameDataCounts>({
    items: 0,
    npcs: 0,
    resources: 0,
    stores: 0,
    music: 0,
    buildings: 0,
    areas: 0,
  });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Load dashboard data
  const loadData = async () => {
    try {
      // Fetch game manifest counts
      const manifestRes = await fetch("/api/game/manifests");
      if (manifestRes.ok) {
        const data = await manifestRes.json();
        if (data.counts) {
          setGameDataCounts({
            items: data.counts.items || 0,
            npcs: data.counts.npcs || 0,
            resources: data.counts.resources || 0,
            stores: data.counts.stores || 0,
            music: data.counts.music || 0,
            buildings: data.counts.buildings || 0,
            areas: data.counts.areas || 0,
          });
        }
      }

      // Fetch 3D model counts from CDN + local (same as useCDNAssets hook)
      try {
        const [cdnRes, localRes] = await Promise.all([
          fetch("/api/assets/cdn").catch(() => null),
          fetch("/api/assets/local").catch(() => null),
        ]);

        let modelCount = 0;
        if (cdnRes?.ok) {
          const cdnData = await cdnRes.json();
          modelCount += Array.isArray(cdnData) ? cdnData.length : 0;
        }
        if (localRes?.ok) {
          const localData = await localRes.json();
          modelCount += Array.isArray(localData) ? localData.length : 0;
        }

        setAssetCounts((prev) => ({
          ...prev,
          models: modelCount,
        }));
      } catch {
        // Assets API may fail
      }

      // Fetch image counts
      try {
        const imagesRes = await fetch("/api/images");
        if (imagesRes.ok) {
          const imagesData = await imagesRes.json();
          setAssetCounts((prev) => ({
            ...prev,
            images: imagesData.images?.length || 0,
          }));
        }
      } catch {
        // Ignore
      }

      // Fetch audio counts - API returns array directly
      try {
        const audioRes = await fetch("/api/audio/assets");
        if (audioRes.ok) {
          const audioData = await audioRes.json();
          setAssetCounts((prev) => ({
            ...prev,
            audio: Array.isArray(audioData) ? audioData.length : 0,
          }));
        }
      } catch {
        // Ignore
      }

      // Fetch content counts
      try {
        const contentRes = await fetch("/api/content/list");
        if (contentRes.ok) {
          const contentData = await contentRes.json();
          setAssetCounts((prev) => ({
            ...prev,
            content: contentData.assets?.length || 0,
          }));
        }
      } catch {
        // Ignore
      }
    } catch (error) {
      log.error("Failed to load dashboard data", { error });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleRefresh = () => {
    setRefreshing(true);
    loadData();
  };

  // Studio links
  const studios: StudioLink[] = [
    {
      id: "image",
      name: "Image Studio",
      description: "Concept art, sprites, textures",
      href: "/images/studio",
      icon: <Palette className="w-5 h-5" />,
      color: "pink",
    },
    {
      id: "audio",
      name: "Audio Studio",
      description: "Voice, SFX, music",
      href: "/audio",
      icon: <Music className="w-5 h-5" />,
      color: "cyan",
    },
    {
      id: "content",
      name: "Content Studio",
      description: "NPCs, quests, areas, items",
      href: "/content/generate",
      icon: <Sparkles className="w-5 h-5" />,
      color: "amber",
    },
    {
      id: "3d",
      name: "3D Generation",
      description: "Weapons, armor, props",
      href: "/generate",
      icon: <Box className="w-5 h-5" />,
      color: "purple",
    },
  ];

  // Processing studios
  const processingStudios: StudioLink[] = [
    {
      id: "equipment",
      name: "Equipment Fitting",
      description: "Fit equipment to character",
      href: "/studio/equipment",
      icon: <Swords className="w-5 h-5" />,
      color: "blue",
    },
    {
      id: "armor",
      name: "Armor Fitting",
      description: "Fit armor to character",
      href: "/studio/armor",
      icon: <Shield className="w-5 h-5" />,
      color: "green",
    },
    {
      id: "hands",
      name: "Hand Rigging",
      description: "Rig hands for weapons",
      href: "/studio/hands",
      icon: <Hand className="w-5 h-5" />,
      color: "orange",
    },
    {
      id: "world",
      name: "World Editor",
      description: "Place assets in world",
      href: "/world",
      icon: <MapIcon className="w-5 h-5" />,
      color: "emerald",
    },
  ];

  const totalGameAssets =
    gameDataCounts.items +
    gameDataCounts.npcs +
    gameDataCounts.resources +
    gameDataCounts.stores +
    gameDataCounts.buildings +
    gameDataCounts.areas;

  return (
    <StudioPageLayout
      title="Dashboard"
      description="HyperForge central hub"
      showVault={false}
    >
      <div className="h-full overflow-auto p-6">
        <div className="max-w-7xl mx-auto space-y-8">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-cyan-400 to-blue-500">
                HyperForge Dashboard
              </h1>
              <p className="text-muted-foreground mt-1">
                Create, manage, and export game assets
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={handleRefresh}
                disabled={refreshing}
                className="p-2 rounded-lg border border-glass-border hover:border-cyan-500/30 transition-colors disabled:opacity-50"
              >
                <RefreshCw
                  className={cn("w-5 h-5", refreshing && "animate-spin")}
                />
              </button>
              <Link
                href="/generate"
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-medium hover:from-cyan-400 hover:to-blue-500 transition-all shadow-lg shadow-cyan-500/20"
              >
                <Plus className="w-4 h-4" />
                Create Asset
              </Link>
            </div>
          </div>

          {/* Asset Libraries Overview */}
          <div>
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <FolderOpen className="w-5 h-5 text-cyan-400" />
              Asset Libraries
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Link href="/">
                <GlassPanel className="p-4 hover:border-cyan-500/30 transition-all cursor-pointer group">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-lg bg-purple-500/20 flex items-center justify-center text-purple-400">
                      <Box className="w-6 h-6" />
                    </div>
                    <div>
                      <div className="text-2xl font-bold">
                        {loading ? "..." : assetCounts.models}
                      </div>
                      <div className="text-sm text-muted-foreground group-hover:text-cyan-400 transition-colors">
                        3D Models
                      </div>
                    </div>
                  </div>
                </GlassPanel>
              </Link>

              <Link href="/images">
                <GlassPanel className="p-4 hover:border-pink-500/30 transition-all cursor-pointer group">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-lg bg-pink-500/20 flex items-center justify-center text-pink-400">
                      <ImageIcon className="w-6 h-6" />
                    </div>
                    <div>
                      <div className="text-2xl font-bold">
                        {loading ? "..." : assetCounts.images}
                      </div>
                      <div className="text-sm text-muted-foreground group-hover:text-pink-400 transition-colors">
                        Images
                      </div>
                    </div>
                  </div>
                </GlassPanel>
              </Link>

              <Link href="/audio/assets">
                <GlassPanel className="p-4 hover:border-cyan-500/30 transition-all cursor-pointer group">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-lg bg-cyan-500/20 flex items-center justify-center text-cyan-400">
                      <Music className="w-6 h-6" />
                    </div>
                    <div>
                      <div className="text-2xl font-bold">
                        {loading ? "..." : assetCounts.audio}
                      </div>
                      <div className="text-sm text-muted-foreground group-hover:text-cyan-400 transition-colors">
                        Audio Files
                      </div>
                    </div>
                  </div>
                </GlassPanel>
              </Link>

              <Link href="/content">
                <GlassPanel className="p-4 hover:border-amber-500/30 transition-all cursor-pointer group">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-lg bg-amber-500/20 flex items-center justify-center text-amber-400">
                      <MessageSquare className="w-6 h-6" />
                    </div>
                    <div>
                      <div className="text-2xl font-bold">
                        {loading ? "..." : assetCounts.content}
                      </div>
                      <div className="text-sm text-muted-foreground group-hover:text-amber-400 transition-colors">
                        Content
                      </div>
                    </div>
                  </div>
                </GlassPanel>
              </Link>
            </div>
          </div>

          {/* Main Grid */}
          <div className="grid lg:grid-cols-3 gap-6">
            {/* Generation Studios */}
            <div className="lg:col-span-2">
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <Zap className="w-5 h-5 text-amber-400" />
                Generation Studios
              </h2>
              <div className="grid md:grid-cols-2 gap-4">
                {studios.map((studio) => (
                  <Link key={studio.id} href={studio.href}>
                    <GlassPanel className="p-4 h-full hover:border-cyan-500/30 transition-all group cursor-pointer">
                      <div className="flex items-start gap-3">
                        <div
                          className={cn(
                            "w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0",
                            `bg-${studio.color}-500/20 text-${studio.color}-400`,
                          )}
                        >
                          {studio.icon}
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="font-medium group-hover:text-cyan-400 transition-colors">
                            {studio.name}
                          </h3>
                          <p className="text-sm text-muted-foreground mt-1">
                            {studio.description}
                          </p>
                        </div>
                        <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-cyan-400 group-hover:translate-x-1 transition-all flex-shrink-0 mt-1" />
                      </div>
                    </GlassPanel>
                  </Link>
                ))}
              </div>

              {/* Processing Studios */}
              <h2 className="text-lg font-semibold mb-4 mt-6 flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-emerald-400" />
                Processing & Tools
              </h2>
              <div className="grid md:grid-cols-2 gap-4">
                {processingStudios.map((studio) => (
                  <Link key={studio.id} href={studio.href}>
                    <GlassPanel className="p-4 h-full hover:border-cyan-500/30 transition-all group cursor-pointer">
                      <div className="flex items-start gap-3">
                        <div
                          className={cn(
                            "w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0",
                            `bg-${studio.color}-500/20 text-${studio.color}-400`,
                          )}
                        >
                          {studio.icon}
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="font-medium group-hover:text-cyan-400 transition-colors">
                            {studio.name}
                          </h3>
                          <p className="text-sm text-muted-foreground mt-1">
                            {studio.description}
                          </p>
                        </div>
                        <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-cyan-400 group-hover:translate-x-1 transition-all flex-shrink-0 mt-1" />
                      </div>
                    </GlassPanel>
                  </Link>
                ))}
              </div>
            </div>

            {/* Game Data Sidebar */}
            <div>
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <Package className="w-5 h-5 text-purple-400" />
                Game Data
              </h2>
              <GlassPanel className="p-4">
                <div className="space-y-3">
                  <GameDataRow
                    icon={<Swords className="w-4 h-4" />}
                    label="Items"
                    count={gameDataCounts.items}
                    loading={loading}
                  />
                  <GameDataRow
                    icon={<Users className="w-4 h-4" />}
                    label="NPCs"
                    count={gameDataCounts.npcs}
                    loading={loading}
                  />
                  <GameDataRow
                    icon={<TreePine className="w-4 h-4" />}
                    label="Resources"
                    count={gameDataCounts.resources}
                    loading={loading}
                  />
                  <GameDataRow
                    icon={<Store className="w-4 h-4" />}
                    label="Stores"
                    count={gameDataCounts.stores}
                    loading={loading}
                  />
                  <GameDataRow
                    icon={<Box className="w-4 h-4" />}
                    label="Buildings"
                    count={gameDataCounts.buildings}
                    loading={loading}
                  />
                  <GameDataRow
                    icon={<MapIcon className="w-4 h-4" />}
                    label="Areas"
                    count={gameDataCounts.areas}
                    loading={loading}
                  />

                  <div className="pt-3 mt-3 border-t border-glass-border">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">Total</span>
                      <span className="text-lg font-bold text-cyan-400">
                        {loading ? "..." : totalGameAssets}
                      </span>
                    </div>
                  </div>
                </div>
              </GlassPanel>

              {/* Quick Links */}
              <h2 className="text-lg font-semibold mb-4 mt-6 flex items-center gap-2">
                <GitGraph className="w-5 h-5 text-violet-400" />
                Quick Links
              </h2>
              <GlassPanel className="p-4">
                <div className="space-y-2">
                  <QuickLink
                    href="/graph"
                    icon={<GitGraph className="w-4 h-4" />}
                    label="Relationship Graph"
                  />
                  <QuickLink
                    href="/content/dialogue"
                    icon={<Scroll className="w-4 h-4" />}
                    label="Dialogue Editor"
                  />
                  <QuickLink
                    href="/studio/retarget"
                    icon={<RefreshCw className="w-4 h-4" />}
                    label="Retarget & Animate"
                  />
                  <QuickLink
                    href="/settings"
                    icon={<Sparkles className="w-4 h-4" />}
                    label="API Settings"
                  />
                </div>
              </GlassPanel>
            </div>
          </div>

          {/* Export Status */}
          <GlassPanel className="p-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-full bg-green-500/20 flex items-center justify-center">
                  <CheckCircle2 className="w-6 h-6 text-green-400" />
                </div>
                <div>
                  <h3 className="font-semibold text-lg">Export Status</h3>
                  <p className="text-muted-foreground">
                    {totalGameAssets} game assets configured • Ready to export
                  </p>
                </div>
              </div>
              <div className="flex gap-3">
                <Link
                  href="/graph"
                  className="px-4 py-2 rounded-lg border border-glass-border hover:border-cyan-500/30 transition-colors"
                >
                  View Graph
                </Link>
                <Link
                  href="/api/manifest/export"
                  className="px-4 py-2 rounded-lg bg-green-500 text-white font-medium hover:bg-green-400 transition-colors"
                >
                  Export to Game
                </Link>
              </div>
            </div>
          </GlassPanel>
        </div>
      </div>
    </StudioPageLayout>
  );
}

// =============================================================================
// SUB-COMPONENTS
// =============================================================================

function GameDataRow({
  icon,
  label,
  count,
  loading,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  loading: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2 text-muted-foreground">
        {icon}
        <span className="text-sm">{label}</span>
      </div>
      <span className="font-medium">{loading ? "..." : count}</span>
    </div>
  );
}

function QuickLink({
  href,
  icon,
  label,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-glass-bg transition-colors group"
    >
      <span className="text-muted-foreground group-hover:text-cyan-400 transition-colors">
        {icon}
      </span>
      <span className="text-sm group-hover:text-cyan-400 transition-colors">
        {label}
      </span>
      <ArrowRight className="w-3 h-3 ml-auto text-muted-foreground opacity-0 group-hover:opacity-100 group-hover:text-cyan-400 transition-all" />
    </Link>
  );
}
