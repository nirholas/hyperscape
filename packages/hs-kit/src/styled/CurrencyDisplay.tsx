/**
 * Currency Display Component
 *
 * Main currency display with animated values, change indicators,
 * and optional tooltip breakdown.
 *
 * @packageDocumentation
 */

import React, { memo, useState, useCallback, type CSSProperties } from "react";
import { useTheme } from "../stores/themeStore";
import {
  type CurrencyType,
  DEFAULT_CURRENCIES,
  formatCurrency,
  formatChange,
} from "../core/currency/currencyUtils";
import {
  useCurrency,
  type UseCurrencyOptions,
} from "../core/currency/useCurrency";
import { CurrencyIcon } from "./CurrencyIcon";
import { CurrencyTooltip } from "./CurrencyTooltip";
import { animationDurations, animationEasings } from "./animations";

/** Display mode */
export type CurrencyDisplayMode = "compact" | "expanded" | "minimal";

/** Currency display props */
export interface CurrencyDisplayProps {
  /** Currency type */
  type: CurrencyType;
  /** Display mode */
  mode?: CurrencyDisplayMode;
  /** Show currency icon */
  showIcon?: boolean;
  /** Show change indicator */
  showChange?: boolean;
  /** Show tooltip on hover */
  showTooltip?: boolean;
  /** Animate value changes */
  animated?: boolean;
  /** Icon size */
  iconSize?: number;
  /** Font size */
  fontSize?: "xs" | "sm" | "base" | "lg" | "xl";
  /** Currency options */
  currencyOptions?: UseCurrencyOptions;
  /** Click handler */
  onClick?: () => void;
  /** Custom class name */
  className?: string;
  /** Custom style */
  style?: CSSProperties;
}

/**
 * Currency Display Component
 *
 * @example
 * ```tsx
 * // Basic usage
 * <CurrencyDisplay type="gold" />
 *
 * // Compact mode with change indicator
 * <CurrencyDisplay type="gold" mode="compact" showChange />
 *
 * // Expanded mode with tooltip
 * <CurrencyDisplay type="gems" mode="expanded" showTooltip />
 *
 * // Minimal (icon only)
 * <CurrencyDisplay type="tokens" mode="minimal" />
 * ```
 */
export const CurrencyDisplay = memo(function CurrencyDisplay({
  type,
  mode = "compact",
  showIcon = true,
  showChange = true,
  showTooltip = true,
  animated = true,
  iconSize = 20,
  fontSize = "base",
  currencyOptions,
  onClick,
  className,
  style,
}: CurrencyDisplayProps): React.ReactElement {
  const theme = useTheme();
  const [tooltipVisible, setTooltipVisible] = useState(false);
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });

  const {
    balance,
    formatted,
    animatedValue,
    isAnimating,
    lastChange,
    showingChange,
    changeIndicator,
    changeColor,
  } = useCurrency(type, { animated, ...currencyOptions });

  const currency = DEFAULT_CURRENCIES[type];

  const handleMouseEnter = useCallback(
    (e: React.MouseEvent) => {
      if (showTooltip) {
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        setTooltipPosition({
          x: rect.left,
          y: rect.bottom + 8,
        });
        setTooltipVisible(true);
      }
    },
    [showTooltip],
  );

  const handleMouseLeave = useCallback(() => {
    setTooltipVisible(false);
  }, []);

  // Container styles
  const containerStyle: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: theme.spacing.xs,
    padding:
      mode === "minimal" ? 0 : `${theme.spacing.xs}px ${theme.spacing.sm}px`,
    backgroundColor:
      mode === "expanded" ? theme.colors.background.secondary : "transparent",
    borderRadius: theme.borderRadius.md,
    border:
      mode === "expanded" ? `1px solid ${theme.colors.border.default}` : "none",
    cursor: onClick ? "pointer" : showTooltip ? "help" : "default",
    transition: theme.transitions.fast,
    position: "relative",
    ...style,
  };

  // Value styles
  const valueStyle: CSSProperties = {
    fontSize: theme.typography.fontSize[fontSize],
    fontWeight: theme.typography.fontWeight.semibold,
    color: currency.color,
    fontVariantNumeric: "tabular-nums",
    transition: isAnimating
      ? `color ${animationDurations.fast}ms ${animationEasings.easeOut}`
      : undefined,
  };

  // Change indicator styles
  const changeStyle: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    fontSize: theme.typography.fontSize.sm,
    fontWeight: theme.typography.fontWeight.medium,
    color: changeColor,
    marginLeft: theme.spacing.xs,
    opacity: showingChange ? 1 : 0,
    transform: showingChange ? "translateY(0)" : "translateY(-4px)",
    transition: `all ${animationDurations.normal}ms ${animationEasings.easeOut}`,
  };

  // Determine displayed value
  const displayValue =
    mode === "minimal"
      ? ""
      : mode === "compact"
        ? formatCurrency(animated ? animatedValue : balance.amount, type, {
            compact: true,
          }).full
        : formatCurrency(animated ? animatedValue : balance.amount, type, {
            compact: false,
          }).full;

  // Format change for display
  const changeDisplay =
    showingChange && lastChange !== 0
      ? formatChange(lastChange, type, true)
      : null;

  return (
    <>
      <div
        className={className}
        style={containerStyle}
        onClick={onClick}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        role={onClick ? "button" : undefined}
        title={!showTooltip ? `${currency.name}: ${formatted}` : undefined}
      >
        {showIcon && (
          <CurrencyIcon
            type={type}
            size={iconSize}
            glow={isAnimating && changeIndicator === "gain"}
          />
        )}

        {mode !== "minimal" && <span style={valueStyle}>{displayValue}</span>}

        {showChange && changeDisplay && (
          <span style={changeStyle}>{changeDisplay.formatted}</span>
        )}
      </div>

      {/* Tooltip */}
      {showTooltip && tooltipVisible && (
        <div
          style={{
            position: "fixed",
            left: tooltipPosition.x,
            top: tooltipPosition.y,
            zIndex: theme.zIndex.tooltip,
          }}
        >
          <CurrencyTooltip
            type={type}
            amount={balance.amount}
            showBreakdown
            showConversions
          />
        </div>
      )}
    </>
  );
});

/** Multi-currency display props */
export interface CurrencyGroupProps {
  /** Currency types to display */
  types?: CurrencyType[];
  /** Display mode for each currency */
  mode?: CurrencyDisplayMode;
  /** Orientation */
  orientation?: "horizontal" | "vertical";
  /** Show dividers between currencies */
  showDividers?: boolean;
  /** Gap between currencies */
  gap?: number;
  /** Custom class name */
  className?: string;
  /** Custom style */
  style?: CSSProperties;
}

/**
 * Currency Group Component
 *
 * Displays multiple currencies in a group.
 *
 * @example
 * ```tsx
 * <CurrencyGroup
 *   types={['gold', 'gems', 'tokens']}
 *   mode="compact"
 *   orientation="horizontal"
 * />
 * ```
 */
export const CurrencyGroup = memo(function CurrencyGroup({
  types = ["gold", "gems"],
  mode = "compact",
  orientation = "horizontal",
  showDividers = true,
  gap,
  className,
  style,
}: CurrencyGroupProps): React.ReactElement {
  const theme = useTheme();

  const containerStyle: CSSProperties = {
    display: "flex",
    flexDirection: orientation === "horizontal" ? "row" : "column",
    alignItems: "center",
    gap: gap ?? theme.spacing.md,
    ...style,
  };

  const dividerStyle: CSSProperties = {
    width: orientation === "horizontal" ? 1 : "100%",
    height: orientation === "horizontal" ? 20 : 1,
    backgroundColor: theme.colors.border.default,
  };

  return (
    <div className={className} style={containerStyle}>
      {types.map((type, index) => (
        <React.Fragment key={type}>
          <CurrencyDisplay type={type} mode={mode} />
          {showDividers && index < types.length - 1 && (
            <div style={dividerStyle} />
          )}
        </React.Fragment>
      ))}
    </div>
  );
});

export default CurrencyDisplay;
