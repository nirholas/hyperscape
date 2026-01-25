/**
 * useEventListener Hook
 *
 * Attaches an event listener to an element with automatic cleanup.
 *
 * @packageDocumentation
 */

/* eslint-disable no-undef, no-redeclare */
// DOM types (Window, Document, HTMLElement, etc.) are browser globals
// Function overloads are valid TypeScript but trigger no-redeclare

import { useEffect, useRef } from "react";

/**
 * Event listener target types
 */
type EventTarget = Window | Document | HTMLElement | null;

/**
 * Attaches an event listener to a target element with automatic cleanup.
 *
 * @param target - The element to attach the listener to (window, document, or element)
 * @param eventName - The event name (e.g., 'click', 'keydown')
 * @param handler - The event handler function
 * @param options - Optional addEventListener options
 *
 * @example
 * ```tsx
 * // Listen to window resize
 * useEventListener(window, 'resize', () => {
 *   console.log('Window resized');
 * });
 *
 * // Listen to element click
 * useEventListener(buttonRef.current, 'click', () => {
 *   console.log('Button clicked');
 * });
 *
 * // Listen to keydown with options
 * useEventListener(document, 'keydown', handleKeyDown, { capture: true });
 * ```
 */
// Function overloads for type-safe event listeners
export function useEventListener<K extends keyof WindowEventMap>(
  target: Window,
  eventName: K,
  handler: (event: WindowEventMap[K]) => void,
  options?: boolean | AddEventListenerOptions,
): void;

export function useEventListener<K extends keyof DocumentEventMap>(
  target: Document,
  eventName: K,
  handler: (event: DocumentEventMap[K]) => void,
  options?: boolean | AddEventListenerOptions,
): void;

export function useEventListener<K extends keyof HTMLElementEventMap>(
  target: HTMLElement | null,
  eventName: K,
  handler: (event: HTMLElementEventMap[K]) => void,
  options?: boolean | AddEventListenerOptions,
): void;

export function useEventListener(
  target: EventTarget,
  eventName: string,
  handler: (event: Event) => void,
  options?: boolean | AddEventListenerOptions,
): void {
  // Keep handler ref up to date to avoid stale closures
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!target) return;

    const eventHandler = (event: Event) => handlerRef.current(event);

    target.addEventListener(eventName, eventHandler, options);

    return () => {
      target.removeEventListener(eventName, eventHandler, options);
    };
  }, [target, eventName, options]);
}

/**
 * Listen to a keyboard shortcut
 *
 * @param key - The key to listen for (e.g., 'Escape', 'Enter', 'a')
 * @param handler - The handler function
 * @param modifiers - Optional modifier keys (ctrl, shift, alt, meta)
 *
 * @example
 * ```tsx
 * useKeyboardShortcut('Escape', () => closeModal());
 * useKeyboardShortcut('s', () => save(), { ctrl: true });
 * ```
 */
export function useKeyboardShortcut(
  key: string,
  handler: () => void,
  modifiers?: {
    ctrl?: boolean;
    shift?: boolean;
    alt?: boolean;
    meta?: boolean;
  },
): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== key) return;

      // Check modifiers
      if (modifiers?.ctrl && !event.ctrlKey) return;
      if (modifiers?.shift && !event.shiftKey) return;
      if (modifiers?.alt && !event.altKey) return;
      if (modifiers?.meta && !event.metaKey) return;

      event.preventDefault();
      handlerRef.current();
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [key, modifiers?.ctrl, modifiers?.shift, modifiers?.alt, modifiers?.meta]);
}
