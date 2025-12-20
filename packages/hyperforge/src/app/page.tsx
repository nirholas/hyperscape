"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  Library,
  Filter,
  Search,
  ChevronDown,
  Globe,
  Upload,
  Map as MapIcon,
} from "lucide-react";
import { Viewport3D } from "@/components/viewer/Viewport3D";
import { AssetLibrary } from "@/components/vault/AssetLibrary";
import { AssetUploadModal } from "@/components/vault/AssetUploadModal";
import { WorldView } from "@/components/world/WorldView";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { useAppStore } from "@/stores/app-store";
import { useHiddenAssets } from "@/hooks/useHiddenAssets";
import type { BaseAsset } from "@/types/asset";

export default function HomePage() {
  // Use individual selectors to prevent unnecessary re-renders
  const selectedAsset = useAppStore((state) => state.selectedAsset);
  const setSelectedAsset = useAppStore((state) => state.setSelectedAsset);
  const sidebarCollapsed = useAppStore((state) => state.sidebarCollapsed);
  const toggleSidebar = useAppStore((state) => state.toggleSidebar);
  const vaultOpen = useAppStore((state) => state.vaultOpen);
  const toggleVault = useAppStore((state) => state.toggleVault);

  const { hiddenCount } = useHiddenAssets();

  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [showCategoryDropdown, setShowCategoryDropdown] = useState(false);
  const [mounted, setMounted] = useState(false);

  // Available categories for 3D assets
  const assetCategories = [
    { value: "all", label: "All Categories" },
    { value: "favorites", label: "⭐ Favorites" },
    { value: "weapon", label: "Weapons" },
    { value: "armor", label: "Armor" },
    { value: "tool", label: "Tools" },
    { value: "avatar", label: "Avatars" },
    { value: "npc", label: "NPCs" },
    { value: "resource", label: "Resources" },
    { value: "item", label: "Items" },
    ...(hiddenCount > 0
      ? [{ value: "hidden", label: `👁️‍🗨️ Hidden (${hiddenCount})` }]
      : []),
  ];
  const [worldViewOpen, setWorldViewOpen] = useState(false);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [assetRefreshKey, setAssetRefreshKey] = useState(0);

  // Ensure consistent rendering between server and client for icons
  useEffect(() => {
    setMounted(true);
  }, []);

  // Close category dropdown when clicking outside
  useEffect(() => {
    if (!showCategoryDropdown) return;

    const handleClickOutside = () => setShowCategoryDropdown(false);
    // Small delay to avoid closing immediately on the button click
    const timer = setTimeout(() => {
      document.addEventListener("click", handleClickOutside);
    }, 0);

    return () => {
      clearTimeout(timer);
      document.removeEventListener("click", handleClickOutside);
    };
  }, [showCategoryDropdown]);

  const handleAssetSelect = (asset: BaseAsset) => {
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
  // Using CSS-only spinner to prevent attribute mismatches
  if (!mounted) {
    return (
      <div className="flex h-screen bg-background overflow-hidden">
        <aside className="w-56 border-r border-glass-border bg-glass-bg/30 flex flex-col flex-shrink-0">
          <div className="flex-1 flex items-center justify-center">
            {/* CSS-only spinner to avoid Lucide hydration mismatch */}
            <div className="w-6 h-6 border-2 border-muted-foreground border-t-transparent rounded-full animate-spin" />
          </div>
        </aside>
        <main className="flex-1 relative overflow-hidden bg-gradient-to-b from-zinc-900 to-zinc-950" />
      </div>
    );
  }

  // Extra sidebar content for the homepage (vault, world view, etc.)
  const extraSidebarContent = (
    <div className="mt-6 pt-4 border-t border-glass-border space-y-2">
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

      {/* World Editor Link */}
      <Link
        href="/world"
        title={sidebarCollapsed ? "World Editor" : "Visual world editor"}
        className={`
          w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm
          transition-all duration-200
          ${sidebarCollapsed ? "justify-center" : ""}
          text-muted-foreground hover:text-foreground hover:bg-glass-bg
        `}
      >
        <MapIcon className="w-4 h-4 flex-shrink-0" />
        {!sidebarCollapsed && <span>World Editor</span>}
      </Link>

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
    </div>
  );

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* === LEFT SIDEBAR: SHARED NAVIGATION === */}
      <AppSidebar
        collapsed={sidebarCollapsed}
        onToggleCollapse={toggleSidebar}
        extraContent={extraSidebarContent}
      />

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
                className="w-full pl-9 pr-3 py-2 bg-glass-bg border border-glass-border rounded-lg text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-cyan-500/50 text-foreground"
              />
            </div>

            {/* Category Filter */}
            <div className="relative">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowCategoryDropdown(!showCategoryDropdown);
                }}
                className="w-full flex items-center justify-between px-3 py-2 bg-glass-bg border border-glass-border rounded-lg text-sm hover:border-cyan-500/30 transition-colors"
              >
                <span className="flex items-center gap-2">
                  <Filter className="w-4 h-4 text-muted-foreground" />
                  {assetCategories.find((c) => c.value === categoryFilter)
                    ?.label || "All Categories"}
                </span>
                <ChevronDown
                  className={`w-4 h-4 text-muted-foreground transition-transform ${showCategoryDropdown ? "rotate-180" : ""}`}
                />
              </button>

              {showCategoryDropdown && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-glass-bg border border-glass-border rounded-lg shadow-lg z-50 max-h-60 overflow-auto">
                  {assetCategories.map((category) => (
                    <button
                      key={category.value}
                      onClick={() => {
                        setCategoryFilter(category.value);
                        setShowCategoryDropdown(false);
                      }}
                      className={`w-full px-3 py-2 text-left text-sm hover:bg-glass-bg/50 transition-colors ${
                        categoryFilter === category.value
                          ? "text-cyan-400 bg-cyan-500/10"
                          : "text-foreground"
                      }`}
                    >
                      {category.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Asset List */}
          <div className="flex-1 overflow-y-auto themed-scrollbar">
            <AssetLibrary
              key={assetRefreshKey}
              onAssetSelect={handleAssetSelect}
              selectedAsset={selectedAsset}
              searchQuery={searchQuery}
              categoryFilter={categoryFilter}
              onAssetDeleted={handleAssetDeleted}
            />
          </div>
        </div>
      )}

      {/* === MAIN 3D VIEWPORT === */}
      <main className="flex-1 relative overflow-hidden">
        <Viewport3D selectedAsset={selectedAsset} />
      </main>

      {/* === WORLD VIEW MODAL === */}
      <WorldView
        isOpen={worldViewOpen}
        onClose={() => setWorldViewOpen(false)}
      />
    </div>
  );
}
