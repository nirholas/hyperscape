/**
 * Escape Menu Component
 *
 * A modal menu that appears when pressing the Escape key.
 * Provides quick access to game options like settings, logout, etc.
 *
 * @packageDocumentation
 */

import React, { useCallback, useEffect, useState, useMemo } from "react";
import { createPortal } from "react-dom";
import { useThemeStore } from "hs-kit";
import { usePrivy } from "@privy-io/react-auth";
import type { ClientWorld } from "../../types";
import {
  Settings,
  LogOut,
  Play,
  Home,
  Volume2,
  VolumeX,
  HelpCircle,
} from "lucide-react";

interface EscapeMenuProps {
  world: ClientWorld;
}

interface MenuButtonProps {
  icon: React.ReactNode;
  label: string;
  sublabel?: string;
  onClick: () => void;
  variant?: "default" | "danger" | "primary";
  disabled?: boolean;
}

function MenuButton({
  icon,
  label,
  sublabel,
  onClick,
  variant = "default",
  disabled = false,
}: MenuButtonProps) {
  const theme = useThemeStore((s) => s.theme);
  const [isHovered, setIsHovered] = useState(false);

  const buttonStyle = useMemo(() => {
    const baseStyle: React.CSSProperties = {
      display: "flex",
      alignItems: "center",
      gap: theme.spacing.md,
      width: "100%",
      padding: `${theme.spacing.md} ${theme.spacing.lg}`,
      background: isHovered ? theme.colors.background.tertiary : "transparent",
      border: `1px solid ${isHovered ? theme.colors.border.hover : "transparent"}`,
      borderRadius: theme.borderRadius.md,
      cursor: disabled ? "not-allowed" : "pointer",
      opacity: disabled ? 0.5 : 1,
      transition: "all 0.15s ease",
      textAlign: "left" as const,
    };

    return baseStyle;
  }, [theme, isHovered, disabled]);

  const iconStyle = useMemo(() => {
    let color = theme.colors.text.secondary;
    if (variant === "danger") color = theme.colors.state.danger;
    if (variant === "primary") color = theme.colors.accent.primary;

    return {
      color,
      flexShrink: 0,
    };
  }, [theme, variant]);

  const labelStyle = useMemo(() => {
    let color = theme.colors.text.primary;
    if (variant === "danger") color = theme.colors.state.danger;
    if (variant === "primary") color = theme.colors.accent.primary;

    return {
      color,
      fontSize: theme.typography.fontSize.base,
      fontWeight: theme.typography.fontWeight.medium,
      fontFamily: theme.typography.fontFamily.body,
    };
  }, [theme, variant]);

  const sublabelStyle = useMemo(
    () => ({
      color: theme.colors.text.muted,
      fontSize: theme.typography.fontSize.xs,
      fontFamily: theme.typography.fontFamily.body,
    }),
    [theme],
  );

  return (
    <button
      type="button"
      style={buttonStyle}
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <span style={iconStyle}>{icon}</span>
      <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
        <span style={labelStyle}>{label}</span>
        {sublabel && <span style={sublabelStyle}>{sublabel}</span>}
      </div>
    </button>
  );
}

export function EscapeMenu({ world }: EscapeMenuProps) {
  const theme = useThemeStore((s) => s.theme);
  const [isOpen, setIsOpen] = useState(false);
  const { logout, authenticated } = usePrivy();

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setIsOpen((prev) => !prev);
      }
    };

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => {
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
    };
  }, []);

  // Close menu handler
  const handleClose = useCallback(() => {
    setIsOpen(false);
  }, []);

  // Resume game
  const handleResume = useCallback(() => {
    setIsOpen(false);
  }, []);

  // Open settings - find and click the settings panel toggle
  const handleSettings = useCallback(() => {
    setIsOpen(false);
    // Emit event to open settings panel
    world.emit?.("ui:openPanel", { panelId: "settings" });
  }, [world]);

  // Back to lobby
  const handleBackToLobby = useCallback(async () => {
    try {
      await world.network?.disconnect?.();
    } catch (e) {
      console.warn("Disconnect error:", e);
    } finally {
      window.location.href = "/";
    }
  }, [world]);

  // Log out completely
  const handleLogout = useCallback(async () => {
    try {
      await world.network?.disconnect?.();
    } catch (e) {
      console.warn("Disconnect error:", e);
    }
    try {
      await logout();
    } catch (e) {
      console.warn("Logout error:", e);
    } finally {
      window.location.href = "/";
    }
  }, [world, logout]);

  // Mute/unmute audio
  const [isMuted, setIsMuted] = useState(false);
  const handleToggleMute = useCallback(() => {
    const prefs = world.prefs;
    if (prefs) {
      const newMuted = !isMuted;
      setIsMuted(newMuted);
      prefs.setMusic?.(newMuted ? 0 : 1);
      prefs.setSFX?.(newMuted ? 0 : 1);
    }
  }, [world, isMuted]);

  // Styles
  const backdropStyle = useMemo(
    () => ({
      position: "fixed" as const,
      inset: 0,
      background: "rgba(0, 0, 0, 0.7)",
      backdropFilter: "blur(4px)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      zIndex: 100000,
      animation: "fadeIn 0.15s ease",
    }),
    [],
  );

  const menuStyle = useMemo(
    () => ({
      background: `linear-gradient(180deg, ${theme.colors.background.primary} 0%, ${theme.colors.background.secondary} 100%)`,
      border: `2px solid ${theme.colors.border.decorative}`,
      borderRadius: theme.borderRadius.lg,
      boxShadow: theme.shadows.xl,
      padding: theme.spacing.lg,
      minWidth: "320px",
      maxWidth: "400px",
      animation: "scaleIn 0.15s ease",
    }),
    [theme],
  );

  const titleStyle = useMemo(
    () => ({
      color: theme.colors.accent.primary,
      fontSize: theme.typography.fontSize.xl,
      fontWeight: theme.typography.fontWeight.bold,
      fontFamily: theme.typography.fontFamily.heading,
      textAlign: "center" as const,
      marginBottom: theme.spacing.lg,
      paddingBottom: theme.spacing.sm,
      borderBottom: `1px solid ${theme.colors.border.default}`,
    }),
    [theme],
  );

  const dividerStyle = useMemo(
    () => ({
      height: "1px",
      background: theme.colors.border.default,
      margin: `${theme.spacing.sm} 0`,
    }),
    [theme],
  );

  const hintStyle = useMemo(
    () => ({
      color: theme.colors.text.muted,
      fontSize: theme.typography.fontSize.xs,
      textAlign: "center" as const,
      marginTop: theme.spacing.sm,
      fontFamily: theme.typography.fontFamily.body,
    }),
    [theme],
  );

  if (!isOpen) return null;

  return createPortal(
    <>
      {/* Inject keyframe animations */}
      <style>
        {`
          @keyframes fadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
          }
          @keyframes scaleIn {
            from { opacity: 0; transform: scale(0.95); }
            to { opacity: 1; transform: scale(1); }
          }
        `}
      </style>
      <div
        style={backdropStyle}
        onClick={handleClose}
        onKeyDown={(e) => e.key === "Escape" && handleClose()}
        role="dialog"
        aria-modal="true"
        aria-label="Game Menu"
        tabIndex={-1}
      >
        <div
          style={menuStyle}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <h2 style={titleStyle}>Game Menu</h2>

          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <MenuButton
              icon={<Play size={20} />}
              label="Resume"
              sublabel="Return to game"
              onClick={handleResume}
              variant="primary"
            />

            <MenuButton
              icon={<Settings size={20} />}
              label="Settings"
              sublabel="Graphics, audio, controls"
              onClick={handleSettings}
            />

            <MenuButton
              icon={isMuted ? <VolumeX size={20} /> : <Volume2 size={20} />}
              label={isMuted ? "Unmute Audio" : "Mute Audio"}
              sublabel="Quick toggle"
              onClick={handleToggleMute}
            />

            <MenuButton
              icon={<HelpCircle size={20} />}
              label="Help"
              sublabel="Controls and tips"
              onClick={() => {
                setIsOpen(false);
                // Could open a help modal here
              }}
            />

            <div style={dividerStyle} />

            <MenuButton
              icon={<Home size={20} />}
              label="Back to Lobby"
              sublabel="Return to character select"
              onClick={handleBackToLobby}
            />

            {authenticated && (
              <MenuButton
                icon={<LogOut size={20} />}
                label="Log Out"
                sublabel="Sign out of your account"
                onClick={handleLogout}
                variant="danger"
              />
            )}
          </div>

          <p style={hintStyle}>Press ESC to close</p>
        </div>
      </div>
    </>,
    document.body,
  );
}
