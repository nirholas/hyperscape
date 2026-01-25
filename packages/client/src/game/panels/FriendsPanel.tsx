/**
 * FriendsPanel - Social/Friends panel for the game interface
 *
 * Minimal, clean design with borderless rows and squared aesthetic.
 * Displays friends list, online status, and social interactions.
 */

import React, { useState, useCallback, useMemo } from "react";
import { useTheme } from "hs-kit";
import {
  Users,
  UserPlus,
  MessageCircle,
  X,
  Check,
  Search,
  Bell,
} from "lucide-react";
import type { ClientWorld } from "../../types";

interface FriendsPanelProps {
  world: ClientWorld;
}

/** Friend status */
type FriendStatus = "online" | "away" | "busy" | "offline";

/** Friend data */
interface Friend {
  id: string;
  name: string;
  status: FriendStatus;
  location?: string;
  level?: number;
  lastSeen?: number;
}

/** Pending friend request */
interface FriendRequest {
  id: string;
  fromId: string;
  fromName: string;
  toId: string;
  toName: string;
  timestamp: number;
}

/**
 * FriendsPanel Component
 *
 * Clean, minimal social panel with friends list and requests.
 */
export function FriendsPanel({ world }: FriendsPanelProps) {
  const theme = useTheme();
  const [activeView, setActiveView] = useState<"friends" | "requests">(
    "friends",
  );
  const [showSearch, setShowSearch] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [showAddFriend, setShowAddFriend] = useState(false);
  const [addFriendName, setAddFriendName] = useState("");
  const [hoveredFriendId, setHoveredFriendId] = useState<string | null>(null);

  // Get friends data from world
  const { friends, requests } = useMemo(() => {
    const socialSystem = world.getSystem?.("social");
    if (
      socialSystem &&
      typeof socialSystem === "object" &&
      "getFriends" in socialSystem
    ) {
      const getFriends = socialSystem.getFriends as () => {
        friends: Friend[];
        requests: FriendRequest[];
      };
      return getFriends();
    }
    return getSampleSocialData();
  }, [world]);

  // Filter friends by search
  const filteredFriends = useMemo(() => {
    if (!searchText) return friends;
    const lower = searchText.toLowerCase();
    return friends.filter(
      (f) =>
        f.name.toLowerCase().includes(lower) ||
        f.location?.toLowerCase().includes(lower),
    );
  }, [friends, searchText]);

  // Sort friends: online first, then alphabetically
  const sortedFriends = useMemo(() => {
    return [...filteredFriends].sort((a, b) => {
      const statusOrder: Record<FriendStatus, number> = {
        online: 0,
        away: 1,
        busy: 2,
        offline: 3,
      };
      const statusDiff = statusOrder[a.status] - statusOrder[b.status];
      if (statusDiff !== 0) return statusDiff;
      return a.name.localeCompare(b.name);
    });
  }, [filteredFriends]);

  // Count online friends
  const onlineCount = useMemo(
    () => friends.filter((f) => f.status !== "offline").length,
    [friends],
  );

  // Status color using theme tokens
  const getStatusColor = (status: FriendStatus) => {
    switch (status) {
      case "online":
        return theme.colors.state.success;
      case "away":
        return theme.colors.state.warning;
      case "busy":
        return theme.colors.state.danger;
      case "offline":
      default:
        return theme.colors.text.muted;
    }
  };

  // Handle friend actions
  const handleMessageFriend = useCallback(
    (friend: Friend) => {
      world.network?.send?.("messagePrivate", { targetId: friend.id });
    },
    [world],
  );

  const handleRemoveFriend = useCallback(
    (friend: Friend) => {
      if (window.confirm(`Remove ${friend.name} from your friends list?`)) {
        world.network?.send?.("friendRemove", { friendId: friend.id });
      }
    },
    [world],
  );

  const handleAcceptRequest = useCallback(
    (request: FriendRequest) => {
      world.network?.send?.("friendAccept", { requestId: request.id });
    },
    [world],
  );

  const handleDeclineRequest = useCallback(
    (request: FriendRequest) => {
      world.network?.send?.("friendDecline", { requestId: request.id });
    },
    [world],
  );

  const handleAddFriend = useCallback(() => {
    if (addFriendName.trim()) {
      world.network?.send?.("friendRequest", {
        targetName: addFriendName.trim(),
      });
      setAddFriendName("");
      setShowAddFriend(false);
    }
  }, [world, addFriendName]);

  // === STYLES - Minimal, squared aesthetic ===

  const containerStyle: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    backgroundColor: theme.colors.background.primary,
  };

  // Compact header row
  const headerRowStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: `${theme.spacing.sm}px ${theme.spacing.sm}px`,
    borderBottom: `1px solid ${theme.colors.border.default}`,
  };

  const headerTitleStyle: React.CSSProperties = {
    color: theme.colors.text.primary,
    fontSize: theme.typography.fontSize.sm,
    fontWeight: theme.typography.fontWeight.semibold,
  };

  const headerActionsStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: theme.spacing.xs,
  };

  const iconButtonStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 28,
    height: 28,
    backgroundColor: "transparent",
    border: "none",
    borderRadius: 0,
    color: theme.colors.text.secondary,
    cursor: "pointer",
    padding: 0,
    position: "relative",
  };

  const activeIconButtonStyle: React.CSSProperties = {
    ...iconButtonStyle,
    color: theme.colors.accent.primary,
    backgroundColor: theme.colors.background.secondary,
  };

  // Search row (only when active)
  const searchRowStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: theme.spacing.xs,
    padding: `${theme.spacing.xs}px ${theme.spacing.sm}px`,
    borderBottom: `1px solid ${theme.colors.border.default}`,
    backgroundColor: theme.colors.background.secondary,
  };

  const searchInputStyle: React.CSSProperties = {
    flex: 1,
    background: "none",
    border: "none",
    outline: "none",
    color: theme.colors.text.primary,
    fontSize: theme.typography.fontSize.sm,
  };

  // Content list
  const listStyle: React.CSSProperties = {
    flex: 1,
    overflowY: "auto",
  };

  // Friend row - borderless with separator
  const getFriendRowStyle = (isHovered: boolean): React.CSSProperties => ({
    display: "flex",
    alignItems: "center",
    padding: `${theme.spacing.sm}px ${theme.spacing.sm}px`,
    borderBottom: `1px solid ${theme.colors.border.default}`,
    gap: theme.spacing.sm,
    backgroundColor: isHovered
      ? theme.colors.background.secondary
      : "transparent",
    cursor: "pointer",
    transition: theme.transitions.fast,
  });

  const statusDotStyle = (status: FriendStatus): React.CSSProperties => ({
    width: 8,
    height: 8,
    borderRadius: "50%",
    backgroundColor: getStatusColor(status),
    flexShrink: 0,
  });

  const friendInfoStyle: React.CSSProperties = {
    flex: 1,
    minWidth: 0,
  };

  const friendNameStyle: React.CSSProperties = {
    color: theme.colors.text.primary,
    fontSize: theme.typography.fontSize.sm,
    fontWeight: theme.typography.fontWeight.medium,
    marginBottom: 2,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  };

  const friendMetaStyle: React.CSSProperties = {
    color: theme.colors.text.muted,
    fontSize: theme.typography.fontSize.xs,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  };

  // Action buttons (shown on hover)
  const actionButtonStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 24,
    height: 24,
    backgroundColor: "transparent",
    border: "none",
    borderRadius: 0,
    color: theme.colors.text.secondary,
    cursor: "pointer",
    padding: 0,
  };

  const acceptButtonStyle: React.CSSProperties = {
    ...actionButtonStyle,
    color: theme.colors.state.success,
  };

  const declineButtonStyle: React.CSSProperties = {
    ...actionButtonStyle,
    color: theme.colors.state.danger,
  };

  const emptyStyle: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center",
    color: theme.colors.text.muted,
    padding: theme.spacing.xl,
    fontSize: theme.typography.fontSize.sm,
    flex: 1,
  };

  // Add friend footer
  const footerStyle: React.CSSProperties = {
    padding: theme.spacing.sm,
    borderTop: `1px solid ${theme.colors.border.default}`,
  };

  const addInputRowStyle: React.CSSProperties = {
    display: "flex",
    gap: theme.spacing.xs,
  };

  const addInputStyle: React.CSSProperties = {
    flex: 1,
    padding: `${theme.spacing.xs}px ${theme.spacing.sm}px`,
    backgroundColor: theme.colors.background.secondary,
    border: `1px solid ${theme.colors.border.default}`,
    borderRadius: 0,
    color: theme.colors.text.primary,
    fontSize: theme.typography.fontSize.sm,
    outline: "none",
  };

  // Request badge
  const badgeStyle: React.CSSProperties = {
    position: "absolute",
    top: 2,
    right: 2,
    width: 8,
    height: 8,
    borderRadius: "50%",
    backgroundColor: theme.colors.state.danger,
  };

  return (
    <div style={containerStyle}>
      {/* Compact header row */}
      <div style={headerRowStyle}>
        <span style={headerTitleStyle}>
          Friends ({onlineCount}/{friends.length})
        </span>
        <div style={headerActionsStyle}>
          {/* Search toggle */}
          <button
            style={showSearch ? activeIconButtonStyle : iconButtonStyle}
            onClick={() => {
              setShowSearch(!showSearch);
              if (showSearch) setSearchText("");
            }}
            title="Search"
          >
            <Search size={16} />
          </button>
          {/* Requests toggle */}
          <button
            style={
              activeView === "requests"
                ? activeIconButtonStyle
                : iconButtonStyle
            }
            onClick={() =>
              setActiveView(activeView === "requests" ? "friends" : "requests")
            }
            title="Friend Requests"
          >
            <Bell size={16} />
            {requests.length > 0 && <div style={badgeStyle} />}
          </button>
          {/* Add friend */}
          <button
            style={showAddFriend ? activeIconButtonStyle : iconButtonStyle}
            onClick={() => setShowAddFriend(!showAddFriend)}
            title="Add Friend"
          >
            <UserPlus size={16} />
          </button>
        </div>
      </div>

      {/* Search row - only when active */}
      {showSearch && (
        <div style={searchRowStyle}>
          <Search size={14} color={theme.colors.text.muted} />
          <input
            type="text"
            placeholder="Search friends..."
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            style={searchInputStyle}
            autoFocus
          />
          {searchText && (
            <button style={actionButtonStyle} onClick={() => setSearchText("")}>
              <X size={14} />
            </button>
          )}
        </div>
      )}

      {/* Add friend input row */}
      {showAddFriend && (
        <div
          style={{
            ...footerStyle,
            borderTop: "none",
            borderBottom: `1px solid ${theme.colors.border.default}`,
          }}
        >
          <div style={addInputRowStyle}>
            <input
              type="text"
              placeholder="Enter player name..."
              value={addFriendName}
              onChange={(e) => setAddFriendName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAddFriend()}
              style={addInputStyle}
              autoFocus
            />
            <button
              style={acceptButtonStyle}
              onClick={handleAddFriend}
              title="Add"
            >
              <Check size={16} />
            </button>
            <button
              style={declineButtonStyle}
              onClick={() => {
                setShowAddFriend(false);
                setAddFriendName("");
              }}
              title="Cancel"
            >
              <X size={16} />
            </button>
          </div>
        </div>
      )}

      {/* Content - Friends or Requests */}
      <div style={listStyle}>
        {activeView === "friends" && (
          <>
            {sortedFriends.length === 0 ? (
              <div style={emptyStyle}>
                <Users
                  size={40}
                  color={theme.colors.text.muted}
                  style={{ opacity: 0.3, marginBottom: theme.spacing.sm }}
                />
                <div>
                  {searchText
                    ? "No friends match your search"
                    : "No friends yet"}
                </div>
              </div>
            ) : (
              sortedFriends.map((friend) => (
                <div
                  key={friend.id}
                  style={getFriendRowStyle(hoveredFriendId === friend.id)}
                  onMouseEnter={() => setHoveredFriendId(friend.id)}
                  onMouseLeave={() => setHoveredFriendId(null)}
                >
                  {/* Status dot */}
                  <div style={statusDotStyle(friend.status)} />

                  {/* Friend info */}
                  <div style={friendInfoStyle}>
                    <div style={friendNameStyle}>{friend.name}</div>
                    <div style={friendMetaStyle}>
                      {friend.status === "online" && friend.location
                        ? `${friend.location}${friend.level ? ` · Lvl ${friend.level}` : ""}`
                        : friend.status === "offline"
                          ? `Last seen ${formatLastSeen(friend.lastSeen)}`
                          : friend.status.charAt(0).toUpperCase() +
                            friend.status.slice(1)}
                    </div>
                  </div>

                  {/* Actions - shown on hover */}
                  {hoveredFriendId === friend.id && (
                    <>
                      {friend.status !== "offline" && (
                        <button
                          style={actionButtonStyle}
                          onClick={() => handleMessageFriend(friend)}
                          title="Message"
                        >
                          <MessageCircle size={14} />
                        </button>
                      )}
                      <button
                        style={declineButtonStyle}
                        onClick={() => handleRemoveFriend(friend)}
                        title="Remove"
                      >
                        <X size={14} />
                      </button>
                    </>
                  )}
                </div>
              ))
            )}
          </>
        )}

        {activeView === "requests" && (
          <>
            {requests.length === 0 ? (
              <div style={emptyStyle}>
                <Bell
                  size={40}
                  color={theme.colors.text.muted}
                  style={{ opacity: 0.3, marginBottom: theme.spacing.sm }}
                />
                <div>No pending requests</div>
              </div>
            ) : (
              requests.map((request) => (
                <div
                  key={request.id}
                  style={getFriendRowStyle(hoveredFriendId === request.id)}
                  onMouseEnter={() => setHoveredFriendId(request.id)}
                  onMouseLeave={() => setHoveredFriendId(null)}
                >
                  {/* Request info */}
                  <div style={friendInfoStyle}>
                    <div style={friendNameStyle}>{request.fromName}</div>
                    <div style={friendMetaStyle}>
                      {formatTimeAgo(request.timestamp)}
                    </div>
                  </div>

                  {/* Accept/Decline - always visible for requests */}
                  <button
                    style={acceptButtonStyle}
                    onClick={() => handleAcceptRequest(request)}
                    title="Accept"
                  >
                    <Check size={16} />
                  </button>
                  <button
                    style={declineButtonStyle}
                    onClick={() => handleDeclineRequest(request)}
                    title="Decline"
                  >
                    <X size={16} />
                  </button>
                </div>
              ))
            )}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Format last seen timestamp
 */
function formatLastSeen(timestamp?: number): string {
  if (!timestamp) return "unknown";
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/**
 * Format timestamp as relative time
 */
function formatTimeAgo(timestamp: number): string {
  return formatLastSeen(timestamp);
}

/**
 * Sample social data for development
 */
function getSampleSocialData(): {
  friends: Friend[];
  requests: FriendRequest[];
} {
  return {
    friends: [
      {
        id: "friend-1",
        name: "AdventureSeeker",
        status: "online",
        location: "Lumbridge",
        level: 42,
      },
      {
        id: "friend-2",
        name: "MiningMaster",
        status: "online",
        location: "Mining Guild",
        level: 85,
      },
      {
        id: "friend-3",
        name: "FishermanJoe",
        status: "away",
        location: "Fishing Spot",
        level: 55,
      },
      {
        id: "friend-4",
        name: "DarkKnight99",
        status: "busy",
        location: "Wilderness",
        level: 99,
      },
      {
        id: "friend-5",
        name: "CasualPlayer",
        status: "offline",
        level: 23,
        lastSeen: Date.now() - 3600000,
      },
      {
        id: "friend-6",
        name: "OldFriend",
        status: "offline",
        level: 15,
        lastSeen: Date.now() - 86400000 * 7,
      },
    ],
    requests: [
      {
        id: "req-1",
        fromId: "player-123",
        fromName: "NewPlayer2024",
        toId: "local",
        toName: "You",
        timestamp: Date.now() - 300000,
      },
    ],
  };
}

export default FriendsPanel;
