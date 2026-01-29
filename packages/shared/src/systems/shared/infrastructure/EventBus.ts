/**
 * Event Bus System
 *
 * Type-safe event bus for inter-system communication.
 * Provides subscription management, event history, and request-response patterns.
 *
 * Features:
 * - Type-safe event emission and subscription
 * - Automatic subscription cleanup
 * - Event history for debugging
 * - Request-response pattern with timeout
 * - Active subscription tracking
 */

import EventEmitter from "eventemitter3";
import { AnyEvent, EventPayloads, EventType } from "../../../types/events";
import type {
  SystemEvent,
  EventHandler,
  EventSubscription,
} from "../../../types/events";

// Types moved to shared event-system.ts

/**
 * Type-safe event bus for world-wide event communication
 */
export class EventBus extends EventEmitter {
  private subscriptionCounter = 0;
  private activeSubscriptions = new Map<string, EventSubscription>();
  private eventHistory: SystemEvent<AnyEvent>[] = [];
  private readonly maxHistorySize = 1000;

  /**
   * Track pending async handlers for graceful shutdown
   * Allows waiting for all async operations to complete before shutdown
   */
  private pendingAsyncHandlers: Set<Promise<unknown>> = new Set();

  /**
   * Emit a typed event
   */
  emitEvent<T extends AnyEvent>(
    type: EventType | string,
    data: T,
    source: string = "unknown",
  ): void {
    const event: SystemEvent<T> = {
      type: type as EventType,
      data,
      source,
      timestamp: Date.now(),
      id: `${source}-${type}-${++this.subscriptionCounter}`,
    };

    // Add to history for debugging
    this.eventHistory.push(event);
    if (this.eventHistory.length > this.maxHistorySize) {
      this.eventHistory.shift();
    }

    // Emit the event
    this.emit(type, event);
  }

  /**
   * Subscribe to typed events with automatic cleanup
   */
  subscribe<K extends keyof EventPayloads>(
    type: K,
    handler: EventHandler<EventPayloads[K]>,
    once?: boolean,
  ): EventSubscription;
  subscribe<T extends AnyEvent>(
    type: string,
    handler: EventHandler<T>,
    once?: boolean,
  ): EventSubscription;
  subscribe(
    type: string | keyof EventPayloads,
    handler: EventHandler<AnyEvent | EventPayloads[keyof EventPayloads]>,
    once: boolean = false,
  ): EventSubscription {
    const subscriptionId = `sub-${++this.subscriptionCounter}`;
    let active = true;

    const wrappedHandler = (
      event: SystemEvent<AnyEvent | EventPayloads[keyof EventPayloads]>,
    ) => {
      if (!active) return;

      const result = handler(event);

      // Handle async handlers - track for graceful shutdown
      if (result instanceof Promise) {
        this.pendingAsyncHandlers.add(result);
        result
          .catch((err) => {
            // Log error but don't crash - handlers should handle their own errors
            console.error("[EventBus] Async handler error:", err);
          })
          .finally(() => {
            this.pendingAsyncHandlers.delete(result);
          });
      }

      if (once) {
        subscription.unsubscribe();
      }
    };

    // Register the handler
    if (once) {
      this.once(type, wrappedHandler);
    } else {
      this.on(type, wrappedHandler);
    }

    const subscription: EventSubscription = {
      unsubscribe: () => {
        if (!active) return;
        active = false;
        this.off(type, wrappedHandler);
        this.activeSubscriptions.delete(subscriptionId);
      },
      get active() {
        return active;
      },
    };

    this.activeSubscriptions.set(subscriptionId, subscription);
    return subscription;
  }

  /**
   * Subscribe to an event only once
   */
  subscribeOnce<K extends keyof EventPayloads>(
    type: K,
    handler: EventHandler<EventPayloads[K]>,
  ): EventSubscription;
  subscribeOnce<T extends AnyEvent>(
    type: string,
    handler: EventHandler<T>,
  ): EventSubscription;
  subscribeOnce(
    type: string | keyof EventPayloads,
    handler: EventHandler<AnyEvent | EventPayloads[keyof EventPayloads]>,
  ): EventSubscription {
    return this.subscribe(
      type as string,
      handler as EventHandler<AnyEvent>,
      true,
    );
  }

  /**
   * Request-response pattern with timeout
   */
  async request<
    TRequest extends AnyEvent = AnyEvent,
    TResponse extends AnyEvent = AnyEvent,
  >(
    requestType: string,
    data: TRequest,
    source: string,
    timeout: number = 5000,
  ): Promise<TResponse> {
    return new Promise((resolve, reject) => {
      const responseType = `${requestType}:response`;
      const requestId = `req-${++this.subscriptionCounter}`;

      const timeoutHandle = setTimeout(() => {
        subscription.unsubscribe();
        reject(
          new Error(`Request ${requestType} timed out after ${timeout}ms`),
        );
      }, timeout);

      const subscription = this.subscribeOnce<TResponse>(
        responseType,
        (event) => {
          clearTimeout(timeoutHandle);
          resolve(event.data);
        },
      );

      // Emit the request with response info
      this.emitEvent(
        requestType as EventType,
        {
          ...data,
          _requestId: requestId,
          _responseType: responseType,
        } as TRequest,
        source,
      );
    });
  }

  /**
   * Respond to a request
   */
  respond<T extends AnyEvent>(
    originalEvent: SystemEvent<{ _responseType?: string; _requestId?: string }>,
    responseData: T,
    source: string,
  ): void {
    if (!originalEvent.data._responseType || !originalEvent.data._requestId) {
      console.warn(
        "[EventBus] Attempted to respond to non-request event:",
        originalEvent,
      );
      return;
    }

    this.emitEvent(originalEvent.data._responseType, responseData, source);
  }

  /**
   * Get event history for debugging
   */
  getEventHistory(filterByType?: string): SystemEvent[] {
    if (filterByType) {
      return this.eventHistory.filter((event) => event.type === filterByType);
    }
    return [...this.eventHistory];
  }

  /**
   * Get active subscription count
   */
  getActiveSubscriptionCount(): number {
    return this.activeSubscriptions.size;
  }

  /**
   * Wait for all pending async handlers to complete
   *
   * Call this during graceful shutdown to ensure all async operations
   * (like database saves) complete before shutting down.
   *
   * @param timeout - Maximum time to wait in ms (default: 5000)
   * @returns Promise that resolves when all handlers complete or timeout
   */
  async waitForPendingHandlers(timeout: number = 5000): Promise<void> {
    if (this.pendingAsyncHandlers.size === 0) {
      return;
    }

    const pending = Array.from(this.pendingAsyncHandlers);
    console.log(
      `[EventBus] Waiting for ${pending.length} pending async handlers...`,
    );

    // Race between waiting for all handlers and timeout
    await Promise.race([
      Promise.allSettled(pending),
      new Promise<void>((resolve) => setTimeout(resolve, timeout)),
    ]);

    if (this.pendingAsyncHandlers.size > 0) {
      console.warn(
        `[EventBus] ${this.pendingAsyncHandlers.size} handlers still pending after timeout`,
      );
    }
  }

  /**
   * Get count of pending async handlers (for debugging/monitoring)
   */
  getPendingHandlerCount(): number {
    return this.pendingAsyncHandlers.size;
  }

  /**
   * Cleanup all subscriptions
   */
  cleanup(): void {
    this.activeSubscriptions.forEach((subscription) => {
      subscription.unsubscribe();
    });
    this.activeSubscriptions.clear();
    this.eventHistory.length = 0;
    this.pendingAsyncHandlers.clear();
    this.removeAllListeners();
  }
}

export type { SystemEvent, EventHandler, EventSubscription };
