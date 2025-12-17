/**
 * FireworksEffect - CSS-based fireworks animation for level-up celebration
 *
 * Creates multiple particle bursts that explode outward from the center.
 * Uses CSS animations for performance (GPU-accelerated transforms).
 *
 * Features:
 * - Multiple burst waves with staggered timing
 * - Particles radiate outward in a circle
 * - Gold, red, teal, blue, green color palette
 * - Sparkle/twinkle effect on particles
 */

import { useMemo } from "react";
import styled, { keyframes } from "styled-components";

// === CONFIGURATION ===

/** Number of particles per burst */
const PARTICLES_PER_BURST = 12;

/** Number of burst waves */
const BURST_COUNT = 3;

/** Particle colors (celebration palette) */
const PARTICLE_COLORS = [
  "#FFD700", // Gold
  "#FF6B6B", // Red/coral
  "#4ECDC4", // Teal
  "#45B7D1", // Sky blue
  "#96CEB4", // Mint green
  "#FFEAA7", // Light gold
  "#DDA0DD", // Plum
  "#98D8C8", // Seafoam
];

// === ANIMATIONS ===

/** Main explosion animation - particles fly outward and fade */
const explode = keyframes`
  0% {
    transform: translate(-50%, -50%) scale(0);
    opacity: 1;
  }
  20% {
    opacity: 1;
  }
  100% {
    transform: translate(-50%, -50%) scale(1);
    opacity: 0;
  }
`;

/** Sparkle/twinkle effect for individual particles */
const sparkle = keyframes`
  0%, 100% {
    filter: brightness(1);
  }
  50% {
    filter: brightness(1.5);
  }
`;

/** Secondary glow pulse */
const glowPulse = keyframes`
  0%, 100% {
    box-shadow: 0 0 4px currentColor, 0 0 8px currentColor;
  }
  50% {
    box-shadow: 0 0 8px currentColor, 0 0 16px currentColor, 0 0 24px currentColor;
  }
`;

// === STYLED COMPONENTS ===

const FireworksContainer = styled.div`
  position: absolute;
  top: 50%;
  left: 50%;
  width: 0;
  height: 0;
  pointer-events: none;
  z-index: -1;
`;

interface ParticleProps {
  $angle: number;
  $distance: number;
  $delay: number;
  $duration: number;
  $color: string;
  $size: number;
}

const Particle = styled.div<ParticleProps>`
  position: absolute;
  width: ${(props) => props.$size}px;
  height: ${(props) => props.$size}px;
  border-radius: 50%;
  background: ${(props) => props.$color};
  color: ${(props) => props.$color};
  left: ${(props) =>
    Math.cos((props.$angle * Math.PI) / 180) * props.$distance}px;
  top: ${(props) =>
    Math.sin((props.$angle * Math.PI) / 180) * props.$distance}px;
  transform: translate(-50%, -50%);

  animation:
    ${explode} ${(props) => props.$duration}s ease-out
      ${(props) => props.$delay}s forwards,
    ${sparkle} 0.3s ease-in-out ${(props) => props.$delay}s infinite,
    ${glowPulse} 0.5s ease-in-out ${(props) => props.$delay}s infinite;

  opacity: 0;
  animation-fill-mode: forwards;

  &::after {
    content: "";
    position: absolute;
    top: 50%;
    left: 50%;
    width: 100%;
    height: 100%;
    border-radius: 50%;
    background: inherit;
    transform: translate(-50%, -50%);
    filter: blur(2px);
    opacity: 0.6;
  }
`;

/** Trail effect for particles */
const Trail = styled.div<ParticleProps>`
  position: absolute;
  width: ${(props) => props.$size * 0.6}px;
  height: ${(props) => props.$size * 0.6}px;
  border-radius: 50%;
  background: ${(props) => props.$color};
  left: ${(props) =>
    Math.cos((props.$angle * Math.PI) / 180) * props.$distance * 0.5}px;
  top: ${(props) =>
    Math.sin((props.$angle * Math.PI) / 180) * props.$distance * 0.5}px;
  transform: translate(-50%, -50%);

  animation: ${explode} ${(props) => props.$duration * 0.8}s ease-out
    ${(props) => props.$delay + 0.05}s forwards;
  opacity: 0;
  filter: blur(1px);
`;

// === COMPONENT ===

interface ParticleData {
  id: string;
  angle: number;
  distance: number;
  delay: number;
  duration: number;
  color: string;
  size: number;
}

/**
 * Generate particle data for all bursts
 */
function generateParticles(): ParticleData[] {
  const particles: ParticleData[] = [];

  for (let burst = 0; burst < BURST_COUNT; burst++) {
    const burstDelay = burst * 0.15; // Stagger bursts
    const baseDistance = 60 + burst * 30; // Each burst goes further

    for (let i = 0; i < PARTICLES_PER_BURST; i++) {
      const angle = (i * 360) / PARTICLES_PER_BURST + burst * 15; // Offset each burst
      const randomOffset = (Math.random() - 0.5) * 20; // Add some randomness
      const distance = baseDistance + randomOffset;
      const delay = burstDelay + Math.random() * 0.1;
      const duration = 0.8 + Math.random() * 0.4;
      const color = PARTICLE_COLORS[(i + burst) % PARTICLE_COLORS.length];
      const size = 6 + Math.random() * 4 + (burst === 0 ? 2 : 0); // First burst slightly larger

      particles.push({
        id: `burst-${burst}-particle-${i}`,
        angle,
        distance,
        delay,
        duration,
        color,
        size,
      });
    }
  }

  return particles;
}

export function FireworksEffect() {
  // Memoize particles so they don't regenerate on re-render
  const particles = useMemo(() => generateParticles(), []);

  return (
    <FireworksContainer>
      {particles.map((p) => (
        <Particle
          key={p.id}
          $angle={p.angle}
          $distance={p.distance}
          $delay={p.delay}
          $duration={p.duration}
          $color={p.color}
          $size={p.size}
        />
      ))}
      {/* Add trails for first burst only (performance) */}
      {particles
        .filter((p) => p.id.startsWith("burst-0"))
        .map((p) => (
          <Trail
            key={`trail-${p.id}`}
            $angle={p.angle}
            $distance={p.distance}
            $delay={p.delay}
            $duration={p.duration}
            $color={p.color}
            $size={p.size}
          />
        ))}
    </FireworksContainer>
  );
}
