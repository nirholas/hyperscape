/**
 * Direct script loader for PhysX
 * This loads PhysX by directly injecting the script tag
 */

import type PhysX from "@hyperscape/physx-js-webidl";
import type { PhysXModule } from "../types/systems/physics";

type PhysXInitOptions = Parameters<typeof PhysX>[0];
interface PhysXWindow extends Window {
  PhysX?: typeof PhysX;
}

export async function loadPhysXScript(
  options?: PhysXInitOptions,
): Promise<PhysXModule> {
  // Check if PhysX is already loaded
  const w = window as PhysXWindow;
  if (w.PhysX) {
    return w.PhysX!(options);
  }

  return new Promise((resolve, reject) => {
    // Check again in case it was loaded while we were waiting
    if (w.PhysX) {
      w.PhysX!(options).then(resolve).catch(reject);
      return;
    }

    // Compute CDN URL for WASM location
    const windowWithCdn = window as Window & { __CDN_URL?: string };
    const cdnUrl =
      windowWithCdn.__CDN_URL ||
      (window.location.hostname === "localhost"
        ? window.location.origin
        : "http://localhost:8080");

    // Set up Module configuration BEFORE loading the script
    // This ensures locateFile is available when Emscripten looks for the WASM
    const windowWithModule = window as Window & {
      Module?: Record<string, unknown>;
    };
    if (!windowWithModule.Module) {
      windowWithModule.Module = {};
    }
    windowWithModule.Module.locateFile = (wasmFileName: string) => {
      if (wasmFileName.endsWith(".wasm")) {
        const url = `${cdnUrl}/web/${wasmFileName}?v=1.0.0`;
        console.log(
          `[physx-script-loader] locateFile called for ${wasmFileName}, returning: ${url}`,
        );
        return url;
      }
      return wasmFileName;
    };

    const script = document.createElement("script");
    // Use static version for cache key - only change this when PhysX binary is updated
    // This allows browser caching between page loads while still allowing forced refresh when needed
    const scriptUrl = `${cdnUrl}/web/physx-js-webidl.js?v=1.0.0`;

    console.log("[physx-script-loader] Loading PhysX from:", scriptUrl);
    console.log("[physx-script-loader] CDN URL:", cdnUrl);
    console.log("[physx-script-loader] Options:", options);

    script.src = scriptUrl;
    script.async = true;

    script.onload = () => {
      console.log(
        "[physx-script-loader] Script loaded, checking PhysX global...",
      );
      // Give it a moment to initialize
      setTimeout(() => {
        const w2 = window as PhysXWindow;
        if (w2.PhysX) {
          console.log(
            "[physx-script-loader] PhysX global found, initializing WASM...",
          );
          const PhysXFn = w2.PhysX!;
          // Merge our locateFile with any options passed in
          const mergedOptions = {
            ...options,
            locateFile: (file: string) => {
              if (file.endsWith(".wasm")) {
                const url = `${cdnUrl}/web/${file}?v=1.0.0`;
                console.log(
                  `[physx-script-loader] PhysXFn locateFile called for ${file}, returning: ${url}`,
                );
                return url;
              }
              return file;
            },
          };
          PhysXFn(mergedOptions)
            .then((physx) => {
              console.log(
                "[physx-script-loader] PhysX WASM initialized successfully",
              );
              resolve(physx);
            })
            .catch((error) => {
              console.error(
                "[physx-script-loader] PhysX initialization failed:",
                error,
              );
              reject(error);
            });
        } else {
          console.error(
            "[physx-script-loader] PhysX function not found after script load",
          );
          reject(
            new Error("PhysX global function not found after script load"),
          );
        }
      }, 100);
    };

    script.onerror = (error) => {
      console.error(
        "[physx-script-loader] Failed to load PhysX script:",
        error,
      );
      reject(new Error("Failed to load PhysX script"));
    };

    document.head.appendChild(script);
  });
}

export default loadPhysXScript;
