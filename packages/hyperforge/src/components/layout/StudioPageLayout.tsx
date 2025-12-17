"use client";

import { ReactNode, useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Library,
  UserCog,
  Shield,
  Hand,
  RefreshCw,
  Globe,
  Sparkles,
  MessageSquare,
  Plus,
  ArrowLeft,
  Music,
  Volume2,
  Mic,
  Image as ImageIcon,
  Palette,
  Grid3X3,
  Layers,
  Settings,
  Box,
  type LucideIcon,
} from "lucide-react";
import { WorldView } from "@/components/world/WorldView";

interface StudioPageLayoutProps {
  children: ReactNode;
  title: string;
  description?: string;
  /** Optional sidebar content for tool options */
  toolsSidebar?: ReactNode;
  /** Optional asset selection sidebar */
  assetSidebar?: ReactNode;
  /** Show vault by default */
  showVault?: boolean;
}

// Studio pages that link to separate routes
const studioPages: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/studio/equipment", label: "Equipment Fitting", icon: UserCog },
  { href: "/studio/armor", label: "Armor Fitting", icon: Shield },
  { href: "/studio/hands", label: "Hand Rigging", icon: Hand },
  { href: "/studio/retarget", label: "Retarget & Animate", icon: RefreshCw },
];

export function StudioPageLayout({
  children,
  title,
  description,
  toolsSidebar,
  assetSidebar,
  showVault = true,
}: StudioPageLayoutProps) {
  const pathname = usePathname();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [vaultOpen, setVaultOpen] = useState(showVault);
  const [mounted, setMounted] = useState(false);
  const [worldViewOpen, setWorldViewOpen] = useState(false);

  // Ensure consistent rendering between server and client
  useEffect(() => {
    setMounted(true);
  }, []);

  // Show a minimal skeleton during SSR to avoid hydration mismatch with icons
  if (!mounted) {
    return (
      <div className="flex h-screen bg-background overflow-hidden">
        <aside className="w-56 border-r border-glass-border bg-glass-bg/30 flex flex-col flex-shrink-0" />
        <main className="flex-1 relative overflow-hidden">{children}</main>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* === LEFT SIDEBAR: NAVIGATION === */}
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
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
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

        {/* Back to Library */}
        <div className="p-3 border-b border-glass-border">
          <Link
            href="/"
            className={`
              w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm
              text-muted-foreground hover:text-foreground hover:bg-glass-bg transition-all duration-200
              ${sidebarCollapsed ? "justify-center" : ""}
            `}
          >
            <ArrowLeft className="w-4 h-4 flex-shrink-0" />
            {!sidebarCollapsed && <span>Back to Library</span>}
          </Link>
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

        {/* All Sections */}
        <div className="flex-1 p-3 overflow-y-auto themed-scrollbar">
          {/* Assets Section */}
          {!sidebarCollapsed && (
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 px-2">
              Assets
            </div>
          )}
          <nav className="space-y-1">
            <Link
              href="/"
              title={sidebarCollapsed ? "3D Assets" : "View 3D model assets"}
              className={`
                w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm 
                transition-all duration-200
                ${sidebarCollapsed ? "justify-center" : ""}
                ${
                  pathname === "/"
                    ? "bg-cyan-500/10 text-cyan-400 border border-cyan-500/20"
                    : "text-muted-foreground hover:text-foreground hover:bg-glass-bg"
                }
              `}
            >
              <Box className="w-4 h-4 flex-shrink-0" />
              {!sidebarCollapsed && <span>3D Assets</span>}
            </Link>
            <Link
              href="/assets/audio"
              title={sidebarCollapsed ? "Audio Assets" : "Browse audio assets"}
              className={`
                w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm 
                transition-all duration-200
                ${sidebarCollapsed ? "justify-center" : ""}
                ${
                  pathname === "/assets/audio"
                    ? "bg-cyan-500/10 text-cyan-400 border border-cyan-500/20"
                    : "text-muted-foreground hover:text-foreground hover:bg-glass-bg"
                }
              `}
            >
              <Volume2 className="w-4 h-4 flex-shrink-0" />
              {!sidebarCollapsed && <span>Audio Assets</span>}
            </Link>
            <Link
              href="/assets/images"
              title={sidebarCollapsed ? "Image Assets" : "Browse image assets"}
              className={`
                w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm 
                transition-all duration-200
                ${sidebarCollapsed ? "justify-center" : ""}
                ${
                  pathname === "/assets/images"
                    ? "bg-pink-500/10 text-pink-400 border border-pink-500/20"
                    : "text-muted-foreground hover:text-foreground hover:bg-glass-bg"
                }
              `}
            >
              <ImageIcon className="w-4 h-4 flex-shrink-0" />
              {!sidebarCollapsed && <span>Image Assets</span>}
            </Link>
            <Link
              href="/assets/content"
              title={
                sidebarCollapsed ? "Content Assets" : "Browse content assets"
              }
              className={`
                w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm 
                transition-all duration-200
                ${sidebarCollapsed ? "justify-center" : ""}
                ${
                  pathname === "/assets/content"
                    ? "bg-cyan-500/10 text-cyan-400 border border-cyan-500/20"
                    : "text-muted-foreground hover:text-foreground hover:bg-glass-bg"
                }
              `}
            >
              <MessageSquare className="w-4 h-4 flex-shrink-0" />
              {!sidebarCollapsed && <span>Content Assets</span>}
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
              {studioPages.map((page) => {
                const isActive = pathname === page.href;
                return (
                  <Link
                    key={page.href}
                    href={page.href}
                    title={sidebarCollapsed ? page.label : undefined}
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
                    <page.icon
                      className={`w-4 h-4 flex-shrink-0 ${isActive ? "text-cyan-400" : ""}`}
                    />
                    {!sidebarCollapsed && (
                      <span className="truncate">{page.label}</span>
                    )}
                  </Link>
                );
              })}
            </nav>
          </div>

          {/* Content Link */}
          <div
            className={`mt-6 pt-4 border-t border-glass-border ${sidebarCollapsed ? "px-0" : ""}`}
          >
            {!sidebarCollapsed && (
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 px-2">
                Content
              </div>
            )}
            <Link
              href="/content"
              title={sidebarCollapsed ? "NPC Dialogue" : undefined}
              className={`
                w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm 
                transition-all duration-200
                ${sidebarCollapsed ? "justify-center" : ""}
                ${
                  pathname === "/content"
                    ? "bg-cyan-500/10 text-cyan-400 border border-cyan-500/20"
                    : "text-muted-foreground hover:text-foreground hover:bg-glass-bg"
                }
              `}
            >
              <MessageSquare className="w-4 h-4 flex-shrink-0" />
              {!sidebarCollapsed && <span>NPC Dialogue</span>}
            </Link>
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
                title={sidebarCollapsed ? "Audio Studio" : undefined}
                className={`
                  w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm 
                  transition-all duration-200
                  ${sidebarCollapsed ? "justify-center" : ""}
                  ${
                    pathname === "/audio"
                      ? "bg-cyan-500/10 text-cyan-400 border border-cyan-500/20"
                      : "text-muted-foreground hover:text-foreground hover:bg-glass-bg"
                  }
                `}
              >
                <Music className="w-4 h-4 flex-shrink-0" />
                {!sidebarCollapsed && <span>Audio Studio</span>}
              </Link>
              <Link
                href="/audio/voice"
                title={sidebarCollapsed ? "Voice Generator" : undefined}
                className={`
                  w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm 
                  transition-all duration-200
                  ${sidebarCollapsed ? "justify-center" : ""}
                  ${
                    pathname === "/audio/voice"
                      ? "bg-cyan-500/10 text-cyan-400 border border-cyan-500/20"
                      : "text-muted-foreground hover:text-foreground hover:bg-glass-bg"
                  }
                `}
              >
                <Mic className="w-4 h-4 flex-shrink-0" />
                {!sidebarCollapsed && <span>Voice Generator</span>}
              </Link>
              <Link
                href="/audio/sfx"
                title={sidebarCollapsed ? "Sound Effects" : undefined}
                className={`
                  w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm 
                  transition-all duration-200
                  ${sidebarCollapsed ? "justify-center" : ""}
                  ${
                    pathname === "/audio/sfx"
                      ? "bg-cyan-500/10 text-cyan-400 border border-cyan-500/20"
                      : "text-muted-foreground hover:text-foreground hover:bg-glass-bg"
                  }
                `}
              >
                <Volume2 className="w-4 h-4 flex-shrink-0" />
                {!sidebarCollapsed && <span>Sound Effects</span>}
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
                title={sidebarCollapsed ? "Image Library" : undefined}
                className={`
                  w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm 
                  transition-all duration-200
                  ${sidebarCollapsed ? "justify-center" : ""}
                  ${
                    pathname === "/images"
                      ? "bg-pink-500/10 text-pink-400 border border-pink-500/20"
                      : "text-muted-foreground hover:text-foreground hover:bg-glass-bg"
                  }
                `}
              >
                <ImageIcon className="w-4 h-4 flex-shrink-0" />
                {!sidebarCollapsed && <span>Image Library</span>}
              </Link>
              <Link
                href="/images/concept-art"
                title={sidebarCollapsed ? "Concept Art" : undefined}
                className={`
                  w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm 
                  transition-all duration-200
                  ${sidebarCollapsed ? "justify-center" : ""}
                  ${
                    pathname === "/images/concept-art"
                      ? "bg-pink-500/10 text-pink-400 border border-pink-500/20"
                      : "text-muted-foreground hover:text-foreground hover:bg-glass-bg"
                  }
                `}
              >
                <Palette className="w-4 h-4 flex-shrink-0" />
                {!sidebarCollapsed && <span>Concept Art</span>}
              </Link>
              <Link
                href="/images/sprites"
                title={sidebarCollapsed ? "Sprites" : undefined}
                className={`
                  w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm 
                  transition-all duration-200
                  ${sidebarCollapsed ? "justify-center" : ""}
                  ${
                    pathname === "/images/sprites"
                      ? "bg-pink-500/10 text-pink-400 border border-pink-500/20"
                      : "text-muted-foreground hover:text-foreground hover:bg-glass-bg"
                  }
                `}
              >
                <Grid3X3 className="w-4 h-4 flex-shrink-0" />
                {!sidebarCollapsed && <span>Sprites</span>}
              </Link>
              <Link
                href="/images/textures"
                title={sidebarCollapsed ? "Textures" : undefined}
                className={`
                  w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm 
                  transition-all duration-200
                  ${sidebarCollapsed ? "justify-center" : ""}
                  ${
                    pathname === "/images/textures"
                      ? "bg-pink-500/10 text-pink-400 border border-pink-500/20"
                      : "text-muted-foreground hover:text-foreground hover:bg-glass-bg"
                  }
                `}
              >
                <Layers className="w-4 h-4 flex-shrink-0" />
                {!sidebarCollapsed && <span>Textures</span>}
              </Link>
            </nav>
          </div>
        </div>

        {/* Vault Toggle & World View */}
        <div className="p-3 border-t border-glass-border space-y-2">
          {assetSidebar && (
            <button
              onClick={() => setVaultOpen(!vaultOpen)}
              title={sidebarCollapsed ? "Assets" : undefined}
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
              {!sidebarCollapsed && <span>Assets</span>}
            </button>
          )}

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
              ${
                pathname === "/settings"
                  ? "bg-cyan-500/10 text-cyan-400 border border-cyan-500/20"
                  : "text-muted-foreground hover:text-foreground hover:bg-glass-bg"
              }
            `}
          >
            <Settings className="w-4 h-4 flex-shrink-0" />
            {!sidebarCollapsed && <span>Settings</span>}
          </Link>
        </div>
      </aside>

      {/* === ASSET SELECTION SIDEBAR === */}
      {vaultOpen && assetSidebar && (
        <div className="w-72 border-r border-glass-border bg-glass-bg/20 flex flex-col flex-shrink-0">
          {assetSidebar}
        </div>
      )}

      {/* === TOOLS SIDEBAR (Right side) === */}
      {toolsSidebar && (
        <div className="w-80 border-r border-glass-border bg-glass-bg/20 flex flex-col flex-shrink-0 order-last">
          <div className="p-4 border-b border-glass-border">
            <h2 className="font-semibold">{title}</h2>
            {description && (
              <p className="text-sm text-muted-foreground mt-1">
                {description}
              </p>
            )}
          </div>
          <div className="flex-1 overflow-y-auto">{toolsSidebar}</div>
        </div>
      )}

      {/* === MAIN VIEWPORT === */}
      <main className="flex-1 relative overflow-hidden">{children}</main>

      {/* === WORLD VIEW MODAL === */}
      <WorldView
        isOpen={worldViewOpen}
        onClose={() => setWorldViewOpen(false)}
      />
    </div>
  );
}
