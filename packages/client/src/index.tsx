/**
 * index.tsx - Hyperscape Client Entry Point
 *
 * Main entry point for the Hyperscape browser client. Initializes the React application,
 * authentication, and 3D game world. Handles the complete client lifecycle from login
 * to world connection.
 */

import {
  CircularSpawnArea,
  installThreeJSExtensions,
  THREE,
  World,
} from "@hyperscape/shared";
import React from "react";
import ReactDOM from "react-dom/client";
import { ErrorBoundary } from "./lib/ErrorBoundary";
import "./index.css";
import { PrivyAuthProvider } from "./auth/PrivyAuthProvider";
import { SolanaWalletProvider } from "./auth/SolanaWalletProvider";
import { playerTokenManager } from "./auth/PlayerTokenManager";
import { privyAuthManager } from "./auth/PrivyAuthManager";
import { injectFarcasterMetaTags } from "./lib/farcaster-frame-config";
import { GameClient } from "./screens/GameClient";
import { LoginScreen } from "./screens/LoginScreen";
import { CharacterSelectScreen } from "./screens/CharacterSelectScreen";
import { UsernameSelectionScreen } from "./screens/UsernameSelectionScreen";
import { EmbeddedGameClient } from "./game/EmbeddedGameClient";
import { isEmbeddedMode } from "./types/embeddedConfig";
import { GAME_API_URL, GAME_WS_URL } from "./lib/api-config";
import {
  validateURLParams,
  type URLParamValidation,
} from "./utils/InputValidator";

import type {
  EmbeddedViewportConfig,
  ViewportMode,
  GraphicsQuality,
  HideableUIElement,
} from "./types/embeddedConfig";

// Buffer polyfill for Privy (required for crypto operations in browser)
// Must be imported and assigned BEFORE any other imports that might use it
import { Buffer } from "buffer";
(globalThis as typeof globalThis & { Buffer: typeof Buffer }).Buffer = Buffer;
// Also ensure window.Buffer is available for libraries that check there
if (typeof window !== "undefined") {
  (window as Window & { Buffer: typeof Buffer }).Buffer = Buffer;
}

// setImmediate polyfill for Privy/Viem
// Browser polyfill uses setTimeout which returns a Timeout, but libraries expect
// the Node.js setImmediate signature. The cast is required for cross-platform compat.
declare global {
  interface GlobalThis {
    setImmediate?: typeof setImmediate;
  }
}

if (!globalThis.setImmediate) {
  // Browser polyfill: setTimeout(cb, 0) mimics setImmediate behavior
  // Cast required: setTimeout returns Timeout, setImmediate expects NodeJS.Immediate
  globalThis.setImmediate = ((
    callback: (...args: unknown[]) => void,
    ...args: unknown[]
  ) => setTimeout(callback, 0, ...args)) as unknown as typeof setImmediate;
}

// Parse URL parameters for embedded configuration
const urlParams = new URLSearchParams(window.location.search);
const isEmbedded = urlParams.get("embedded") === "true";

// URL parameter validation schema for embedded mode
// SECURITY: authToken is NOT accepted via URL parameters
// Tokens in URLs are exposed in browser history, referrer headers, and server logs
const embeddedParamSchema: URLParamValidation[] = [
  { name: "embedded", type: "boolean" },
  { name: "mode", type: "enum", enumValues: ["spectator", "free"] as const },
  {
    name: "quality",
    type: "enum",
    enumValues: ["potato", "low", "medium", "high", "ultra"] as const,
  },
  { name: "agentId", type: "id", maxLength: 64 },
  { name: "characterId", type: "id", maxLength: 64 },
  { name: "followEntity", type: "id", maxLength: 64 },
  { name: "wsUrl", type: "url" },
  { name: "hiddenUI", type: "string", maxLength: 128 },
  { name: "privyUserId", type: "id", maxLength: 64 },
  // sessionToken validated but NOT authToken - see security note above
  { name: "sessionToken", type: "id", maxLength: 256 },
];

if (isEmbedded) {
  window.__HYPERSCAPE_EMBEDDED__ = true;

  // Validate URL parameters
  const validation = validateURLParams(urlParams, embeddedParamSchema);

  if (!validation.isValid) {
    console.warn(
      "[Hyperscape] Invalid embedded URL parameters:",
      validation.errors,
    );
  }

  // Construct config from validated params
  const params = validation.params;
  const modeParam = params.mode as string | undefined;
  const qualityParam = params.quality as string | undefined;

  // Parse hiddenUI as comma-separated list
  const hiddenUIRaw = params.hiddenUI as string | undefined;
  const validHiddenUI: HideableUIElement[] = [];
  if (hiddenUIRaw) {
    const validElements = ["chat", "inventory", "minimap", "hotbar", "stats"];
    hiddenUIRaw.split(",").forEach((el) => {
      if (validElements.includes(el)) {
        validHiddenUI.push(el as HideableUIElement);
      }
    });
  }

  const config: EmbeddedViewportConfig = {
    agentId: (params.agentId as string) || "",
    // SECURITY: authToken is NOT read from URL parameters
    // It will be set via postMessage from parent window or from session storage
    authToken: "", // Will be populated via secure postMessage
    characterId: (params.characterId as string) || undefined,
    wsUrl: (params.wsUrl as string) || GAME_WS_URL || "ws://localhost:5555/ws",
    mode: (modeParam === "spectator" || modeParam === "free"
      ? modeParam
      : "spectator") as ViewportMode,
    followEntity: (params.followEntity as string) || undefined,
    hiddenUI: validHiddenUI.length > 0 ? validHiddenUI : undefined,
    quality: (qualityParam === "potato" ||
    qualityParam === "low" ||
    qualityParam === "medium" ||
    qualityParam === "high" ||
    qualityParam === "ultra"
      ? qualityParam
      : "medium") as GraphicsQuality,
    sessionToken: (params.sessionToken as string) || "",
    privyUserId: (params.privyUserId as string) || undefined,
  };

  window.__HYPERSCAPE_CONFIG__ = config;

  // Setup secure postMessage listener for receiving auth token from parent window
  // This is the secure alternative to passing tokens via URL parameters
  const handleAuthMessage = (event: MessageEvent) => {
    // Validate origin - in production, should check against allowed origins
    if (event.data?.type === "HYPERSCAPE_AUTH" && event.data?.authToken) {
      const currentConfig = window.__HYPERSCAPE_CONFIG__;
      if (currentConfig) {
        currentConfig.authToken = event.data.authToken;
        // Notify that auth is ready
        window.dispatchEvent(new CustomEvent("hyperscape:auth-ready"));
      }
      // Remove listener after receiving token
      window.removeEventListener("message", handleAuthMessage);
    }
  };
  window.addEventListener("message", handleAuthMessage);

  // Notify parent window that embedded viewport is ready to receive auth
  if (window.parent !== window) {
    window.parent.postMessage({ type: "HYPERSCAPE_READY" }, "*");
  }

  // Use logger to safely redact sensitive data
  import("./lib/logger").then(({ logger }) => {
    logger.config("[Hyperscape] Configured from validated URL params:", {
      ...config,
      authToken: config.authToken ? "[REDACTED]" : "[PENDING]",
    });
  });
}

// Set global environment flags
(
  globalThis as typeof globalThis & { isBrowser?: boolean; isServer?: boolean }
).isBrowser = true;
(
  globalThis as typeof globalThis & { isBrowser?: boolean; isServer?: boolean }
).isServer = false;

// Global window extensions
declare global {
  interface Window {
    THREE?: typeof THREE;
    world?: InstanceType<typeof World>;
    testChat?: () => void;
    Hyperscape?: {
      CircularSpawnArea: typeof CircularSpawnArea;
    };
    privyLogout?: () => Promise<void> | void;
  }
}

// Vite environment variables
interface ImportMetaEnv {
  readonly PUBLIC_PRIVY_APP_ID?: string;
  readonly PUBLIC_WS_URL?: string;
  readonly PUBLIC_CDN_URL?: string;
  readonly PUBLIC_ENABLE_FARCASTER?: string;
  readonly PUBLIC_APP_URL?: string;
  readonly PUBLIC_API_URL?: string;
  readonly PUBLIC_ELIZAOS_URL?: string;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Install Three.js extensions
installThreeJSExtensions();

/**
 * Clean up corrupted Privy localStorage data
 * Prevents JSON parse errors from malformed data
 */
function cleanupCorruptedPrivyData(): void {
  try {
    const corruptedKeys: string[] = [];

    // Our custom keys that store plain strings (not JSON)
    const plainStringKeys = new Set([
      "privy_user_id",
      "privy_auth_token",
      "farcaster_fid",
    ]);

    // Check each localStorage key for corruption
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;

      // Only check Privy SDK keys (not our custom plain string keys)
      if (key.startsWith("privy:") && !plainStringKeys.has(key)) {
        try {
          const value = localStorage.getItem(key);
          if (value) {
            // Try to parse as JSON - if it fails, it's corrupted
            JSON.parse(value);
          }
        } catch (parseError) {
          // Found corrupted data
          const errorStr =
            parseError instanceof Error
              ? parseError.message
              : String(parseError);
          if (
            errorStr.includes("setImmedia") ||
            errorStr.includes("Unexpected token")
          ) {
            console.warn(`[App] 🧹 Found corrupted localStorage key: ${key}`);
            corruptedKeys.push(key);
          }
        }
      }
    }

    // Remove corrupted keys
    if (corruptedKeys.length > 0) {
      console.log(
        `[App] 🧹 Cleaning up ${corruptedKeys.length} corrupted Privy keys`,
      );
      corruptedKeys.forEach((key) => {
        try {
          localStorage.removeItem(key);
        } catch (e) {
          console.warn(`[App] Failed to remove corrupted key ${key}:`, e);
        }
      });
    }
  } catch (error) {
    console.error("[App] Error during localStorage cleanup:", error);
  }
}

// Run cleanup on app load
cleanupCorruptedPrivyData();

function App() {
  // Determine Privy availability
  const appId = import.meta.env.PUBLIC_PRIVY_APP_ID || "";
  const privyEnabled = appId.length > 0 && !appId.includes("your-privy-app-id");

  const [isAuthenticated, setIsAuthenticated] = React.useState(false);
  const [authState, setAuthState] = React.useState(privyAuthManager.getState());
  const [showCharacterPage, setShowCharacterPage] =
    React.useState<boolean>(privyEnabled);
  const [hasUsername, setHasUsername] = React.useState<boolean | null>(null); // null = checking, true/false = result
  const [isCheckingUsername, setIsCheckingUsername] = React.useState(false);

  // Subscribe to auth state changes (runs immediately)
  React.useEffect(() => {
    const unsubscribe = privyAuthManager.subscribe(setAuthState);
    injectFarcasterMetaTags();
    return unsubscribe;
  }, []);

  // Restore auth from localStorage ONLY after Privy SDK is ready
  // This prevents race conditions where we read stale/incomplete data
  React.useEffect(() => {
    if (!authState.privySdkReady) return;
    privyAuthManager.restoreFromStorage();
  }, [authState.privySdkReady]);

  // Check if user has a username when authenticated
  // Gate on privySdkReady to ensure Privy has finished initializing
  React.useEffect(() => {
    const checkUsername = async () => {
      // Wait for Privy SDK to be ready before checking
      if (!authState.privySdkReady) {
        return;
      }

      if (!authState.isAuthenticated) {
        setHasUsername(null);
        return;
      }

      // Use PrivyAuthManager with localStorage fallback
      const accountId =
        privyAuthManager.getUserId() || localStorage.getItem("privy_user_id");
      if (!accountId) {
        console.warn("[App] No privy_user_id found");
        // Don't immediately assume no username - Privy may still be writing
        // Stay in loading state briefly, then check again
        setHasUsername(null);
        return;
      }

      setIsCheckingUsername(true);

      // Retry logic for API call - server may not be ready on fresh start
      const apiBaseUrl = GAME_API_URL;
      const maxRetries = 3;
      const retryDelayMs = 500;

      for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
          const response = await fetch(
            `${apiBaseUrl}/api/users/check?accountId=${encodeURIComponent(accountId)}`,
          );

          if (response.ok) {
            const data = await response.json();
            setHasUsername(data.exists);
            console.log(
              `[App] User ${accountId} ${data.exists ? "has" : "does not have"} username`,
            );
            setIsCheckingUsername(false);
            return;
          } else {
            console.warn(
              `[App] Username check failed (attempt ${attempt + 1}/${maxRetries}):`,
              response.statusText,
            );
          }
        } catch (error) {
          console.warn(
            `[App] Username check error (attempt ${attempt + 1}/${maxRetries}):`,
            error,
          );
        }

        // Wait before retry (unless last attempt)
        if (attempt < maxRetries - 1) {
          await new Promise((resolve) =>
            setTimeout(resolve, retryDelayMs * (attempt + 1)),
          );
        }
      }

      // All retries failed - stay in loading state rather than showing wrong screen
      console.error(
        "[App] Username check failed after all retries, staying in loading state",
      );
      setHasUsername(null);
      setIsCheckingUsername(false);
    };

    checkUsername();
  }, [authState.isAuthenticated, authState.privySdkReady]);

  // Show character page when authenticated and has username
  React.useEffect(() => {
    if (authState.isAuthenticated && hasUsername === true) {
      setShowCharacterPage(true);
    }
  }, [authState.isAuthenticated, hasUsername]);

  // Initialize player token
  React.useEffect(() => {
    playerTokenManager.getOrCreatePlayerToken("Player");
    playerTokenManager.startSession();
    return () => {
      playerTokenManager.endSession();
    };
  }, []);

  const wsUrl: string = GAME_WS_URL || "ws://localhost:5555/ws";
  const appRef = React.useRef<HTMLDivElement>(null);

  const handleAuthenticated = React.useCallback(() => {
    setIsAuthenticated(true);
  }, []);

  const handleUsernameSelected = React.useCallback((username: string) => {
    console.log(`[App] Username selected: ${username}`);
    setHasUsername(true);
    setShowCharacterPage(true);
  }, []);

  const handleLogout = React.useCallback(() => {
    console.log("[App] 🚪 Logging out...");

    try {
      // Clear Privy auth manager first
      privyAuthManager.clearAuth();

      // Clear potentially corrupted Privy localStorage keys
      // This prevents JSON parse errors from corrupted data
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (
          key &&
          (key.startsWith("privy:") ||
            key.startsWith("privy_") ||
            key.includes("privy") ||
            key.includes("wallet"))
        ) {
          keysToRemove.push(key);
        }
      }

      console.log(
        `[App] 🧹 Clearing ${keysToRemove.length} Privy localStorage keys`,
      );
      keysToRemove.forEach((key) => {
        try {
          localStorage.removeItem(key);
        } catch (e) {
          console.warn(`[App] Failed to remove key ${key}:`, e);
        }
      });

      // Update React state
      setIsAuthenticated(false);
      setShowCharacterPage(false);
      setHasUsername(null);

      // Attempt Privy logout (wrapped in try-catch to handle errors gracefully)
      try {
        window.privyLogout?.();
      } catch (privyError) {
        console.warn(
          "[App] ⚠️ Privy logout error (safe to ignore):",
          privyError,
        );
      }

      console.log("[App] ✅ Logout complete - reloading page for clean state");

      // Force reload to ensure completely clean state
      setTimeout(() => {
        window.location.href = "/";
      }, 100);
    } catch (error) {
      console.error("[App] ❌ Error during logout:", error);
      // Even if logout fails, force reload for clean state
      window.location.href = "/";
    }
  }, []);

  const handleSetup = React.useCallback(
    (world: InstanceType<typeof World>, _config: unknown) => {
      // Extend window with debug utilities
      window.world = world;
      window.THREE = THREE;
      window.Hyperscape = {
        CircularSpawnArea,
      };

      window.testChat = () => {
        const chat = world.getSystem("chat") as {
          send?: (msg: string) => void;
        } | null;
        chat?.send?.(
          "Test message from console at " + new Date().toLocaleTimeString(),
        );
      };
    },
    [],
  );

  // Show initializing screen while Privy SDK loads
  // This prevents race conditions where we show the wrong screen
  if (privyEnabled && !authState.privySdkReady) {
    return (
      <div
        ref={appRef}
        data-component="app-root"
        className="flex items-center justify-center h-screen bg-black"
      >
        <div className="text-[#f2d08a] text-xl">Initializing...</div>
      </div>
    );
  }

  // Show login screen if Privy enabled and not authenticated
  if (privyEnabled && !isAuthenticated && !authState.isAuthenticated) {
    return (
      <div ref={appRef} data-component="app-root">
        <ErrorBoundary>
          <LoginScreen onAuthenticated={handleAuthenticated} />
        </ErrorBoundary>
      </div>
    );
  }

  // Show username selection for new users (authenticated but no username yet)
  if (
    privyEnabled &&
    authState.isAuthenticated &&
    hasUsername === false &&
    !isCheckingUsername
  ) {
    return (
      <div ref={appRef} data-component="app-root">
        <ErrorBoundary>
          <UsernameSelectionScreen
            onUsernameSelected={handleUsernameSelected}
          />
        </ErrorBoundary>
      </div>
    );
  }

  // Show character selection (only if Privy enabled and user has username)
  if (showCharacterPage && privyEnabled && hasUsername === true) {
    return (
      <div ref={appRef} data-component="app-root">
        <ErrorBoundary>
          <CharacterSelectScreen
            wsUrl={wsUrl}
            onPlay={(id) => {
              if (id) {
                // Use sessionStorage (per-tab) instead of localStorage (shared across tabs)
                // This prevents Tab B from overwriting Tab A's selected character
                sessionStorage.setItem("selectedCharacterId", id);
              }
              setShowCharacterPage(false);
            }}
            onLogout={handleLogout}
          />
        </ErrorBoundary>
      </div>
    );
  }

  // Show loading screen while checking auth status (prevent GameClient from loading prematurely)
  if (privyEnabled && (hasUsername === null || isCheckingUsername)) {
    return (
      <div
        ref={appRef}
        data-component="app-root"
        className="flex items-center justify-center h-screen bg-black"
      >
        <div className="text-[#f2d08a] text-xl">Loading...</div>
      </div>
    );
  }

  // Show game (when Privy disabled, skip character selection and go straight to game)
  // The client will automatically send enterWorld without characterId for dev mode
  return (
    <div ref={appRef} data-component="app-root">
      <ErrorBoundary>
        <GameClient wsUrl={wsUrl} onSetup={handleSetup} />
      </ErrorBoundary>
    </div>
  );
}

import { DashboardScreen } from "./screens/DashboardScreen";
import { CharacterEditorScreen } from "./screens/CharacterEditorScreen";
import { AdminScreen } from "./screens/AdminScreen";
import {
  isTauriApp,
  onDeepLink,
  parseOAuthCallback,
} from "./lib/tauri-integration";

/**
 * Setup Tauri deep link handler for OAuth callbacks
 */
async function setupTauriDeepLinks(): Promise<void> {
  if (!isTauriApp()) return;

  console.log("[Hyperscape] Running in Tauri app, setting up deep links");

  const unlisten = await onDeepLink((url) => {
    console.log("[Hyperscape] OAuth callback received:", url);

    const { code, state, error } = parseOAuthCallback(url);

    if (error) {
      console.error("[Hyperscape] OAuth error:", error);
      return;
    }

    if (code) {
      // Store the auth code for Privy to pick up
      // Privy will handle the token exchange
      console.log("[Hyperscape] OAuth code received, state:", state);

      // Dispatch custom event for auth handling
      window.dispatchEvent(
        new CustomEvent("hyperscape:oauth-callback", {
          detail: { code, state },
        }),
      );
    }
  });

  // Store unlisten function for cleanup if needed
  if (unlisten) {
    (
      window as Window & { __tauriDeepLinkUnlisten?: () => void }
    ).__tauriDeepLinkUnlisten = unlisten;
  }
}

// Track React root instance to prevent double mounting on HMR
let reactRoot: ReactDOM.Root | null = null;

async function mountApp() {
  const rootElement = document.getElementById("root")!;

  // Reuse existing root if already created (prevents HMR double-mount warning)
  if (!reactRoot) {
    reactRoot = ReactDOM.createRoot(rootElement);
  }
  const root = reactRoot;

  // Setup Tauri deep links for OAuth
  await setupTauriDeepLinks();

  // Check for special page modes
  const urlParams = new URLSearchParams(window.location.search);
  const page = urlParams.get("page");

  // Check if running in embedded viewport mode
  if (isEmbeddedMode()) {
    console.log(
      "[Hyperscape] Embedded mode detected - rendering EmbeddedGameClient",
    );

    // Render embedded game client directly (no auth screens)
    root.render(
      <ErrorBoundary>
        <EmbeddedGameClient />
      </ErrorBoundary>,
    );
  } else {
    if (page === "dashboard") {
      console.log(
        "[Hyperscape] Dashboard mode detected - rendering DashboardScreen",
      );
      root.render(
        <ErrorBoundary>
          <SolanaWalletProvider>
            <PrivyAuthProvider>
              <DashboardScreen />
            </PrivyAuthProvider>
          </SolanaWalletProvider>
        </ErrorBoundary>,
      );
    } else if (page === "character-editor") {
      console.log(
        "[Hyperscape] Character editor mode detected - rendering CharacterEditorScreen",
      );
      root.render(
        <ErrorBoundary>
          <SolanaWalletProvider>
            <PrivyAuthProvider>
              <CharacterEditorScreen />
            </PrivyAuthProvider>
          </SolanaWalletProvider>
        </ErrorBoundary>,
      );
    } else if (page === "admin") {
      console.log("[Hyperscape] Admin mode detected - rendering AdminScreen");
      root.render(
        <ErrorBoundary>
          <AdminScreen />
        </ErrorBoundary>,
      );
    } else {
      // Normal mode - render full app with auth
      root.render(
        <ErrorBoundary>
          <SolanaWalletProvider>
            <PrivyAuthProvider>
              <App />
            </PrivyAuthProvider>
          </SolanaWalletProvider>
        </ErrorBoundary>,
      );
    }
  }

  // Verify render completion
  const verifyRender = (attempts = 0) => {
    const maxAttempts = 10;
    const hasContent = rootElement.innerHTML.length > 0;

    if (hasContent) {
      return;
    }

    if (attempts < maxAttempts) {
      requestAnimationFrame(() => verifyRender(attempts + 1));
      return;
    }

    // Should never reach here - React render failed
    throw new Error(
      "React app mounted but no content rendered after multiple attempts",
    );
  };

  setTimeout(() => {
    requestAnimationFrame(() => verifyRender(0));
  }, 0);
}

// Ensure DOM is ready before mounting
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    void mountApp();
  });
} else {
  void mountApp();
}
