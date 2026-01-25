/**
 * Currency Icon Component
 *
 * Displays a currency icon with optional amount badge.
 *
 * @packageDocumentation
 */

import React, { memo, type CSSProperties } from "react";
import { useTheme } from "../stores/themeStore";
import {
  type CurrencyType,
  type CurrencyDefinition,
  DEFAULT_CURRENCIES,
} from "../core/currency/currencyUtils";
import { Gem } from "../icons";

/** Currency icon props */
export interface CurrencyIconProps {
  /** Currency type */
  type: CurrencyType;
  /** Size in pixels */
  size?: number;
  /** Show glow effect */
  glow?: boolean;
  /** Custom currency definition */
  currency?: CurrencyDefinition;
  /** Custom class name */
  className?: string;
  /** Custom style */
  style?: CSSProperties;
}

/**
 * Currency Icon Component
 *
 * @example
 * ```tsx
 * <CurrencyIcon type="gold" size={24} />
 * <CurrencyIcon type="gems" size={32} glow />
 * ```
 */
export const CurrencyIcon = memo(function CurrencyIcon({
  type,
  size = 20,
  glow = false,
  currency: customCurrency,
  className,
  style,
}: CurrencyIconProps): React.ReactElement {
  const theme = useTheme();
  const currency = customCurrency || DEFAULT_CURRENCIES[type];

  const containerStyle: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: size,
    height: size,
    borderRadius: theme.borderRadius.full,
    backgroundColor: currency.backgroundColor,
    color: currency.color,
    fontSize: size * 0.6,
    fontWeight: theme.typography.fontWeight.bold,
    boxShadow: glow
      ? `0 0 ${size / 2}px ${currency.color}40`
      : theme.shadows.sm,
    transition: theme.transitions.fast,
    ...style,
  };

  // Render icon based on currency type
  const renderIcon = () => {
    switch (type) {
      case "gold":
        return (
          <svg
            width={size * 0.7}
            height={size * 0.7}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="10" />
            <path d="M12 6v12" />
            <path d="M15 9H9.5a2.5 2.5 0 0 0 0 5H15a2.5 2.5 0 0 1 0 5H9" />
          </svg>
        );
      case "silver":
        return (
          <svg
            width={size * 0.7}
            height={size * 0.7}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="10" />
            <path d="M9 12h6" />
          </svg>
        );
      case "copper":
        return (
          <svg
            width={size * 0.7}
            height={size * 0.7}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="10" />
            <circle cx="12" cy="12" r="4" />
          </svg>
        );
      case "gems":
        return <Gem size={size * 0.7} />;
      case "tokens":
        return (
          <svg
            width={size * 0.7}
            height={size * 0.7}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
            <path d="M16 3v4" />
            <path d="M8 3v4" />
          </svg>
        );
      default:
        return null;
    }
  };

  return (
    <span className={className} style={containerStyle} title={currency.name}>
      {renderIcon()}
    </span>
  );
});

export default CurrencyIcon;
