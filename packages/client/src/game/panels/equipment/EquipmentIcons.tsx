import React from "react";

// ============================================================================
// SVG Icons for Equipment Slots (Clean monochrome design)
// ============================================================================

/** Helmet/Head slot icon */
export function HelmetIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M12 2C7 2 4 6 4 10v4c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2v-4c0-4-3-8-8-8z" />
      <path d="M4 12h16" />
      <path d="M8 16v2M16 16v2" />
    </svg>
  );
}

/** Weapon slot icon (crossed swords) */
export function WeaponIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M14.5 17.5L3 6V3h3l11.5 11.5" />
      <path d="M13 19l6-6" />
      <path d="M16 16l4 4" />
      <path d="M19 21l2-2" />
      <path d="M9.5 6.5L21 18V21h-3L6.5 9.5" />
    </svg>
  );
}

/** Body/Chest armor slot icon */
export function BodyIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M6 4l-2 2v12l2 2h12l2-2V6l-2-2" />
      <path d="M6 4h12" />
      <path d="M9 4v3c0 1.7 1.3 3 3 3s3-1.3 3-3V4" />
      <path d="M4 8h2M18 8h2" />
    </svg>
  );
}

/** Shield slot icon */
export function ShieldIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

/** Legs slot icon */
export function LegsIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M6 4h12v4l-1 12H7L6 8V4z" />
      <path d="M12 4v16" />
      <path d="M6 8h12" />
    </svg>
  );
}

/** Arrows/Ammo slot icon */
export function ArrowsIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {/* Arrow shaft */}
      <path d="M5 19L19 5" />
      {/* Arrow head */}
      <path d="M15 5h4v4" />
      {/* Arrow fletching */}
      <path d="M5 19l3-1M5 19l1-3" />
      {/* Second arrow (stacked) */}
      <path d="M8 16L18 6" strokeOpacity="0.5" />
    </svg>
  );
}

/** Boots slot icon */
export function BootsIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M7 3v8l-3 4v5h6l1-3h2l1 3h6v-5l-3-4V3" />
      <path d="M7 11h10" />
    </svg>
  );
}

/** Gloves slot icon */
export function GlovesIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M6 14V8a2 2 0 0 1 4 0v1a2 2 0 0 1 4 0v-1a2 2 0 0 1 4 0v6" />
      <path d="M6 14c0 4 2 7 6 7s6-3 6-7" />
      <path d="M10 9V6a2 2 0 0 0-4 0v2" />
    </svg>
  );
}

/** Cape slot icon */
export function CapeIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M8 3h8v2l1 14-5 3-5-3 1-14V3z" />
      <path d="M8 3c-1 0-2 1-2 2M16 3c1 0 2 1 2 2" />
      <path d="M9 7h6" />
    </svg>
  );
}

/** Amulet/Necklace slot icon */
export function AmuletIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M7 4c0 3 2 6 5 8 3-2 5-5 5-8" />
      <circle cx="12" cy="15" r="3" />
      <path d="M12 18v1" />
    </svg>
  );
}

/** Ring slot icon */
export function RingIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <ellipse cx="12" cy="14" rx="6" ry="4" />
      <ellipse cx="12" cy="14" rx="3.5" ry="2" />
      <path d="M10 7l2-4 2 4" />
      <path d="M10 7h4" />
      <path d="M12 7v3" />
    </svg>
  );
}

// ============================================================================
// Utility Button Icons
// ============================================================================

/** Stats icon (bar chart) */
export function StatsIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M18 20V10M12 20V4M6 20v-6" />
    </svg>
  );
}

/** Death/Skull icon */
export function DeathIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <circle cx="12" cy="10" r="7" />
      <circle cx="9" cy="9" r="1.5" fill="currentColor" />
      <circle cx="15" cy="9" r="1.5" fill="currentColor" />
      <path d="M8 17v4M12 17v4M16 17v4" />
      <path d="M9 14c.8.7 1.9 1 3 1s2.2-.3 3-1" />
    </svg>
  );
}
