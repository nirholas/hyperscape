/**
 * @fileoverview PaymentModal Component
 * @module @hyperscape/client/ui/components/web3/PaymentModal
 *
 * Modal component for sending payments with recipient input,
 * amount selection, and transaction status.
 */

import React, { memo, useState, useCallback, useEffect } from "react";
import { usePayment } from "../../../hooks/usePayment";
import { useWallet } from "../../../hooks/useWallet";
import { useBalance } from "../../../hooks/useBalance";
import {
  formatUsd,
  formatTokenAmount,
  truncateAddress,
  NETWORK_METADATA,
  type FeeEstimate,
} from "@hyperscape/shared";
import { useTheme } from "../../stores/themeStore";

// ============================================================================
// Types
// ============================================================================

export interface PaymentModalProps {
  /** Whether the modal is visible */
  visible: boolean;
  /** Called when modal should close */
  onClose: () => void;
  /** Pre-filled recipient address */
  recipient?: string;
  /** Pre-filled amount */
  amount?: string;
  /** Pre-selected token */
  token?: string;
  /** Called when payment is successful */
  onSuccess?: (txHash: string) => void;
  /** Called when payment fails */
  onError?: (error: Error) => void;
}

type Step = "input" | "confirm" | "pending" | "success" | "error";

// ============================================================================
// Component
// ============================================================================

/**
 * PaymentModal component for sending payments
 *
 * @example
 * ```tsx
 * <PaymentModal
 *   visible={isOpen}
 *   onClose={() => setIsOpen(false)}
 *   recipient="0x..."
 *   onSuccess={(txHash) => console.log('Sent!', txHash)}
 * />
 * ```
 */
export const PaymentModal = memo(function PaymentModal({
  visible,
  onClose,
  recipient: initialRecipient = "",
  amount: initialAmount = "",
  token: initialToken,
  onSuccess,
  onError,
}: PaymentModalProps) {
  const theme = useTheme();
  const { wallet } = useWallet();
  const { balance } = useBalance();
  const {
    send,
    estimateFee,
    isPending,
    lastTransaction,
    error: paymentError,
  } = usePayment();

  // Form state
  const [recipient, setRecipient] = useState(initialRecipient);
  const [amount, setAmount] = useState(initialAmount);
  const [token, setToken] = useState(initialToken || "USDs");
  const [memo, setMemo] = useState("");
  const [useGasless, setUseGasless] = useState(true);

  // UI state
  const [step, setStep] = useState<Step>("input");
  const [feeEstimate, setFeeEstimate] = useState<FeeEstimate | null>(null);
  const [isEstimating, setIsEstimating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset form when modal opens
  useEffect(() => {
    if (visible) {
      setRecipient(initialRecipient);
      setAmount(initialAmount);
      setToken(initialToken || "USDs");
      setMemo("");
      setStep("input");
      setError(null);
      setFeeEstimate(null);
    }
  }, [visible, initialRecipient, initialAmount, initialToken]);

  // Track transaction status
  useEffect(() => {
    if (lastTransaction && step === "pending") {
      if (lastTransaction.status === "confirmed") {
        setStep("success");
        onSuccess?.(lastTransaction.txHash);
      } else if (lastTransaction.status === "failed") {
        setStep("error");
        setError("Transaction failed");
        onError?.(new Error("Transaction failed"));
      }
    }
  }, [lastTransaction, step, onSuccess, onError]);

  // Estimate fee when inputs change
  useEffect(() => {
    const estimate = async () => {
      if (!wallet || !recipient || !amount || parseFloat(amount) <= 0) {
        setFeeEstimate(null);
        return;
      }

      setIsEstimating(true);
      try {
        const estimate = await estimateFee({
          to: recipient,
          amount,
          token:
            token !== NETWORK_METADATA[wallet.network].nativeToken
              ? token
              : undefined,
        });
        setFeeEstimate(estimate);
      } catch {
        // Silently fail - user can still proceed
        setFeeEstimate(null);
      }
      setIsEstimating(false);
    };

    const debounce = setTimeout(estimate, 500);
    return () => clearTimeout(debounce);
  }, [wallet, recipient, amount, token, estimateFee]);

  // Validate inputs
  const validateInputs = useCallback((): boolean => {
    if (!recipient) {
      setError("Recipient address is required");
      return false;
    }

    // Basic address validation
    const isEvmAddress = /^0x[a-fA-F0-9]{40}$/.test(recipient);
    const isSolanaAddress = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(recipient);

    if (!isEvmAddress && !isSolanaAddress) {
      setError("Invalid recipient address");
      return false;
    }

    if (!amount || parseFloat(amount) <= 0) {
      setError("Amount must be greater than 0");
      return false;
    }

    // Check balance
    if (balance) {
      const availableBalance =
        token === balance.native.symbol
          ? parseFloat(balance.native.balance)
          : balance.tokens.find((t: { symbol: string }) => t.symbol === token)
                ?.balance
            ? parseFloat(
                balance.tokens.find(
                  (t: { symbol: string }) => t.symbol === token,
                )!.balance,
              )
            : 0;

      if (parseFloat(amount) > availableBalance) {
        setError(`Insufficient ${token} balance`);
        return false;
      }
    }

    setError(null);
    return true;
  }, [recipient, amount, token, balance]);

  // Handle continue to confirmation
  const handleContinue = useCallback(() => {
    if (validateInputs()) {
      setStep("confirm");
    }
  }, [validateInputs]);

  // Handle send
  const handleSend = useCallback(async () => {
    if (!wallet) return;

    setStep("pending");
    setError(null);

    try {
      await send({
        to: recipient,
        amount,
        token:
          token !== NETWORK_METADATA[wallet.network].nativeToken
            ? token
            : undefined,
        memo: memo || undefined,
        gasless: useGasless && feeEstimate?.gaslessAvailable,
      });
    } catch (err) {
      setStep("error");
      const errorMessage =
        err instanceof Error ? err.message : "Transaction failed";
      setError(errorMessage);
      onError?.(err instanceof Error ? err : new Error(errorMessage));
    }
  }, [
    wallet,
    send,
    recipient,
    amount,
    token,
    memo,
    useGasless,
    feeEstimate,
    onError,
  ]);

  // Handle close
  const handleClose = useCallback(() => {
    if (!isPending) {
      onClose();
    }
  }, [isPending, onClose]);

  if (!visible) return null;

  // Available tokens
  const availableTokens = balance
    ? [
        { symbol: balance.native.symbol, balance: balance.native.balance },
        ...balance.tokens.map((t: { symbol: string; balance: string }) => ({
          symbol: t.symbol,
          balance: t.balance,
        })),
      ]
    : [{ symbol: token, balance: "0" }];

  // Styles
  const overlayStyle: React.CSSProperties = {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0, 0, 0, 0.6)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10000,
    pointerEvents: "auto",
  };

  const modalStyle: React.CSSProperties = {
    width: 420,
    maxWidth: "90vw",
    maxHeight: "90vh",
    backgroundColor: theme.colors.background.primary,
    borderRadius: theme.borderRadius.lg,
    border: `1px solid ${theme.colors.border.default}`,
    boxShadow: theme.shadows.xl,
    overflow: "hidden",
  };

  const headerStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "16px 20px",
    borderBottom: `1px solid ${theme.colors.border.default}`,
    backgroundColor: theme.colors.background.secondary,
  };

  const contentStyle: React.CSSProperties = {
    padding: 20,
    maxHeight: "calc(90vh - 120px)",
    overflowY: "auto",
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "12px 14px",
    borderRadius: theme.borderRadius.md,
    border: `1px solid ${theme.colors.border.default}`,
    backgroundColor: theme.colors.background.tertiary,
    color: theme.colors.text.primary,
    fontSize: theme.typography.fontSize.base,
    outline: "none",
    transition: `border-color ${theme.transitions.fast}`,
  };

  const labelStyle: React.CSSProperties = {
    display: "block",
    marginBottom: 6,
    fontSize: theme.typography.fontSize.sm,
    fontWeight: theme.typography.fontWeight.medium,
    color: theme.colors.text.secondary,
  };

  const buttonStyle: React.CSSProperties = {
    width: "100%",
    padding: "14px 20px",
    borderRadius: theme.borderRadius.md,
    border: "none",
    backgroundColor: theme.colors.accent.primary,
    color: "#fff",
    fontSize: theme.typography.fontSize.base,
    fontWeight: theme.typography.fontWeight.semibold,
    cursor: "pointer",
    transition: `all ${theme.transitions.fast}`,
  };

  return (
    <div style={overlayStyle} onClick={handleClose}>
      <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={headerStyle}>
          <h3
            style={{
              margin: 0,
              fontSize: theme.typography.fontSize.lg,
              fontWeight: theme.typography.fontWeight.semibold,
            }}
          >
            {step === "input" && "Send Payment"}
            {step === "confirm" && "Confirm Payment"}
            {step === "pending" && "Processing..."}
            {step === "success" && "Payment Sent!"}
            {step === "error" && "Payment Failed"}
          </h3>
          {!isPending && (
            <button
              onClick={handleClose}
              style={{
                border: "none",
                background: "none",
                cursor: "pointer",
                padding: 4,
                color: theme.colors.text.secondary,
                fontSize: 18,
              }}
            >
              ✕
            </button>
          )}
        </div>

        {/* Content */}
        <div style={contentStyle}>
          {/* Input Step */}
          {step === "input" && (
            <>
              {/* Recipient */}
              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle}>Recipient Address</label>
                <input
                  type="text"
                  value={recipient}
                  onChange={(e) => setRecipient(e.target.value)}
                  placeholder="0x... or base58 address"
                  style={inputStyle}
                />
              </div>

              {/* Amount and Token */}
              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle}>Amount</label>
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    type="number"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.00"
                    min="0"
                    step="0.01"
                    style={{ ...inputStyle, flex: 1 }}
                  />
                  <select
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    style={{ ...inputStyle, width: 100 }}
                  >
                    {availableTokens.map((t) => (
                      <option key={t.symbol} value={t.symbol}>
                        {t.symbol}
                      </option>
                    ))}
                  </select>
                </div>
                {balance && (
                  <div
                    style={{
                      marginTop: 6,
                      fontSize: theme.typography.fontSize.xs,
                      color: theme.colors.text.muted,
                    }}
                  >
                    Available:{" "}
                    {formatTokenAmount(
                      token === balance.native.symbol
                        ? balance.native.balance
                        : balance.tokens.find(
                            (t: { symbol: string }) => t.symbol === token,
                          )?.balance || "0",
                    )}{" "}
                    {token}
                    <button
                      onClick={() => {
                        const max =
                          token === balance.native.symbol
                            ? balance.native.balance
                            : balance.tokens.find(
                                (t: { symbol: string }) => t.symbol === token,
                              )?.balance || "0";
                        setAmount(max);
                      }}
                      style={{
                        marginLeft: 8,
                        padding: "2px 6px",
                        border: "none",
                        borderRadius: 4,
                        backgroundColor: theme.colors.accent.primary,
                        color: "#fff",
                        fontSize: 10,
                        cursor: "pointer",
                      }}
                    >
                      MAX
                    </button>
                  </div>
                )}
              </div>

              {/* Memo */}
              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle}>Memo (optional)</label>
                <input
                  type="text"
                  value={memo}
                  onChange={(e) => setMemo(e.target.value)}
                  placeholder="Payment for..."
                  style={inputStyle}
                />
              </div>

              {/* Gasless option */}
              {feeEstimate?.gaslessAvailable && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    marginBottom: 16,
                    padding: 12,
                    borderRadius: theme.borderRadius.md,
                    backgroundColor: `${theme.colors.state.success}15`,
                    border: `1px solid ${theme.colors.state.success}40`,
                  }}
                >
                  <input
                    type="checkbox"
                    id="gasless"
                    checked={useGasless}
                    onChange={(e) => setUseGasless(e.target.checked)}
                    style={{ cursor: "pointer" }}
                  />
                  <label
                    htmlFor="gasless"
                    style={{
                      flex: 1,
                      cursor: "pointer",
                      fontSize: theme.typography.fontSize.sm,
                    }}
                  >
                    Use gasless transfer (no ETH needed)
                  </label>
                </div>
              )}

              {/* Fee estimate */}
              {feeEstimate && !useGasless && (
                <div
                  style={{
                    padding: 12,
                    borderRadius: theme.borderRadius.md,
                    backgroundColor: theme.colors.background.secondary,
                    marginBottom: 16,
                    fontSize: theme.typography.fontSize.sm,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      marginBottom: 4,
                    }}
                  >
                    <span style={{ color: theme.colors.text.secondary }}>
                      Estimated Fee
                    </span>
                    <span>
                      {feeEstimate.fee} ({formatUsd(feeEstimate.feeUsd)})
                    </span>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      color: theme.colors.text.muted,
                    }}
                  >
                    <span>Est. Time</span>
                    <span>~{feeEstimate.estimatedTime}s</span>
                  </div>
                </div>
              )}

              {/* Error */}
              {error && (
                <div
                  style={{
                    padding: 12,
                    marginBottom: 16,
                    borderRadius: theme.borderRadius.md,
                    backgroundColor: `${theme.colors.state.danger}20`,
                    color: theme.colors.state.danger,
                    fontSize: theme.typography.fontSize.sm,
                  }}
                >
                  {error}
                </div>
              )}

              {/* Continue button */}
              <button
                onClick={handleContinue}
                disabled={!recipient || !amount || isEstimating}
                style={{
                  ...buttonStyle,
                  opacity: !recipient || !amount || isEstimating ? 0.5 : 1,
                  cursor:
                    !recipient || !amount || isEstimating
                      ? "not-allowed"
                      : "pointer",
                }}
              >
                {isEstimating ? "Estimating..." : "Continue"}
              </button>
            </>
          )}

          {/* Confirm Step */}
          {step === "confirm" && (
            <>
              <div
                style={{
                  padding: 16,
                  borderRadius: theme.borderRadius.md,
                  backgroundColor: theme.colors.background.secondary,
                  marginBottom: 16,
                }}
              >
                <div style={{ marginBottom: 16 }}>
                  <div
                    style={{
                      fontSize: theme.typography.fontSize.xs,
                      color: theme.colors.text.muted,
                      marginBottom: 4,
                    }}
                  >
                    Sending
                  </div>
                  <div
                    style={{
                      fontSize: theme.typography.fontSize.xxl,
                      fontWeight: theme.typography.fontWeight.bold,
                    }}
                  >
                    {formatTokenAmount(amount)} {token}
                  </div>
                </div>

                <div style={{ marginBottom: 12 }}>
                  <div
                    style={{
                      fontSize: theme.typography.fontSize.xs,
                      color: theme.colors.text.muted,
                      marginBottom: 4,
                    }}
                  >
                    To
                  </div>
                  <div
                    style={{
                      fontFamily: "monospace",
                      fontSize: theme.typography.fontSize.sm,
                      wordBreak: "break-all",
                    }}
                  >
                    {recipient}
                  </div>
                </div>

                {memo && (
                  <div>
                    <div
                      style={{
                        fontSize: theme.typography.fontSize.xs,
                        color: theme.colors.text.muted,
                        marginBottom: 4,
                      }}
                    >
                      Memo
                    </div>
                    <div style={{ fontSize: theme.typography.fontSize.sm }}>
                      {memo}
                    </div>
                  </div>
                )}
              </div>

              {/* Fee info */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  padding: "12px 0",
                  borderTop: `1px solid ${theme.colors.border.default}`,
                  fontSize: theme.typography.fontSize.sm,
                  marginBottom: 16,
                }}
              >
                <span style={{ color: theme.colors.text.secondary }}>
                  Transaction Fee
                </span>
                <span>
                  {useGasless && feeEstimate?.gaslessAvailable ? (
                    <span style={{ color: theme.colors.state.success }}>
                      FREE (Gasless)
                    </span>
                  ) : feeEstimate ? (
                    `${feeEstimate.fee} (${formatUsd(feeEstimate.feeUsd)})`
                  ) : (
                    "Calculating..."
                  )}
                </span>
              </div>

              {/* Buttons */}
              <div style={{ display: "flex", gap: 12 }}>
                <button
                  onClick={() => setStep("input")}
                  style={{
                    ...buttonStyle,
                    flex: 1,
                    backgroundColor: "transparent",
                    border: `1px solid ${theme.colors.border.default}`,
                    color: theme.colors.text.primary,
                  }}
                >
                  Back
                </button>
                <button
                  onClick={handleSend}
                  style={{ ...buttonStyle, flex: 2 }}
                >
                  Confirm & Send
                </button>
              </div>
            </>
          )}

          {/* Pending Step */}
          {step === "pending" && (
            <div style={{ textAlign: "center", padding: "40px 0" }}>
              <div
                style={{
                  width: 60,
                  height: 60,
                  margin: "0 auto 20px",
                  border: `3px solid ${theme.colors.border.default}`,
                  borderTopColor: theme.colors.accent.primary,
                  borderRadius: "50%",
                  animation: "spin 1s linear infinite",
                }}
              />
              <div
                style={{
                  fontSize: theme.typography.fontSize.lg,
                  fontWeight: theme.typography.fontWeight.semibold,
                  marginBottom: 8,
                }}
              >
                Processing Transaction
              </div>
              <div style={{ color: theme.colors.text.secondary }}>
                Please wait while your transaction is being confirmed...
              </div>
              <style>
                {`
                  @keyframes spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                  }
                `}
              </style>
            </div>
          )}

          {/* Success Step */}
          {step === "success" && lastTransaction && (
            <div style={{ textAlign: "center", padding: "40px 0" }}>
              <div
                style={{
                  width: 60,
                  height: 60,
                  margin: "0 auto 20px",
                  borderRadius: "50%",
                  backgroundColor: `${theme.colors.state.success}20`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 32,
                }}
              >
                ✓
              </div>
              <div
                style={{
                  fontSize: theme.typography.fontSize.lg,
                  fontWeight: theme.typography.fontWeight.semibold,
                  marginBottom: 8,
                }}
              >
                Payment Sent!
              </div>
              <div
                style={{
                  color: theme.colors.text.secondary,
                  marginBottom: 20,
                }}
              >
                {formatTokenAmount(amount)} {token} sent to{" "}
                {truncateAddress(recipient)}
              </div>
              <a
                href={lastTransaction.explorerUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: "inline-block",
                  padding: "10px 20px",
                  borderRadius: theme.borderRadius.md,
                  backgroundColor: theme.colors.background.secondary,
                  color: theme.colors.accent.primary,
                  textDecoration: "none",
                  fontSize: theme.typography.fontSize.sm,
                  marginBottom: 20,
                }}
              >
                View on Explorer ↗
              </a>
              <br />
              <button
                onClick={handleClose}
                style={{ ...buttonStyle, width: "auto", padding: "12px 40px" }}
              >
                Done
              </button>
            </div>
          )}

          {/* Error Step */}
          {step === "error" && (
            <div style={{ textAlign: "center", padding: "40px 0" }}>
              <div
                style={{
                  width: 60,
                  height: 60,
                  margin: "0 auto 20px",
                  borderRadius: "50%",
                  backgroundColor: `${theme.colors.state.danger}20`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 32,
                  color: theme.colors.state.danger,
                }}
              >
                ✕
              </div>
              <div
                style={{
                  fontSize: theme.typography.fontSize.lg,
                  fontWeight: theme.typography.fontWeight.semibold,
                  marginBottom: 8,
                }}
              >
                Payment Failed
              </div>
              <div
                style={{
                  color: theme.colors.state.danger,
                  marginBottom: 20,
                }}
              >
                {error ||
                  paymentError?.message ||
                  "Transaction could not be completed"}
              </div>
              <div
                style={{ display: "flex", gap: 12, justifyContent: "center" }}
              >
                <button
                  onClick={() => setStep("input")}
                  style={{
                    ...buttonStyle,
                    width: "auto",
                    padding: "12px 24px",
                    backgroundColor: "transparent",
                    border: `1px solid ${theme.colors.border.default}`,
                    color: theme.colors.text.primary,
                  }}
                >
                  Try Again
                </button>
                <button
                  onClick={handleClose}
                  style={{
                    ...buttonStyle,
                    width: "auto",
                    padding: "12px 24px",
                  }}
                >
                  Close
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

export default PaymentModal;
