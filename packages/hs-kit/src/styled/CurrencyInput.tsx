/**
 * Currency Input Component
 *
 * Input field for currency amounts with validation,
 * shortcuts, and formatting.
 *
 * @packageDocumentation
 */

import React, {
  memo,
  useState,
  useCallback,
  useRef,
  useEffect,
  type CSSProperties,
} from "react";
import { useTheme } from "../stores/themeStore";
import {
  type CurrencyType,
  DEFAULT_CURRENCIES,
  formatCurrency,
  parseCurrency,
  validateAmount,
} from "../core/currency/currencyUtils";
import { useCurrency } from "../core/currency/useCurrency";
import { CurrencyIcon } from "./CurrencyIcon";
import { animationDurations } from "./animations";

/** Quick amount preset */
export interface QuickAmountPreset {
  /** Display label */
  label: string;
  /** Amount value (or "all" for full balance, "half" for 50%) */
  value: number | "all" | "half" | "quarter";
}

/** Default quick amounts */
export const DEFAULT_QUICK_AMOUNTS: QuickAmountPreset[] = [
  { label: "All", value: "all" },
  { label: "Half", value: "half" },
  { label: "1K", value: 1000 },
  { label: "10K", value: 10000 },
  { label: "100K", value: 100000 },
  { label: "1M", value: 1000000 },
];

/** Currency input props */
export interface CurrencyInputProps {
  /** Currency type */
  type: CurrencyType;
  /** Controlled value */
  value?: number;
  /** Default value (uncontrolled) */
  defaultValue?: number;
  /** Change handler */
  onChange?: (value: number) => void;
  /** Validation error handler */
  onValidationError?: (error: string) => void;
  /** Minimum value */
  min?: number;
  /** Maximum value */
  max?: number;
  /** Check against current balance */
  checkBalance?: boolean;
  /** Show insufficient funds warning */
  showInsufficientWarning?: boolean;
  /** Show quick amount buttons */
  showQuickAmounts?: boolean;
  /** Quick amount presets */
  quickAmounts?: QuickAmountPreset[];
  /** Show currency icon */
  showIcon?: boolean;
  /** Placeholder text */
  placeholder?: string;
  /** Disabled state */
  disabled?: boolean;
  /** Read-only state */
  readOnly?: boolean;
  /** Auto-focus on mount */
  autoFocus?: boolean;
  /** Allow compact input (k, M, B suffixes) */
  allowCompactInput?: boolean;
  /** Custom class name */
  className?: string;
  /** Custom style */
  style?: CSSProperties;
}

/**
 * Currency Input Component
 *
 * @example
 * ```tsx
 * // Basic usage
 * const [amount, setAmount] = useState(0);
 * <CurrencyInput
 *   type="gold"
 *   value={amount}
 *   onChange={setAmount}
 *   checkBalance
 *   showQuickAmounts
 * />
 *
 * // With validation
 * <CurrencyInput
 *   type="gold"
 *   min={100}
 *   max={1000000}
 *   onValidationError={console.error}
 * />
 * ```
 */
export const CurrencyInput = memo(function CurrencyInput({
  type,
  value: controlledValue,
  defaultValue = 0,
  onChange,
  onValidationError,
  min = 0,
  max,
  checkBalance = false,
  showInsufficientWarning = true,
  showQuickAmounts = false,
  quickAmounts = DEFAULT_QUICK_AMOUNTS,
  showIcon = true,
  placeholder = "Enter amount...",
  disabled = false,
  readOnly = false,
  autoFocus = false,
  allowCompactInput = true,
  className,
  style,
}: CurrencyInputProps): React.ReactElement {
  const theme = useTheme();
  const inputRef = useRef<HTMLInputElement>(null);
  const { balance } = useCurrency(type);

  const isControlled = controlledValue !== undefined;
  const [internalValue, setInternalValue] = useState(defaultValue);
  const [inputText, setInputText] = useState(
    defaultValue > 0 ? defaultValue.toString() : "",
  );
  const [isFocused, setIsFocused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isShaking, setIsShaking] = useState(false);

  const currency = DEFAULT_CURRENCIES[type];
  const actualValue = isControlled ? controlledValue : internalValue;
  const effectiveMax = max ?? currency.maxValue;

  // Check if insufficient funds
  const isInsufficient = checkBalance && actualValue > balance.amount;

  // Validation
  const validate = useCallback(
    (val: number): { valid: boolean; error?: string } => {
      if (val < min) {
        return {
          valid: false,
          error: `Minimum is ${formatCurrency(min, type).full}`,
        };
      }
      if (val > effectiveMax) {
        return {
          valid: false,
          error: `Maximum is ${formatCurrency(effectiveMax, type).full}`,
        };
      }
      if (checkBalance && val > balance.amount) {
        return { valid: false, error: "Insufficient funds" };
      }
      return validateAmount(val, type);
    },
    [min, effectiveMax, checkBalance, balance.amount, type],
  );

  // Update value
  const updateValue = useCallback(
    (newValue: number) => {
      const validation = validate(newValue);

      if (!validation.valid) {
        setError(validation.error || "Invalid amount");
        onValidationError?.(validation.error || "Invalid amount");

        // Trigger shake animation
        setIsShaking(true);
        setTimeout(() => setIsShaking(false), animationDurations.extended);
      } else {
        setError(null);
      }

      if (!isControlled) {
        setInternalValue(newValue);
      }
      onChange?.(newValue);
    },
    [validate, isControlled, onChange, onValidationError],
  );

  // Handle input change
  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const text = e.target.value;
      setInputText(text);

      if (text === "") {
        updateValue(0);
        return;
      }

      // Parse the input
      const parsed = allowCompactInput
        ? parseCurrency(text)
        : parseInt(text, 10);
      if (!isNaN(parsed)) {
        updateValue(parsed);
      }
    },
    [updateValue, allowCompactInput],
  );

  // Handle blur - format the value
  const handleBlur = useCallback(() => {
    setIsFocused(false);
    // Format the displayed value
    if (actualValue > 0) {
      setInputText(actualValue.toString());
    } else {
      setInputText("");
    }
  }, [actualValue]);

  // Handle focus
  const handleFocus = useCallback(() => {
    setIsFocused(true);
    inputRef.current?.select();
  }, []);

  // Handle quick amount click
  const handleQuickAmount = useCallback(
    (preset: QuickAmountPreset) => {
      let value: number;

      if (preset.value === "all") {
        value = checkBalance ? balance.amount : effectiveMax;
      } else if (preset.value === "half") {
        value = Math.floor((checkBalance ? balance.amount : effectiveMax) / 2);
      } else if (preset.value === "quarter") {
        value = Math.floor((checkBalance ? balance.amount : effectiveMax) / 4);
      } else {
        value = preset.value;
      }

      value = Math.min(value, effectiveMax);
      value = Math.max(value, min);

      setInputText(value.toString());
      updateValue(value);
      inputRef.current?.focus();
    },
    [checkBalance, balance.amount, effectiveMax, min, updateValue],
  );

  // Auto-focus
  useEffect(() => {
    if (autoFocus) {
      inputRef.current?.focus();
    }
  }, [autoFocus]);

  // Sync controlled value to display
  useEffect(() => {
    if (isControlled && !isFocused) {
      setInputText(controlledValue > 0 ? controlledValue.toString() : "");
    }
  }, [isControlled, controlledValue, isFocused]);

  // Container styles
  const containerStyle: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: theme.spacing.xs,
    ...style,
  };

  const inputWrapperStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: theme.spacing.xs,
    padding: `${theme.spacing.xs}px ${theme.spacing.sm}px`,
    backgroundColor: theme.colors.background.secondary,
    border: `1px solid ${
      error
        ? theme.colors.state.danger
        : isFocused
          ? theme.colors.border.focus
          : theme.colors.border.default
    }`,
    borderRadius: theme.borderRadius.md,
    transition: theme.transitions.fast,
    animation: isShaking
      ? `shake ${animationDurations.extended}ms ease`
      : undefined,
    opacity: disabled ? 0.5 : 1,
  };

  const inputStyle: CSSProperties = {
    flex: 1,
    border: "none",
    background: "transparent",
    fontSize: theme.typography.fontSize.base,
    fontWeight: theme.typography.fontWeight.medium,
    color: isInsufficient
      ? theme.colors.state.danger
      : theme.colors.text.primary,
    fontVariantNumeric: "tabular-nums",
    outline: "none",
    minWidth: 0,
  };

  const quickAmountsStyle: CSSProperties = {
    display: "flex",
    flexWrap: "wrap",
    gap: theme.spacing.xs,
  };

  const quickButtonStyle: CSSProperties = {
    padding: `${theme.spacing.xs}px ${theme.spacing.sm}px`,
    fontSize: theme.typography.fontSize.xs,
    fontWeight: theme.typography.fontWeight.medium,
    color: theme.colors.text.secondary,
    backgroundColor: theme.colors.background.tertiary,
    border: `1px solid ${theme.colors.border.default}`,
    borderRadius: theme.borderRadius.sm,
    cursor: disabled ? "not-allowed" : "pointer",
    transition: theme.transitions.fast,
  };

  const errorStyle: CSSProperties = {
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.state.danger,
    marginTop: theme.spacing.xs,
  };

  const balanceStyle: CSSProperties = {
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.text.muted,
    display: "flex",
    alignItems: "center",
    gap: theme.spacing.xs,
  };

  return (
    <div className={className} style={containerStyle}>
      {/* Balance display */}
      {checkBalance && (
        <div style={balanceStyle}>
          <span>Balance:</span>
          <CurrencyIcon type={type} size={12} />
          <span style={{ color: currency.color }}>
            {formatCurrency(balance.amount, type).full}
          </span>
        </div>
      )}

      {/* Input wrapper */}
      <div style={inputWrapperStyle}>
        {showIcon && <CurrencyIcon type={type} size={20} />}

        <input
          ref={inputRef}
          type="text"
          inputMode="numeric"
          value={inputText}
          placeholder={placeholder}
          disabled={disabled}
          readOnly={readOnly}
          onChange={handleInputChange}
          onFocus={handleFocus}
          onBlur={handleBlur}
          style={inputStyle}
          aria-invalid={!!error}
          aria-describedby={error ? "currency-input-error" : undefined}
        />

        {/* Compact suffix hint */}
        {allowCompactInput && isFocused && (
          <span
            style={{
              fontSize: theme.typography.fontSize.xs,
              color: theme.colors.text.muted,
            }}
          >
            k, M, B
          </span>
        )}
      </div>

      {/* Error message */}
      {error && (
        <div id="currency-input-error" style={errorStyle}>
          {error}
        </div>
      )}

      {/* Insufficient warning */}
      {!error && showInsufficientWarning && isInsufficient && (
        <div style={errorStyle}>Insufficient {currency.name.toLowerCase()}</div>
      )}

      {/* Quick amounts */}
      {showQuickAmounts && !disabled && (
        <div style={quickAmountsStyle}>
          {quickAmounts.map((preset) => (
            <button
              key={preset.label}
              type="button"
              style={quickButtonStyle}
              onClick={() => handleQuickAmount(preset)}
              disabled={disabled}
              onMouseEnter={(e) => {
                (e.target as HTMLElement).style.backgroundColor =
                  theme.colors.background.secondary;
                (e.target as HTMLElement).style.color =
                  theme.colors.text.primary;
              }}
              onMouseLeave={(e) => {
                (e.target as HTMLElement).style.backgroundColor =
                  theme.colors.background.tertiary;
                (e.target as HTMLElement).style.color =
                  theme.colors.text.secondary;
              }}
            >
              {preset.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
});

export default CurrencyInput;
