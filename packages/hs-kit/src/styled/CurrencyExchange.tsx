/**
 * Currency Exchange Component
 *
 * Allows exchanging between different currency types
 * with real-time conversion preview.
 *
 * @packageDocumentation
 */

import React, {
  memo,
  useState,
  useCallback,
  useMemo,
  type CSSProperties,
} from "react";
import { useTheme } from "../stores/themeStore";
import {
  type CurrencyType,
  DEFAULT_CURRENCIES,
  formatCurrency,
  convertCurrency,
} from "../core/currency/currencyUtils";
import { useCurrency, useCurrencies } from "../core/currency/useCurrency";
import { CurrencyIcon } from "./CurrencyIcon";
import { CurrencyInput, DEFAULT_QUICK_AMOUNTS } from "./CurrencyInput";

/** Exchange rate info */
export interface ExchangeRate {
  from: CurrencyType;
  to: CurrencyType;
  rate: number;
  fee?: number; // Percentage fee (0-100)
}

/** Currency exchange props */
export interface CurrencyExchangeProps {
  /** Available currencies for exchange */
  currencies?: CurrencyType[];
  /** Initial from currency */
  initialFrom?: CurrencyType;
  /** Initial to currency */
  initialTo?: CurrencyType;
  /** Exchange fee percentage (0-100) */
  fee?: number;
  /** Minimum exchange amount */
  minAmount?: number;
  /** Maximum exchange amount */
  maxAmount?: number;
  /** Exchange handler */
  onExchange?: (
    from: CurrencyType,
    to: CurrencyType,
    amount: number,
    receivedAmount: number,
  ) => void;
  /** Disable exchange */
  disabled?: boolean;
  /** Show fee breakdown */
  showFee?: boolean;
  /** Show exchange rate */
  showRate?: boolean;
  /** Custom class name */
  className?: string;
  /** Custom style */
  style?: CSSProperties;
}

/**
 * Currency Exchange Component
 *
 * @example
 * ```tsx
 * <CurrencyExchange
 *   currencies={['gold', 'gems', 'tokens']}
 *   fee={5}
 *   onExchange={(from, to, amount, received) => {
 *     console.log(`Exchanged ${amount} ${from} for ${received} ${to}`);
 *   }}
 * />
 * ```
 */
export const CurrencyExchange = memo(function CurrencyExchange({
  currencies = ["gold", "gems", "tokens"],
  initialFrom = "gold",
  initialTo = "gems",
  fee = 0,
  minAmount = 1,
  maxAmount,
  onExchange,
  disabled = false,
  showFee = true,
  showRate = true,
  className,
  style,
}: CurrencyExchangeProps): React.ReactElement {
  const theme = useTheme();
  // Transfer function available but we use individual currency hooks for fine-grained control
  useCurrencies();

  const [fromType, setFromType] = useState<CurrencyType>(initialFrom);
  const [toType, setToType] = useState<CurrencyType>(
    initialTo !== initialFrom
      ? initialTo
      : currencies.find((c) => c !== initialFrom) || "gems",
  );
  const [amount, setAmount] = useState(0);
  const [isExchanging, setIsExchanging] = useState(false);
  const [lastResult, setLastResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  const fromCurrency = useCurrency(fromType);
  const toCurrency = useCurrency(toType);

  // Calculate conversion
  const conversion = useMemo(() => {
    if (amount <= 0) {
      return { gross: 0, feeAmount: 0, net: 0 };
    }

    const gross = convertCurrency(amount, fromType, toType);
    const feeAmount = fee > 0 ? Math.floor(gross * (fee / 100)) : 0;
    const net = gross - feeAmount;

    return { gross, feeAmount, net };
  }, [amount, fromType, toType, fee]);

  // Get exchange rate
  const exchangeRate = useMemo(() => {
    const fromDef = DEFAULT_CURRENCIES[fromType];
    const toDef = DEFAULT_CURRENCIES[toType];
    return fromDef.conversionRate / toDef.conversionRate;
  }, [fromType, toType]);

  // Can exchange
  const canExchange = useMemo(() => {
    if (disabled || amount <= 0) return false;
    if (amount < minAmount) return false;
    if (maxAmount && amount > maxAmount) return false;
    if (amount > fromCurrency.balance.amount) return false;
    if (conversion.net <= 0) return false;
    return true;
  }, [
    disabled,
    amount,
    minAmount,
    maxAmount,
    fromCurrency.balance.amount,
    conversion.net,
  ]);

  // Swap currencies
  const handleSwap = useCallback(() => {
    setFromType(toType);
    setToType(fromType);
    setAmount(0);
    setLastResult(null);
  }, [fromType, toType]);

  // Select currency
  const handleSelectFrom = useCallback(
    (type: CurrencyType) => {
      if (type === toType) {
        setToType(fromType);
      }
      setFromType(type);
      setAmount(0);
      setLastResult(null);
    },
    [toType, fromType],
  );

  const handleSelectTo = useCallback(
    (type: CurrencyType) => {
      if (type === fromType) {
        setFromType(toType);
      }
      setToType(type);
      setLastResult(null);
    },
    [fromType, toType],
  );

  // Execute exchange
  const handleExchange = useCallback(async () => {
    if (!canExchange) return;

    setIsExchanging(true);
    setLastResult(null);

    try {
      // Deduct from source
      const deducted = fromCurrency.subtract(amount, `Exchange to ${toType}`);

      if (!deducted) {
        setLastResult({ success: false, message: "Insufficient funds" });
        setIsExchanging(false);
        return;
      }

      // Add to destination (after fee)
      toCurrency.add(conversion.net, `Exchange from ${fromType}`);

      onExchange?.(fromType, toType, amount, conversion.net);

      setLastResult({
        success: true,
        message: `Exchanged ${formatCurrency(amount, fromType).full} for ${formatCurrency(conversion.net, toType).full}`,
      });
      setAmount(0);
    } catch {
      setLastResult({ success: false, message: "Exchange failed" });
    }

    setIsExchanging(false);
  }, [
    canExchange,
    amount,
    fromType,
    toType,
    conversion.net,
    fromCurrency,
    toCurrency,
    onExchange,
  ]);

  // Styles
  const containerStyle: CSSProperties = {
    padding: theme.spacing.md,
    backgroundColor: theme.colors.background.secondary,
    border: `1px solid ${theme.colors.border.default}`,
    borderRadius: theme.borderRadius.lg,
    ...style,
  };

  const headerStyle: CSSProperties = {
    fontSize: theme.typography.fontSize.lg,
    fontWeight: theme.typography.fontWeight.semibold,
    color: theme.colors.text.primary,
    marginBottom: theme.spacing.md,
  };

  const sectionStyle: CSSProperties = {
    marginBottom: theme.spacing.md,
  };

  const labelStyle: CSSProperties = {
    fontSize: theme.typography.fontSize.xs,
    fontWeight: theme.typography.fontWeight.medium,
    color: theme.colors.text.muted,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    marginBottom: theme.spacing.xs,
  };

  const currencySelectStyle: CSSProperties = {
    display: "flex",
    gap: theme.spacing.xs,
    flexWrap: "wrap",
    marginBottom: theme.spacing.sm,
  };

  const currencyButtonStyle = (
    type: CurrencyType,
    isSelected: boolean,
  ): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: theme.spacing.xs,
    padding: `${theme.spacing.xs}px ${theme.spacing.sm}px`,
    backgroundColor: isSelected
      ? theme.colors.background.tertiary
      : "transparent",
    border: `1px solid ${isSelected ? theme.colors.border.active : theme.colors.border.default}`,
    borderRadius: theme.borderRadius.md,
    cursor: disabled ? "not-allowed" : "pointer",
    transition: theme.transitions.fast,
    opacity: disabled ? 0.5 : 1,
  });

  const swapButtonStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 40,
    height: 40,
    margin: `${theme.spacing.sm}px auto`,
    backgroundColor: theme.colors.background.tertiary,
    border: `1px solid ${theme.colors.border.default}`,
    borderRadius: theme.borderRadius.full,
    cursor: disabled ? "not-allowed" : "pointer",
    transition: theme.transitions.fast,
    color: theme.colors.text.secondary,
    opacity: disabled ? 0.5 : 1,
  };

  const previewStyle: CSSProperties = {
    padding: theme.spacing.sm,
    backgroundColor: theme.colors.background.primary,
    borderRadius: theme.borderRadius.md,
    marginBottom: theme.spacing.md,
  };

  const previewRowStyle: CSSProperties = {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: `${theme.spacing.xs}px 0`,
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.text.secondary,
  };

  const exchangeButtonStyle: CSSProperties = {
    width: "100%",
    padding: `${theme.spacing.sm}px ${theme.spacing.md}px`,
    fontSize: theme.typography.fontSize.base,
    fontWeight: theme.typography.fontWeight.semibold,
    color: canExchange ? theme.colors.text.primary : theme.colors.text.disabled,
    backgroundColor: canExchange
      ? theme.colors.accent.primary
      : theme.colors.background.tertiary,
    border: "none",
    borderRadius: theme.borderRadius.md,
    cursor: canExchange && !isExchanging ? "pointer" : "not-allowed",
    transition: theme.transitions.fast,
    opacity: isExchanging ? 0.7 : 1,
  };

  const resultStyle: CSSProperties = {
    padding: theme.spacing.sm,
    marginTop: theme.spacing.sm,
    borderRadius: theme.borderRadius.md,
    fontSize: theme.typography.fontSize.sm,
    backgroundColor: lastResult?.success
      ? `${theme.colors.state.success}20`
      : `${theme.colors.state.danger}20`,
    color: lastResult?.success
      ? theme.colors.state.success
      : theme.colors.state.danger,
    border: `1px solid ${lastResult?.success ? theme.colors.state.success : theme.colors.state.danger}`,
  };

  return (
    <div className={className} style={containerStyle}>
      <div style={headerStyle}>Currency Exchange</div>

      {/* From Currency */}
      <div style={sectionStyle}>
        <div style={labelStyle}>From</div>
        <div style={currencySelectStyle}>
          {currencies.map((type) => (
            <button
              key={type}
              type="button"
              style={currencyButtonStyle(type, type === fromType)}
              onClick={() => handleSelectFrom(type)}
              disabled={disabled}
            >
              <CurrencyIcon type={type} size={16} />
              <span style={{ color: theme.colors.text.primary }}>
                {DEFAULT_CURRENCIES[type].name}
              </span>
            </button>
          ))}
        </div>

        <CurrencyInput
          type={fromType}
          value={amount}
          onChange={setAmount}
          checkBalance
          showQuickAmounts
          quickAmounts={DEFAULT_QUICK_AMOUNTS}
          disabled={disabled}
          min={minAmount}
          max={maxAmount ?? fromCurrency.balance.amount}
        />
      </div>

      {/* Swap button */}
      <button
        type="button"
        style={swapButtonStyle}
        onClick={handleSwap}
        disabled={disabled}
        title="Swap currencies"
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M7 16V4m0 0L3 8m4-4l4 4" />
          <path d="M17 8v12m0 0l4-4m-4 4l-4-4" />
        </svg>
      </button>

      {/* To Currency */}
      <div style={sectionStyle}>
        <div style={labelStyle}>To</div>
        <div style={currencySelectStyle}>
          {currencies.map((type) => (
            <button
              key={type}
              type="button"
              style={currencyButtonStyle(type, type === toType)}
              onClick={() => handleSelectTo(type)}
              disabled={disabled}
            >
              <CurrencyIcon type={type} size={16} />
              <span style={{ color: theme.colors.text.primary }}>
                {DEFAULT_CURRENCIES[type].name}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Preview */}
      {amount > 0 && (
        <div style={previewStyle}>
          {showRate && (
            <div style={previewRowStyle}>
              <span>Exchange Rate</span>
              <span style={{ color: theme.colors.text.primary }}>
                1 {DEFAULT_CURRENCIES[fromType].shortName} ={" "}
                {exchangeRate.toFixed(4)} {DEFAULT_CURRENCIES[toType].shortName}
              </span>
            </div>
          )}

          <div style={previewRowStyle}>
            <span>You Pay</span>
            <span style={{ color: DEFAULT_CURRENCIES[fromType].color }}>
              {formatCurrency(amount, fromType).full}
            </span>
          </div>

          {showFee && fee > 0 && (
            <div style={previewRowStyle}>
              <span>Fee ({fee}%)</span>
              <span style={{ color: theme.colors.state.danger }}>
                -{formatCurrency(conversion.feeAmount, toType).full}
              </span>
            </div>
          )}

          <div
            style={{
              ...previewRowStyle,
              borderTop: `1px solid ${theme.colors.border.default}`,
              paddingTop: theme.spacing.sm,
              fontWeight: theme.typography.fontWeight.semibold,
            }}
          >
            <span>You Receive</span>
            <span style={{ color: DEFAULT_CURRENCIES[toType].color }}>
              {formatCurrency(conversion.net, toType).full}
            </span>
          </div>
        </div>
      )}

      {/* Exchange button */}
      <button
        type="button"
        style={exchangeButtonStyle}
        onClick={handleExchange}
        disabled={!canExchange || isExchanging}
      >
        {isExchanging ? "Exchanging..." : "Exchange"}
      </button>

      {/* Result message */}
      {lastResult && <div style={resultStyle}>{lastResult.message}</div>}
    </div>
  );
});

export default CurrencyExchange;
