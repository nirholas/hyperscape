import React, { useState } from "react";
import { getItem } from "@hyperscape/shared";

/**
 * Helper to resolve asset paths for the client
 */
export function resolveAssetUrl(path: string): string {
  if (path.startsWith("asset://")) {
    const cdnUrl = import.meta.env.PUBLIC_CDN_URL || "http://localhost:8080";
    return path.replace("asset://", `${cdnUrl}/`);
  }
  return path;
}

/**
 * Item Icon Component
 * Renders either an image (if iconPath exists) or a fallback emoji
 * valid for Inventory, Bank, Store, Action Bar, etc.
 */
export function ItemIcon({
  itemId,
  size = "normal",
  className = "",
}: {
  itemId: string;
  size?: "normal" | "large";
  className?: string;
}) {
  const itemData = getItem(itemId);
  const iconPath = itemData?.iconPath;
  const [imageError, setImageError] = useState(false);

  // Fallback Emoji Logic
  const getEmoji = (itemId: string) => {
    const id = itemId.toLowerCase();

    // Weaponry
    if (
      id.includes("sword") ||
      id.includes("dagger") ||
      id.includes("scimitar")
    )
      return "⚔️";
    if (id.includes("bow")) return "🎯";
    if (id.includes("arrow") || id.includes("bolt")) return "🏹";

    // Armor
    if (id.includes("shield") || id.includes("defender")) return "🛡️";
    if (id.includes("helmet") || id.includes("helm") || id.includes("hat"))
      return "⛑️";
    if (
      id.includes("body") ||
      id.includes("platebody") ||
      id.includes("chainmail")
    )
      return "👕";
    if (id.includes("legs") || id.includes("platelegs")) return "👖";
    if (id.includes("boots") || id.includes("boot")) return "👢";
    if (id.includes("glove") || id.includes("gauntlet")) return "🧤";
    if (id.includes("cape") || id.includes("cloak")) return "🧥";

    // Jewelry
    if (id.includes("amulet") || id.includes("necklace")) return "📿";
    if (id.includes("ring")) return "💍";

    // Resources & Tools
    if (id.includes("pickaxe")) return "⛏️"; // Specific tool check first
    if (id.includes("hatchet") || id.includes("axe")) return "🪓";
    if (id.includes("fishing") || id.includes("rod")) return "🎣";
    if (id.includes("tinderbox")) return "🔥";

    if (id.includes("ore") || id.includes("bar")) return "🪨"; // Rock for ores/bars
    if (id.includes("log") || id.includes("wood")) return "🪵";
    if (
      id.includes("fish") ||
      id.includes("shrimp") ||
      id.includes("lobster") ||
      id.includes("shark")
    )
      return "🐟";
    if (id.includes("food") || id.includes("bread") || id.includes("meat"))
      return "🍖";

    // Magic & Misc
    if (id.includes("rune")) return "🔮";
    if (id.includes("potion") || id.includes("vial")) return "🧪";
    if (id.includes("bone")) return "🦴";
    if (id.includes("coins") || id.includes("gold")) return "🪙";

    return id.substring(0, 2).toUpperCase();
  };

  if (iconPath && !imageError) {
    return (
      <img
        src={resolveAssetUrl(iconPath)}
        alt={itemData?.name || itemId}
        className={`w-full h-full object-contain p-1 drop-shadow-md ${className}`}
        draggable={false}
        onError={() => setImageError(true)}
      />
    );
  }

  return (
    <div
      className={`flex items-center justify-center h-full w-full select-none ${className}`}
      style={{
        fontSize: size === "large" ? "1.5rem" : "1.25rem",
      }}
    >
      {getEmoji(itemId)}
    </div>
  );
}
