/**
 * Character Model Component
 *
 * Character silhouette/preview for paper doll equipment display.
 * Supports static silhouette or optional 3D model rotation.
 *
 * @packageDocumentation
 */

import React, { memo, useState, useCallback, type CSSProperties } from "react";
import { useTheme } from "../stores/themeStore";

/** Character model props */
export interface CharacterModelProps {
  /** Width of the character display */
  width?: number;
  /** Height of the character display */
  height?: number;
  /** Character silhouette image URL */
  silhouetteUrl?: string;
  /** Whether to enable 3D rotation (drag to rotate) */
  rotatable?: boolean;
  /** Initial rotation angle (degrees) */
  initialRotation?: number;
  /** Callback when rotation changes */
  onRotationChange?: (angle: number) => void;
  /** Character name to display */
  characterName?: string;
  /** Character level to display */
  characterLevel?: number;
  /** Custom class name */
  className?: string;
  /** Custom style */
  style?: CSSProperties;
  /** Children (usually equipment slots overlaid) */
  children?: React.ReactNode;
}

/**
 * Character Model Component
 *
 * @example
 * ```tsx
 * <CharacterModel
 *   width={200}
 *   height={300}
 *   characterName="Hero"
 *   characterLevel={50}
 *   rotatable
 * >
 *   {/ * Equipment slots positioned over silhouette * /}
 *   <EquipmentSlot slotType="head" style={{ position: 'absolute', top: 10, left: 85 }} />
 * </CharacterModel>
 * ```
 */
export const CharacterModel = memo(function CharacterModel({
  width = 200,
  height = 300,
  silhouetteUrl,
  rotatable = false,
  initialRotation = 0,
  onRotationChange,
  characterName,
  characterLevel,
  className,
  style,
  children,
}: CharacterModelProps): React.ReactElement {
  const theme = useTheme();
  const [rotation, setRotation] = useState(initialRotation);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, rotation: 0 });

  // Rotation drag handlers
  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!rotatable) return;
      setIsDragging(true);
      setDragStart({ x: e.clientX, rotation });
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [rotatable, rotation],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isDragging || !rotatable) return;
      const deltaX = e.clientX - dragStart.x;
      const newRotation = (dragStart.rotation + deltaX * 0.5) % 360;
      setRotation(newRotation);
      onRotationChange?.(newRotation);
    },
    [isDragging, rotatable, dragStart, onRotationChange],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!isDragging) return;
      setIsDragging(false);
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    },
    [isDragging],
  );

  // Container styles
  const containerStyle: CSSProperties = {
    width,
    height,
    position: "relative",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.background.secondary,
    borderRadius: theme.borderRadius.lg,
    border: `1px solid ${theme.colors.border.default}`,
    overflow: "hidden",
    cursor: rotatable ? (isDragging ? "grabbing" : "grab") : "default",
    userSelect: "none",
    ...style,
  };

  // Silhouette styles
  const silhouetteStyle: CSSProperties = {
    position: "absolute",
    top: "50%",
    left: "50%",
    transform: `translate(-50%, -50%) rotateY(${rotation}deg)`,
    width: width * 0.7,
    height: height * 0.8,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    transition: isDragging ? "none" : theme.transitions.normal,
    transformStyle: "preserve-3d",
    perspective: 1000,
  };

  // Default silhouette (humanoid shape)
  const defaultSilhouetteStyle: CSSProperties = {
    width: "100%",
    height: "100%",
    background: `linear-gradient(to bottom,
      transparent 0%,
      ${theme.colors.background.tertiary} 8%,
      ${theme.colors.background.tertiary} 15%,
      transparent 16%,
      transparent 20%,
      ${theme.colors.background.tertiary} 21%,
      ${theme.colors.background.tertiary} 55%,
      transparent 56%,
      ${theme.colors.background.tertiary} 57%,
      ${theme.colors.background.tertiary} 95%,
      transparent 96%
    )`,
    maskImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 150'%3E%3Cellipse cx='50' cy='15' rx='15' ry='15' fill='white'/%3E%3Crect x='35' y='30' width='30' height='50' rx='5' fill='white'/%3E%3Crect x='15' y='32' width='20' height='8' rx='4' fill='white'/%3E%3Crect x='65' y='32' width='20' height='8' rx='4' fill='white'/%3E%3Crect x='38' y='80' width='10' height='60' rx='3' fill='white'/%3E%3Crect x='52' y='80' width='10' height='60' rx='3' fill='white'/%3E%3C/svg%3E")`,
    WebkitMaskImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 150'%3E%3Cellipse cx='50' cy='15' rx='15' ry='15' fill='white'/%3E%3Crect x='35' y='30' width='30' height='50' rx='5' fill='white'/%3E%3Crect x='15' y='32' width='20' height='8' rx='4' fill='white'/%3E%3Crect x='65' y='32' width='20' height='8' rx='4' fill='white'/%3E%3Crect x='38' y='80' width='10' height='60' rx='3' fill='white'/%3E%3Crect x='52' y='80' width='10' height='60' rx='3' fill='white'/%3E%3C/svg%3E")`,
    maskSize: "contain",
    WebkitMaskSize: "contain",
    maskRepeat: "no-repeat",
    WebkitMaskRepeat: "no-repeat",
    maskPosition: "center",
    WebkitMaskPosition: "center",
    opacity: 0.5,
  };

  // Character info styles
  const infoContainerStyle: CSSProperties = {
    position: "absolute",
    bottom: theme.spacing.sm,
    left: "50%",
    transform: "translateX(-50%)",
    textAlign: "center",
    zIndex: 10,
  };

  const nameStyle: CSSProperties = {
    fontSize: theme.typography.fontSize.sm,
    fontWeight: theme.typography.fontWeight.bold,
    color: theme.colors.text.primary,
    textShadow: "0 1px 2px rgba(0,0,0,0.8)",
  };

  const levelStyle: CSSProperties = {
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.text.secondary,
    textShadow: "0 1px 2px rgba(0,0,0,0.8)",
  };

  // Rotation indicator styles
  const rotationIndicatorStyle: CSSProperties = {
    position: "absolute",
    top: theme.spacing.sm,
    right: theme.spacing.sm,
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.text.muted,
    opacity: isDragging ? 1 : 0.5,
    transition: theme.transitions.fast,
  };

  return (
    <div
      className={className}
      style={containerStyle}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      {/* Silhouette */}
      <div style={silhouetteStyle}>
        {silhouetteUrl ? (
          <img
            src={silhouetteUrl}
            alt="Character"
            style={{
              width: "100%",
              height: "100%",
              objectFit: "contain",
              opacity: 0.5,
            }}
            draggable={false}
          />
        ) : (
          <div style={defaultSilhouetteStyle} />
        )}
      </div>

      {/* Equipment slots (children) */}
      {children}

      {/* Character info */}
      {(characterName || characterLevel !== undefined) && (
        <div style={infoContainerStyle}>
          {characterName && <div style={nameStyle}>{characterName}</div>}
          {characterLevel !== undefined && (
            <div style={levelStyle}>Level {characterLevel}</div>
          )}
        </div>
      )}

      {/* Rotation indicator */}
      {rotatable && (
        <div style={rotationIndicatorStyle}>{Math.round(rotation)}°</div>
      )}
    </div>
  );
});

export default CharacterModel;
