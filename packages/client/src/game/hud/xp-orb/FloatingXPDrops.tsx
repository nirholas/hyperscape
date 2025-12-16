/**
 * FloatingXPDrops - Floating XP numbers that rise toward orbs
 *
 * RS3-style visual feedback:
 * - Gold text with skill icons
 * - Multiple skills grouped into single floating element (game tick grouping)
 * - Float-up animation with fade-out
 *
 * Extracted from XPProgressOrb for Single Responsibility Principle (SRP)
 */

import styled, { keyframes } from "styled-components";
import { SKILL_ICONS } from "@hyperscape/shared";
import type { GroupedXPDrop } from "./useXPOrbState";

// Floating XP drop animation - plain text rising up
const floatUpAnimation = keyframes`
  0% {
    top: 33vh;
    opacity: 1;
  }
  80% {
    opacity: 1;
  }
  100% {
    top: 80px;
    opacity: 0;
  }
`;

// Floating XP drop element - plain text, no background
// RS3 style: multiple skill icons grouped together with total XP
const FloatingXP = styled.div`
  position: fixed;
  left: 50%;
  transform: translateX(-50%);
  z-index: 999;
  pointer-events: none;
  animation: ${floatUpAnimation} 1.5s ease-out forwards;

  display: flex;
  align-items: center;
  gap: 2px;

  color: #ffd700;
  font-size: 20px;
  font-weight: bold;
  text-shadow:
    -1px -1px 0 #000,
    1px -1px 0 #000,
    -1px 1px 0 #000,
    1px 1px 0 #000,
    0 0 8px rgba(0, 0, 0, 0.8);
  white-space: nowrap;
`;

const FloatingXPIcons = styled.span`
  display: flex;
  align-items: center;
  gap: 1px;
  font-size: 18px;
`;

const FloatingXPAmount = styled.span`
  margin-left: 4px;
`;

interface FloatingXPDropsProps {
  drops: GroupedXPDrop[];
}

export function FloatingXPDrops({ drops }: FloatingXPDropsProps) {
  if (drops.length === 0) {
    return null;
  }

  return (
    <>
      {drops.map((drop) => (
        <FloatingXP key={drop.id}>
          <FloatingXPIcons>
            {drop.skills.map((s, i) => {
              const dropIcon = SKILL_ICONS[s.skill.toLowerCase()] || "\u2B50";
              return <span key={`${drop.id}-${s.skill}-${i}`}>{dropIcon}</span>;
            })}
          </FloatingXPIcons>
          <FloatingXPAmount>+{drop.totalAmount}</FloatingXPAmount>
        </FloatingXP>
      ))}
    </>
  );
}
