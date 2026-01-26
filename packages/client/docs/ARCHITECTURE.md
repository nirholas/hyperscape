# Client Architecture

This document describes the architectural decisions and patterns used in the Hyperscape client.

## Table of Contents

- [Overview](#overview)
- [Optimistic Updates](#optimistic-updates)
- [Server Reconciliation](#server-reconciliation)
- [CAP Theorem Tradeoffs](#cap-theorem-tradeoffs)
- [Network Resilience](#network-resilience)
- [State Management](#state-management)

## Overview

The Hyperscape client is designed for real-time multiplayer gameplay with:
- Low-latency input response (optimistic updates)
- Server authority (no client-side cheating)
- Graceful degradation (offline resilience)
- Consistent state (eventual consistency)

## Optimistic Updates

### What Are Optimistic Updates?

Optimistic updates show the result of an action immediately, before the server confirms it. This provides instant feedback for a responsive feel.

### Implementation Pattern

```typescript
// 1. Update UI immediately (optimistic)
const previousState = getState();
setState(newState);

// 2. Send request to server
const result = await api.updateState(newState);

// 3. Handle server response
if (result.error) {
  // Rollback on failure
  setState(previousState);
  showError(result.error);
} else {
  // Apply authoritative state
  setState(result.data);
}
```

### Where We Use Optimistic Updates

| Feature | Optimistic | Server Authoritative |
|---------|------------|---------------------|
| Player movement | ✅ Position | ✅ Validation |
| Inventory | ✅ UI state | ✅ Actual items |
| Chat | ✅ Show message | ✅ Delivery confirmation |
| Combat | ❌ | ✅ All damage/outcomes |
| Currency | ✅ Display | ✅ Actual balance |

### Combat Is NOT Optimistic

Combat outcomes are never predicted client-side:
- Damage calculations happen on server
- Hit/miss determined by server
- Death/respawn controlled by server
- This prevents combat exploits

## Server Reconciliation

### The Problem

With optimistic updates, client state can diverge from server state:
- Network delays
- Conflicting actions from other players
- Server validation failures

### Reconciliation Strategy

```typescript
// Server sends authoritative state periodically
world.on("state:sync", (serverState) => {
  // Compare with local state
  const localState = getState();
  
  if (hasConflict(localState, serverState)) {
    // Server wins - apply corrections
    applyCorrections(serverState);
    
    // Replay unconfirmed local actions
    replayPendingActions();
  }
});
```

### Conflict Resolution Rules

1. **Server is always right** - Server state is authoritative
2. **Preserve player intent** - Re-apply pending actions when possible
3. **Smooth corrections** - Interpolate position corrections
4. **Log conflicts** - Track for debugging

## CAP Theorem Tradeoffs

### Background

The CAP theorem states that distributed systems can only guarantee 2 of 3:
- **C**onsistency - All nodes see the same data
- **A**vailability - Every request gets a response
- **P**artition tolerance - System works despite network failures

### Our Choices

For a real-time game, we prioritize:

**Availability + Partition Tolerance** over strict Consistency

### What This Means

| Scenario | Behavior |
|----------|----------|
| Normal operation | Strong consistency, server authoritative |
| Network lag | Client shows optimistic state, reconciles later |
| Disconnection | Limited offline functionality, reconnects when possible |
| Server overload | Client continues with local state, catches up later |

### Consistency Levels by Feature

| Feature | Consistency Level |
|---------|-------------------|
| Player position | Eventual (interpolated) |
| Inventory display | Eventual (optimistic) |
| Bank transactions | Strong (server confirms) |
| Combat outcomes | Strong (server only) |
| Chat messages | Eventual (ordered by server) |
| Currency balance | Strong (server authoritative) |

## Network Resilience

### Connection States

```typescript
enum ConnectionState {
  DISCONNECTED = "disconnected",
  CONNECTING = "connecting",
  CONNECTED = "connected",
  RECONNECTING = "reconnecting",
}
```

### Reconnection Strategy

1. **Exponential backoff** - Avoid overwhelming the server
2. **Max retries** - Eventually notify user to take action
3. **State preservation** - Keep local state during reconnection
4. **Session resumption** - Resume where player left off

### Backoff Configuration

```typescript
const config = {
  initialDelay: 1000,      // 1 second
  maxDelay: 30000,         // 30 seconds max
  multiplier: 2,           // Double each time
  maxRetries: 10,          // Give up after 10 attempts
};
```

### Offline Capabilities

During disconnection:
- UI remains responsive
- Settings can be changed (saved locally)
- Map can be explored (cached data)
- Chat queues messages for later delivery

## State Management

### Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     React Components                      │
├─────────────────────────────────────────────────────────┤
│  Zustand Stores   │  React Context   │  Local State      │
├─────────────────────────────────────────────────────────┤
│                   Hyperscape World                        │
├─────────────────────────────────────────────────────────┤
│  Network Layer   │   ECS Systems   │   Three.js Scene    │
└─────────────────────────────────────────────────────────┘
```

### State Ownership

| State Type | Owner | Persistence |
|------------|-------|-------------|
| Game world | Hyperscape ECS | Server |
| UI panels | Zustand stores | Session |
| Settings | Zustand + localStorage | Permanent |
| Auth | Privy SDK | Secure storage |
| Theme | Zustand + localStorage | Permanent |

### Store Patterns

```typescript
// Feature store pattern
const useFeatureStore = create<FeatureState>((set, get) => ({
  // State
  data: initialData,
  isLoading: false,
  
  // Selectors
  getItem: (id) => get().data.find(d => d.id === id),
  
  // Actions
  setData: (data) => set({ data }),
  fetchData: async () => {
    set({ isLoading: true });
    const data = await api.fetchData();
    set({ data, isLoading: false });
  },
}));
```

### Performance Considerations

- Use selectors to prevent unnecessary re-renders
- Separate frequently-updated state from stable state
- Batch related state updates
- Use refs for values that don't need re-renders

## Data Flow

### Inbound (Server → Client)

```
Server Message
    ↓
Network Layer (deserialize)
    ↓
World Event System
    ↓
ECS Systems (update entities)
    ↓
React Stores (update UI state)
    ↓
React Components (re-render)
```

### Outbound (Client → Server)

```
User Action
    ↓
React Handler
    ↓
Optimistic Update (if applicable)
    ↓
Network Layer (serialize)
    ↓
Server
    ↓
Server Response
    ↓
Reconciliation (if needed)
```

## Best Practices

### DO

- Use server-authoritative state for game logic
- Apply optimistic updates for UI responsiveness
- Handle network failures gracefully
- Log state conflicts for debugging
- Use TypeScript for type safety

### DON'T

- Trust client-side calculations for important outcomes
- Block UI on server responses (use optimistic updates)
- Store sensitive data in localStorage
- Assume network is always available
- Ignore reconciliation edge cases

## References

- [CAP Theorem Explained](https://en.wikipedia.org/wiki/CAP_theorem)
- [Optimistic UI Patterns](https://www.apollographql.com/docs/react/performance/optimistic-ui/)
- [Real-time Game Networking](https://gafferongames.com/post/what_every_programmer_needs_to_know_about_game_networking/)
