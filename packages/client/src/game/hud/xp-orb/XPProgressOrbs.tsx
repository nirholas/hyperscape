/**
 * XPProgressOrbs - RuneLite-style XP progress orbs
 *
 * Circular progress indicators at top of screen:
 * - One orb per active skill
 * - Progress ring shows XP to next level
 * - Skill icon in center
 * - Hover tooltip with detailed XP info
 * - Level-up celebration animation
 * - Fade-out animation after inactivity
 *
 * Extracted from XPProgressOrb for Single Responsibility Principle (SRP)
 */

import styled, { keyframes, css } from "styled-components";
import { ORB_FADE_DURATION_MS } from "./useXPOrbState";
import type { SkillWithProgress } from "./useXPOrbState";

// Animation keyframes
const levelUpCelebration = keyframes`
  0% { transform: scale(1); filter: brightness(1); }
  25% { transform: scale(1.3); filter: brightness(1.5); }
  50% { transform: scale(1.1); filter: brightness(1.2); }
  100% { transform: scale(1); filter: brightness(1); }
`;

const fadeOutAnimation = keyframes`
  0% { opacity: 1; transform: scale(1); }
  100% { opacity: 0; transform: scale(0.8); }
`;

// Styled components

/** Container for multiple orbs displayed side by side */
const OrbsRow = styled.div`
  position: fixed;
  top: 20px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 1000;
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  gap: 8px;
  pointer-events: none;
`;

/** Individual orb container (one per skill) - supports fade-out animation */
const SingleOrbContainer = styled.div<{ $fading?: boolean }>`
  display: flex;
  flex-direction: column;
  align-items: center;
  pointer-events: none;
  ${({ $fading }) =>
    $fading &&
    css`
      animation: ${fadeOutAnimation} ${ORB_FADE_DURATION_MS}ms ease-out forwards;
    `}
`;

const OrbWrapper = styled.div<{ $isLevelUp?: boolean }>`
  position: relative;
  width: 64px;
  height: 64px;
  pointer-events: auto;
  cursor: pointer;
  ${({ $isLevelUp }) =>
    $isLevelUp &&
    css`
      animation: ${levelUpCelebration} 0.6s ease-out;
    `}
`;

const ProgressRing = styled.svg`
  transform: rotate(-90deg);
  width: 100%;
  height: 100%;
`;

const BackgroundCircle = styled.circle`
  fill: rgba(0, 0, 0, 0.7);
  stroke: rgba(255, 255, 255, 0.2);
  stroke-width: 3;
`;

const ProgressCircle = styled.circle<{ $progress: number }>`
  fill: none;
  stroke: #ffd700;
  stroke-width: 3;
  stroke-linecap: round;
  stroke-dasharray: ${({ $progress }) => {
    const circumference = 2 * Math.PI * 27;
    const filled = (circumference * $progress) / 100;
    return `${filled} ${circumference}`;
  }};
  transition: stroke-dasharray 0.3s ease;
`;

/** Single skill icon centered in the orb */
const SkillIcon = styled.div`
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  font-size: 24px;
  line-height: 1;
  text-shadow: 0 0 10px rgba(255, 215, 0, 0.5);
`;

/** Tooltip for hover info on individual orb */
const Tooltip = styled.div`
  position: absolute;
  top: 100%;
  left: 50%;
  transform: translateX(-50%);
  margin-top: 8px;
  background: rgba(0, 0, 0, 0.9);
  border: 1px solid #ffd700;
  border-radius: 6px;
  padding: 8px 12px;
  white-space: nowrap;
  z-index: 1001;
  pointer-events: none;

  color: #fff;
  font-size: 12px;
  line-height: 1.5;
`;

const TooltipRow = styled.div`
  display: flex;
  justify-content: space-between;
  gap: 16px;
`;

const TooltipLabel = styled.span`
  color: #aaa;
`;

const TooltipValue = styled.span`
  color: #ffd700;
  font-weight: bold;
`;

interface XPProgressOrbsProps {
  skills: SkillWithProgress[];
  levelUpSkill: string | null;
  hoveredSkill: string | null;
  onHoverSkill: (skill: string | null) => void;
}

export function XPProgressOrbs({
  skills,
  levelUpSkill,
  hoveredSkill,
  onHoverSkill,
}: XPProgressOrbsProps) {
  if (skills.length === 0) {
    return null;
  }

  return (
    <OrbsRow>
      {skills.map((skill) => {
        const isThisLevelUp = levelUpSkill === skill.skillKey;
        const isHovered = hoveredSkill === skill.skillKey;

        return (
          <SingleOrbContainer
            key={`orb-${skill.skillKey}`}
            $fading={skill.isFading}
          >
            <OrbWrapper
              $isLevelUp={isThisLevelUp}
              onMouseEnter={() => onHoverSkill(skill.skillKey)}
              onMouseLeave={() => onHoverSkill(null)}
            >
              <ProgressRing viewBox="0 0 64 64">
                <BackgroundCircle cx="32" cy="32" r="27" />
                <ProgressCircle
                  cx="32"
                  cy="32"
                  r="27"
                  $progress={skill.progress}
                />
              </ProgressRing>
              <SkillIcon>{skill.icon}</SkillIcon>

              {/* Hover tooltip for this specific skill */}
              {isHovered && (
                <Tooltip>
                  <TooltipRow>
                    <TooltipLabel>Level:</TooltipLabel>
                    <TooltipValue>{skill.level}</TooltipValue>
                  </TooltipRow>
                  <TooltipRow>
                    <TooltipLabel>Current XP:</TooltipLabel>
                    <TooltipValue>{skill.xp.toLocaleString()}</TooltipValue>
                  </TooltipRow>
                  <TooltipRow>
                    <TooltipLabel>XP to level:</TooltipLabel>
                    <TooltipValue>
                      {skill.xpToLevel.toLocaleString()}
                    </TooltipValue>
                  </TooltipRow>
                  <TooltipRow>
                    <TooltipLabel>Progress:</TooltipLabel>
                    <TooltipValue>{skill.progress.toFixed(1)}%</TooltipValue>
                  </TooltipRow>
                </Tooltip>
              )}
            </OrbWrapper>
          </SingleOrbContainer>
        );
      })}
    </OrbsRow>
  );
}
