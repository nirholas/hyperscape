/**
 * React 19 Utilities
 *
 * Modern React 19 patterns for hs-kit components.
 * Provides utilities for:
 * - Concurrent rendering with startTransition
 * - Optimistic updates with useOptimistic
 * - Async data loading patterns
 * - Deferred updates for non-urgent UI changes
 *
 * @packageDocumentation
 */

import {
  startTransition,
  useTransition,
  useDeferredValue,
  useCallback,
  useState,
  useSyncExternalStore,
  useRef,
  useEffect,
} from "react";

// ============================================================================
// Transition Utilities
// ============================================================================

/**
 * Wrap a state update in startTransition for non-urgent updates
 *
 * Use this for:
 * - Large list re-renders
 * - Complex filtering/sorting
 * - Search queries
 *
 * @example
 * ```tsx
 * const [items, setItems] = useState([]);
 *
 * const handleSearch = (query: string) => {
 *   transitionUpdate(() => setItems(filterItems(query)));
 * };
 * ```
 */
export function transitionUpdate(callback: () => void): void {
  startTransition(callback);
}

/**
 * Hook for managing transition state with isPending indicator
 *
 * @example
 * ```tsx
 * const { isPending, startTransition } = useTransitionState();
 *
 * return (
 *   <div>
 *     <input onChange={(e) => startTransition(() => setQuery(e.target.value))} />
 *     {isPending && <Spinner />}
 *   </div>
 * );
 * ```
 */
export function useTransitionState(): {
  isPending: boolean;
  startTransition: typeof startTransition;
} {
  const [isPending, startTransitionInternal] = useTransition();

  const startTransitionWrapped = useCallback(
    (callback: () => void) => {
      startTransitionInternal(callback);
    },
    [startTransitionInternal],
  );

  return {
    isPending,
    startTransition: startTransitionWrapped as typeof startTransition,
  };
}

// ============================================================================
// Deferred Values
// ============================================================================

/**
 * Hook for deferring expensive computations
 *
 * @example
 * ```tsx
 * function SearchResults({ query }: { query: string }) {
 *   const deferredQuery = useDeferredSearch(query);
 *
 *   // Results will update with lower priority, keeping UI responsive
 *   const results = useMemo(() => search(deferredQuery), [deferredQuery]);
 *
 *   return <ResultsList results={results} />;
 * }
 * ```
 */
export function useDeferredSearch<T>(value: T): T {
  return useDeferredValue(value);
}

/**
 * Hook for deferring list updates
 *
 * Useful for large lists where filtering/sorting is expensive
 */
export function useDeferredList<T>(items: T[]): T[] {
  return useDeferredValue(items);
}

// ============================================================================
// Optimistic Updates
// ============================================================================

/**
 * Simple optimistic state hook
 *
 * For React 19's useOptimistic pattern without the experimental API.
 * Provides optimistic updates that revert on error.
 *
 * @example
 * ```tsx
 * const {
 *   value,
 *   setOptimistic,
 *   revert,
 *   isPending
 * } = useOptimisticState(initialItems);
 *
 * const handleAdd = async (item) => {
 *   setOptimistic([...value, item]);
 *   try {
 *     await saveToServer(item);
 *   } catch {
 *     revert();
 *   }
 * };
 * ```
 */
export function useOptimisticState<T>(initialValue: T): {
  value: T;
  setOptimistic: (newValue: T) => void;
  revert: () => void;
  isPending: boolean;
  confirm: () => void;
} {
  const [value, setValue] = useState(initialValue);
  const [optimisticValue, setOptimisticValue] = useState<T | null>(null);
  const [isPending, setIsPending] = useState(false);
  const previousValueRef = useRef(initialValue);

  const setOptimistic = useCallback(
    (newValue: T) => {
      previousValueRef.current = value;
      setOptimisticValue(newValue);
      setIsPending(true);
    },
    [value],
  );

  const revert = useCallback(() => {
    setOptimisticValue(null);
    setValue(previousValueRef.current);
    setIsPending(false);
  }, []);

  const confirm = useCallback(() => {
    if (optimisticValue !== null) {
      setValue(optimisticValue);
    }
    setOptimisticValue(null);
    setIsPending(false);
  }, [optimisticValue]);

  return {
    value: optimisticValue ?? value,
    setOptimistic,
    revert,
    isPending,
    confirm,
  };
}

// ============================================================================
// External Store Utilities
// ============================================================================

/**
 * Create a simple external store with React 19 compatible subscribe pattern
 *
 * @example
 * ```tsx
 * const gameStateStore = createExternalStore<GameState>(initialState);
 *
 * // In component
 * const state = useExternalStore(gameStateStore);
 *
 * // Update from anywhere
 * gameStateStore.setState({ ...newState });
 * ```
 */
export interface ExternalStore<T> {
  getState: () => T;
  setState: (newState: T | ((prev: T) => T)) => void;
  subscribe: (listener: () => void) => () => void;
}

export function createExternalStore<T>(initialState: T): ExternalStore<T> {
  let state = initialState;
  const listeners = new Set<() => void>();

  return {
    getState: () => state,
    setState: (newState: T | ((prev: T) => T)) => {
      const nextState =
        typeof newState === "function"
          ? (newState as (prev: T) => T)(state)
          : newState;
      if (nextState !== state) {
        state = nextState;
        listeners.forEach((listener) => listener());
      }
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/**
 * Hook for consuming an external store
 *
 * Uses React 18/19's useSyncExternalStore for proper concurrent mode support
 */
export function useExternalStore<T>(store: ExternalStore<T>): T {
  return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}

/**
 * Hook for consuming a slice of an external store
 *
 * Only re-renders when the selected slice changes
 */
export function useExternalStoreSelector<T, S>(
  store: ExternalStore<T>,
  selector: (state: T) => S,
): S {
  return useSyncExternalStore(
    store.subscribe,
    () => selector(store.getState()),
    () => selector(store.getState()),
  );
}

// ============================================================================
// Batched Updates
// ============================================================================

/**
 * Hook for batching multiple state updates
 *
 * React 18+ automatically batches updates, but this provides an explicit API
 * for grouping related updates with transition support.
 */
export function useBatchedUpdates(): {
  batch: (updates: (() => void)[]) => void;
  batchTransition: (updates: (() => void)[]) => void;
} {
  const batch = useCallback((updates: (() => void)[]) => {
    updates.forEach((update) => update());
  }, []);

  const batchTransition = useCallback((updates: (() => void)[]) => {
    startTransition(() => {
      updates.forEach((update) => update());
    });
  }, []);

  return { batch, batchTransition };
}

// ============================================================================
// Suspense Helpers
// ============================================================================

/**
 * Status for suspense resource
 */
type ResourceStatus = "pending" | "success" | "error";

/**
 * Create a suspense-compatible resource from a promise
 *
 * @example
 * ```tsx
 * const userResource = createResource(fetchUser(userId));
 *
 * function UserProfile() {
 *   const user = userResource.read();
 *   return <div>{user.name}</div>;
 * }
 *
 * // Wrap in Suspense
 * <Suspense fallback={<Loading />}>
 *   <UserProfile />
 * </Suspense>
 * ```
 */
export function createResource<T>(promise: Promise<T>): {
  read: () => T;
  status: ResourceStatus;
} {
  let status: ResourceStatus = "pending";
  let result: T;
  let error: Error;

  const suspender = promise.then(
    (data) => {
      status = "success";
      result = data;
    },
    (err) => {
      status = "error";
      error = err;
    },
  );

  return {
    read() {
      if (status === "pending") {
        throw suspender;
      } else if (status === "error") {
        throw error;
      }
      return result;
    },
    get status() {
      return status;
    },
  };
}

/**
 * Hook for creating a suspense resource that can be reset
 */
export function useSuspenseResource<T>(
  fetcher: () => Promise<T>,
  deps: unknown[] = [],
): {
  read: () => T;
  refresh: () => void;
} {
  const resourceRef = useRef<ReturnType<typeof createResource<T>> | null>(null);
  const [, forceUpdate] = useState({});

  useEffect(() => {
    resourceRef.current = createResource(fetcher());
  }, deps);

  const refresh = useCallback(() => {
    resourceRef.current = createResource(fetcher());
    forceUpdate({});
  }, [fetcher]);

  return {
    read: () => {
      if (!resourceRef.current) {
        resourceRef.current = createResource(fetcher());
      }
      return resourceRef.current.read();
    },
    refresh,
  };
}

// ============================================================================
// Export all utilities
// ============================================================================

export { startTransition, useTransition, useDeferredValue } from "react";
