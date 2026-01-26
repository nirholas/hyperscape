/**
 * SocialSystem - Client-side friend/social system
 *
 * Manages the client-side state for the social/friend system:
 * - Friends list with online status
 * - Pending friend requests
 * - Ignore list
 *
 * This system caches data received from the server and provides
 * the interface used by UI components like FriendsPanel.
 *
 * **Data Flow**:
 * 1. ClientNetwork receives friendsListSync packet
 * 2. ClientNetwork calls SocialSystem.handleSync()
 * 3. SocialSystem updates local state and emits FRIENDS_UPDATED
 * 4. FriendsPanel uses world.getSystem("social").getFriends()
 *
 * **Usage in UI**:
 * ```typescript
 * const socialSystem = world.getSystem("social") as SocialSystem;
 * const { friends, requests } = socialSystem.getFriends();
 * ```
 *
 * @see packages/shared/src/types/game/social-types.ts for type definitions
 * @see packages/client/src/game/panels/FriendsPanel.tsx for UI implementation
 */

import { System } from "../shared/infrastructure/System";
import type { World } from "../../core/World";
import type { WorldOptions } from "../../types";
import type {
  Friend,
  FriendRequest,
  FriendStatus,
  IgnoredPlayer,
  FriendsListSyncData,
  FriendStatusUpdateData,
} from "../../types/game/social-types";
// Note: We use UI_UPDATE with component: "friends" for friend updates

/**
 * SocialSystem - Client-side friend system
 *
 * Manages cached social data and provides interface for UI components.
 */
export class SocialSystem extends System {
  /** Cached friends map (friendId -> Friend) */
  private friends: Map<string, Friend> = new Map();

  /** Pending incoming friend requests */
  private requests: FriendRequest[] = [];

  /** Cached ignore list (ignoredId -> IgnoredPlayer) */
  private ignoreList: Map<string, IgnoredPlayer> = new Map();

  /** Cached sorted friends array (invalidated on changes) */
  private cachedSortedFriends: Friend[] | null = null;

  /** Pending transaction IDs for optimistic updates */
  private pendingTransactions: Map<
    string,
    { type: string; data: unknown; timestamp: number }
  > = new Map();

  /** Transaction timeout in ms */
  private static readonly TRANSACTION_TIMEOUT = 10000;

  constructor(world: World) {
    super(world);
  }

  /**
   * Initialize the system
   */
  override async init(_options: WorldOptions): Promise<void> {
    await super.init(_options);
    this.clearAllData();
  }

  /**
   * Cleanup on destroy
   */
  override destroy(): void {
    this.clearAllData();
    super.destroy();
  }

  /**
   * Clear all cached data
   */
  private clearAllData(): void {
    this.friends.clear();
    this.requests = [];
    this.ignoreList.clear();
    this.cachedSortedFriends = null;
    this.pendingTransactions.clear();
  }

  /**
   * Invalidate the sorted friends cache
   */
  private invalidateCache(): void {
    this.cachedSortedFriends = null;
  }

  // ==========================================================================
  // PUBLIC API (used by UI components)
  // ==========================================================================

  /**
   * Get friends list and pending requests
   *
   * This is the main interface used by FriendsPanel.tsx.
   * Returns friends sorted by status (online first) and name.
   * Uses cached sorted array to avoid allocations on repeated calls.
   *
   * @returns Object with friends array and requests array
   */
  getFriends(): { friends: Friend[]; requests: FriendRequest[] } {
    // Use cached array if available
    if (this.cachedSortedFriends === null) {
      // Convert map to sorted array
      const friendsArray = Array.from(this.friends.values());

      // Sort: online first, then alphabetically by name
      const statusOrder: Record<FriendStatus, number> = {
        online: 0,
        away: 1,
        busy: 2,
        offline: 3,
      };

      friendsArray.sort((a, b) => {
        const statusDiff = statusOrder[a.status] - statusOrder[b.status];
        if (statusDiff !== 0) return statusDiff;
        return a.name.localeCompare(b.name);
      });

      this.cachedSortedFriends = friendsArray;
    }

    return {
      friends: this.cachedSortedFriends,
      requests: [...this.requests],
    };
  }

  /**
   * Get ignore list
   *
   * @returns Array of ignored players
   */
  getIgnoreList(): IgnoredPlayer[] {
    return Array.from(this.ignoreList.values());
  }

  /**
   * Get online friend count
   *
   * @returns Number of friends currently online
   */
  getOnlineFriendCount(): number {
    let count = 0;
    for (const friend of this.friends.values()) {
      if (friend.status !== "offline") {
        count++;
      }
    }
    return count;
  }

  /**
   * Get total friend count
   *
   * @returns Total number of friends
   */
  getFriendCount(): number {
    return this.friends.size;
  }

  /**
   * Get pending request count
   *
   * @returns Number of pending friend requests
   */
  getRequestCount(): number {
    return this.requests.length;
  }

  /**
   * Check if a player is a friend
   *
   * @param playerId - Player ID to check
   * @returns True if the player is a friend
   */
  isFriend(playerId: string): boolean {
    return this.friends.has(playerId);
  }

  /**
   * Check if a player is on the ignore list
   *
   * @param playerId - Player ID to check
   * @returns True if the player is ignored
   */
  isIgnored(playerId: string): boolean {
    return this.ignoreList.has(playerId);
  }

  /**
   * Get a specific friend's data
   *
   * @param friendId - Friend's player ID
   * @returns Friend data or undefined
   */
  getFriend(friendId: string): Friend | undefined {
    return this.friends.get(friendId);
  }

  // ==========================================================================
  // NETWORK HANDLERS (called by ClientNetwork)
  // ==========================================================================

  /**
   * Handle full friends list sync from server
   *
   * Called by ClientNetwork when friendsListSync packet is received.
   * Replaces all cached data with the new data.
   *
   * @param data - Full sync data from server
   */
  handleSync(data: FriendsListSyncData): void {
    // Clear and rebuild friends map
    this.friends.clear();
    for (const friend of data.friends) {
      this.friends.set(friend.id, friend);
    }

    // Replace requests
    this.requests = [...data.requests];

    // Clear and rebuild ignore list
    this.ignoreList.clear();
    for (const ignored of data.ignoreList) {
      this.ignoreList.set(ignored.id, ignored);
    }

    // Clear pending transactions - server is source of truth
    this.pendingTransactions.clear();

    // Invalidate cache
    this.invalidateCache();

    // Emit update event for UI
    this.world.emit("ui:stateChanged", { type: "friends_updated" });
  }

  /**
   * Handle friend status update from server
   *
   * Called by ClientNetwork when friendStatusUpdate packet is received.
   * Updates a single friend's status without replacing entire list.
   *
   * @param data - Status update for a specific friend
   */
  handleStatusUpdate(data: FriendStatusUpdateData): void {
    const friend = this.friends.get(data.friendId);
    if (!friend) {
      // Friend not in list - might be newly added, ignore for now
      // Full sync will come separately
      return;
    }

    // Update friend data in place
    friend.status = data.status;
    if (data.location !== undefined) {
      friend.location = data.location;
    }
    if (data.level !== undefined) {
      friend.level = data.level;
    }
    if (data.lastSeen !== undefined) {
      friend.lastSeen = data.lastSeen;
    }

    // Invalidate cache since status order may have changed
    this.invalidateCache();

    // Emit update event for UI
    this.world.emit("ui:stateChanged", { type: "friends_updated" });
  }

  /**
   * Handle incoming friend request
   *
   * Called by ClientNetwork when friendRequestIncoming packet is received.
   * Adds the request to the pending list.
   *
   * @param request - New friend request
   */
  addIncomingRequest(request: FriendRequest): void {
    // Check if request already exists
    const existing = this.requests.find((r) => r.id === request.id);
    if (existing) return;

    // Add to beginning of list (most recent first)
    this.requests.unshift(request);

    // Emit update event for UI
    this.world.emit("ui:stateChanged", { type: "friends_updated" });
  }

  /**
   * Remove a friend request from the local cache
   *
   * Called after accepting or declining a request.
   *
   * @param requestId - Request ID to remove
   */
  removeRequest(requestId: string): void {
    const index = this.requests.findIndex((r) => r.id === requestId);
    if (index >= 0) {
      this.requests.splice(index, 1);
      // Note: requests don't affect friends cache, no need to invalidate
      this.world.emit("ui:stateChanged", { type: "friends_updated" });
    }
  }

  /**
   * Add a friend to the local cache
   *
   * Used for optimistic updates before server confirms.
   *
   * @param friend - Friend data to add
   * @param transactionId - Optional transaction ID for rollback support
   */
  addFriend(friend: Friend, transactionId?: string): void {
    this.friends.set(friend.id, friend);
    this.invalidateCache();

    if (transactionId) {
      this.pendingTransactions.set(transactionId, {
        type: "addFriend",
        data: friend.id,
        timestamp: Date.now(),
      });
      this.scheduleTransactionTimeout(transactionId);
    }

    this.world.emit("ui:stateChanged", { type: "friends_updated" });
  }

  /**
   * Remove a friend from the local cache
   *
   * Used for optimistic updates before server confirms.
   *
   * @param friendId - Friend ID to remove
   * @param transactionId - Optional transaction ID for rollback support
   */
  removeFriend(friendId: string, transactionId?: string): void {
    const friend = this.friends.get(friendId);
    if (this.friends.delete(friendId)) {
      this.invalidateCache();

      if (transactionId && friend) {
        this.pendingTransactions.set(transactionId, {
          type: "removeFriend",
          data: friend,
          timestamp: Date.now(),
        });
        this.scheduleTransactionTimeout(transactionId);
      }

      this.world.emit("ui:stateChanged", { type: "friends_updated" });
    }
  }

  /**
   * Add player to ignore list in local cache
   *
   * @param ignored - Ignored player data
   */
  addIgnored(ignored: IgnoredPlayer): void {
    this.ignoreList.set(ignored.id, ignored);
    // Also remove from friends if present
    if (this.friends.delete(ignored.id)) {
      this.invalidateCache();
    }
    this.world.emit("ui:stateChanged", { type: "friends_updated" });
  }

  /**
   * Remove player from ignore list in local cache
   *
   * @param ignoredId - Player ID to unignore
   */
  removeIgnored(ignoredId: string): void {
    if (this.ignoreList.delete(ignoredId)) {
      this.world.emit("ui:stateChanged", { type: "friends_updated" });
    }
  }

  // ==========================================================================
  // OPTIMISTIC UPDATE SUPPORT
  // ==========================================================================

  /**
   * Confirm a pending transaction (server acknowledged)
   *
   * @param transactionId - The transaction ID to confirm
   */
  confirmTransaction(transactionId: string): void {
    this.pendingTransactions.delete(transactionId);
  }

  /**
   * Rollback a pending transaction (server rejected)
   *
   * @param transactionId - The transaction ID to rollback
   */
  rollbackTransaction(transactionId: string): void {
    const transaction = this.pendingTransactions.get(transactionId);
    if (!transaction) return;

    this.pendingTransactions.delete(transactionId);

    // Rollback based on transaction type
    if (transaction.type === "addFriend") {
      // Remove the optimistically added friend
      const friendId = transaction.data as string;
      this.friends.delete(friendId);
      this.invalidateCache();
    } else if (transaction.type === "removeFriend") {
      // Re-add the optimistically removed friend
      const friend = transaction.data as Friend;
      this.friends.set(friend.id, friend);
      this.invalidateCache();
    }

    this.world.emit("ui:stateChanged", { type: "friends_updated" });
  }

  /**
   * Check if there are pending transactions
   */
  hasPendingTransactions(): boolean {
    return this.pendingTransactions.size > 0;
  }

  /**
   * Schedule timeout for a transaction
   */
  private scheduleTransactionTimeout(transactionId: string): void {
    setTimeout(() => {
      if (this.pendingTransactions.has(transactionId)) {
        // Transaction timed out - rollback
        this.rollbackTransaction(transactionId);
      }
    }, SocialSystem.TRANSACTION_TIMEOUT);
  }
}
