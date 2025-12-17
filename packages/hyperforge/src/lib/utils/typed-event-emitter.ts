/**
 * Typed Event Emitter
 * A type-safe event emitter implementation
 */

import { logger } from "./logger";

const log = logger.child("TypedEventEmitter");

export class TypedEventEmitter<Events extends Record<PropertyKey, unknown>> {
  private listeners: { [K in keyof Events]?: Set<(data: Events[K]) => void> } =
    {};

  /**
   * Subscribe to an event
   */
  on<K extends keyof Events>(
    event: K,
    listener: (data: Events[K]) => void,
  ): this {
    const set = this.listeners[event];
    if (set) {
      set.add(listener);
    } else {
      this.listeners[event] = new Set([listener]);
    }
    return this;
  }

  /**
   * Alias for on()
   */
  addListener<K extends keyof Events>(
    event: K,
    listener: (data: Events[K]) => void,
  ): this {
    return this.on(event, listener);
  }

  /**
   * Unsubscribe from an event
   */
  off<K extends keyof Events>(
    event: K,
    listener: (data: Events[K]) => void,
  ): this {
    const set = this.listeners[event];
    if (set) {
      set.delete(listener);
    }
    return this;
  }

  /**
   * Alias for off()
   */
  removeListener<K extends keyof Events>(
    event: K,
    listener: (data: Events[K]) => void,
  ): this {
    return this.off(event, listener);
  }

  /**
   * Subscribe to an event once
   */
  once<K extends keyof Events>(
    event: K,
    listener: (data: Events[K]) => void,
  ): this {
    const wrapper = (data: Events[K]) => {
      this.off(event, wrapper);
      listener(data);
    };
    this.on(event, wrapper);
    return this;
  }

  /**
   * Emit an event
   */
  emit<K extends keyof Events>(event: K, data: Events[K]): boolean {
    const set = this.listeners[event];
    if (!set || set.size === 0) return false;
    for (const fn of Array.from(set)) {
      try {
        fn(data);
      } catch (e) {
        log.error(
          { event: String(event), error: e },
          `Error in event listener for '${String(event)}'`,
        );
      }
    }
    return true;
  }

  /**
   * Remove all listeners for an event (or all events if no event specified)
   */
  removeAllListeners<K extends keyof Events>(event?: K): this {
    if (event !== undefined) {
      delete this.listeners[event];
    } else {
      this.listeners = {};
    }
    return this;
  }

  /**
   * Get the number of listeners for an event
   */
  listenerCount<K extends keyof Events>(event: K): number {
    return this.listeners[event]?.size ?? 0;
  }

  /**
   * Get all event names that have listeners
   */
  eventNames(): (keyof Events)[] {
    return Object.keys(this.listeners) as (keyof Events)[];
  }
}
