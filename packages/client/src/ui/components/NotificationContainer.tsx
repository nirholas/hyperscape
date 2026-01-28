/**
 * NotificationContainer - Display notification toasts
 *
 * Renders all active notifications from the notification store.
 * Positioned in the top-right corner by default.
 *
 * Features:
 * - Animated entry/exit
 * - Type-based styling (success, error, warning, info)
 * - Dismissible with X button
 * - Action button support
 * - ARIA live region for accessibility
 *
 * @packageDocumentation
 */

import React from "react";
import {
  useNotificationList,
  useNotificationStore,
  type Notification,
  type NotificationType,
} from "../stores/notificationStore";

/** Type-based colors */
const TYPE_COLORS: Record<
  NotificationType,
  { bg: string; border: string; icon: string }
> = {
  success: {
    bg: "rgba(34, 139, 34, 0.95)",
    border: "#2d8a2d",
    icon: "✓",
  },
  error: {
    bg: "rgba(180, 30, 30, 0.95)",
    border: "#c44",
    icon: "✕",
  },
  warning: {
    bg: "rgba(180, 130, 30, 0.95)",
    border: "#c90",
    icon: "⚠",
  },
  info: {
    bg: "rgba(30, 100, 180, 0.95)",
    border: "#369",
    icon: "ℹ",
  },
};

/** Individual notification component */
function NotificationItem({ notification }: { notification: Notification }) {
  const dismiss = useNotificationStore((s) => s.dismiss);
  const colors = TYPE_COLORS[notification.type];

  return (
    <div
      role="alert"
      aria-live={notification.type === "error" ? "assertive" : "polite"}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 12,
        padding: "12px 16px",
        backgroundColor: colors.bg,
        border: `1px solid ${colors.border}`,
        borderRadius: 8,
        boxShadow: "0 4px 12px rgba(0, 0, 0, 0.3)",
        minWidth: 280,
        maxWidth: 400,
        fontFamily: "system-ui, -apple-system, sans-serif",
        animation: "slideIn 0.2s ease-out",
      }}
    >
      {/* Icon */}
      <div
        style={{
          width: 20,
          height: 20,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 14,
          color: "#fff",
          flexShrink: 0,
        }}
      >
        {colors.icon}
      </div>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {notification.title && (
          <div
            style={{
              fontWeight: 600,
              fontSize: 14,
              color: "#fff",
              marginBottom: 4,
            }}
          >
            {notification.title}
          </div>
        )}
        <div
          style={{
            fontSize: 13,
            color: "rgba(255, 255, 255, 0.9)",
            lineHeight: 1.4,
          }}
        >
          {notification.message}
        </div>

        {/* Action button */}
        {notification.action && (
          <button
            onClick={notification.action.onClick}
            style={{
              marginTop: 8,
              padding: "6px 12px",
              backgroundColor: "rgba(255, 255, 255, 0.2)",
              border: "1px solid rgba(255, 255, 255, 0.3)",
              borderRadius: 4,
              color: "#fff",
              fontSize: 12,
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            {notification.action.label}
          </button>
        )}
      </div>

      {/* Dismiss button */}
      {notification.dismissible && (
        <button
          onClick={() => dismiss(notification.id)}
          aria-label="Dismiss notification"
          style={{
            width: 20,
            height: 20,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "transparent",
            border: "none",
            color: "rgba(255, 255, 255, 0.7)",
            cursor: "pointer",
            fontSize: 16,
            padding: 0,
            flexShrink: 0,
          }}
        >
          ×
        </button>
      )}
    </div>
  );
}

/** Container for all notifications */
export function NotificationContainer(): React.ReactElement | null {
  const notifications = useNotificationList();

  if (notifications.length === 0) {
    return null;
  }

  return (
    <div
      aria-label="Notifications"
      style={{
        position: "fixed",
        top: 16,
        right: 16,
        zIndex: 10001,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        pointerEvents: "auto",
      }}
    >
      {notifications.map((notification) => (
        <NotificationItem key={notification.id} notification={notification} />
      ))}

      {/* CSS animation */}
      <style>
        {`
          @keyframes slideIn {
            from {
              opacity: 0;
              transform: translateX(100%);
            }
            to {
              opacity: 1;
              transform: translateX(0);
            }
          }
        `}
      </style>
    </div>
  );
}

export default NotificationContainer;
