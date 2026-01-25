import { afterEach, vi } from "vitest";

// Mock window dimensions
vi.stubGlobal("window", {
  ...globalThis.window,
  innerWidth: 1920,
  innerHeight: 1080,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
});

// Reset document between tests
afterEach(() => {
  document.body.innerHTML = "";
});
