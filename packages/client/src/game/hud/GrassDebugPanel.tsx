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
import { Leaf, X, Eye, EyeOff, Wind, Palette, Sun, Moon } from "lucide-react";

interface GrassDebugPanelProps {
  world: ClientWorld;
}

/** Type for grass system API accessed from debug panel */
type GrassSystemAPI = {
  getMesh?: () => { visible: boolean } | null;
  setVisible?: (visible: boolean) => void;
  isVisible?: () => boolean;
  // Wind
  setWindStrength?: (v: number) => void;
  getWindStrength?: () => number;
  setWindSpeed?: (v: number) => void;
  getWindSpeed?: () => number;
  setWindScale?: (v: number) => void;
  getWindScale?: () => number;
  // LOD0 fade
  setFadeStart?: (v: number) => void;
  getFadeStart?: () => number;
  setFadeEnd?: (v: number) => void;
  getFadeEnd?: () => number;
  // Culling
  setCullingR0?: (v: number) => void;
  getCullingR0?: () => number;
  setCullingR1?: (v: number) => void;
  getCullingR1?: () => number;
  setCullingPMin?: (v: number) => void;
  getCullingPMin?: () => number;
  // Trail
  setTrailRadius?: (v: number) => void;
  getTrailRadius?: () => number;
  // Day/night
  setDayColor?: (r: number, g: number, b: number) => void;
  getDayColor?: () => { r: number; g: number; b: number };
  setNightColor?: (r: number, g: number, b: number) => void;
  getNightColor?: () => { r: number; g: number; b: number };
  setDayNightMix?: (v: number) => void;
  getDayNightMix?: () => number;
  // LOD1 cards
  setLOD1FadeInStart?: (v: number) => void;
  getLOD1FadeInStart?: () => number;
  setLOD1FadeInEnd?: (v: number) => void;
  getLOD1FadeInEnd?: () => number;
  setLOD1FadeOutStart?: (v: number) => void;
  getLOD1FadeOutStart?: () => number;
  setLOD1FadeOutEnd?: (v: number) => void;
  getLOD1FadeOutEnd?: () => number;
  // Terrain
  renderTerrainProjection?: () => void;
} | null;

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

interface ColorRowProps {
  label: string;
  value: { r: number; g: number; b: number };
  onChange: (color: { r: number; g: number; b: number }) => void;
  icon?: React.ReactNode;
}

function ColorRow({ label, value, onChange, icon }: ColorRowProps) {
  const theme = useThemeStore((s) => s.theme);

  // Convert RGB 0-1 to hex
  const toHex = (c: { r: number; g: number; b: number }) => {
    const r = Math.round(c.r * 255)
      .toString(16)
      .padStart(2, "0");
    const g = Math.round(c.g * 255)
      .toString(16)
      .padStart(2, "0");
    const b = Math.round(c.b * 255)
      .toString(16)
      .padStart(2, "0");
    return `#${r}${g}${b}`;
  };

  // Convert hex to RGB 0-1
  const fromHex = (hex: string) => {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    return { r, g, b };
  };

  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        {icon}
        <span
          className="text-[10px]"
          style={{ color: theme.colors.text.secondary }}
        >
          {label}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={toHex(value)}
          onChange={(e) => onChange(fromHex(e.target.value))}
          className="w-6 h-6 rounded cursor-pointer border-0"
          style={{
            background: "transparent",
          }}
        />
        <span
          className="text-[9px] font-mono"
          style={{ color: theme.colors.text.muted }}
        >
          {toHex(value).toUpperCase()}
        </span>
      </div>
    </div>
  );
}

export function GrassDebugPanel({ world }: GrassDebugPanelProps) {
  const theme = useThemeStore((s) => s.theme);
  const [isVisible, setIsVisible] = useState(false);
  const [keyHeldStart, setKeyHeldStart] = useState<number | null>(null);

  // Grass settings state - initialized from grass system when panel opens
  const [grassEnabled, setGrassEnabled] = useState(true);
  // Wind
  const [windStrength, setWindStrength] = useState(0.4);
  const [windSpeed, setWindSpeed] = useState(0.25);
  const [windScale, setWindScale] = useState(1.75);
  // LOD0 fade (distance where blades fade out)
  const [fadeStart, setFadeStart] = useState(35);
  const [fadeEnd, setFadeEnd] = useState(50);
  // Culling (density falloff over distance)
  const [cullingR0, setCullingR0] = useState(25);
  const [cullingR1, setCullingR1] = useState(50);
  const [cullingPMin, setCullingPMin] = useState(0.15);
  // Trail (player distortion)
  const [trailRadius, setTrailRadius] = useState(0.6);
  // Day/night colors
  const [dayColor, setDayColorState] = useState({ r: 1, g: 1, b: 1 });
  const [nightColor, setNightColorState] = useState({
    r: 0.25,
    g: 0.3,
    b: 0.35,
  });
  const [dayNightMix, setDayNightMix] = useState(1.0);
  // LOD1 fade (dithered card distance) - Classic mode
  const [lod1FadeInStart, setLod1FadeInStart] = useState(18);
  const [lod1FadeInEnd, setLod1FadeInEnd] = useState(28);
  const [lod1FadeOutStart, setLod1FadeOutStart] = useState(50);
  const [lod1FadeOutEnd, setLod1FadeOutEnd] = useState(65);

  // Get grass system reference
  const grassSystem = useMemo(
    () => world.getSystem?.("grass") as GrassSystemAPI,
    [world],
  );

  // Handler for refreshing terrain color projection
  const handleRefreshColors = useCallback(
    () => grassSystem?.renderTerrainProjection?.(),
    [grassSystem],
  );

  // Initialize state from grass system when panel opens
  useEffect(() => {
    if (!isVisible || !grassSystem) return;
    // Sync all values from system to local state
    const g = grassSystem;
    g.getWindStrength && setWindStrength(g.getWindStrength());
    g.getWindSpeed && setWindSpeed(g.getWindSpeed());
    g.getWindScale && setWindScale(g.getWindScale());
    g.getFadeStart && setFadeStart(g.getFadeStart());
    g.getFadeEnd && setFadeEnd(g.getFadeEnd());
    g.getCullingR0 && setCullingR0(g.getCullingR0());
    g.getCullingR1 && setCullingR1(g.getCullingR1());
    g.getCullingPMin && setCullingPMin(g.getCullingPMin());
    g.getTrailRadius && setTrailRadius(g.getTrailRadius());
    g.isVisible && setGrassEnabled(g.isVisible());
    g.getDayColor && setDayColorState(g.getDayColor());
    g.getNightColor && setNightColorState(g.getNightColor());
    g.getDayNightMix && setDayNightMix(g.getDayNightMix());
    g.getLOD1FadeInStart && setLod1FadeInStart(g.getLOD1FadeInStart());
    g.getLOD1FadeInEnd && setLod1FadeInEnd(g.getLOD1FadeInEnd());
    g.getLOD1FadeOutStart && setLod1FadeOutStart(g.getLOD1FadeOutStart());
    g.getLOD1FadeOutEnd && setLod1FadeOutEnd(g.getLOD1FadeOutEnd());
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
    grassSystem?.setVisible?.(grassEnabled);
  }, [grassEnabled, grassSystem]);

  // Consolidated change handlers (setState + call system API)
  const handleWindStrengthChange = useCallback(
    (v: number) => {
      setWindStrength(v);
      grassSystem?.setWindStrength?.(v);
    },
    [grassSystem],
  );
  const handleWindSpeedChange = useCallback(
    (v: number) => {
      setWindSpeed(v);
      grassSystem?.setWindSpeed?.(v);
    },
    [grassSystem],
  );
  const handleWindScaleChange = useCallback(
    (v: number) => {
      setWindScale(v);
      grassSystem?.setWindScale?.(v);
    },
    [grassSystem],
  );
  const handleFadeStartChange = useCallback(
    (v: number) => {
      setFadeStart(v);
      grassSystem?.setFadeStart?.(v);
    },
    [grassSystem],
  );
  const handleFadeEndChange = useCallback(
    (v: number) => {
      setFadeEnd(v);
      grassSystem?.setFadeEnd?.(v);
    },
    [grassSystem],
  );
  const handleCullingR0Change = useCallback(
    (v: number) => {
      setCullingR0(v);
      grassSystem?.setCullingR0?.(v);
    },
    [grassSystem],
  );
  const handleCullingR1Change = useCallback(
    (v: number) => {
      setCullingR1(v);
      grassSystem?.setCullingR1?.(v);
    },
    [grassSystem],
  );
  const handleCullingPMinChange = useCallback(
    (v: number) => {
      setCullingPMin(v);
      grassSystem?.setCullingPMin?.(v);
    },
    [grassSystem],
  );
  const handleTrailRadiusChange = useCallback(
    (v: number) => {
      setTrailRadius(v);
      grassSystem?.setTrailRadius?.(v);
    },
    [grassSystem],
  );
  const handleDayNightMixChange = useCallback(
    (v: number) => {
      setDayNightMix(v);
      grassSystem?.setDayNightMix?.(v);
    },
    [grassSystem],
  );
  const handleLod1FadeInStartChange = useCallback(
    (v: number) => {
      setLod1FadeInStart(v);
      grassSystem?.setLOD1FadeInStart?.(v);
    },
    [grassSystem],
  );
  const handleLod1FadeInEndChange = useCallback(
    (v: number) => {
      setLod1FadeInEnd(v);
      grassSystem?.setLOD1FadeInEnd?.(v);
    },
    [grassSystem],
  );
  const handleLod1FadeOutStartChange = useCallback(
    (v: number) => {
      setLod1FadeOutStart(v);
      grassSystem?.setLOD1FadeOutStart?.(v);
    },
    [grassSystem],
  );
  const handleLod1FadeOutEndChange = useCallback(
    (v: number) => {
      setLod1FadeOutEnd(v);
      grassSystem?.setLOD1FadeOutEnd?.(v);
    },
    [grassSystem],
  );

  // Color handlers need special treatment (3 args)
  const handleDayColorChange = useCallback(
    (c: { r: number; g: number; b: number }) => {
      setDayColorState(c);
      grassSystem?.setDayColor?.(c.r, c.g, c.b);
    },
    [grassSystem],
  );
  const handleNightColorChange = useCallback(
    (c: { r: number; g: number; b: number }) => {
      setNightColorState(c);
      grassSystem?.setNightColor?.(c.r, c.g, c.b);
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

        {/* Day/Night Colors */}
        <div className="space-y-2">
          <div
            className="text-[9px] font-semibold uppercase tracking-wider flex items-center gap-1"
            style={{ color: theme.colors.text.muted }}
          >
            <Sun size={10} />
            Day/Night
          </div>
          <ColorRow
            label="Day Color"
            value={dayColor}
            onChange={handleDayColorChange}
            icon={
              <Sun size={10} style={{ color: theme.colors.state.warning }} />
            }
          />
          <ColorRow
            label="Night Color"
            value={nightColor}
            onChange={handleNightColorChange}
            icon={<Moon size={10} style={{ color: theme.colors.state.info }} />}
          />
          <SliderRow
            label="Day/Night Mix"
            value={dayNightMix}
            min={0}
            max={1}
            step={0.05}
            onChange={handleDayNightMixChange}
          />
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
            max={1}
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
          <SliderRow
            label="Scale"
            value={windScale}
            min={0.5}
            max={5}
            step={0.25}
            onChange={handleWindScaleChange}
          />
        </div>

        {/* Trail (Player Distortion) */}
        <div className="space-y-2">
          <div
            className="text-[9px] font-semibold uppercase tracking-wider flex items-center gap-1"
            style={{ color: theme.colors.text.muted }}
          >
            Trail
          </div>
          <SliderRow
            label="Radius"
            value={trailRadius}
            min={0}
            max={3}
            step={0.1}
            onChange={handleTrailRadiusChange}
            suffix="m"
          />
        </div>

        {/* LOD0 Fade (Blade Distance) */}
        <div className="space-y-2">
          <div
            className="text-[9px] font-semibold uppercase tracking-wider flex items-center gap-1"
            style={{ color: theme.colors.text.muted }}
          >
            LOD0 Fade (Blades)
          </div>
          <SliderRow
            label="Start"
            value={fadeStart}
            min={5}
            max={60}
            step={1}
            onChange={handleFadeStartChange}
            suffix="m"
          />
          <SliderRow
            label="End"
            value={fadeEnd}
            min={10}
            max={80}
            step={1}
            onChange={handleFadeEndChange}
            suffix="m"
          />
        </div>

        {/* LOD1 Fade (Simple Triangles) */}
        <div className="space-y-2">
          <div
            className="text-[9px] font-semibold uppercase tracking-wider flex items-center gap-1"
            style={{ color: theme.colors.text.muted }}
          >
            <Leaf size={10} />
            LOD1 Fade
          </div>
          <SliderRow
            label="Fade In Start"
            value={lod1FadeInStart}
            min={5}
            max={50}
            step={1}
            onChange={handleLod1FadeInStartChange}
            suffix="m"
          />
          <SliderRow
            label="Fade In End"
            value={lod1FadeInEnd}
            min={10}
            max={60}
            step={1}
            onChange={handleLod1FadeInEndChange}
            suffix="m"
          />
          <SliderRow
            label="Fade Out Start"
            value={lod1FadeOutStart}
            min={30}
            max={100}
            step={1}
            onChange={handleLod1FadeOutStartChange}
            suffix="m"
          />
          <SliderRow
            label="Fade Out End"
            value={lod1FadeOutEnd}
            min={40}
            max={120}
            step={1}
            onChange={handleLod1FadeOutEndChange}
            suffix="m"
          />
        </div>

        {/* Culling (Density Falloff) */}
        <div className="space-y-2">
          <div
            className="text-[9px] font-semibold uppercase tracking-wider flex items-center gap-1"
            style={{ color: theme.colors.text.muted }}
          >
            Culling
          </div>
          <SliderRow
            label="Full Density"
            value={cullingR0}
            min={5}
            max={50}
            step={1}
            onChange={handleCullingR0Change}
            suffix="m"
          />
          <SliderRow
            label="Min Density At"
            value={cullingR1}
            min={20}
            max={100}
            step={1}
            onChange={handleCullingR1Change}
            suffix="m"
          />
          <SliderRow
            label="Min Density %"
            value={cullingPMin}
            min={0}
            max={1}
            step={0.05}
            onChange={handleCullingPMinChange}
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
