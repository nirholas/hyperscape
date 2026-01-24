/**
 * FriendsPanel - Social/friends panel using design tokens
 *
 * Clean design with proper separations matching other panels.
 * Uses COLORS and panelStyles from constants for consistency.
 */

import React, { useState, useCallback, useMemo, useEffect } from "react";
import {
  Users,
  UserPlus,
  MessageCircle,
  X,
  Check,
  Search,
  Bell,
} from "lucide-react";
import {
  COLORS,
  spacing,
  panelStyles,
  typography,
  breakpoints,
} from "../../constants";
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

// Status colors matching COLORS constant
const STATUS_COLORS: Record<FriendStatus, string> = {
  online: COLORS.SUCCESS,
  away: COLORS.WARNING,
  busy: COLORS.ERROR,
  offline: COLORS.TEXT_MUTED,
};

/**
 * FriendsPanel Component
 *
 * Social panel using design tokens for consistent styling.
 */
export function FriendsPanel({ world }: FriendsPanelProps) {
  const [activeView, setActiveView] = useState<"friends" | "requests">(
    "friends",
  );
  const [showSearch, setShowSearch] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [showAddFriend, setShowAddFriend] = useState(false);
  const [addFriendName, setAddFriendName] = useState("");
  const [hoveredFriendId, setHoveredFriendId] = useState<string | null>(null);

  // Mobile responsiveness
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth < breakpoints.md : false,
  );

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < breakpoints.md);
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

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

  // === Styling using COLORS constants (mobile responsive) ===

  const containerStyle: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    background: panelStyles.container.background,
  };

  // Header - responsive padding
  const headerRowStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: isMobile
      ? `${spacing.xs} ${spacing.sm}`
      : `${spacing.sm} ${spacing.md}`,
    background: COLORS.BG_TERTIARY,
    borderBottom: `1px solid ${COLORS.BORDER_PRIMARY}`,
    minHeight: isMobile ? "40px" : "44px",
  };

  const headerTitleStyle: React.CSSProperties = {
    color: COLORS.ACCENT,
    fontSize: isMobile ? typography.fontSize.xs : typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
  };

  const headerActionsStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: isMobile ? spacing["2xs"] : spacing.xs,
  };

  // Responsive icon button sizes for touch targets
  const iconButtonSize = isMobile ? "36px" : "28px";
  const iconButtonStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: iconButtonSize,
    height: iconButtonSize,
    backgroundColor: "transparent",
    border: "none",
    borderRadius: "2px",
    color: COLORS.TEXT_MUTED,
    cursor: "pointer",
    padding: 0,
    position: "relative",
    transition: "all 0.15s ease",
  };

  const activeIconButtonStyle: React.CSSProperties = {
    ...iconButtonStyle,
    color: COLORS.ACCENT,
    backgroundColor: COLORS.SELECTION,
  };

  // Search row - responsive
  const searchRowStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: isMobile ? spacing.xs : spacing.sm,
    padding: isMobile
      ? `${spacing.xs} ${spacing.sm}`
      : `${spacing.sm} ${spacing.md}`,
    borderBottom: `1px solid ${COLORS.BORDER_SECONDARY}`,
    backgroundColor: COLORS.BG_OVERLAY,
    minHeight: isMobile ? "40px" : "36px",
  };

  const searchInputStyle: React.CSSProperties = {
    flex: 1,
    background: "none",
    border: "none",
    outline: "none",
    color: COLORS.TEXT_PRIMARY,
    fontSize: isMobile ? typography.fontSize.base : typography.fontSize.sm,
  };

  // Content list
  const listStyle: React.CSSProperties = {
    flex: 1,
    overflowY: "auto",
    WebkitOverflowScrolling: "touch", // Smooth scrolling on iOS
  };

  // Friend row - responsive with larger touch targets on mobile
  const getFriendRowStyle = (isHovered: boolean): React.CSSProperties => ({
    display: "flex",
    alignItems: "center",
    padding: isMobile
      ? `${spacing.sm} ${spacing.sm}`
      : `${spacing.sm} ${spacing.md}`,
    borderBottom: `1px solid ${COLORS.BORDER_SECONDARY}`,
    gap: isMobile ? spacing.xs : spacing.sm,
    backgroundColor: isHovered ? COLORS.HOVER : "transparent",
    cursor: "pointer",
    transition: "background-color 0.15s ease",
    minHeight: isMobile ? "48px" : "40px", // Touch-friendly on mobile
  });

  const statusDotStyle = (status: FriendStatus): React.CSSProperties => ({
    width: isMobile ? "10px" : "8px",
    height: isMobile ? "10px" : "8px",
    borderRadius: "50%",
    backgroundColor: STATUS_COLORS[status],
    flexShrink: 0,
  });

  const friendInfoStyle: React.CSSProperties = {
    flex: 1,
    minWidth: 0,
  };

  const friendNameStyle: React.CSSProperties = {
    color: COLORS.TEXT_PRIMARY,
    fontSize: isMobile ? typography.fontSize.base : typography.fontSize.sm,
    fontWeight: typography.fontWeight.medium,
    marginBottom: "2px",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  };

  const friendMetaStyle: React.CSSProperties = {
    color: COLORS.TEXT_MUTED,
    fontSize: isMobile ? typography.fontSize.sm : typography.fontSize.xs,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  };

  // Action buttons - larger on mobile for touch
  const actionButtonSize = isMobile ? "36px" : "24px";
  const actionButtonStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: actionButtonSize,
    height: actionButtonSize,
    backgroundColor: "transparent",
    border: "none",
    borderRadius: "2px",
    color: COLORS.TEXT_MUTED,
    cursor: "pointer",
    padding: 0,
    transition: "color 0.15s ease",
  };

  const acceptButtonStyle: React.CSSProperties = {
    ...actionButtonStyle,
    color: COLORS.SUCCESS,
  };

  const declineButtonStyle: React.CSSProperties = {
    ...actionButtonStyle,
    color: COLORS.ERROR,
  };

  const emptyStyle: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center",
    color: COLORS.TEXT_MUTED,
    padding: isMobile
      ? `${spacing.lg} ${spacing.sm}`
      : `${spacing.xl} ${spacing.md}`,
    fontSize: isMobile ? typography.fontSize.base : typography.fontSize.sm,
    flex: 1,
  };

  // Add friend input area - responsive
  const addInputRowStyle: React.CSSProperties = {
    display: "flex",
    gap: spacing.xs,
    padding: isMobile
      ? `${spacing.xs} ${spacing.sm}`
      : `${spacing.sm} ${spacing.md}`,
    borderBottom: `1px solid ${COLORS.BORDER_SECONDARY}`,
    backgroundColor: COLORS.BG_OVERLAY,
  };

  const addInputStyle: React.CSSProperties = {
    ...panelStyles.input,
    flex: 1,
    padding: isMobile
      ? `${spacing.sm} ${spacing.sm}`
      : `${spacing.xs} ${spacing.sm}`,
    color: COLORS.TEXT_PRIMARY,
    fontSize: isMobile ? typography.fontSize.base : typography.fontSize.sm,
    outline: "none",
  };

  // Request badge
  const badgeStyle: React.CSSProperties = {
    position: "absolute",
    top: isMobile ? "4px" : "2px",
    right: isMobile ? "4px" : "2px",
    width: isMobile ? "10px" : "8px",
    height: isMobile ? "10px" : "8px",
    borderRadius: "50%",
    backgroundColor: COLORS.ERROR,
  };

  return (
    <div style={containerStyle}>
      {/* Header */}
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
            <Search size={isMobile ? 20 : 16} />
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
            <Bell size={isMobile ? 20 : 16} />
            {requests.length > 0 && <div style={badgeStyle} />}
          </button>
          {/* Add friend */}
          <button
            style={showAddFriend ? activeIconButtonStyle : iconButtonStyle}
            onClick={() => setShowAddFriend(!showAddFriend)}
            title="Add Friend"
          >
            <UserPlus size={isMobile ? 20 : 16} />
          </button>
        </div>
      </div>

      {/* Search row */}
      {showSearch && (
        <div style={searchRowStyle}>
          <Search size={isMobile ? 18 : 14} color={COLORS.TEXT_MUTED} />
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
              <X size={isMobile ? 18 : 14} />
            </button>
          )}
        </div>
      )}

      {/* Add friend input */}
      {showAddFriend && (
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
            <Check size={isMobile ? 20 : 16} />
          </button>
          <button
            style={declineButtonStyle}
            onClick={() => {
              setShowAddFriend(false);
              setAddFriendName("");
            }}
            title="Cancel"
          >
            <X size={isMobile ? 20 : 16} />
          </button>
        </div>
      )}

      {/* Content - Friends or Requests */}
      <div style={listStyle} className="scrollbar-thin">
        {activeView === "friends" && (
          <>
            {sortedFriends.length === 0 ? (
              <div style={emptyStyle}>
                <Users
                  size={isMobile ? 48 : 40}
                  color={COLORS.TEXT_MUTED}
                  style={{ opacity: 0.3, marginBottom: spacing.sm }}
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
                          onClick={(e) => {
                            e.stopPropagation();
                            handleMessageFriend(friend);
                          }}
                          title="Message"
                        >
                          <MessageCircle size={isMobile ? 18 : 14} />
                        </button>
                      )}
                      <button
                        style={declineButtonStyle}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRemoveFriend(friend);
                        }}
                        title="Remove"
                      >
                        <X size={isMobile ? 18 : 14} />
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
                  size={isMobile ? 48 : 40}
                  color={COLORS.TEXT_MUTED}
                  style={{ opacity: 0.3, marginBottom: spacing.sm }}
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

                  {/* Accept/Decline */}
                  <button
                    style={acceptButtonStyle}
                    onClick={() => handleAcceptRequest(request)}
                    title="Accept"
                  >
                    <Check size={isMobile ? 20 : 16} />
                  </button>
                  <button
                    style={declineButtonStyle}
                    onClick={() => handleDeclineRequest(request)}
                    title="Decline"
                  >
                    <X size={isMobile ? 20 : 16} />
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
