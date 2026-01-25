import React, { useCallback } from "react";
import { useTheme } from "../stores/themeStore";
import type { TransparencySliderProps } from "../types";

/**
 * Slider control for window transparency
 *
 * @example
 * ```tsx
 * function WindowSettings({ windowId }: { windowId: string }) {
 *   const { window, setTransparency } = useWindow(windowId);
 *
 *   return (
 *     <div>
 *       <label>Transparency</label>
 *       <TransparencySlider
 *         value={window.transparency}
 *         onChange={setTransparency}
 *       />
 *     </div>
 *   );
 * }
 * ```
 */
export function TransparencySlider({
  value,
  onChange,
  className,
  style,
}: TransparencySliderProps): React.ReactElement {
  const theme = useTheme();
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onChange(Number(e.target.value));
    },
    [onChange],
  );

  const containerStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: theme.spacing.sm,
    ...style,
  };

  const sliderStyle: React.CSSProperties = {
    flex: 1,
    height: 4,
    appearance: "none",
    backgroundColor: theme.colors.background.tertiary,
    borderRadius: 2,
    cursor: "pointer",
    outline: "none",
  };

  const labelStyle: React.CSSProperties = {
    minWidth: 40,
    textAlign: "right",
    color: theme.colors.text.secondary,
    fontSize: theme.typography.fontSize.sm,
  };

  return (
    <div className={className} style={containerStyle}>
      <span style={{ ...labelStyle, textAlign: "left" }}>Opacity</span>
      <input
        type="range"
        min={0}
        max={100}
        value={value}
        onChange={handleChange}
        style={sliderStyle}
      />
      <span style={labelStyle}>{100 - value}%</span>
    </div>
  );
}
