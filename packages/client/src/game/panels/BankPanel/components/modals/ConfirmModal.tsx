/**
 * Confirm Modal Component
 *
 * Generic confirmation modal for destructive actions (e.g., delete tab).
 * Uses hs-kit ModalWindow and theme system for consistent styling.
 */

import { useState, type CSSProperties } from "react";
import { ModalWindow, useThemeStore } from "hs-kit";
import type { ConfirmModalState } from "../../types";

interface ConfirmModalProps {
  modal: ConfirmModalState;
  onClose: () => void;
}

export function ConfirmModal({ modal, onClose }: ConfirmModalProps) {
  const theme = useThemeStore((s) => s.theme);
  const [deleteHover, setDeleteHover] = useState(false);
  const [cancelHover, setCancelHover] = useState(false);

  if (!modal.visible) return null;

  const buttonStyle: CSSProperties = {
    flex: 1,
    padding: `${theme.spacing.sm}px`,
    borderRadius: theme.borderRadius.md,
    fontSize: theme.typography.fontSize.sm,
    fontWeight: theme.typography.fontWeight.bold,
    cursor: "pointer",
    transition: "all 0.2s ease",
    color: theme.colors.text.primary,
  };

  return (
    <ModalWindow
      visible={modal.visible}
      onClose={onClose}
      title={modal.title}
      width={320}
      showCloseButton={false}
    >
      <div style={{ padding: theme.spacing.sm }}>
        <p
          style={{
            fontSize: theme.typography.fontSize.sm,
            color: theme.colors.text.secondary,
            textAlign: "center",
            marginBottom: theme.spacing.lg,
          }}
        >
          {modal.message}
        </p>

        <div style={{ display: "flex", gap: theme.spacing.sm }}>
          <button
            onClick={() => {
              modal.onConfirm();
              onClose();
            }}
            style={{
              ...buttonStyle,
              background: deleteHover
                ? theme.colors.state.danger
                : `${theme.colors.state.danger}b3`,
              border: `1px solid ${theme.colors.state.danger}`,
            }}
            onMouseEnter={() => setDeleteHover(true)}
            onMouseLeave={() => setDeleteHover(false)}
          >
            Delete
          </button>
          <button
            onClick={onClose}
            style={{
              ...buttonStyle,
              background: cancelHover
                ? theme.colors.background.secondary
                : theme.colors.background.tertiary,
              border: `1px solid ${theme.colors.border.default}`,
            }}
            onMouseEnter={() => setCancelHover(true)}
            onMouseLeave={() => setCancelHover(false)}
          >
            Cancel
          </button>
        </div>
      </div>
    </ModalWindow>
  );
}
