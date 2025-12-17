/**
 * Three.js Server-Side Polyfills
 *
 * Three.js uses browser APIs that don't exist in Node.js.
 * This module provides polyfills for server-side rendering.
 *
 * Import this BEFORE importing Three.js in any server-side code.
 */

// Polyfill ProgressEvent for Three.js FileLoader
if (typeof globalThis.ProgressEvent === "undefined") {
  (globalThis as Record<string, unknown>).ProgressEvent =
    class ProgressEvent extends Event {
      readonly lengthComputable: boolean;
      readonly loaded: number;
      readonly total: number;

      constructor(type: string, init?: ProgressEventInit) {
        super(type);
        this.lengthComputable = init?.lengthComputable ?? false;
        this.loaded = init?.loaded ?? 0;
        this.total = init?.total ?? 0;
      }
    };
}

// Polyfill FileReader for Three.js GLTFExporter
if (typeof globalThis.FileReader === "undefined") {
  (globalThis as Record<string, unknown>).FileReader =
    class FileReader extends EventTarget {
      result: string | ArrayBuffer | null = null;
      error: Error | null = null;
      readyState: number = 0;
      onload: ((this: FileReader, ev: ProgressEvent) => void) | null = null;
      onerror: ((this: FileReader, ev: ProgressEvent) => void) | null = null;
      onloadend: ((this: FileReader, ev: ProgressEvent) => void) | null = null;

      readAsDataURL(blob: Blob): void {
        this.readyState = 1;
        blob
          .arrayBuffer()
          .then((buffer) => {
            const base64 = Buffer.from(buffer).toString("base64");
            const mimeType = blob.type || "application/octet-stream";
            this.result = `data:${mimeType};base64,${base64}`;
            this.readyState = 2;
            const event = new ProgressEvent("load");
            if (this.onload) this.onload.call(this, event);
            if (this.onloadend) this.onloadend.call(this, event);
          })
          .catch((err) => {
            this.error = err;
            this.readyState = 2;
            const event = new ProgressEvent("error");
            if (this.onerror) this.onerror.call(this, event);
            if (this.onloadend) this.onloadend.call(this, event);
          });
      }

      readAsArrayBuffer(blob: Blob): void {
        this.readyState = 1;
        blob
          .arrayBuffer()
          .then((buffer) => {
            this.result = buffer;
            this.readyState = 2;
            const event = new ProgressEvent("load");
            if (this.onload) this.onload.call(this, event);
            if (this.onloadend) this.onloadend.call(this, event);
          })
          .catch((err) => {
            this.error = err;
            this.readyState = 2;
            const event = new ProgressEvent("error");
            if (this.onerror) this.onerror.call(this, event);
            if (this.onloadend) this.onloadend.call(this, event);
          });
      }

      abort(): void {
        this.readyState = 0;
      }
    };
}

// Polyfill self for web workers compatibility
if (typeof globalThis.self === "undefined") {
  (globalThis as Record<string, unknown>).self = globalThis;
}

// Export a no-op to force module execution
export function ensureThreePolyfills(): void {
  // This function exists just to ensure the polyfills are loaded
  // when this module is imported
}
