"use client";

import { useState } from "react";
import {
  ChevronRight,
  ChevronLeft,
  Filter,
  FileStack,
  Upload,
} from "lucide-react";
import { SpectacularButton } from "@/components/ui/spectacular-button";
import { AssetLibrary } from "./AssetLibrary";
import { CategoryTree } from "./CategoryTree";
import { AssetFilters } from "./AssetFilters";
import { AssetUploadModal } from "./AssetUploadModal";

import type { AssetData } from "@/types/asset";

interface AssetLibrarySidebarProps {
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  onAssetSelect?: (asset: AssetData) => void;
}

export function AssetLibrarySidebar({
  isCollapsed,
  onToggleCollapse,
  onAssetSelect,
}: AssetLibrarySidebarProps) {
  const [showFilters, setShowFilters] = useState(false);
  const [showCategories, setShowCategories] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const handleUploadComplete = () => {
    // Refresh the asset library
    setRefreshKey((prev) => prev + 1);
  };

  if (isCollapsed) {
    return (
      <div className="w-12 border-r border-glass-border flex flex-col items-center py-2">
        <SpectacularButton
          variant="ghost"
          size="sm"
          onClick={onToggleCollapse}
          className="w-8 h-8 p-0"
        >
          <ChevronRight className="w-4 h-4" />
        </SpectacularButton>
      </div>
    );
  }

  return (
    <div className="w-80 border-r border-glass-border flex flex-col h-full">
      {/* Upload Modal */}
      <AssetUploadModal
        isOpen={showUploadModal}
        onClose={() => setShowUploadModal(false)}
        onUploadComplete={handleUploadComplete}
      />

      {/* Header */}
      <div className="p-4 border-b border-glass-border">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <SpectacularButton
              variant="ghost"
              size="sm"
              onClick={onToggleCollapse}
              className="w-8 h-8 p-0"
            >
              <ChevronLeft className="w-4 h-4" />
            </SpectacularButton>
            <h2 className="text-lg font-semibold">VAULT</h2>
          </div>
          <SpectacularButton
            variant="default"
            size="sm"
            onClick={() => setShowUploadModal(true)}
            className="flex items-center gap-1"
          >
            <Upload className="w-4 h-4" />
            Upload
          </SpectacularButton>
        </div>

        {/* Filters Toggle */}
        <div className="flex items-center justify-between">
          <SpectacularButton
            variant="ghost"
            size="sm"
            onClick={() => setShowFilters(!showFilters)}
            className="flex items-center gap-2"
          >
            <Filter className="w-4 h-4" />
            <span className="text-sm">Filters</span>
            <span className="text-xs text-muted-foreground">40 / 40</span>
            <ChevronRight
              className={`w-4 h-4 transition-transform ${
                showFilters ? "rotate-90" : ""
              }`}
            />
          </SpectacularButton>
        </div>
      </div>

      {/* Filters Panel */}
      {showFilters && (
        <div className="border-b border-glass-border">
          <AssetFilters />
        </div>
      )}

      {/* Asset Library */}
      <div className="flex-1 overflow-hidden flex flex-col">
        <div className="p-4 border-b border-glass-border">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileStack className="w-4 h-4" />
              <h3 className="font-medium">Asset Library</h3>
            </div>
            <span className="text-xs text-muted-foreground">40 items</span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          <AssetLibrary key={refreshKey} onAssetSelect={onAssetSelect} />
        </div>

        {/* Categories */}
        <div className="border-t border-glass-border">
          <CategoryTree />
        </div>
      </div>
    </div>
  );
}
