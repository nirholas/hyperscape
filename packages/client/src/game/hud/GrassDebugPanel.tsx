/**
 * GrassDebugPanel.tsx - Debug controls for grass system
 *
 * Shows on right side of screen when long-pressing 'g' key.
 * Allows real-time adjustment of grass parameters.
 */

import React, { useCallback, useEffect, useState, useMemo } from "react";
import { createPortal } from "react-dom";
import { useThemeStore } from "@/ui";
import type { ClientWorld } from "../../types";
import { Leaf, X, Eye, EyeOff, Wind, Palette, Layers } from "lucide-react";

interface GrassDebugPanelProps {
  world: ClientWorld;
}

interface SliderRowProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  suffix?: string;
}

function SliderRow({
  label,
  value,
  min,
  max,
  step = 0.01,
  onChange,
  suffix = "",
}: SliderRowProps) {
  const theme = useThemeStore((s) => s.theme);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between items-center">
        <span
          className="text-[10px]"
          style={{ color: theme.colors.text.secondary }}
        >
          {label}
        </span>
        <span
          className="text-[10px] font-mono"
          style={{ color: theme.colors.text.accent }}
        >
          {value.toFixed(2)}
          {suffix}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
        style={{
          background: `linear-gradient(to right, ${theme.colors.accent.primary} 0%, ${theme.colors.accent.primary} ${((value - min) / (max - min)) * 100}%, ${theme.colors.background.tertiary} ${((value - min) / (max - min)) * 100}%, ${theme.colors.background.tertiary} 100%)`,
        }}
      />
    </div>
  );
}

interface ToggleRowProps {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
  icon?: React.ReactNode;
}

function ToggleRow({ label, value, onChange, icon }: ToggleRowProps) {
  const theme = useThemeStore((s) => s.theme);

  return (
    <button
      onClick={() => onChange(!value)}
      className="flex items-center justify-between w-full p-2 rounded transition-colors"
      style={{
        background: value
          ? `${theme.colors.state.success}20`
          : theme.colors.background.tertiary,
        border: `1px solid ${value ? theme.colors.state.success + "40" : theme.colors.border.default}`,
      }}
    >
      <div className="flex items-center gap-2">
        {icon}
        <span
          className="text-[10px]"
          style={{ color: theme.colors.text.primary }}
        >
          {label}
        </span>
      </div>
      <div
        className="w-8 h-4 rounded-full relative transition-colors"
        style={{
          background: value
            ? theme.colors.state.success
            : theme.colors.background.overlay,
        }}
      >
        <div
          className="absolute top-0.5 w-3 h-3 rounded-full transition-transform"
          style={{
            background: theme.colors.text.primary,
            transform: value ? "translateX(16px)" : "translateX(2px)",
          }}
        />
      </div>
    </button>
  );
}

export function GrassDebugPanel({ world }: GrassDebugPanelProps) {
  const theme = useThemeStore((s) => s.theme);
  const [isVisible, setIsVisible] = useState(false);
  const [keyHeldStart, setKeyHeldStart] = useState<number | null>(null);

  // Grass settings state - initialized from grass system when panel opens
  const [grassEnabled, setGrassEnabled] = useState(true);
  const [windEnabled, setWindEnabled] = useState(true);
  const [windStrength, setWindStrength] = useState(0.15);
  const [windSpeed, setWindSpeed] = useState(0.3);
  const [bladeHeight, setBladeHeight] = useState(0.5); // New default
  const [bladeWidth, setBladeWidth] = useState(0.06); // New default
  const [fadeStart, setFadeStart] = useState(90); // New default
  const [fadeEnd, setFadeEnd] = useState(100); // New default

  // Get grass system reference with proper typing
  const grassSystem = useMemo(() => {
    return world.getSystem?.("grass") as {
      getMesh?: () => { visible: boolean } | null;
      setVisible?: (visible: boolean) => void;
      isVisible?: () => boolean;
      setWindEnabled?: (enabled: boolean) => void;
      isWindEnabled?: () => boolean;
      getTime?: () => number;
      // Shader parameter setters
      setWindStrength?: (value: number) => void;
      getWindStrength?: () => number;
      setWindSpeed?: (value: number) => void;
      getWindSpeed?: () => number;
      setBladeHeight?: (value: number) => void;
      getBladeHeight?: () => number;
      setBladeWidth?: (value: number) => void;
      getBladeWidth?: () => number;
      setFadeStart?: (value: number) => void;
      getFadeStart?: () => number;
      setFadeEnd?: (value: number) => void;
      getFadeEnd?: () => number;
      // Terrain projection
      renderTerrainProjection?: () => void;
    } | null;
  }, [world]);

  // Handler for refreshing terrain color projection
  const handleRefreshColors = useCallback(() => {
    if (grassSystem?.renderTerrainProjection) {
      grassSystem.renderTerrainProjection();
    }
  }, [grassSystem]);

  // Initialize state from grass system values when panel opens
  useEffect(() => {
    if (isVisible && grassSystem) {
      if (grassSystem.getWindStrength)
        setWindStrength(grassSystem.getWindStrength());
      if (grassSystem.getWindSpeed) setWindSpeed(grassSystem.getWindSpeed());
      if (grassSystem.getBladeHeight)
        setBladeHeight(grassSystem.getBladeHeight());
      if (grassSystem.getBladeWidth) setBladeWidth(grassSystem.getBladeWidth());
      if (grassSystem.getFadeStart) setFadeStart(grassSystem.getFadeStart());
      if (grassSystem.getFadeEnd) setFadeEnd(grassSystem.getFadeEnd());
      if (grassSystem.isVisible) setGrassEnabled(grassSystem.isVisible());
      if (grassSystem.isWindEnabled)
        setWindEnabled(grassSystem.isWindEnabled());
    }
  }, [isVisible, grassSystem]);

  // Long-press 'g' detection
  useEffect(() => {
    const LONG_PRESS_MS = 500;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "g" && !e.repeat) {
        setKeyHeldStart(Date.now());
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "g") {
        if (keyHeldStart && Date.now() - keyHeldStart >= LONG_PRESS_MS) {
          setIsVisible((prev) => !prev);
        }
        setKeyHeldStart(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [keyHeldStart]);

  // Apply grass visibility
  useEffect(() => {
    if (grassSystem?.setVisible) {
      grassSystem.setVisible(grassEnabled);
    }
  }, [grassEnabled, grassSystem]);

  // Apply wind enabled state
  useEffect(() => {
    if (grassSystem?.setWindEnabled) {
      grassSystem.setWindEnabled(windEnabled);
    }
  }, [windEnabled, grassSystem]);

  // Apply shader parameter changes in real-time
  const handleWindStrengthChange = useCallback(
    (value: number) => {
      setWindStrength(value);
      if (grassSystem?.setWindStrength) {
        grassSystem.setWindStrength(value);
      }
    },
    [grassSystem],
  );

  const handleWindSpeedChange = useCallback(
    (value: number) => {
      setWindSpeed(value);
      if (grassSystem?.setWindSpeed) {
        grassSystem.setWindSpeed(value);
      }
    },
    [grassSystem],
  );

  const handleBladeHeightChange = useCallback(
    (value: number) => {
      setBladeHeight(value);
      if (grassSystem?.setBladeHeight) {
        grassSystem.setBladeHeight(value);
      }
    },
    [grassSystem],
  );

  const handleBladeWidthChange = useCallback(
    (value: number) => {
      setBladeWidth(value);
      if (grassSystem?.setBladeWidth) {
        grassSystem.setBladeWidth(value);
      }
    },
    [grassSystem],
  );

  const handleFadeStartChange = useCallback(
    (value: number) => {
      setFadeStart(value);
      if (grassSystem?.setFadeStart) {
        grassSystem.setFadeStart(value);
      }
    },
    [grassSystem],
  );

  const handleFadeEndChange = useCallback(
    (value: number) => {
      setFadeEnd(value);
      if (grassSystem?.setFadeEnd) {
        grassSystem.setFadeEnd(value);
      }
    },
    [grassSystem],
  );

  // Stats from grass system
  const stats = useMemo(() => {
    const config = (
      world.getSystem?.("grass") as {
        constructor?: { getConfig?: () => Record<string, number> };
      }
    )?.constructor;
    if (config && typeof config === "function") {
      const getConfig = (
        config as unknown as { getConfig?: () => Record<string, number> }
      ).getConfig;
      if (getConfig) {
        const cfg = getConfig();
        return {
          instances: cfg.MAX_INSTANCES || 0,
          gridRadius: cfg.GRID_RADIUS || 0,
          cellSize: cfg.CELL_SIZE || 0,
          subCellsPerAxis: cfg.SUB_CELLS_PER_AXIS || 2,
          falloffRate: cfg.DENSITY_FALLOFF_RATE || 0.04,
        };
      }
    }
    return {
      instances: 600000,
      gridRadius: 67,
      cellSize: 0.35,
      subCellsPerAxis: 2,
      falloffRate: 0.04,
    };
  }, [world]);

  if (!isVisible) return null;

  const panel = (
    <div
      className="fixed right-4 top-1/2 -translate-y-1/2 w-64 rounded-lg overflow-hidden z-50"
      style={{
        background: `${theme.colors.background.panelPrimary}F5`,
        border: `1px solid ${theme.colors.border.default}`,
        backdropFilter: "blur(12px)",
        boxShadow: `0 8px 32px rgba(0,0,0,0.4)`,
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between p-3"
        style={{
          background: `linear-gradient(135deg, ${theme.colors.state.success}20 0%, transparent 100%)`,
          borderBottom: `1px solid ${theme.colors.border.default}`,
        }}
      >
        <div className="flex items-center gap-2">
          <Leaf size={16} style={{ color: theme.colors.state.success }} />
          <span
            className="text-xs font-semibold"
            style={{ color: theme.colors.text.accent }}
          >
            Grass Debug
          </span>
        </div>
        <button
          onClick={() => setIsVisible(false)}
          className="p-1 rounded hover:bg-white/10 transition-colors"
        >
          <X size={14} style={{ color: theme.colors.text.muted }} />
        </button>
      </div>

      {/* Content */}
      <div className="p-3 space-y-3">
        {/* Stats */}
        <div
          className="p-2 rounded text-[9px] font-mono space-y-1"
          style={{
            background: theme.colors.background.overlay,
            border: `1px solid ${theme.colors.border.default}40`,
          }}
        >
          <div className="flex justify-between">
            <span style={{ color: theme.colors.text.muted }}>Instances</span>
            <span style={{ color: theme.colors.state.info }}>
              {stats.instances.toLocaleString()}
            </span>
          </div>
          <div className="flex justify-between">
            <span style={{ color: theme.colors.text.muted }}>Grid Radius</span>
            <span style={{ color: theme.colors.state.info }}>
              {stats.gridRadius}m
            </span>
          </div>
          <div
            className="pt-1 mt-1"
            style={{ borderTop: `1px solid ${theme.colors.border.default}30` }}
          >
            <div
              className="text-[8px] mb-1"
              style={{ color: theme.colors.text.muted }}
            >
              Stratified + Exp Falloff
            </div>
            <div className="flex justify-between">
              <span style={{ color: theme.colors.state.success }}>
                Sub-cells
              </span>
              <span style={{ color: theme.colors.text.secondary }}>
                {stats.subCellsPerAxis}×{stats.subCellsPerAxis}
              </span>
            </div>
            <div className="flex justify-between">
              <span style={{ color: theme.colors.state.warning }}>Falloff</span>
              <span style={{ color: theme.colors.text.secondary }}>
                {stats.falloffRate}/m
              </span>
            </div>
            <div className="flex justify-between">
              <span style={{ color: theme.colors.state.info }}>@ 10m</span>
              <span style={{ color: theme.colors.text.secondary }}>
                {Math.round(Math.exp(-10 * stats.falloffRate) * 100)}%
              </span>
            </div>
            <div className="flex justify-between">
              <span style={{ color: theme.colors.text.muted }}>@ 40m</span>
              <span style={{ color: theme.colors.text.secondary }}>
                {Math.round(Math.exp(-40 * stats.falloffRate) * 100)}%
              </span>
            </div>
          </div>
        </div>

        {/* Visibility */}
        <div className="space-y-2">
          <div
            className="text-[9px] font-semibold uppercase tracking-wider"
            style={{ color: theme.colors.text.muted }}
          >
            Visibility
          </div>
          <ToggleRow
            label="Grass Enabled"
            value={grassEnabled}
            onChange={setGrassEnabled}
            icon={
              grassEnabled ? (
                <Eye size={12} style={{ color: theme.colors.state.success }} />
              ) : (
                <EyeOff size={12} style={{ color: theme.colors.text.muted }} />
              )
            }
          />
          <ToggleRow
            label="Wind Animation"
            value={windEnabled}
            onChange={setWindEnabled}
            icon={
              <Wind
                size={12}
                style={{
                  color: windEnabled
                    ? theme.colors.state.info
                    : theme.colors.text.muted,
                }}
              />
            }
          />
          {/* Refresh terrain colors button */}
          <button
            onClick={handleRefreshColors}
            className="w-full p-2 rounded text-[10px] font-medium transition-colors"
            style={{
              background: theme.colors.background.tertiary,
              border: `1px solid ${theme.colors.border.default}`,
              color: theme.colors.text.primary,
            }}
          >
            <div className="flex items-center justify-center gap-2">
              <Palette size={12} style={{ color: theme.colors.state.info }} />
              Refresh Terrain Colors
            </div>
          </button>
        </div>

        {/* Wind Controls */}
        <div className="space-y-2">
          <div
            className="text-[9px] font-semibold uppercase tracking-wider flex items-center gap-1"
            style={{ color: theme.colors.text.muted }}
          >
            <Wind size={10} />
            Wind
          </div>
          <SliderRow
            label="Strength"
            value={windStrength}
            min={0}
            max={0.5}
            step={0.01}
            onChange={handleWindStrengthChange}
          />
          <SliderRow
            label="Speed"
            value={windSpeed}
            min={0}
            max={1}
            step={0.05}
            onChange={handleWindSpeedChange}
          />
        </div>

        {/* Blade Controls */}
        <div className="space-y-2">
          <div
            className="text-[9px] font-semibold uppercase tracking-wider flex items-center gap-1"
            style={{ color: theme.colors.text.muted }}
          >
            <Layers size={10} />
            Blades
          </div>
          <SliderRow
            label="Height"
            value={bladeHeight}
            min={0.1}
            max={1.0}
            step={0.02}
            onChange={handleBladeHeightChange}
            suffix="m"
          />
          <SliderRow
            label="Width"
            value={bladeWidth}
            min={0.02}
            max={0.15}
            step={0.005}
            onChange={handleBladeWidthChange}
            suffix="m"
          />
        </div>

        {/* Distance Controls */}
        <div className="space-y-2">
          <div
            className="text-[9px] font-semibold uppercase tracking-wider flex items-center gap-1"
            style={{ color: theme.colors.text.muted }}
          >
            <Palette size={10} />
            Distance
          </div>
          <SliderRow
            label="Fade Start"
            value={fadeStart}
            min={20}
            max={150}
            step={5}
            onChange={handleFadeStartChange}
            suffix="m"
          />
          <SliderRow
            label="Fade End"
            value={fadeEnd}
            min={30}
            max={200}
            step={5}
            onChange={handleFadeEndChange}
            suffix="m"
          />
        </div>

        {/* Hotkey hint */}
        <div
          className="text-[8px] text-center pt-2"
          style={{
            color: theme.colors.text.muted,
            borderTop: `1px solid ${theme.colors.border.default}40`,
          }}
        >
          Long-press <kbd className="px-1 py-0.5 rounded bg-white/10">G</kbd> to
          toggle
        </div>
      </div>
    </div>
  );

  return createPortal(panel, document.body);
}

export default GrassDebugPanel;
