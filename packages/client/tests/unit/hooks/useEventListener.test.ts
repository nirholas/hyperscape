/**
 * useEventListener Hook Tests
 *
 * Tests for the event listener hook functionality.
 *
 * @packageDocumentation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import {
  useEventListener,
  useKeyboardShortcut,
} from "@/hooks/useEventListener";

describe("useEventListener", () => {
  it("should attach event listener to window", () => {
    const handler = vi.fn();
    const addEventListenerSpy = vi.spyOn(window, "addEventListener");
    const removeEventListenerSpy = vi.spyOn(window, "removeEventListener");

    const { unmount } = renderHook(() =>
      useEventListener(window, "resize", handler),
    );

    expect(addEventListenerSpy).toHaveBeenCalledWith(
      "resize",
      expect.any(Function),
      undefined,
    );

    unmount();

    expect(removeEventListenerSpy).toHaveBeenCalledWith(
      "resize",
      expect.any(Function),
      undefined,
    );

    addEventListenerSpy.mockRestore();
    removeEventListenerSpy.mockRestore();
  });

  it("should attach event listener to document", () => {
    const handler = vi.fn();
    const addEventListenerSpy = vi.spyOn(document, "addEventListener");
    const removeEventListenerSpy = vi.spyOn(document, "removeEventListener");

    const { unmount } = renderHook(() =>
      useEventListener(document, "click", handler),
    );

    expect(addEventListenerSpy).toHaveBeenCalledWith(
      "click",
      expect.any(Function),
      undefined,
    );

    unmount();

    expect(removeEventListenerSpy).toHaveBeenCalledWith(
      "click",
      expect.any(Function),
      undefined,
    );

    addEventListenerSpy.mockRestore();
    removeEventListenerSpy.mockRestore();
  });

  it("should not attach listener if target is null", () => {
    const handler = vi.fn();
    const addEventListenerSpy = vi.spyOn(window, "addEventListener");

    renderHook(() => useEventListener(null, "click", handler));

    // Should not be called for null target
    expect(addEventListenerSpy).not.toHaveBeenCalledWith(
      "click",
      expect.any(Function),
      undefined,
    );

    addEventListenerSpy.mockRestore();
  });

  it("should call handler when event fires", () => {
    const handler = vi.fn();

    renderHook(() => useEventListener(window, "resize", handler));

    // Dispatch a resize event
    window.dispatchEvent(new Event("resize"));

    expect(handler).toHaveBeenCalled();
  });

  it("should use latest handler via ref", () => {
    const handler1 = vi.fn();
    const handler2 = vi.fn();

    const { rerender } = renderHook(
      ({ handler }) => useEventListener(window, "resize", handler),
      { initialProps: { handler: handler1 } },
    );

    // Update handler
    rerender({ handler: handler2 });

    // Dispatch event
    window.dispatchEvent(new Event("resize"));

    // Only handler2 should be called
    expect(handler1).not.toHaveBeenCalled();
    expect(handler2).toHaveBeenCalled();
  });

  it("should pass options to addEventListener", () => {
    const handler = vi.fn();
    const options = { capture: true, passive: true };
    const addEventListenerSpy = vi.spyOn(window, "addEventListener");

    renderHook(() => useEventListener(window, "scroll", handler, options));

    expect(addEventListenerSpy).toHaveBeenCalledWith(
      "scroll",
      expect.any(Function),
      options,
    );

    addEventListenerSpy.mockRestore();
  });
});

describe("useKeyboardShortcut", () => {
  it("should call handler when key is pressed", () => {
    const handler = vi.fn();

    renderHook(() => useKeyboardShortcut("Escape", handler));

    // Dispatch escape key event
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );

    expect(handler).toHaveBeenCalled();
  });

  it("should not call handler for different key", () => {
    const handler = vi.fn();

    renderHook(() => useKeyboardShortcut("Escape", handler));

    // Dispatch different key event
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );

    expect(handler).not.toHaveBeenCalled();
  });

  it("should respect ctrl modifier", () => {
    const handler = vi.fn();

    renderHook(() => useKeyboardShortcut("s", handler, { ctrl: true }));

    // Without ctrl - should not trigger
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "s", bubbles: true }),
    );
    expect(handler).not.toHaveBeenCalled();

    // With ctrl - should trigger
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true }),
    );
    expect(handler).toHaveBeenCalled();
  });

  it("should respect shift modifier", () => {
    const handler = vi.fn();

    renderHook(() => useKeyboardShortcut("Tab", handler, { shift: true }));

    // Without shift - should not trigger
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Tab", bubbles: true }),
    );
    expect(handler).not.toHaveBeenCalled();

    // With shift - should trigger
    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Tab",
        shiftKey: true,
        bubbles: true,
      }),
    );
    expect(handler).toHaveBeenCalled();
  });

  it("should respect multiple modifiers", () => {
    const handler = vi.fn();

    renderHook(() =>
      useKeyboardShortcut("s", handler, { ctrl: true, shift: true }),
    );

    // Only ctrl - should not trigger
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true }),
    );
    expect(handler).not.toHaveBeenCalled();

    // Ctrl + Shift - should trigger
    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "s",
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
      }),
    );
    expect(handler).toHaveBeenCalled();
  });

  it("should cleanup listener on unmount", () => {
    const handler = vi.fn();
    const removeEventListenerSpy = vi.spyOn(document, "removeEventListener");

    const { unmount } = renderHook(() =>
      useKeyboardShortcut("Escape", handler),
    );

    unmount();

    expect(removeEventListenerSpy).toHaveBeenCalledWith(
      "keydown",
      expect.any(Function),
    );

    removeEventListenerSpy.mockRestore();
  });
});
