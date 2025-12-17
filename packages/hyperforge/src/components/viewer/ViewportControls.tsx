"use client";

import { SpectacularButton } from "@/components/ui/spectacular-button";
import {
  RefreshCw,
  Camera,
  Eye,
  Grid3x3,
  Moon,
  Settings,
  Palette,
  Loader2,
} from "lucide-react";

interface ViewportControlsProps {
  /** If true, hide Retexture and Regenerate buttons (for VRM files) */
  isVRM?: boolean;
  /** If true, show loading state for action buttons */
  isProcessing?: boolean;
  onRetexture?: () => void;
  onRegenerate?: () => void;
  onSprites?: () => void;
  onEdit?: () => void;
  onToggleVisibility?: () => void;
  onToggleGrid?: () => void;
  onToggleTheme?: () => void;
  onRefresh?: () => void;
  onCapture?: () => void;
  onSettings?: () => void;
}

export function ViewportControls({
  isVRM = false,
  isProcessing = false,
  onRetexture,
  onRegenerate,
  onSprites,
  onEdit,
  onToggleVisibility,
  onToggleGrid,
  onToggleTheme,
  onRefresh,
  onCapture,
  onSettings: _onSettings,
}: ViewportControlsProps) {
  // Show action buttons only for non-VRM assets
  const showAssetActions = !isVRM;

  return (
    <div className="absolute top-4 left-4 z-10 flex items-center gap-2 glass-panel p-2 rounded-lg">
      {/* Action Buttons - Only for GLB assets, not VRM */}
      {showAssetActions && (
        <>
          <SpectacularButton
            variant="ghost"
            size="sm"
            onClick={onRetexture}
            disabled={isProcessing}
            title="Retexture - Create texture variants"
          >
            {isProcessing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Palette className="w-4 h-4" />
            )}
            <span className="hidden sm:inline ml-1">Retexture</span>
          </SpectacularButton>

          <SpectacularButton
            variant="ghost"
            size="sm"
            onClick={onRegenerate}
            disabled={isProcessing}
            title="Regenerate - Create variations"
          >
            {isProcessing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
            <span className="hidden sm:inline ml-1">Regenerate</span>
          </SpectacularButton>

          <SpectacularButton
            variant="ghost"
            size="sm"
            onClick={onSprites}
            disabled={isProcessing}
            title="Generate Sprites"
          >
            <Grid3x3 className="w-4 h-4" />
            <span className="hidden sm:inline ml-1">Sprites</span>
          </SpectacularButton>

          {/* Divider */}
          <div className="w-px h-6 bg-glass-border mx-1" />
        </>
      )}

      {/* Utility Icons - Always visible */}
      <SpectacularButton
        variant="ghost"
        size="sm"
        onClick={onEdit}
        title="Edit Properties"
      >
        <Settings className="w-4 h-4" />
      </SpectacularButton>

      <SpectacularButton
        variant="ghost"
        size="sm"
        onClick={onToggleVisibility}
        title="Toggle Visibility"
      >
        <Eye className="w-4 h-4" />
      </SpectacularButton>

      <SpectacularButton
        variant="ghost"
        size="sm"
        onClick={onToggleGrid}
        title="Toggle Grid"
      >
        <Grid3x3 className="w-4 h-4" />
      </SpectacularButton>

      <SpectacularButton
        variant="ghost"
        size="sm"
        onClick={onToggleTheme}
        title="Toggle Theme"
      >
        <Moon className="w-4 h-4" />
      </SpectacularButton>

      <SpectacularButton
        variant="ghost"
        size="sm"
        onClick={onRefresh}
        title="Refresh Model"
      >
        <RefreshCw className="w-4 h-4" />
      </SpectacularButton>

      <SpectacularButton
        variant="ghost"
        size="sm"
        onClick={onCapture}
        title="Capture Screenshot"
      >
        <Camera className="w-4 h-4" />
      </SpectacularButton>
    </div>
  );
}
