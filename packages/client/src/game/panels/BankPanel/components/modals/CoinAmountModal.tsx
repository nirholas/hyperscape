/**
 * Coin Amount Modal Component
 *
 * Modal for entering coin deposit/withdraw amounts with quick buttons.
 * Uses hs-kit ModalWindow and theme system for consistent styling.
 */

import { useState, useEffect, useRef, type CSSProperties } from "react";
import { ModalWindow, useThemeStore } from "hs-kit";
import type { CoinModalState } from "../../types";
import { formatQuantity } from "../../utils";

interface CoinAmountModalProps {
  modal: CoinModalState;
  onConfirm: (amount: number) => void;
  onClose: () => void;
}

export function CoinAmountModal({
  modal,
  onConfirm,
  onClose,
}: CoinAmountModalProps) {
  const theme = useThemeStore((s) => s.theme);
  const [amount, setAmount] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (modal.visible && inputRef.current) {
      inputRef.current.focus();
      setAmount("");
    }
  }, [modal.visible]);

  if (!modal.visible) return null;

  const handleSubmit = () => {
    const numAmount = parseInt(amount, 10);
    if (numAmount > 0 && numAmount <= modal.maxAmount) {
      onConfirm(numAmount);
      onClose();
    }
  };

  const handleQuickAmount = (value: number) => {
    const actualAmount = Math.min(value, modal.maxAmount);
    if (actualAmount > 0) {
      onConfirm(actualAmount);
      onClose();
    }
  };

  const actionLabel = modal.action === "deposit" ? "Deposit" : "Withdraw";
  const actionColor =
    modal.action === "deposit"
      ? theme.colors.state.success
      : theme.colors.state.warning;

  const buttonStyle: CSSProperties = {
    padding: `${theme.spacing.sm}px`,
    borderRadius: theme.borderRadius.md,
    fontSize: theme.typography.fontSize.sm,
    fontWeight: theme.typography.fontWeight.bold,
    cursor: "pointer",
    transition: "all 0.2s ease",
    color: theme.colors.text.primary,
    border: `1px solid ${theme.colors.border.default}`,
  };

  const activeButtonStyle: CSSProperties = {
    ...buttonStyle,
    background: `${actionColor}cc`,
  };

  const disabledButtonStyle: CSSProperties = {
    ...buttonStyle,
    background: theme.colors.background.tertiary,
    opacity: 0.3,
    cursor: "not-allowed",
  };

  return (
    <ModalWindow
      visible={modal.visible}
      onClose={onClose}
      title={`${actionLabel} Coins`}
      width={300}
      showCloseButton={false}
    >
      <div style={{ padding: theme.spacing.sm }}>
        {/* Quick amounts */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: theme.spacing.sm,
            marginBottom: theme.spacing.md,
          }}
        >
          {[1, 10, 100, 1000].map((qty) => (
            <button
              key={qty}
              onClick={() => handleQuickAmount(qty)}
              disabled={modal.maxAmount < qty}
              style={
                modal.maxAmount >= qty ? activeButtonStyle : disabledButtonStyle
              }
            >
              {qty >= 1000 ? `${qty / 1000}K` : qty}
            </button>
          ))}
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(2, 1fr)",
            gap: theme.spacing.sm,
            marginBottom: theme.spacing.md,
          }}
        >
          <button
            onClick={() => handleQuickAmount(Math.floor(modal.maxAmount / 2))}
            disabled={modal.maxAmount < 2}
            style={
              modal.maxAmount >= 2 ? activeButtonStyle : disabledButtonStyle
            }
          >
            Half ({formatQuantity(Math.floor(modal.maxAmount / 2))})
          </button>
          <button
            onClick={() => handleQuickAmount(modal.maxAmount)}
            disabled={modal.maxAmount < 1}
            style={
              modal.maxAmount >= 1 ? activeButtonStyle : disabledButtonStyle
            }
          >
            All ({formatQuantity(modal.maxAmount)})
          </button>
        </div>

        {/* Custom amount input */}
        <div style={{ marginBottom: theme.spacing.md }}>
          <label
            style={{
              display: "block",
              fontSize: theme.typography.fontSize.xs,
              color: theme.colors.text.secondary,
              marginBottom: theme.spacing.xs,
            }}
          >
            Custom amount (max: {modal.maxAmount.toLocaleString()})
          </label>
          <input
            ref={inputRef}
            type="number"
            min="1"
            max={modal.maxAmount}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSubmit();
              if (e.key === "Escape") onClose();
            }}
            style={{
              width: "100%",
              padding: `${theme.spacing.sm}px ${theme.spacing.md}px`,
              borderRadius: theme.borderRadius.md,
              fontSize: theme.typography.fontSize.sm,
              background: theme.colors.background.tertiary,
              border: `1px solid ${theme.colors.border.default}`,
              color: theme.colors.text.primary,
              outline: "none",
            }}
            placeholder="Enter amount..."
          />
        </div>

        {/* Action buttons */}
        <div style={{ display: "flex", gap: theme.spacing.sm }}>
          <button
            onClick={handleSubmit}
            disabled={
              !amount ||
              parseInt(amount, 10) <= 0 ||
              parseInt(amount, 10) > modal.maxAmount
            }
            style={{
              ...buttonStyle,
              flex: 1,
              background:
                amount &&
                parseInt(amount, 10) > 0 &&
                parseInt(amount, 10) <= modal.maxAmount
                  ? `${actionColor}cc`
                  : theme.colors.background.tertiary,
              opacity:
                amount &&
                parseInt(amount, 10) > 0 &&
                parseInt(amount, 10) <= modal.maxAmount
                  ? 1
                  : 0.3,
            }}
          >
            {actionLabel}
          </button>
          <button
            onClick={onClose}
            style={{
              ...buttonStyle,
              flex: 1,
              background: theme.colors.background.tertiary,
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </ModalWindow>
  );
}
