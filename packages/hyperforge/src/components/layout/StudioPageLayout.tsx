"use client";

import { ReactNode, useState, useEffect } from "react";
import { Library, Globe } from "lucide-react";
import { WorldView } from "@/components/world/WorldView";
import { AppSidebar } from "./AppSidebar";

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

export function StudioPageLayout({
  children,
  title,
  description,
  toolsSidebar,
  assetSidebar,
  showVault = true,
}: StudioPageLayoutProps) {
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

  // Extra content for the sidebar (vault toggle and world view)
  const extraSidebarContent = (
    <div className="mt-6 pt-4 border-t border-glass-border space-y-2">
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
    </div>
  );

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* === LEFT SIDEBAR: NAVIGATION === */}
      <AppSidebar
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
        extraContent={extraSidebarContent}
      />

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
