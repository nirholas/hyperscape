/**
 * Account Management Panel
 * Compact account status card - full management in Settings > Account tab
 */

import React, { useEffect, useState } from "react";
import { useThemeStore } from "hs-kit";
import { EventType } from "@hyperscape/shared";
import type { ClientWorld } from "../../types";
import { privyAuthManager } from "../../auth/PrivyAuthManager";

interface AccountPanelProps {
  world: ClientWorld;
}

export function AccountPanel({ world }: AccountPanelProps) {
  const theme = useThemeStore((s) => s.theme);
  const [authState, setAuthState] = useState(privyAuthManager.getState());
  const [playerName, setPlayerName] = useState("");
  const [characterWallet, setCharacterWallet] = useState<string | undefined>();

  useEffect(() => {
    const unsubscribe = privyAuthManager.subscribe(setAuthState);
    return unsubscribe;
  }, []);

  useEffect(() => {
    const player = world.entities?.player;
    if (player?.name) {
      setPlayerName(player.name);
    }
    if (player?.data?.wallet) {
      setCharacterWallet(player.data.wallet as string);
    }
  }, [world]);

  const authenticated = authState.isAuthenticated;
  const mainWalletAddress = (
    authState.user as { wallet?: { address?: string } }
  )?.wallet?.address;
  const displayWallet = characterWallet || mainWalletAddress;
  const farcasterFid = authState.farcasterFid;

  const truncate = (str: string, startLen: number, endLen: number) => {
    if (str.length <= startLen + endLen + 3) return str;
    return `${str.substring(0, startLen)}...${str.slice(-endLen)}`;
  };

  // Cloud feature count for summary
  const cloudFeatures = [
    { enabled: authenticated },
    { enabled: authenticated },
    { enabled: authenticated },
  ];
  const enabledCount = cloudFeatures.filter((f) => f.enabled).length;

  return (
    <div
      className="h-full overflow-y-auto noscrollbar"
      style={{ padding: "4px" }}
    >
      <div className="flex flex-col gap-3">
        {/* Profile Summary Card */}
        <div
          className="rounded-lg relative overflow-hidden"
          style={{
            background: `linear-gradient(135deg, ${theme.colors.background.secondary} 0%, ${theme.colors.background.primary} 100%)`,
            border: authenticated
              ? `1px solid ${theme.colors.state.success}40`
              : `1px solid ${theme.colors.border.decorative}`,
          }}
        >
          {/* Status glow */}
          {authenticated && (
            <div
              className="absolute top-0 right-0 w-24 h-24 rounded-full blur-3xl"
              style={{
                background: theme.colors.state.success,
                opacity: 0.1,
                transform: "translate(30%, -30%)",
              }}
            />
          )}

          <div className="relative z-10 p-3">
            {/* Header */}
            <div className="flex items-center gap-3 mb-3">
              {/* Avatar */}
              <div
                className="w-12 h-12 rounded-full flex items-center justify-center"
                style={{
                  background: authenticated
                    ? `linear-gradient(135deg, ${theme.colors.state.success}25 0%, ${theme.colors.state.success}10 100%)`
                    : `linear-gradient(135deg, ${theme.colors.border.decorative}30 0%, ${theme.colors.border.decorative}20 100%)`,
                  border: authenticated
                    ? `2px solid ${theme.colors.state.success}50`
                    : `2px solid ${theme.colors.border.decorative}`,
                }}
              >
                <span style={{ fontSize: "22px" }}>
                  {authenticated ? "👤" : "👻"}
                </span>
              </div>

              <div className="flex-1">
                {/* Status */}
                <div className="flex items-center gap-1.5 mb-1">
                  <div
                    className="w-2 h-2 rounded-full"
                    style={{
                      background: authenticated
                        ? theme.colors.state.success
                        : theme.colors.state.warning,
                      boxShadow: authenticated
                        ? `0 0 8px ${theme.colors.state.success}80`
                        : `0 0 8px ${theme.colors.state.warning}80`,
                    }}
                  />
                  <span
                    className="text-[10px] font-medium"
                    style={{
                      color: authenticated
                        ? theme.colors.state.success
                        : theme.colors.state.warning,
                    }}
                  >
                    {authenticated ? "Connected" : "Guest Mode"}
                  </span>
                </div>

                {/* Name */}
                <div
                  className="text-[15px] font-bold"
                  style={{ color: theme.colors.accent.primary }}
                >
                  {playerName || "Adventurer"}
                </div>
              </div>
            </div>

            {/* Quick Info */}
            {authenticated && displayWallet && (
              <div
                className="flex items-center justify-between p-2 rounded"
                style={{
                  background: theme.colors.background.tertiary,
                  border: `1px solid ${theme.colors.border.default}`,
                }}
              >
                <span
                  className="text-[9px]"
                  style={{ color: `${theme.colors.state.success}80` }}
                >
                  Wallet
                </span>
                <span
                  className="text-[10px] font-mono"
                  style={{ color: `${theme.colors.state.success}CC` }}
                >
                  {truncate(displayWallet, 6, 4)}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Cloud Status Summary */}
        <div
          className="rounded-lg p-3"
          style={{
            background: theme.colors.background.secondary,
            border: `1px solid ${theme.colors.border.default}`,
          }}
        >
          <div className="flex items-center justify-between mb-2">
            <span
              className="text-[10px] font-semibold"
              style={{ color: theme.colors.accent.primary }}
            >
              Cloud Features
            </span>
            <span
              className="text-[9px] px-2 py-0.5 rounded-full"
              style={{
                background: authenticated
                  ? `${theme.colors.state.success}20`
                  : theme.colors.background.tertiary,
                border: authenticated
                  ? `1px solid ${theme.colors.state.success}40`
                  : `1px solid ${theme.colors.border.default}`,
                color: authenticated
                  ? theme.colors.state.success
                  : theme.colors.text.muted,
              }}
            >
              {enabledCount}/3 Active
            </span>
          </div>

          <div className="flex gap-2">
            {[
              { icon: "🔄", label: "Sync" },
              { icon: "☁️", label: "Backup" },
              { icon: "🔐", label: "Recovery" },
            ].map((feature) => (
              <div
                key={feature.label}
                className="flex-1 flex flex-col items-center py-2 rounded"
                style={{
                  background: authenticated
                    ? `${theme.colors.state.success}10`
                    : theme.colors.background.tertiary,
                  border: authenticated
                    ? `1px solid ${theme.colors.state.success}25`
                    : `1px solid ${theme.colors.border.default}`,
                  opacity: authenticated ? 1 : 0.5,
                }}
              >
                <span style={{ fontSize: "14px" }}>{feature.icon}</span>
                <span
                  className="text-[8px] mt-1"
                  style={{
                    color: authenticated
                      ? theme.colors.accent.primary
                      : theme.colors.text.muted,
                  }}
                >
                  {feature.label}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Social Badge */}
        {farcasterFid && (
          <div
            className="flex items-center gap-2 p-2.5 rounded-lg"
            style={{
              background:
                "linear-gradient(135deg, rgba(168, 85, 247, 0.12) 0%, rgba(168, 85, 247, 0.06) 100%)",
              border: "1px solid rgba(168, 85, 247, 0.3)",
            }}
          >
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center"
              style={{
                background: "rgba(168, 85, 247, 0.2)",
                border: "1px solid rgba(168, 85, 247, 0.4)",
              }}
            >
              <span style={{ fontSize: "12px" }}>🟣</span>
            </div>
            <div className="flex-1">
              <div
                className="text-[10px] font-medium"
                style={{ color: "#c084fc" }}
              >
                Farcaster Connected
              </div>
              <div
                className="text-[8px]"
                style={{ color: "rgba(168, 85, 247, 0.7)" }}
              >
                FID #{farcasterFid}
              </div>
            </div>
          </div>
        )}

        {/* Guest Warning */}
        {!authenticated && (
          <div
            className="rounded-lg p-3 flex items-start gap-2.5"
            style={{
              background: `linear-gradient(135deg, ${theme.colors.state.warning}12 0%, ${theme.colors.state.warning}06 100%)`,
              border: `1px solid ${theme.colors.state.warning}30`,
            }}
          >
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{
                background: `${theme.colors.state.warning}20`,
                border: `1px solid ${theme.colors.state.warning}35`,
              }}
            >
              <span style={{ fontSize: "12px" }}>⚠️</span>
            </div>
            <div>
              <div
                className="text-[10px] font-semibold mb-0.5"
                style={{ color: theme.colors.state.warning }}
              >
                Playing as Guest
              </div>
              <div
                className="text-[8px] leading-relaxed"
                style={{ color: `${theme.colors.state.warning}BB` }}
              >
                Progress not saved. Sign in for cloud sync and recovery.
              </div>
            </div>
          </div>
        )}

        {/* Settings Link */}
        <div
          className="rounded-lg p-2.5 flex items-center justify-between cursor-pointer transition-all hover:opacity-90"
          style={{
            background: theme.colors.background.secondary,
            border: `1px solid ${theme.colors.border.default}`,
          }}
          onClick={() => {
            // Set pending tab for SettingsPanel to pick up
            sessionStorage.setItem("settings-initial-tab", "account");
            // Open settings panel using the proper event
            world.emit?.(EventType.UI_OPEN_PANE, { pane: "settings" });
          }}
        >
          <div className="flex items-center gap-2">
            <span style={{ fontSize: "12px" }}>⚙️</span>
            <span
              className="text-[10px]"
              style={{ color: theme.colors.text.secondary }}
            >
              Full Account Settings
            </span>
          </div>
          <span
            className="text-[10px]"
            style={{ color: theme.colors.text.muted }}
          >
            →
          </span>
        </div>
      </div>
    </div>
  );
}
