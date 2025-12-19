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
  Grid3X3,
  Layers,
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

      {/* Generate New Button */}
      <div className="p-3 border-b border-glass-border">
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
          {!collapsed && <span>Generate New</span>}
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
            href="/audio"
            title={collapsed ? "Audio Assets" : "Browse audio assets"}
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
            <Volume2 className="w-4 h-4 flex-shrink-0" />
            {!collapsed && <span>Audio Assets</span>}
          </Link>
          <Link
            href="/images/concept-art"
            title={collapsed ? "Image Assets" : "Browse image assets"}
            className={`
              w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm 
              transition-all duration-200
              ${collapsed ? "justify-center" : ""}
              ${
                pathname?.startsWith("/images")
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
                pathname?.startsWith("/content")
                  ? "bg-cyan-500/10 text-cyan-400 border border-cyan-500/20"
                  : "text-muted-foreground hover:text-foreground hover:bg-glass-bg"
              }
            `}
          >
            <MessageSquare className="w-4 h-4 flex-shrink-0" />
            {!collapsed && <span>Content Assets</span>}
          </Link>
        </nav>

        {/* Studio Pages */}
        <div
          className={`mt-6 pt-4 border-t border-glass-border ${collapsed ? "px-0" : ""}`}
        >
          {!collapsed && (
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

        {/* Images Section */}
        <div
          className={`mt-6 pt-4 border-t border-glass-border ${collapsed ? "px-0" : ""}`}
        >
          {!collapsed && (
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 px-2">
              Images
            </div>
          )}
          <nav className="space-y-1">
            <Link
              href="/images/concept-art"
              title={collapsed ? "Concept Art" : undefined}
              className={`
                w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm 
                transition-all duration-200
                ${collapsed ? "justify-center" : ""}
                ${
                  pathname === "/images/concept-art"
                    ? "bg-pink-500/10 text-pink-400 border border-pink-500/20"
                    : "text-muted-foreground hover:text-foreground hover:bg-glass-bg"
                }
              `}
            >
              <Palette className="w-4 h-4 flex-shrink-0" />
              {!collapsed && <span>Concept Art</span>}
            </Link>
            <Link
              href="/images/sprites"
              title={collapsed ? "Sprites" : undefined}
              className={`
                w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm 
                transition-all duration-200
                ${collapsed ? "justify-center" : ""}
                ${
                  pathname === "/images/sprites"
                    ? "bg-pink-500/10 text-pink-400 border border-pink-500/20"
                    : "text-muted-foreground hover:text-foreground hover:bg-glass-bg"
                }
              `}
            >
              <Grid3X3 className="w-4 h-4 flex-shrink-0" />
              {!collapsed && <span>Sprites</span>}
            </Link>
            <Link
              href="/images/textures"
              title={collapsed ? "Textures" : undefined}
              className={`
                w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm 
                transition-all duration-200
                ${collapsed ? "justify-center" : ""}
                ${
                  pathname === "/images/textures"
                    ? "bg-pink-500/10 text-pink-400 border border-pink-500/20"
                    : "text-muted-foreground hover:text-foreground hover:bg-glass-bg"
                }
              `}
            >
              <Layers className="w-4 h-4 flex-shrink-0" />
              {!collapsed && <span>Textures</span>}
            </Link>
          </nav>
        </div>

        {/* Audio Section */}
        <div
          className={`mt-6 pt-4 border-t border-glass-border ${collapsed ? "px-0" : ""}`}
        >
          {!collapsed && (
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 px-2">
              Audio
            </div>
          )}
          <nav className="space-y-1">
            <Link
              href="/audio"
              title={collapsed ? "Audio Studio" : "Voice, SFX & Music"}
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
