/**
 * useFocusTrap Hook Tests
 *
 * Tests for the focus trap hook used in modals and dialogs.
 *
 * @packageDocumentation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useFocusTrap } from "@/hooks/useFocusTrap";

describe("useFocusTrap", () => {
  let container: HTMLDivElement;
  let button1: HTMLButtonElement;
  let button2: HTMLButtonElement;
  let button3: HTMLButtonElement;

  beforeEach(() => {
    // Create test DOM
    container = document.createElement("div");
    button1 = document.createElement("button");
    button1.textContent = "Button 1";
    button2 = document.createElement("button");
    button2.textContent = "Button 2";
    button3 = document.createElement("button");
    button3.textContent = "Button 3";

    container.appendChild(button1);
    container.appendChild(button2);
    container.appendChild(button3);
    document.body.appendChild(container);

    vi.useFakeTimers();
  });

  afterEach(() => {
    document.body.removeChild(container);
    vi.useRealTimers();
  });

  it("should return containerRef, focusFirst, and focusLast", () => {
    const { result } = renderHook(() => useFocusTrap());

    expect(result.current.containerRef).toBeDefined();
    expect(typeof result.current.focusFirst).toBe("function");
    expect(typeof result.current.focusLast).toBe("function");
  });

  it("should call onEscape when Escape key is pressed", () => {
    const onEscape = vi.fn();

    const { result, rerender } = renderHook(
      ({ active }) => useFocusTrap({ active, onEscape }),
      { initialProps: { active: false } },
    );

    // Attach container ref before activating
    (
      result.current.containerRef as { current: HTMLDivElement | null }
    ).current = container;

    // Now activate the trap - this triggers the effect which adds the listener
    rerender({ active: true });

    // Dispatch Escape key event
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );

    expect(onEscape).toHaveBeenCalled();
  });

  it("should not trap focus when active is false", () => {
    const onEscape = vi.fn();

    renderHook(() => useFocusTrap({ active: false, onEscape }));

    // Dispatch Escape key event
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );

    // Should not be called when inactive
    expect(onEscape).not.toHaveBeenCalled();
  });

  it("should cleanup event listener on unmount", () => {
    const removeEventListenerSpy = vi.spyOn(document, "removeEventListener");
    const onEscape = vi.fn();

    const { result, rerender, unmount } = renderHook(
      ({ active }) => useFocusTrap({ active, onEscape }),
      { initialProps: { active: false } },
    );

    // Attach container ref before activating
    (
      result.current.containerRef as { current: HTMLDivElement | null }
    ).current = container;

    // Activate the trap - this adds the event listener
    rerender({ active: true });

    // Now unmount
    unmount();

    expect(removeEventListenerSpy).toHaveBeenCalledWith(
      "keydown",
      expect.any(Function),
    );

    removeEventListenerSpy.mockRestore();
  });

  it("should provide focusFirst function", () => {
    const { result } = renderHook(() => useFocusTrap({ active: true }));

    // Attach container ref
    act(() => {
      (
        result.current.containerRef as { current: HTMLDivElement | null }
      ).current = container;
    });

    // Call focusFirst
    act(() => {
      result.current.focusFirst();
    });

    expect(document.activeElement).toBe(button1);
  });

  it("should provide focusLast function", () => {
    const { result } = renderHook(() => useFocusTrap({ active: true }));

    // Attach container ref
    act(() => {
      (
        result.current.containerRef as { current: HTMLDivElement | null }
      ).current = container;
    });

    // Call focusLast
    act(() => {
      result.current.focusLast();
    });

    expect(document.activeElement).toBe(button3);
  });
});
