import React, { useState, memo } from "react";
import { getItem } from "@hyperscape/shared";
import { CDN_URL } from "../../lib/api-config";
import { getItemIcon, isNotedItem } from "../../utils/itemUtils";

/**
 * Resolve an asset:// URL to a full HTTP URL using the CDN base.
 */
function resolveAssetUrl(assetPath: string): string {
  if (assetPath.startsWith("asset://")) {
    const cdnBase = (CDN_URL || "").replace(/\/$/, "");
    return assetPath.replace("asset://", `${cdnBase}/`);
  }
  return assetPath;
}

interface ItemIconProps {
  itemId: string;
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * ItemIcon - Renders an item's icon from its manifest iconPath,
 * falling back to emoji if the image fails to load or no iconPath exists.
 */
export const ItemIcon = memo(function ItemIcon({
  itemId,
  size = 24,
  className,
  style,
}: ItemIconProps) {
  const [imgError, setImgError] = useState(false);

  // Strip _noted suffix to get the base item's icon
  const baseItemId = isNotedItem(itemId)
    ? itemId.replace(/_noted$/, "")
    : itemId;
  const item = getItem(baseItemId);
  const iconPath = item?.iconPath;

  if (iconPath && !imgError) {
    const url = resolveAssetUrl(iconPath);
    return (
      <img
        src={url}
        alt={item?.name || baseItemId}
        className={className}
        style={{
          width: size,
          height: size,
          objectFit: "contain",
          imageRendering: "auto",
          ...style,
        }}
        onError={() => setImgError(true)}
        draggable={false}
      />
    );
  }

  // Fallback to emoji
  return (
    <span className={className} style={style}>
      {getItemIcon(itemId)}
    </span>
  );
});
