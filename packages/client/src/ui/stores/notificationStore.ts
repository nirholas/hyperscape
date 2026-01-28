/**
 * Notification Store
 *
 * Zustand store for unified notification/toast management.
 * Replaces inconsistent alert(), toast, and inline error patterns with a single system.
 *
 * Features:
 * - Multiple notification types (success, error, warning, info)
 * - Auto-dismiss with configurable duration
 * - Queue management with max visible limit
 * - Action buttons support
 * - Accessibility support (aria-live regions)
 *
 * @packageDocumentation
 */

import { create } from "zustand";

/** Notification types */
export type NotificationType = "success" | "error" | "warning" | "info";

/** Notification action button */
export interface NotificationAction {
  label: string;
  onClick: () => void;
}

/** Notification data */
export interface Notification {
  id: string;
  type: NotificationType;
  title?: string;
  message: string;
  duration?: number; // ms, 0 = persistent
  action?: NotificationAction;
  dismissible?: boolean;
  createdAt: number;
}

/** Notification store state */
export interface NotificationStoreState {
  notifications: Notification[];
  maxVisible: number;

  // Actions
  show: (notification: Omit<Notification, "id" | "createdAt">) => string;
  showSuccess: (message: string, title?: string) => string;
  showError: (message: string, title?: string) => string;
  showWarning: (message: string, title?: string) => string;
  showInfo: (message: string, title?: string) => string;
  dismiss: (id: string) => void;
  dismissAll: () => void;

  // Settings
  setMaxVisible: (max: number) => void;
}

// Default durations by type (ms)
const DEFAULT_DURATIONS: Record<NotificationType, number> = {
  success: 3000,
  error: 5000,
  warning: 4000,
  info: 3000,
};

// Generate unique ID
let notificationIdCounter = 0;
function generateId(): string {
  return `notification-${Date.now()}-${++notificationIdCounter}`;
}

/**
 * Zustand store for notification management
 *
 * @example
 * ```tsx
 * // Show success notification
 * const { showSuccess } = useNotificationStore();
 * showSuccess("Item deposited successfully");
 *
 * // Show error with title
 * const { showError } = useNotificationStore();
 * showError("Failed to complete trade", "Trade Error");
 *
 * // Show with custom options
 * const { show } = useNotificationStore();
 * show({
 *   type: "warning",
 *   message: "Your session will expire in 5 minutes",
 *   duration: 0, // Persistent
 *   action: {
 *     label: "Refresh",
 *     onClick: () => location.reload(),
 *   },
 * });
 * ```
 */
export const useNotificationStore = create<NotificationStoreState>()(
  (set, get) => ({
    notifications: [],
    maxVisible: 5,

    show: (notification) => {
      const id = generateId();
      const now = Date.now();
      const duration =
        notification.duration ?? DEFAULT_DURATIONS[notification.type];

      const newNotification: Notification = {
        ...notification,
        id,
        createdAt: now,
        duration,
        dismissible: notification.dismissible ?? true,
      };

      set((state) => {
        // Add to beginning (newest first)
        let notifications = [newNotification, ...state.notifications];

        // Limit to maxVisible
        if (notifications.length > state.maxVisible) {
          notifications = notifications.slice(0, state.maxVisible);
        }

        return { notifications };
      });

      // Auto-dismiss if duration > 0
      if (duration > 0) {
        setTimeout(() => {
          get().dismiss(id);
        }, duration);
      }

      return id;
    },

    showSuccess: (message, title) => {
      return get().show({ type: "success", message, title });
    },

    showError: (message, title) => {
      return get().show({ type: "error", message, title });
    },

    showWarning: (message, title) => {
      return get().show({ type: "warning", message, title });
    },

    showInfo: (message, title) => {
      return get().show({ type: "info", message, title });
    },

    dismiss: (id) => {
      set((state) => ({
        notifications: state.notifications.filter((n) => n.id !== id),
      }));
    },

    dismissAll: () => {
      set({ notifications: [] });
    },

    setMaxVisible: (max) => {
      set({ maxVisible: max });
    },
  }),
);

/**
 * Hook for showing notifications (convenience)
 */
export function useNotifications() {
  const show = useNotificationStore((s) => s.show);
  const showSuccess = useNotificationStore((s) => s.showSuccess);
  const showError = useNotificationStore((s) => s.showError);
  const showWarning = useNotificationStore((s) => s.showWarning);
  const showInfo = useNotificationStore((s) => s.showInfo);
  const dismiss = useNotificationStore((s) => s.dismiss);
  const dismissAll = useNotificationStore((s) => s.dismissAll);

  return {
    show,
    showSuccess,
    showError,
    showWarning,
    showInfo,
    dismiss,
    dismissAll,
  };
}

/**
 * Hook for reading notification list (for display component)
 */
export function useNotificationList() {
  return useNotificationStore((s) => s.notifications);
}

/**
 * User-friendly error message mapping
 * Maps technical errors to user-friendly messages
 */
export const ERROR_MESSAGES: Record<string, string> = {
  // Network errors
  NETWORK_ERROR: "Unable to connect. Please check your internet connection.",
  TIMEOUT: "The request timed out. Please try again.",
  CONNECTION_LOST: "Connection lost. Attempting to reconnect...",

  // Auth errors
  AUTH_FAILED: "Authentication failed. Please log in again.",
  SESSION_EXPIRED: "Your session has expired. Please refresh the page.",
  UNAUTHORIZED: "You don't have permission to perform this action.",

  // Game errors
  INVENTORY_FULL: "Your inventory is full.",
  INSUFFICIENT_FUNDS: "You don't have enough coins.",
  ITEM_NOT_FOUND: "Item not found.",
  LEVEL_REQUIRED: "You need a higher level to do that.",
  RATE_LIMITED: "Too many requests. Please wait a moment.",

  // Fallback
  UNKNOWN: "An unexpected error occurred. Please try again.",
};

/**
 * Get user-friendly error message
 */
export function getUserFriendlyError(error: string | Error): string {
  const errorKey = error instanceof Error ? error.message : error;
  return ERROR_MESSAGES[errorKey] || ERROR_MESSAGES.UNKNOWN;
}

/**
 * Show an error notification from a caught error
 *
 * This is a convenience function for use in catch blocks.
 * It logs the error to console and shows a user-friendly notification.
 *
 * @param error - The error that was caught
 * @param context - Optional context string (e.g., "loading inventory")
 * @param options - Optional override options
 *
 * @example
 * ```tsx
 * try {
 *   await loadData();
 * } catch (error) {
 *   showErrorNotification(error, "loading inventory");
 * }
 * ```
 */
export function showErrorNotification(
  error: unknown,
  context?: string,
  options?: { silent?: boolean; title?: string },
): void {
  // Extract error message for logging
  const errorMessage = error instanceof Error ? error.message : String(error);

  // Log to console for debugging (always includes full error for stack trace)
  console.error(
    `[Error${context ? ` in ${context}` : ""}] ${errorMessage}`,
    error instanceof Error ? error.stack : "",
  );

  // Skip notification if silent mode requested
  if (options?.silent) {
    return;
  }

  // Get user-friendly message (may differ from technical errorMessage)
  const friendlyMessage = getUserFriendlyError(errorMessage);

  // Show notification
  const { showError } = useNotificationStore.getState();
  showError(
    context ? `${friendlyMessage} (${context})` : friendlyMessage,
    options?.title || "Error",
  );
}

/**
 * Show a network error notification
 *
 * Specialized for network-related errors with appropriate messaging.
 *
 * @param error - The network error
 * @param action - What action failed (e.g., "deposit", "withdraw")
 */
export function showNetworkErrorNotification(
  error: unknown,
  action: string,
): void {
  console.error(`[Network Error] ${action}:`, error);

  const { showError } = useNotificationStore.getState();
  showError(
    `Failed to ${action}. Please check your connection and try again.`,
    "Network Error",
  );
}

/**
 * Show a success notification for completed actions
 *
 * @param message - Success message
 * @param title - Optional title
 */
export function showSuccessNotification(message: string, title?: string): void {
  const { showSuccess } = useNotificationStore.getState();
  showSuccess(message, title);
}
