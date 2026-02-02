/**
 * EditorWorldContext.tsx - React Context for EditorWorld
 *
 * Provides the EditorWorld instance to Asset Forge components via React context.
 * Handles world initialization, cleanup, and the animation loop.
 *
 * Usage:
 * ```tsx
 * // In App or page component
 * <EditorWorldProvider viewport={containerRef.current}>
 *   <WorldBuilderUI />
 * </EditorWorldProvider>
 *
 * // In child components
 * const world = useEditorWorld();
 * const terrain = useTerrain();
 * ```
 */

import {
  createEditorWorld,
  EditorWorld,
  type EditorWorldOptions,
  type EditorCameraSystem,
  type EditorSelectionSystem,
  type EditorGizmoSystem,
  type WorldOptions,
} from "@hyperscape/shared";
import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useRef,
  useCallback,
  type ReactNode,
  type RefObject,
} from "react";

/**
 * Context value for EditorWorld
 */
interface EditorWorldContextValue {
  /** The EditorWorld instance (null until initialized) */
  world: EditorWorld | null;

  /** Whether the world is currently initializing */
  isInitializing: boolean;

  /** Whether the world has been initialized */
  isInitialized: boolean;

  /** Any error that occurred during initialization */
  error: Error | null;

  /** Reinitialize the world with new options */
  reinitialize: (options?: Partial<EditorWorldOptions>) => Promise<void>;

  /** Access to editor camera system */
  editorCamera: EditorCameraSystem | null;

  /** Access to editor selection system */
  editorSelection: EditorSelectionSystem | null;

  /** Access to editor gizmo system */
  editorGizmo: EditorGizmoSystem | null;
}

const EditorWorldContext = createContext<EditorWorldContextValue | null>(null);

/**
 * Props for EditorWorldProvider
 */
interface EditorWorldProviderProps {
  /** Child components */
  children: ReactNode;

  /** Viewport element or ref (required) */
  viewport: HTMLElement | RefObject<HTMLElement | null>;

  /** Additional editor world options */
  options?: Omit<EditorWorldOptions, "viewport">;

  /** World initialization options */
  initOptions?: Partial<WorldOptions>;

  /** Callback when world is initialized */
  onInitialized?: (world: EditorWorld) => void;

  /** Callback when world is destroyed */
  onDestroyed?: () => void;

  /** Callback on error */
  onError?: (error: Error) => void;
}

/**
 * EditorWorldProvider - Provides EditorWorld to child components
 *
 * Handles:
 * - World creation and initialization
 * - Animation loop (tick)
 * - Cleanup on unmount
 * - Re-initialization when options change
 */
export function EditorWorldProvider({
  children,
  viewport,
  options = {},
  initOptions = {},
  onInitialized,
  onDestroyed,
  onError,
}: EditorWorldProviderProps): React.ReactElement {
  const [world, setWorld] = useState<EditorWorld | null>(null);
  const [isInitializing, setIsInitializing] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Refs for animation loop
  const animationFrameRef = useRef<number | null>(null);
  const worldRef = useRef<EditorWorld | null>(null);

  // Resolve viewport from ref if necessary
  const resolveViewport = useCallback((): HTMLElement | null => {
    if (viewport instanceof HTMLElement) {
      return viewport;
    }
    return viewport.current;
  }, [viewport]);

  // Initialize world
  const initialize = useCallback(
    async (overrideOptions?: Partial<EditorWorldOptions>) => {
      const viewportElement = resolveViewport();
      if (!viewportElement) {
        console.warn("[EditorWorldProvider] Viewport not available");
        return;
      }

      // Clean up existing world
      if (worldRef.current) {
        if (animationFrameRef.current !== null) {
          cancelAnimationFrame(animationFrameRef.current);
          animationFrameRef.current = null;
        }
        worldRef.current.destroy();
        worldRef.current = null;
        setWorld(null);
        setIsInitialized(false);
      }

      setIsInitializing(true);
      setError(null);

      const mergedOptions: EditorWorldOptions = {
        ...options,
        ...overrideOptions,
        viewport: viewportElement,
      };

      const newWorld = createEditorWorld(mergedOptions);
      worldRef.current = newWorld;

      const fullInitOptions: WorldOptions = {
        assetsUrl: initOptions.assetsUrl ?? "/assets/",
        assetsDir: initOptions.assetsDir ?? "",
        viewport: viewportElement,
        ...initOptions,
      };

      await newWorld.init(fullInitOptions);

      // Store references to editor systems
      newWorld.editorCamera =
        (newWorld.getSystem("editor-camera") as
          | EditorCameraSystem
          | undefined) ?? null;
      newWorld.editorSelection =
        (newWorld.getSystem("editor-selection") as
          | EditorSelectionSystem
          | undefined) ?? null;
      newWorld.editorGizmo =
        (newWorld.getSystem("editor-gizmo") as EditorGizmoSystem | undefined) ??
        null;

      setWorld(newWorld);
      setIsInitializing(false);
      setIsInitialized(true);

      onInitialized?.(newWorld);

      // Start animation loop
      const tick = (time: number) => {
        if (worldRef.current) {
          worldRef.current.tick(time);
          animationFrameRef.current = requestAnimationFrame(tick);
        }
      };
      animationFrameRef.current = requestAnimationFrame(tick);
    },
    [resolveViewport, options, initOptions, onInitialized],
  );

  // Reinitialize is just initialize with optional overrides
  const reinitialize = initialize;

  // Initialize on mount when viewport is available
  useEffect(() => {
    const viewportElement = resolveViewport();
    if (!viewportElement) {
      return;
    }

    initialize().catch((err) => {
      const initError = err instanceof Error ? err : new Error(String(err));
      setError(initError);
      setIsInitializing(false);
      onError?.(initError);
    });

    // Cleanup on unmount
    return () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      if (worldRef.current) {
        worldRef.current.destroy();
        worldRef.current = null;
        onDestroyed?.();
      }
    };
  }, [initialize, resolveViewport, onError, onDestroyed]);

  const contextValue: EditorWorldContextValue = {
    world,
    isInitializing,
    isInitialized,
    error,
    reinitialize,
    editorCamera: world?.editorCamera ?? null,
    editorSelection: world?.editorSelection ?? null,
    editorGizmo: world?.editorGizmo ?? null,
  };

  return (
    <EditorWorldContext.Provider value={contextValue}>
      {children}
    </EditorWorldContext.Provider>
  );
}

/**
 * Hook to access the EditorWorld context
 *
 * @throws Error if used outside EditorWorldProvider
 */
export function useEditorWorldContext(): EditorWorldContextValue {
  const context = useContext(EditorWorldContext);
  if (!context) {
    throw new Error(
      "useEditorWorldContext must be used within EditorWorldProvider",
    );
  }
  return context;
}

/**
 * Hook to access the EditorWorld instance
 *
 * @returns The EditorWorld instance or null if not initialized
 */
export function useEditorWorld(): EditorWorld | null {
  const { world } = useEditorWorldContext();
  return world;
}

/**
 * Hook to access the EditorWorld instance, throwing if not available
 *
 * Use this when you know the world should be initialized
 */
export function useEditorWorldRequired(): EditorWorld {
  const { world } = useEditorWorldContext();
  if (!world) {
    throw new Error("EditorWorld not initialized");
  }
  return world;
}

/**
 * Hook to access the editor camera system
 */
export function useEditorCamera(): EditorCameraSystem | null {
  const { editorCamera } = useEditorWorldContext();
  return editorCamera;
}

/**
 * Hook to access the editor selection system
 */
export function useEditorSelection(): EditorSelectionSystem | null {
  const { editorSelection } = useEditorWorldContext();
  return editorSelection;
}

/**
 * Hook to access the editor gizmo system
 */
export function useEditorGizmo(): EditorGizmoSystem | null {
  const { editorGizmo } = useEditorWorldContext();
  return editorGizmo;
}

/**
 * Hook to access a specific system from the world.
 *
 * Returns the system cast to T, or null if world not initialized or system not found.
 * Note: No runtime validation is performed - the returned system must match T.
 */
export function useWorldSystem<T>(systemKey: string): T | null {
  const world = useEditorWorld();
  if (!world) return null;
  const system = world.getSystem(systemKey);
  // Return the system as T if found, null otherwise
  // This relies on correct system registration - no invented types
  return (system as T | undefined) ?? null;
}

/**
 * Hook to access terrain system.
 * Returns the actual TerrainSystem instance from the world.
 *
 * Available methods include: getHeightAt, getHeightAtPosition, getBiomeAt, etc.
 * See packages/shared/src/types/systems/system-interfaces.ts for full interface.
 */
export function useTerrain() {
  return useWorldSystem<{
    getHeightAt(x: number, z: number): number;
    getHeightAtPosition(x: number, z: number): number;
    getBiomeAt(x: number, z: number): string;
    isPositionWalkable(
      x: number,
      z: number,
    ): { walkable: boolean; reason?: string };
  }>("terrain");
}

/**
 * Hook to access vegetation system.
 * Returns the actual VegetationSystem instance from the world.
 */
export function useVegetation() {
  // VegetationSystem doesn't have a typed interface in system-interfaces.ts
  // Return as unknown and let consumer handle
  return useWorldSystem<{
    setEnabled?(enabled: boolean): void;
    update?(delta: number): void;
  }>("vegetation");
}

/**
 * Hook to access grass system (ProceduralGrassSystem).
 */
export function useGrass() {
  // ProceduralGrassSystem doesn't have a typed interface
  return useWorldSystem<{
    setEnabled?(enabled: boolean): void;
    update?(delta: number): void;
  }>("grass");
}

/**
 * Hook to access town system.
 */
export function useTowns() {
  // TownSystem doesn't have a typed interface in system-interfaces.ts
  return useWorldSystem<{
    towns?: Map<string, unknown>;
    update?(delta: number): void;
  }>("towns");
}

/**
 * Hook to access road system.
 */
export function useRoads() {
  // RoadNetworkSystem doesn't have a typed interface
  return useWorldSystem<{
    roads?: Map<string, unknown>;
    update?(delta: number): void;
  }>("roads");
}

/**
 * Hook to access building rendering system.
 */
export function useBuildings() {
  return useWorldSystem<{
    update?(delta: number): void;
  }>("building-rendering");
}

/**
 * Hook to access environment system.
 */
export function useEnvironment() {
  return useWorldSystem<{
    setTimeOfDay?(hour: number): void;
    update?(delta: number): void;
  }>("environment");
}

// Export context for advanced usage
export { EditorWorldContext };
