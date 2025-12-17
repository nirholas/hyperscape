/**
 * LevelUpPopup - RuneScape-style level-up notification popup
 *
 * Features:
 * - Centered modal with skill icon and level
 * - Auto-dismiss after 5 seconds
 * - Click anywhere to dismiss early
 * - Non-blocking (player can continue actions)
 *
 * Fireworks animation added in Phase 3.
 * Unlocks section added in Phase 5.
 */

import { useEffect } from "react";
import styled, { keyframes } from "styled-components";
import { SKILL_ICONS } from "@hyperscape/shared";
import type { LevelUpEvent } from "./useLevelUpState";
import { capitalizeSkill } from "./utils";

/** Auto-dismiss duration in milliseconds */
const AUTO_DISMISS_MS = 5000;

// === ANIMATIONS ===

const fadeIn = keyframes`
  from {
    opacity: 0;
    transform: translate(-50%, -50%) scale(0.8);
  }
  to {
    opacity: 1;
    transform: translate(-50%, -50%) scale(1);
  }
`;

const pulseGlow = keyframes`
  0%, 100% {
    box-shadow:
      0 0 20px rgba(255, 215, 0, 0.4),
      0 0 40px rgba(255, 215, 0, 0.2),
      inset 0 0 20px rgba(255, 215, 0, 0.1);
  }
  50% {
    box-shadow:
      0 0 30px rgba(255, 215, 0, 0.6),
      0 0 60px rgba(255, 215, 0, 0.3),
      inset 0 0 30px rgba(255, 215, 0, 0.15);
  }
`;

const iconBounce = keyframes`
  0%, 100% {
    transform: scale(1);
  }
  50% {
    transform: scale(1.1);
  }
`;

// === STYLED COMPONENTS ===

const Overlay = styled.div`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 1000;
  pointer-events: auto;
  cursor: pointer;
`;

const PopupContainer = styled.div`
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  z-index: 1001;

  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 32px 48px;

  background: linear-gradient(
    180deg,
    rgba(20, 20, 30, 0.95) 0%,
    rgba(10, 10, 20, 0.98) 100%
  );
  border: 2px solid #ffd700;
  border-radius: 12px;

  animation:
    ${fadeIn} 0.3s ease-out,
    ${pulseGlow} 2s ease-in-out infinite;

  min-width: 280px;
  max-width: 400px;
`;

const SkillIconLarge = styled.div`
  font-size: 64px;
  line-height: 1;
  animation: ${iconBounce} 1s ease-in-out infinite;
  filter: drop-shadow(0 0 10px rgba(255, 215, 0, 0.5));
`;

const CongratsText = styled.div`
  font-size: 24px;
  font-weight: bold;
  color: #ffd700;
  text-shadow:
    0 0 10px rgba(255, 215, 0, 0.5),
    2px 2px 4px rgba(0, 0, 0, 0.8);
  text-align: center;
`;

const LevelText = styled.div`
  font-size: 18px;
  color: #ffffff;
  text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.8);
  text-align: center;
`;

const NewLevelBadge = styled.div`
  font-size: 32px;
  font-weight: bold;
  color: #ffffff;
  background: linear-gradient(180deg, #4a90d9 0%, #2c5aa0 100%);
  padding: 8px 24px;
  border-radius: 8px;
  border: 2px solid #6ab0ff;
  box-shadow:
    0 4px 12px rgba(0, 0, 0, 0.4),
    inset 0 1px 0 rgba(255, 255, 255, 0.2);
  text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.5);
`;

const ClickToContinue = styled.div`
  font-size: 12px;
  color: rgba(255, 255, 255, 0.6);
  margin-top: 8px;
  font-style: italic;
`;

// === COMPONENT ===

interface LevelUpPopupProps {
  event: LevelUpEvent;
  onDismiss: () => void;
}

export function LevelUpPopup({ event, onDismiss }: LevelUpPopupProps) {
  const { skill, newLevel } = event;
  const skillKey = skill.toLowerCase();
  const skillIcon = SKILL_ICONS[skillKey] || "\u2B50";

  // Auto-dismiss after timeout
  useEffect(() => {
    const timer = setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  return (
    <>
      <Overlay onClick={onDismiss} />
      <PopupContainer>
        <SkillIconLarge>{skillIcon}</SkillIconLarge>
        <CongratsText>Congratulations!</CongratsText>
        <LevelText>You've advanced a {capitalizeSkill(skill)} level!</LevelText>
        <NewLevelBadge>Level {newLevel}</NewLevelBadge>
        {/* UnlocksSection added in Phase 5 */}
        <ClickToContinue>Click anywhere to continue</ClickToContinue>
      </PopupContainer>
    </>
  );
}
