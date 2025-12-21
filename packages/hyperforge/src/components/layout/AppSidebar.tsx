"use client";

import { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  UserCog,
  Shield,
  Hand,
  RefreshCw,
  Sparkles,
  MessageSquare,
  Plus,
  Music,
  Volume2,
  Image as ImageIcon,
  Settings,
  Box,
  Palette,
  Map as MapIcon,
  LayoutDashboard,
  GitGraph,
  Building,
  type LucideIcon,
} from "lucide-react";

interface AppSidebarProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
  /** Optional extra content before the settings section */
  extraContent?: ReactNode;
}

// Studio pages that link to separate routes
const studioPages: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/studio/equipment", label: "Equipment Fitting", icon: UserCog },
  { href: "/studio/armor", label: "Armor Fitting", icon: Shield },
  { href: "/studio/hands", label: "Hand Rigging", icon: Hand },
  { href: "/studio/retarget", label: "Retarget & Animate", icon: RefreshCw },
  { href: "/studio/structures", label: "Structure Studio", icon: Building },
];

export function AppSidebar({
  collapsed,
  onToggleCollapse,
  extraContent,
}: AppSidebarProps) {
  const pathname = usePathname();

  return (
    <aside
      className={`
        ${collapsed ? "w-16" : "w-56"} 
        border-r border-glass-border bg-glass-bg/30 flex flex-col flex-shrink-0
        transition-all duration-300 ease-in-out
      `}
    >
      {/* Logo - Click to collapse */}
      <div className="p-4 border-b border-glass-border">
        <button
          onClick={onToggleCollapse}
          className="flex items-center gap-2 w-full hover:opacity-80 transition-opacity"
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center shadow-lg shadow-cyan-500/20 flex-shrink-0">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          {!collapsed && (
            <span className="font-bold text-lg tracking-wider text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-500 whitespace-nowrap">
              HYPERFORGE
            </span>
          )}
        </button>
      </div>

      {/* Dashboard + Generate */}
      <div className="p-3 border-b border-glass-border space-y-2">
        <Link
          href="/dashboard"
          className={`
            w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium
            transition-all duration-200
            ${collapsed ? "justify-center" : ""}
            ${
              pathname === "/dashboard"
                ? "bg-cyan-500/10 text-cyan-400 border border-cyan-500/20"
                : "text-muted-foreground hover:text-foreground hover:bg-glass-bg"
            }
          `}
        >
          <LayoutDashboard className="w-4 h-4 flex-shrink-0" />
          {!collapsed && <span>Dashboard</span>}
        </Link>
        <Link
          href="/generate"
          className={`
            w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium
            bg-gradient-to-r from-cyan-500 to-blue-600 text-white
            hover:from-cyan-400 hover:to-blue-500
            transition-all duration-200 shadow-lg shadow-cyan-500/20
            ${collapsed ? "justify-center" : ""}
          `}
        >
          <Plus className="w-4 h-4 flex-shrink-0" />
          {!collapsed && <span>Create Asset</span>}
        </Link>
      </div>

      {/* All Sections */}
      <div className="flex-1 p-3 overflow-y-auto themed-scrollbar">
        {/* Assets Section */}
        {!collapsed && (
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 px-2">
            Assets
          </div>
        )}
        <nav className="space-y-1">
          <Link
            href="/"
            title={collapsed ? "3D Assets" : "View 3D model assets"}
            className={`
              w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm 
              transition-all duration-200
              ${collapsed ? "justify-center" : ""}
              ${
                pathname === "/"
                  ? "bg-cyan-500/10 text-cyan-400 border border-cyan-500/20"
                  : "text-muted-foreground hover:text-foreground hover:bg-glass-bg"
              }
            `}
          >
            <Box className="w-4 h-4 flex-shrink-0" />
            {!collapsed && <span>3D Assets</span>}
          </Link>
          <Link
            href="/audio/assets"
            title={collapsed ? "Audio Assets" : "Browse audio assets"}
            className={`
              w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm 
              transition-all duration-200
              ${collapsed ? "justify-center" : ""}
              ${
                pathname === "/audio/assets"
                  ? "bg-cyan-500/10 text-cyan-400 border border-cyan-500/20"
                  : "text-muted-foreground hover:text-foreground hover:bg-glass-bg"
              }
            `}
          >
            <Volume2 className="w-4 h-4 flex-shrink-0" />
            {!collapsed && <span>Audio Assets</span>}
          </Link>
          <Link
            href="/images"
            title={collapsed ? "Image Assets" : "Browse image assets"}
            className={`
              w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm 
              transition-all duration-200
              ${collapsed ? "justify-center" : ""}
              ${
                pathname === "/images"
                  ? "bg-pink-500/10 text-pink-400 border border-pink-500/20"
                  : "text-muted-foreground hover:text-foreground hover:bg-glass-bg"
              }
            `}
          >
            <ImageIcon className="w-4 h-4 flex-shrink-0" />
            {!collapsed && <span>Image Assets</span>}
          </Link>
          <Link
            href="/content"
            title={collapsed ? "Content Assets" : "Browse content assets"}
            className={`
              w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm 
              transition-all duration-200
              ${collapsed ? "justify-center" : ""}
              ${
                pathname === "/content"
                  ? "bg-cyan-500/10 text-cyan-400 border border-cyan-500/20"
                  : "text-muted-foreground hover:text-foreground hover:bg-glass-bg"
              }
            `}
          >
            <MessageSquare className="w-4 h-4 flex-shrink-0" />
            {!collapsed && <span>Content Assets</span>}
          </Link>
        </nav>

        {/* Studios Section */}
        <div
          className={`mt-6 pt-4 border-t border-glass-border ${collapsed ? "px-0" : ""}`}
        >
          {!collapsed && (
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 px-2">
              Studios
            </div>
          )}
          <nav className="space-y-1">
            {/* Generation Studios */}
            <Link
              href="/images/studio"
              title={
                collapsed
                  ? "Image Studio"
                  : "Generate concept art, sprites, and textures"
              }
              className={`
                w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm 
                transition-all duration-200
                ${collapsed ? "justify-center" : ""}
                ${
                  pathname === "/images/studio"
                    ? "bg-pink-500/10 text-pink-400 border border-pink-500/20"
                    : "text-muted-foreground hover:text-foreground hover:bg-glass-bg"
                }
              `}
            >
              <Palette className="w-4 h-4 flex-shrink-0" />
              {!collapsed && <span>Image Studio</span>}
            </Link>
            <Link
              href="/audio"
              title={
                collapsed ? "Audio Studio" : "Voice, SFX & Music generation"
              }
              className={`
                w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm
                transition-all duration-200
                ${collapsed ? "justify-center" : ""}
                ${
                  pathname === "/audio"
                    ? "bg-cyan-500/10 text-cyan-400 border border-cyan-500/20"
                    : "text-muted-foreground hover:text-foreground hover:bg-glass-bg"
                }
              `}
            >
              <Music className="w-4 h-4 flex-shrink-0" />
              {!collapsed && <span>Audio Studio</span>}
            </Link>
            <Link
              href="/content/generate"
              title={
                collapsed
                  ? "Content Studio"
                  : "Generate NPCs, quests, areas & items"
              }
              className={`
                w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm
                transition-all duration-200
                ${collapsed ? "justify-center" : ""}
                ${
                  pathname === "/content/generate"
                    ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                    : "text-muted-foreground hover:text-foreground hover:bg-glass-bg"
                }
              `}
            >
              <Sparkles className="w-4 h-4 flex-shrink-0" />
              {!collapsed && <span>Content Studio</span>}
            </Link>

            {/* Divider */}
            {!collapsed && (
              <div className="my-2 border-t border-glass-border/50" />
            )}

            {/* 3D Processing Studios */}
            {studioPages.map((page) => {
              const isActive = pathname === page.href;
              return (
                <Link
                  key={page.href}
                  href={page.href}
                  title={collapsed ? page.label : undefined}
                  className={`
                    w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm
                    transition-all duration-200
                    ${collapsed ? "justify-center" : ""}
                    ${
                      isActive
                        ? "bg-cyan-500/10 text-cyan-400 border border-cyan-500/20"
                        : "text-muted-foreground hover:text-foreground hover:bg-glass-bg"
                    }
                  `}
                >
                  <page.icon className="w-4 h-4 flex-shrink-0" />
                  {!collapsed && <span>{page.label}</span>}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* World Section */}
        <div
          className={`mt-6 pt-4 border-t border-glass-border ${collapsed ? "px-0" : ""}`}
        >
          {!collapsed && (
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 px-2">
              World
            </div>
          )}
          <nav className="space-y-1">
            <Link
              href="/world"
              title={collapsed ? "World Editor" : "Visual world editor"}
              className={`
                w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm
                transition-all duration-200
                ${collapsed ? "justify-center" : ""}
                ${
                  pathname === "/world"
                    ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                    : "text-muted-foreground hover:text-foreground hover:bg-glass-bg"
                }
              `}
            >
              <MapIcon className="w-4 h-4 flex-shrink-0" />
              {!collapsed && <span>World Editor</span>}
            </Link>
            <Link
              href="/graph"
              title={
                collapsed ? "Relationship Graph" : "Asset relationship graph"
              }
              className={`
                w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm
                transition-all duration-200
                ${collapsed ? "justify-center" : ""}
                ${
                  pathname === "/graph"
                    ? "bg-violet-500/10 text-violet-400 border border-violet-500/20"
                    : "text-muted-foreground hover:text-foreground hover:bg-glass-bg"
                }
              `}
            >
              <GitGraph className="w-4 h-4 flex-shrink-0" />
              {!collapsed && <span>Relationship Graph</span>}
            </Link>
          </nav>
        </div>

        {/* Extra Content */}
        {extraContent}
      </div>

      {/* Bottom Settings Section */}
      <div className="p-3 border-t border-glass-border space-y-2">
        <Link
          href="/settings"
          title={collapsed ? "Settings" : "API keys & usage"}
          className={`
            w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm
            transition-all duration-200
            ${collapsed ? "justify-center" : ""}
            ${
              pathname === "/settings"
                ? "bg-cyan-500/10 text-cyan-400 border border-cyan-500/20"
                : "text-muted-foreground hover:text-foreground hover:bg-glass-bg"
            }
          `}
        >
          <Settings className="w-4 h-4 flex-shrink-0" />
          {!collapsed && <span>Settings</span>}
        </Link>
      </div>
    </aside>
  );
}
