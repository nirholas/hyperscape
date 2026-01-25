/**
 * Currency Tooltip Component
 *
 * Shows detailed currency breakdown and conversion info.
 *
 * @packageDocumentation
 */

import React, { memo, type CSSProperties } from "react";
import { useTheme } from "../stores/themeStore";
import {
  type CurrencyType,
  DEFAULT_CURRENCIES,
  formatCurrency,
  calculateBreakdown,
  formatBreakdown,
  convertCurrency,
} from "../core/currency/currencyUtils";
import { CurrencyIcon } from "./CurrencyIcon";

/** Currency tooltip props */
export interface CurrencyTooltipProps {
  /** Currency type */
  type: CurrencyType;
  /** Amount to display */
  amount: number;
  /** Show breakdown (gold/silver/copper) */
  showBreakdown?: boolean;
  /** Show conversion to other currencies */
  showConversions?: boolean;
  /** Currencies to show conversions for */
  conversionTypes?: CurrencyType[];
  /** Position */
  position?: "top" | "bottom" | "left" | "right";
  /** Custom class name */
  className?: string;
  /** Custom style */
  style?: CSSProperties;
}

/**
 * Currency Tooltip Component
 *
 * @example
 * ```tsx
 * <CurrencyTooltip
 *   type="gold"
 *   amount={123456}
 *   showBreakdown
 *   showConversions
 * />
 * ```
 */
export const CurrencyTooltip = memo(function CurrencyTooltip({
  type,
  amount,
  showBreakdown = true,
  showConversions = true,
  conversionTypes = ["gems", "tokens"],
  className,
  style,
}: CurrencyTooltipProps): React.ReactElement {
  const theme = useTheme();
  const currency = DEFAULT_CURRENCIES[type];

  const containerStyle: CSSProperties = {
    padding: theme.spacing.sm,
    backgroundColor: theme.colors.background.glass,
    backdropFilter: `blur(${theme.glass.blur}px)`,
    border: `1px solid ${theme.colors.border.default}`,
    borderRadius: theme.borderRadius.md,
    boxShadow: theme.shadows.lg,
    minWidth: 180,
    ...style,
  };

  const headerStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.sm,
    paddingBottom: theme.spacing.xs,
    borderBottom: `1px solid ${theme.colors.border.default}`,
  };

  const titleStyle: CSSProperties = {
    fontSize: theme.typography.fontSize.base,
    fontWeight: theme.typography.fontWeight.semibold,
    color: theme.colors.text.primary,
  };

  const amountStyle: CSSProperties = {
    fontSize: theme.typography.fontSize.lg,
    fontWeight: theme.typography.fontWeight.bold,
    color: currency.color,
    marginLeft: "auto",
  };

  const sectionStyle: CSSProperties = {
    marginTop: theme.spacing.xs,
  };

  const sectionTitleStyle: CSSProperties = {
    fontSize: theme.typography.fontSize.xs,
    fontWeight: theme.typography.fontWeight.medium,
    color: theme.colors.text.muted,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    marginBottom: theme.spacing.xs,
  };

  const rowStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing.sm,
    padding: `${theme.spacing.xs}px 0`,
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.text.secondary,
  };

  const valueStyle: CSSProperties = {
    fontWeight: theme.typography.fontWeight.medium,
    color: theme.colors.text.primary,
  };

  // Calculate breakdown for gold/silver/copper
  const breakdown =
    showBreakdown && (type === "gold" || type === "silver" || type === "copper")
      ? calculateBreakdown(
          type === "gold"
            ? amount * 10000
            : type === "silver"
              ? amount * 100
              : amount,
        )
      : null;

  // Calculate conversions
  const conversions = showConversions
    ? conversionTypes
        .filter((t) => t !== type)
        .map((toType) => ({
          type: toType,
          currency: DEFAULT_CURRENCIES[toType],
          amount: convertCurrency(amount, type, toType),
        }))
    : [];

  return (
    <div className={className} style={containerStyle}>
      {/* Header */}
      <div style={headerStyle}>
        <CurrencyIcon type={type} size={24} />
        <span style={titleStyle}>{currency.name}</span>
        <span style={amountStyle}>
          {
            formatCurrency(amount, type, { compact: false, showSuffix: false })
              .value
          }
        </span>
      </div>

      {/* Compact format */}
      <div
        style={{
          ...rowStyle,
          borderBottom: `1px solid ${theme.colors.border.default}`,
        }}
      >
        <span>Compact</span>
        <span style={valueStyle}>
          {formatCurrency(amount, type, { compact: true }).full}
        </span>
      </div>

      {/* Breakdown */}
      {breakdown && (
        <div style={sectionStyle}>
          <div style={sectionTitleStyle}>Breakdown</div>
          <div style={rowStyle}>
            <span>Full Value</span>
            <span style={valueStyle}>{formatBreakdown(breakdown)}</span>
          </div>
          {breakdown.gold > 0 && (
            <div style={rowStyle}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: theme.spacing.xs,
                }}
              >
                <CurrencyIcon type="gold" size={14} />
                <span>Gold</span>
              </div>
              <span style={valueStyle}>{breakdown.gold.toLocaleString()}</span>
            </div>
          )}
          {breakdown.silver > 0 && (
            <div style={rowStyle}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: theme.spacing.xs,
                }}
              >
                <CurrencyIcon type="silver" size={14} />
                <span>Silver</span>
              </div>
              <span style={valueStyle}>
                {breakdown.silver.toLocaleString()}
              </span>
            </div>
          )}
          {breakdown.copper > 0 && (
            <div style={rowStyle}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: theme.spacing.xs,
                }}
              >
                <CurrencyIcon type="copper" size={14} />
                <span>Copper</span>
              </div>
              <span style={valueStyle}>
                {breakdown.copper.toLocaleString()}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Conversions */}
      {conversions.length > 0 && (
        <div style={sectionStyle}>
          <div style={sectionTitleStyle}>Equivalent Value</div>
          {conversions.map((conv) => (
            <div key={conv.type} style={rowStyle}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: theme.spacing.xs,
                }}
              >
                <CurrencyIcon type={conv.type} size={14} />
                <span>{conv.currency.name}</span>
              </div>
              <span style={{ ...valueStyle, color: conv.currency.color }}>
                {formatCurrency(conv.amount, conv.type, { compact: true }).full}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
});

export default CurrencyTooltip;
