/**
 * Buffer polyfill shim for esbuild inject
 * This file is injected by esbuild during dependency optimization to ensure
 * Buffer is available globally before any library tries to use it.
 */
import { Buffer } from "buffer";

// Set Buffer on globalThis for Node.js-style access
if (typeof globalThis !== "undefined" && !globalThis.Buffer) {
  globalThis.Buffer = Buffer;
}

// Also set on window for browser environments
if (typeof window !== "undefined" && !window.Buffer) {
  window.Buffer = Buffer;
}

export { Buffer };
