/**
 * useFocusTrap Hook
 *
 * Traps keyboard focus within a modal or dialog element.
 * Essential for accessibility - ensures keyboard users can't tab out of modals.
 *
 * @packageDocumentation
 */

import { useEffect, useRef, useCallback } from "react";

/**
 * Selectors for focusable elements
 */
const FOCUSABLE_SELECTORS = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

/**
 * Options for the focus trap hook
 */
export interface UseFocusTrapOptions {
  /** Whether the focus trap is active */
  active?: boolean;
  /** Whether to return focus to the previously focused element on deactivation */
  returnFocus?: boolean;
  /** Whether to focus the first focusable element when activated */
  autoFocus?: boolean;
  /** Callback when user attempts to close (e.g., pressing Escape) */
  onEscape?: () => void;
}

/**
 * Result from useFocusTrap hook
 */
export interface UseFocusTrapResult {
  /** Ref to attach to the container element */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** Manually focus the first focusable element */
  focusFirst: () => void;
  /** Manually focus the last focusable element */
  focusLast: () => void;
}

/**
 * Hook for trapping focus within a modal or dialog.
 *
 * @param options - Configuration options
 * @returns Ref and focus utilities
 *
 * @example
 * ```tsx
 * function Modal({ isOpen, onClose, children }) {
 *   const { containerRef } = useFocusTrap({
 *     active: isOpen,
 *     returnFocus: true,
 *     onEscape: onClose,
 *   });
 *
 *   return (
 *     <div ref={containerRef} role="dialog" aria-modal="true">
 *       {children}
 *     </div>
 *   );
 * }
 * ```
 */
export function useFocusTrap(
  options: UseFocusTrapOptions = {},
): UseFocusTrapResult {
  const {
    active = true,
    returnFocus = true,
    autoFocus = true,
    onEscape,
  } = options;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  /**
   * Get all focusable elements within the container
   */
  const getFocusableElements = useCallback((): HTMLElement[] => {
    if (!containerRef.current) return [];
    return Array.from(
      containerRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTORS),
    );
  }, []);

  /**
   * Focus the first focusable element
   */
  const focusFirst = useCallback(() => {
    const elements = getFocusableElements();
    if (elements.length > 0) {
      elements[0].focus();
    }
  }, [getFocusableElements]);

  /**
   * Focus the last focusable element
   */
  const focusLast = useCallback(() => {
    const elements = getFocusableElements();
    if (elements.length > 0) {
      elements[elements.length - 1].focus();
    }
  }, [getFocusableElements]);

  useEffect(() => {
    if (!active || !containerRef.current) return;

    // Store the previously focused element
    if (returnFocus) {
      previouslyFocusedRef.current = document.activeElement as HTMLElement;
    }

    // Auto-focus first element
    if (autoFocus) {
      // Use RAF to ensure the modal is rendered
      requestAnimationFrame(() => {
        focusFirst();
      });
    }

    /**
     * Handle keydown for Tab and Escape
     */
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && onEscape) {
        event.preventDefault();
        onEscape();
        return;
      }

      if (event.key !== "Tab") return;

      const elements = getFocusableElements();
      if (elements.length === 0) return;

      const firstElement = elements[0];
      const lastElement = elements[elements.length - 1];
      const activeElement = document.activeElement;

      // Shift+Tab from first element -> focus last
      if (event.shiftKey && activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
        return;
      }

      // Tab from last element -> focus first
      if (!event.shiftKey && activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
        return;
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);

      // Return focus to previously focused element
      if (returnFocus && previouslyFocusedRef.current) {
        previouslyFocusedRef.current.focus();
      }
    };
  }, [
    active,
    returnFocus,
    autoFocus,
    onEscape,
    focusFirst,
    getFocusableElements,
  ]);

  return {
    containerRef,
    focusFirst,
    focusLast,
  };
}
