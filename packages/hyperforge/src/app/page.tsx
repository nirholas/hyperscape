"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  Library,
  UserCog,
  Shield,
  Hand,
  RefreshCw,
  Music,
  Filter,
  Search,
  ChevronDown,
  Globe,
  Sparkles,
  MessageSquare,
  Plus,
  ExternalLink,
  Loader2,
  Mic,
  Volume2,
  Upload,
  Users,
  Scroll,
  Map,
  Sword,
  Settings,
  Box,
  Image as ImageIcon,
  Palette,
  Grid3X3,
  Layers,
  type LucideIcon,
} from "lucide-react";
import { Viewport3D } from "@/components/viewer/Viewport3D";
import { AssetLibrary } from "@/components/vault/AssetLibrary";
import { AssetUploadModal } from "@/components/vault/AssetUploadModal";
import { WorldView } from "@/components/world/WorldView";
import { useAppStore, type ModuleView } from "@/stores/app-store";
import type { AssetData } from "@/types/asset";

// Modules that are just state toggles (stay on this page)
const stateModules: { id: ModuleView; label: string; icon: LucideIcon }[] = [
  { id: "library", label: "3D Assets", icon: Box },
];

// Studio pages that link to separate routes
const studioPages: {
  href: string;
  label: string;
  icon: LucideIcon;
  description: string;
}[] = [
  {
    href: "/studio/equipment",
    label: "Equipment Fitting",
    icon: UserCog,
    description: "Attach weapons to VRM avatars",
  },
  {
    href: "/studio/armor",
    label: "Armor Fitting",
    icon: Shield,
    description: "Fit armor to VRM avatars",
  },
  {
    href: "/studio/hands",
    label: "Hand Rigging",
    icon: Hand,
    description: "Add hand bones",
  },
  {
    href: "/studio/retarget",
    label: "Retarget & Animate",
    icon: RefreshCw,
    description: "VRM conversion & animation",
  },
];

export default function HomePage() {
  const {
    activeModule,
    setActiveModule,
    selectedAsset,
    setSelectedAsset,
    sidebarCollapsed,
    toggleSidebar,
    vaultOpen,
    toggleVault,
  } = useAppStore();

  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, _setCategoryFilter] = useState("all");
  const [mounted, setMounted] = useState(false);
  const [worldViewOpen, setWorldViewOpen] = useState(false);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [assetRefreshKey, setAssetRefreshKey] = useState(0);

  // Ensure consistent rendering between server and client for icons
  useEffect(() => {
    setMounted(true);
  }, []);

  const handleAssetSelect = (asset: AssetData) => {
    setSelectedAsset(asset);
    // Properties panel opens automatically via store
  };

  const handleUploadComplete = () => {
    // Refresh the asset library by changing the key
    setAssetRefreshKey((prev) => prev + 1);
  };

  const handleAssetDeleted = (assetId: string) => {
    // Clear selection if deleted asset was selected
    if (selectedAsset?.id === assetId) {
      setSelectedAsset(null);
    }
    // Refresh the asset library
    setAssetRefreshKey((prev) => prev + 1);
  };

  // Show a minimal skeleton during SSR to avoid hydration mismatch with Lucide icons
  if (!mounted) {
    return (
      <div className="flex h-screen bg-background overflow-hidden">
        <aside className="w-56 border-r border-glass-border bg-glass-bg/30 flex flex-col flex-shrink-0">
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        </aside>
        <main className="flex-1 relative overflow-hidden bg-gradient-to-b from-zinc-900 to-zinc-950" />
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* === LEFT SIDEBAR: MODULES === */}
      <aside
        className={`
          ${sidebarCollapsed ? "w-16" : "w-56"} 
          border-r border-glass-border bg-glass-bg/30 flex flex-col flex-shrink-0
          transition-all duration-300 ease-in-out
        `}
      >
        {/* Logo - Click to collapse */}
        <div className="p-4 border-b border-glass-border">
          <button
            onClick={toggleSidebar}
            className="flex items-center gap-2 w-full hover:opacity-80 transition-opacity"
            title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center shadow-lg shadow-cyan-500/20 flex-shrink-0">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            {!sidebarCollapsed && (
              <span className="font-bold text-lg tracking-wider text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-500 whitespace-nowrap">
                HYPERFORGE
              </span>
            )}
          </button>
        </div>

        {/* Generate New Button */}
        <div className="p-3 border-b border-glass-border">
          <Link
            href="/generate"
            className={`
              w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium
              bg-gradient-to-r from-cyan-500 to-blue-600 text-white
              hover:from-cyan-400 hover:to-blue-500
              transition-all duration-200 shadow-lg shadow-cyan-500/20
              ${sidebarCollapsed ? "justify-center" : ""}
            `}
          >
            <Plus className="w-4 h-4 flex-shrink-0" />
            {!sidebarCollapsed && <span>Generate New</span>}
          </Link>
        </div>

        {/* Assets Section */}
        <div className="flex-1 p-3 overflow-y-auto themed-scrollbar">
          {!sidebarCollapsed && (
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 px-2">
              Assets
            </div>
          )}
          <nav className="space-y-1">
            {/* 3D Assets - toggle for main viewport */}
            {stateModules.map((module) => {
              const isActive = activeModule === module.id;
              return (
                <button
                  key={module.id}
                  onClick={() => setActiveModule(module.id)}
                  title={sidebarCollapsed ? module.label : undefined}
                  className={`
                    w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm
                    transition-all duration-200
                    ${sidebarCollapsed ? "justify-center" : ""}
                    ${
                      isActive
                        ? "bg-cyan-500/10 text-cyan-400 border border-cyan-500/20"
                        : "text-muted-foreground hover:text-foreground hover:bg-glass-bg"
                    }
                  `}
                >
                  <module.icon
                    className={`w-4 h-4 flex-shrink-0 ${isActive ? "text-cyan-400" : ""}`}
                  />
                  {!sidebarCollapsed && (
                    <span className="truncate">{module.label}</span>
                  )}
                </button>
              );
            })}

            {/* Audio Assets Link */}
            <Link
              href="/assets/audio"
              title={sidebarCollapsed ? "Audio Assets" : "Browse audio assets"}
              className={`
                w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm 
                text-muted-foreground hover:text-foreground hover:bg-glass-bg transition-all duration-200
                ${sidebarCollapsed ? "justify-center" : ""}
              `}
            >
              <Volume2 className="w-4 h-4 flex-shrink-0" />
              {!sidebarCollapsed && (
                <>
                  <span className="truncate flex-1">Audio Assets</span>
                  <ExternalLink className="w-3 h-3 text-muted-foreground/50" />
                </>
              )}
            </Link>

            {/* Image Assets Link */}
            <Link
              href="/assets/images"
              title={sidebarCollapsed ? "Image Assets" : "Browse image assets"}
              className={`
                w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm 
                text-muted-foreground hover:text-foreground hover:bg-glass-bg transition-all duration-200
                ${sidebarCollapsed ? "justify-center" : ""}
              `}
            >
              <ImageIcon className="w-4 h-4 flex-shrink-0" />
              {!sidebarCollapsed && (
                <>
                  <span className="truncate flex-1">Image Assets</span>
                  <ExternalLink className="w-3 h-3 text-muted-foreground/50" />
                </>
              )}
            </Link>

            {/* Content Assets Link */}
            <Link
              href="/assets/content"
              title={
                sidebarCollapsed ? "Content Assets" : "Browse content assets"
              }
              className={`
                w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm 
                text-muted-foreground hover:text-foreground hover:bg-glass-bg transition-all duration-200
                ${sidebarCollapsed ? "justify-center" : ""}
              `}
            >
              <MessageSquare className="w-4 h-4 flex-shrink-0" />
              {!sidebarCollapsed && (
                <>
                  <span className="truncate flex-1">Content Assets</span>
                  <ExternalLink className="w-3 h-3 text-muted-foreground/50" />
                </>
              )}
            </Link>
          </nav>

          {/* Studio Pages */}
          <div
            className={`mt-6 pt-4 border-t border-glass-border ${sidebarCollapsed ? "px-0" : ""}`}
          >
            {!sidebarCollapsed && (
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 px-2">
                Studio
              </div>
            )}
            <nav className="space-y-1">
              {studioPages.map((page) => (
                <Link
                  key={page.href}
                  href={page.href}
                  title={sidebarCollapsed ? page.label : page.description}
                  className={`
                    w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm
                    text-muted-foreground hover:text-foreground hover:bg-glass-bg transition-all duration-200
                    ${sidebarCollapsed ? "justify-center" : ""}
                  `}
                >
                  <page.icon className="w-4 h-4 flex-shrink-0" />
                  {!sidebarCollapsed && (
                    <>
                      <span className="truncate flex-1">{page.label}</span>
                      <ExternalLink className="w-3 h-3 text-muted-foreground/50" />
                    </>
                  )}
                </Link>
              ))}
            </nav>
          </div>

          {/* Content Generation Links */}
          <div
            className={`mt-6 pt-4 border-t border-glass-border ${sidebarCollapsed ? "px-0" : ""}`}
          >
            {!sidebarCollapsed && (
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 px-2">
                Content
              </div>
            )}
            <nav className="space-y-1">
              <Link
                href="/content"
                title={
                  sidebarCollapsed
                    ? "NPCs & Dialogue"
                    : "Generate NPC dialogue trees"
                }
                className={`
                  w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm 
                  text-muted-foreground hover:text-foreground hover:bg-glass-bg transition-all duration-200
                  ${sidebarCollapsed ? "justify-center" : ""}
                `}
              >
                <Users className="w-4 h-4 flex-shrink-0" />
                {!sidebarCollapsed && (
                  <>
                    <span className="truncate flex-1">NPCs & Dialogue</span>
                    <ExternalLink className="w-3 h-3 text-muted-foreground/50" />
                  </>
                )}
              </Link>
              <Link
                href="/content?tab=quest"
                title={sidebarCollapsed ? "Quests" : "Generate quest chains"}
                className={`
                  w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm 
                  text-muted-foreground hover:text-foreground hover:bg-glass-bg transition-all duration-200
                  ${sidebarCollapsed ? "justify-center" : ""}
                `}
              >
                <Scroll className="w-4 h-4 flex-shrink-0" />
                {!sidebarCollapsed && (
                  <>
                    <span className="truncate flex-1">Quests</span>
                    <ExternalLink className="w-3 h-3 text-muted-foreground/50" />
                  </>
                )}
              </Link>
              <Link
                href="/content?tab=area"
                title={
                  sidebarCollapsed ? "World Areas" : "Generate world areas"
                }
                className={`
                  w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm 
                  text-muted-foreground hover:text-foreground hover:bg-glass-bg transition-all duration-200
                  ${sidebarCollapsed ? "justify-center" : ""}
                `}
              >
                <Map className="w-4 h-4 flex-shrink-0" />
                {!sidebarCollapsed && (
                  <>
                    <span className="truncate flex-1">World Areas</span>
                    <ExternalLink className="w-3 h-3 text-muted-foreground/50" />
                  </>
                )}
              </Link>
              <Link
                href="/content?tab=item"
                title={
                  sidebarCollapsed ? "Items" : "Generate items & equipment"
                }
                className={`
                  w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm 
                  text-muted-foreground hover:text-foreground hover:bg-glass-bg transition-all duration-200
                  ${sidebarCollapsed ? "justify-center" : ""}
                `}
              >
                <Sword className="w-4 h-4 flex-shrink-0" />
                {!sidebarCollapsed && (
                  <>
                    <span className="truncate flex-1">Items</span>
                    <ExternalLink className="w-3 h-3 text-muted-foreground/50" />
                  </>
                )}
              </Link>
            </nav>
          </div>

          {/* Audio Section */}
          <div
            className={`mt-4 pt-4 border-t border-glass-border ${sidebarCollapsed ? "px-0" : ""}`}
          >
            {!sidebarCollapsed && (
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 px-2">
                Audio
              </div>
            )}
            <nav className="space-y-1">
              <Link
                href="/audio"
                title={
                  sidebarCollapsed
                    ? "Audio Studio"
                    : "Generate voice, SFX, and music"
                }
                className={`
                  w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm 
                  text-muted-foreground hover:text-foreground hover:bg-glass-bg transition-all duration-200
                  ${sidebarCollapsed ? "justify-center" : ""}
                `}
              >
                <Music className="w-4 h-4 flex-shrink-0" />
                {!sidebarCollapsed && (
                  <>
                    <span className="truncate flex-1">Audio Studio</span>
                    <ExternalLink className="w-3 h-3 text-muted-foreground/50" />
                  </>
                )}
              </Link>
              <Link
                href="/audio/voice"
                title={
                  sidebarCollapsed
                    ? "Voice Generator"
                    : "Generate NPC dialogue audio"
                }
                className={`
                  w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm 
                  text-muted-foreground hover:text-foreground hover:bg-glass-bg transition-all duration-200
                  ${sidebarCollapsed ? "justify-center" : ""}
                `}
              >
                <Mic className="w-4 h-4 flex-shrink-0" />
                {!sidebarCollapsed && (
                  <>
                    <span className="truncate flex-1">Voice Generator</span>
                    <ExternalLink className="w-3 h-3 text-muted-foreground/50" />
                  </>
                )}
              </Link>
              <Link
                href="/audio/sfx"
                title={sidebarCollapsed ? "Sound Effects" : "Generate game SFX"}
                className={`
                  w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm 
                  text-muted-foreground hover:text-foreground hover:bg-glass-bg transition-all duration-200
                  ${sidebarCollapsed ? "justify-center" : ""}
                `}
              >
                <Volume2 className="w-4 h-4 flex-shrink-0" />
                {!sidebarCollapsed && (
                  <>
                    <span className="truncate flex-1">Sound Effects</span>
                    <ExternalLink className="w-3 h-3 text-muted-foreground/50" />
                  </>
                )}
              </Link>
            </nav>
          </div>

          {/* Images Section */}
          <div
            className={`mt-4 pt-4 border-t border-glass-border ${sidebarCollapsed ? "px-0" : ""}`}
          >
            {!sidebarCollapsed && (
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 px-2">
                Images
              </div>
            )}
            <nav className="space-y-1">
              <Link
                href="/images"
                title={
                  sidebarCollapsed ? "Image Library" : "Browse generated images"
                }
                className={`
                  w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm 
                  text-muted-foreground hover:text-foreground hover:bg-glass-bg transition-all duration-200
                  ${sidebarCollapsed ? "justify-center" : ""}
                `}
              >
                <ImageIcon className="w-4 h-4 flex-shrink-0" />
                {!sidebarCollapsed && (
                  <>
                    <span className="truncate flex-1">Image Library</span>
                    <ExternalLink className="w-3 h-3 text-muted-foreground/50" />
                  </>
                )}
              </Link>
              <Link
                href="/images/concept-art"
                title={
                  sidebarCollapsed ? "Concept Art" : "Generate AI concept art"
                }
                className={`
                  w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm 
                  text-muted-foreground hover:text-foreground hover:bg-glass-bg transition-all duration-200
                  ${sidebarCollapsed ? "justify-center" : ""}
                `}
              >
                <Palette className="w-4 h-4 flex-shrink-0" />
                {!sidebarCollapsed && (
                  <>
                    <span className="truncate flex-1">Concept Art</span>
                    <ExternalLink className="w-3 h-3 text-muted-foreground/50" />
                  </>
                )}
              </Link>
              <Link
                href="/images/sprites"
                title={
                  sidebarCollapsed ? "Sprites" : "Generate 2D game sprites"
                }
                className={`
                  w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm 
                  text-muted-foreground hover:text-foreground hover:bg-glass-bg transition-all duration-200
                  ${sidebarCollapsed ? "justify-center" : ""}
                `}
              >
                <Grid3X3 className="w-4 h-4 flex-shrink-0" />
                {!sidebarCollapsed && (
                  <>
                    <span className="truncate flex-1">Sprites</span>
                    <ExternalLink className="w-3 h-3 text-muted-foreground/50" />
                  </>
                )}
              </Link>
              <Link
                href="/images/textures"
                title={
                  sidebarCollapsed ? "Textures" : "Generate seamless textures"
                }
                className={`
                  w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm 
                  text-muted-foreground hover:text-foreground hover:bg-glass-bg transition-all duration-200
                  ${sidebarCollapsed ? "justify-center" : ""}
                `}
              >
                <Layers className="w-4 h-4 flex-shrink-0" />
                {!sidebarCollapsed && (
                  <>
                    <span className="truncate flex-1">Textures</span>
                    <ExternalLink className="w-3 h-3 text-muted-foreground/50" />
                  </>
                )}
              </Link>
            </nav>
          </div>
        </div>

        {/* Vault Toggle & World View Button */}
        <div className="p-3 border-t border-glass-border space-y-2">
          <button
            onClick={toggleVault}
            title={sidebarCollapsed ? "Vault" : undefined}
            className={`
              w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm
              transition-all duration-200
              ${sidebarCollapsed ? "justify-center" : ""}
              ${
                vaultOpen
                  ? "bg-cyan-500/10 text-cyan-400 border border-cyan-500/20"
                  : "text-muted-foreground hover:text-foreground hover:bg-glass-bg"
              }
            `}
          >
            <Library className="w-4 h-4 flex-shrink-0" />
            {!sidebarCollapsed && <span>Vault</span>}
          </button>

          {/* World View Button */}
          <button
            onClick={() => setWorldViewOpen(true)}
            title={sidebarCollapsed ? "World View" : "View game world entities"}
            className={`
              w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm
              transition-all duration-200
              ${sidebarCollapsed ? "justify-center" : ""}
              text-muted-foreground hover:text-foreground hover:bg-glass-bg
            `}
          >
            <Globe className="w-4 h-4 flex-shrink-0" />
            {!sidebarCollapsed && <span>World View</span>}
          </button>

          {/* Settings Link */}
          <Link
            href="/settings"
            title={sidebarCollapsed ? "Settings" : "API keys & usage"}
            className={`
              w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm
              transition-all duration-200
              ${sidebarCollapsed ? "justify-center" : ""}
              text-muted-foreground hover:text-foreground hover:bg-glass-bg
            `}
          >
            <Settings className="w-4 h-4 flex-shrink-0" />
            {!sidebarCollapsed && <span>Settings</span>}
          </Link>
        </div>
      </aside>

      {/* === UPLOAD MODAL === */}
      <AssetUploadModal
        isOpen={uploadModalOpen}
        onClose={() => setUploadModalOpen(false)}
        onUploadComplete={handleUploadComplete}
      />

      {/* === VAULT PANEL: ASSET LIBRARY === */}
      {vaultOpen && (
        <div className="w-72 border-r border-glass-border bg-glass-bg/20 flex flex-col flex-shrink-0">
          {/* Vault Header */}
          <div className="p-4 border-b border-glass-border">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Library className="w-4 h-4 text-cyan-400" />
                <span className="font-semibold text-sm uppercase tracking-wider">
                  Vault
                </span>
              </div>
              <button
                onClick={() => setUploadModalOpen(true)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-gradient-to-r from-cyan-500 to-blue-600 text-white hover:from-cyan-400 hover:to-blue-500 transition-all duration-200 shadow-lg shadow-cyan-500/20"
              >
                <Upload className="w-3.5 h-3.5" />
                Upload
              </button>
            </div>

            {/* Search */}
            <div className="relative mb-3">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search assets..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-2 bg-glass-bg border border-glass-border rounded-lg text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-cyan-500/50"
              />
            </div>

            {/* Filter Dropdown */}
            <button className="w-full flex items-center justify-between px-3 py-2 bg-glass-bg border border-glass-border rounded-lg text-sm hover:bg-glass-bg/80 transition-colors">
              <div className="flex items-center gap-2">
                <Filter className="w-4 h-4 text-muted-foreground" />
                <span>
                  {categoryFilter === "all" ? "All Categories" : categoryFilter}
                </span>
              </div>
              <ChevronDown className="w-4 h-4 text-muted-foreground" />
            </button>
          </div>

          {/* Asset List */}
          <div className="flex-1 overflow-y-auto">
            <AssetLibrary
              key={assetRefreshKey}
              onAssetSelect={handleAssetSelect}
            />
          </div>
        </div>
      )}

      {/* === MAIN VIEWPORT === */}
      <main className="flex-1 relative overflow-hidden">
        <Viewport3D
          selectedAsset={selectedAsset}
          onAssetDeleted={handleAssetDeleted}
        />
      </main>

      {/* === WORLD VIEW MODAL === */}
      <WorldView
        isOpen={worldViewOpen}
        onClose={() => setWorldViewOpen(false)}
      />
    </div>
  );
}
