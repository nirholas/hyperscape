# Level-Up Notification System - Implementation Plan

## Overview

Implement a RuneScape-style level-up notification system with audio, visual, and chat feedback when players advance skill levels.

---

## Current Architecture

### Existing Event Flow

```
Server: SkillsSystem.addXPInternal()
    ↓ Detects level-up (newLevel > oldLevel)
    ↓ Emits SKILLS_LEVEL_UP event (server-side only)
    ↓ Emits SKILLS_XP_GAINED event

Server: EventBridge.setupSkillEvents()
    ↓ Listens to SKILLS_XP_GAINED
    ↓ Sends "xpDrop" packet to client

Client: ClientNetwork.onXpDrop()
    ↓ Emits XP_DROP_RECEIVED event

Client: XPProgressOrb (useXPOrbState hook)
    ↓ Detects level-up by comparing previousLevelsRef
    ↓ Sets levelUpSkill state for 600ms
    ↓ Triggers orb celebration animation
```

### Key Files

| Component | Path | Purpose |
|-----------|------|---------|
| SkillsSystem | `packages/shared/src/systems/shared/character/SkillsSystem.ts` | XP calculation, level-up detection |
| EventBridge | `packages/server/src/systems/ServerNetwork/event-bridge.ts` | Server→Client event forwarding |
| ClientNetwork | `packages/shared/src/systems/client/ClientNetwork.ts` | Network packet → local event |
| XPProgressOrb | `packages/client/src/game/hud/xp-orb/` | Current XP orb UI |
| ClientAudio | `packages/shared/src/systems/client/ClientAudio.ts` | Audio playback system |
| Particles | `packages/shared/src/systems/shared/presentation/Particles.ts` | GPU particle effects |
| Chat | `packages/shared/src/systems/shared/presentation/Chat.ts` | Chat message system |
| CoreUI | `packages/client/src/game/CoreUI.tsx` | Main HUD container, Toast system |

---

## Implementation Plan

### Phase 0: Utility Functions

**New File:** `packages/client/src/game/hud/level-up/utils.ts`

```typescript
// packages/client/src/game/hud/level-up/utils.ts

/**
 * Normalize skill name to lowercase key
 * Matches the pattern in useXPOrbState.ts
 */
export function normalizeSkillName(skill: string): string {
  return skill.toLowerCase().replace(/\s+/g, "");
}

/**
 * Capitalize skill name for display
 * e.g., "woodcutting" -> "Woodcutting"
 */
export function capitalizeSkill(skill: string): string {
  return skill.charAt(0).toUpperCase() + skill.slice(1).toLowerCase();
}
```

### Phase 1: Create LevelUpNotification System

**New File:** `packages/client/src/game/hud/level-up/LevelUpNotification.tsx`

#### 1.1 Create Level-Up Event Listener Hook

```typescript
// packages/client/src/game/hud/level-up/useLevelUpState.ts
import { useState, useEffect, useCallback, useRef } from "react";
import { EventType } from "@hyperscape/shared";
import type { ClientWorld } from "../../../types";
import type { XPDropData } from "../xp-orb";
import { normalizeSkillName } from "./utils";

interface LevelUpEvent {
  skill: string;
  oldLevel: number;
  newLevel: number;
  timestamp: number;
}

export function useLevelUpState(world: ClientWorld) {
  const [levelUpQueue, setLevelUpQueue] = useState<LevelUpEvent[]>([]);
  const [currentLevelUp, setCurrentLevelUp] = useState<LevelUpEvent | null>(null);
  const previousLevelsRef = useRef<Record<string, number>>({});

  // Listen to XP_DROP_RECEIVED and detect level-ups
  useEffect(() => {
    const handleXPDrop = (data: XPDropData) => {
      const skillKey = normalizeSkillName(data.skill);
      const prevLevel = previousLevelsRef.current[skillKey];

      if (prevLevel !== undefined && data.newLevel > prevLevel) {
        // Level up detected!
        const event: LevelUpEvent = {
          skill: data.skill,
          oldLevel: prevLevel,
          newLevel: data.newLevel,
          timestamp: Date.now(),
        };
        setLevelUpQueue(prev => [...prev, event]);
      }
      previousLevelsRef.current[skillKey] = data.newLevel;
    };

    world.on(EventType.XP_DROP_RECEIVED, handleXPDrop);
    return () => world.off(EventType.XP_DROP_RECEIVED, handleXPDrop);
  }, [world]);

  // Process queue - show one level-up at a time
  useEffect(() => {
    if (!currentLevelUp && levelUpQueue.length > 0) {
      const [next, ...rest] = levelUpQueue;
      setCurrentLevelUp(next);
      setLevelUpQueue(rest);
    }
  }, [currentLevelUp, levelUpQueue]);

  const dismissLevelUp = useCallback(() => {
    setCurrentLevelUp(null);
  }, []);

  return { currentLevelUp, dismissLevelUp };
}
```

#### 1.2 Create Level-Up Popup Component

```typescript
// packages/client/src/game/hud/level-up/LevelUpPopup.tsx
import { SKILL_ICONS } from "@hyperscape/shared";
import { capitalizeSkill } from "./utils";

interface LevelUpPopupProps {
  event: LevelUpEvent;
  onDismiss: () => void;
}

export function LevelUpPopup({ event, onDismiss }: LevelUpPopupProps) {
  const { skill, newLevel } = event;
  const skillIcon = SKILL_ICONS[skill.toLowerCase()] || "⭐";

  // Auto-dismiss after 5 seconds
  useEffect(() => {
    const timer = setTimeout(onDismiss, 5000);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  return (
    <PopupContainer onClick={onDismiss}>
      <FireworksEffect />
      <SkillIconLarge>{skillIcon}</SkillIconLarge>
      <CongratsText>Congratulations!</CongratsText>
      <LevelText>
        You've advanced a {capitalizeSkill(skill)} level!
      </LevelText>
      <NewLevelBadge>Level {newLevel}</NewLevelBadge>
      <UnlocksSection skill={skill} level={newLevel} />
      <ClickToContinue>Click to continue</ClickToContinue>
    </PopupContainer>
  );
}
```

### Phase 2: Audio System Integration

**New File:** `packages/client/src/game/hud/level-up/levelUpAudio.ts`

#### 2.1 Programmatic Placeholder Sound

```typescript
// packages/client/src/game/hud/level-up/levelUpAudio.ts

/**
 * Placeholder level-up fanfare using Web Audio API
 * Generates an ascending major arpeggio (C-E-G-C)
 * Replace with actual audio file later
 */
export function playLevelUpSound(audioContext?: AudioContext): void {
  const ctx = audioContext || new (window.AudioContext || (window as any).webkitAudioContext)();

  // C major arpeggio: C5, E5, G5, C6
  const notes = [523.25, 659.25, 783.99, 1046.50];
  const noteDuration = 0.12;
  const noteGap = 0.08;

  notes.forEach((freq, i) => {
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);

    oscillator.frequency.value = freq;
    oscillator.type = "triangle"; // Softer than sine, more musical

    const startTime = ctx.currentTime + i * (noteDuration + noteGap);
    const endTime = startTime + noteDuration * 2;

    // Attack and decay envelope
    gainNode.gain.setValueAtTime(0, startTime);
    gainNode.gain.linearRampToValueAtTime(0.3, startTime + 0.02);
    gainNode.gain.exponentialRampToValueAtTime(0.01, endTime);

    oscillator.start(startTime);
    oscillator.stop(endTime);
  });
}

/**
 * Enhanced fanfare for milestone levels (10, 25, 50, 75, 99)
 */
export function playMilestoneLevelUpSound(audioContext?: AudioContext): void {
  const ctx = audioContext || new (window.AudioContext || (window as any).webkitAudioContext)();

  // Extended fanfare with harmony
  const melody = [523.25, 659.25, 783.99, 1046.50, 1318.51, 1046.50];
  const harmony = [261.63, 329.63, 392.00, 523.25, 659.25, 523.25];

  [melody, harmony].forEach((notes, voiceIdx) => {
    notes.forEach((freq, i) => {
      const oscillator = ctx.createOscillator();
      const gainNode = ctx.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);

      oscillator.frequency.value = freq;
      oscillator.type = voiceIdx === 0 ? "triangle" : "sine";

      const startTime = ctx.currentTime + i * 0.15;
      const volume = voiceIdx === 0 ? 0.25 : 0.15;

      gainNode.gain.setValueAtTime(0, startTime);
      gainNode.gain.linearRampToValueAtTime(volume, startTime + 0.02);
      gainNode.gain.exponentialRampToValueAtTime(0.01, startTime + 0.4);

      oscillator.start(startTime);
      oscillator.stop(startTime + 0.5);
    });
  });
}

/** Check if level is a milestone */
export function isMilestoneLevel(level: number): boolean {
  return [10, 25, 50, 75, 99].includes(level);
}
```

#### 2.2 Integrate with ClientAudio System

```typescript
// In LevelUpNotification component or hook:
import type { ClientAudio } from "@hyperscape/shared";

const playSound = useCallback((newLevel: number) => {
  // Get audio context from ClientAudio system (direct access on world)
  const audioSystem = world.audio as ClientAudio | undefined;
  const ctx = audioSystem?.ctx;

  // Check SFX volume setting
  const sfxVolume = audioSystem?.groupGains?.sfx?.gain?.value ?? 1;
  if (sfxVolume === 0) return; // SFX muted

  if (isMilestoneLevel(newLevel)) {
    playMilestoneLevelUpSound(ctx);
  } else {
    playLevelUpSound(ctx);
  }
}, [world]);
```

### Phase 3: Visual Effects

#### 3.1 CSS Fireworks Animation (HUD Layer)

```typescript
// packages/client/src/game/hud/level-up/LevelUpPopup.tsx

const fireworksAnimation = keyframes`
  0% {
    transform: scale(0);
    opacity: 1;
  }
  50% {
    opacity: 1;
  }
  100% {
    transform: scale(2);
    opacity: 0;
  }
`;

const FireworkParticle = styled.div<{ $delay: number; $angle: number }>`
  position: absolute;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: ${props => ['#FFD700', '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4'][props.$angle % 5]};
  animation: ${fireworksAnimation} 1s ease-out forwards;
  animation-delay: ${props => props.$delay}ms;
  transform-origin: center;
  left: 50%;
  top: 50%;
  margin-left: ${props => Math.cos(props.$angle * Math.PI / 180) * 60}px;
  margin-top: ${props => Math.sin(props.$angle * Math.PI / 180) * 60}px;
`;

function FireworksEffect() {
  // Create 12 particles in a circle
  const particles = Array.from({ length: 12 }, (_, i) => ({
    angle: i * 30,
    delay: Math.random() * 200,
  }));

  return (
    <FireworksContainer>
      {particles.map((p, i) => (
        <FireworkParticle key={i} $angle={p.angle} $delay={p.delay} />
      ))}
    </FireworksContainer>
  );
}
```

#### 3.2 Optional: 3D Particle Fireworks (World Space)

For future enhancement, use the existing Particles system:

```typescript
// Create fireworks emitter config
const fireworksConfig = {
  max: 100,
  rate: 0, // Burst mode
  burst: 50,
  life: [0.5, 1.0],
  speed: [2, 5],
  size: [0.1, 0.3],
  color: [[1, 0.84, 0], [1, 0.4, 0.4], [0.3, 0.8, 0.76]], // Gold, red, teal
  alpha: [1, 0],
  gravity: -2,
  spread: 360,
};
```

### Phase 4: Chat Message Integration

#### 4.1 Send Level-Up Message to Chat

```typescript
// In useLevelUpState.ts or LevelUpNotification component
import { uuid } from "@hyperscape/shared";
import type { Chat, ChatMessage } from "@hyperscape/shared";
import { capitalizeSkill } from "./utils";

const sendChatMessage = useCallback((skill: string, newLevel: number) => {
  // Access chat system directly on world
  const chatSystem = world.chat as Chat | undefined;

  if (chatSystem?.add) {
    const messageBody = `Congratulations! You've advanced a ${capitalizeSkill(skill)} level. You are now level ${newLevel}.`;

    const message: ChatMessage = {
      id: uuid(),
      from: "", // Empty = no [username] prefix, just game text (like OSRS)
      body: messageBody,
      text: messageBody, // For interface compatibility
      timestamp: Date.now(),
      createdAt: new Date().toISOString(),
    };

    chatSystem.add(message, false); // false = don't broadcast to server
  }
}, [world]);
```

### Phase 5: Skill Unlocks Data

**New File:** `packages/shared/src/data/skill-unlocks.ts`

```typescript
// packages/shared/src/data/skill-unlocks.ts

export interface SkillUnlock {
  level: number;
  description: string;
  type: "item" | "ability" | "area" | "quest";
}

export const SKILL_UNLOCKS: Record<string, SkillUnlock[]> = {
  attack: [
    { level: 1, description: "Bronze weapons", type: "item" },
    { level: 5, description: "Steel weapons", type: "item" },
    { level: 10, description: "Black weapons", type: "item" },
    { level: 20, description: "Mithril weapons", type: "item" },
    { level: 30, description: "Adamant weapons", type: "item" },
    { level: 40, description: "Rune weapons", type: "item" },
    { level: 60, description: "Dragon weapons", type: "item" },
  ],
  strength: [
    { level: 1, description: "Basic melee attacks", type: "ability" },
    // ... more unlocks
  ],
  woodcutting: [
    { level: 1, description: "Normal trees", type: "item" },
    { level: 15, description: "Oak trees", type: "item" },
    { level: 30, description: "Willow trees", type: "item" },
    { level: 45, description: "Maple trees", type: "item" },
    { level: 60, description: "Yew trees", type: "item" },
    { level: 75, description: "Magic trees", type: "item" },
  ],
  // ... all skills
};

export function getUnlocksAtLevel(skill: string, level: number): SkillUnlock[] {
  const skillUnlocks = SKILL_UNLOCKS[skill.toLowerCase()] || [];
  return skillUnlocks.filter(unlock => unlock.level === level);
}
```

---

## File Structure

```
packages/client/src/game/hud/level-up/
├── index.ts                    # Barrel exports
├── LevelUpNotification.tsx     # Main component (composition root)
├── LevelUpPopup.tsx            # Popup UI with fireworks
├── useLevelUpState.ts          # State management hook
├── levelUpAudio.ts             # Placeholder sound generation
├── FireworksEffect.tsx         # CSS fireworks animation
├── UnlocksSection.tsx          # Shows what unlocked at this level
└── utils.ts                    # Helper functions (normalizeSkillName, capitalizeSkill)

packages/shared/src/data/
└── skill-unlocks.ts            # Unlock data per skill per level
```

---

## Integration Points

### 1. Add to CoreUI

```typescript
// packages/client/src/game/CoreUI.tsx

import { LevelUpNotification } from "./hud/level-up";

// In the render function:
{ready && <LevelUpNotification world={world} />}
```

### 2. Export from Shared Package

```typescript
// packages/shared/src/data/index.ts
export * from "./skill-unlocks";

// packages/shared/src/index.client.ts
export { SKILL_UNLOCKS, getUnlocksAtLevel } from "./data/skill-unlocks";
```

---

## Implementation Phases Summary

| Phase | Description | Priority | Files |
|-------|-------------|----------|-------|
| **0** | Create utility functions | HIGH | `utils.ts` |
| **1** | Create LevelUpNotification component & state hook | HIGH | `useLevelUpState.ts`, `LevelUpNotification.tsx`, `LevelUpPopup.tsx` |
| **2** | Add placeholder audio (Web Audio API fanfare) | HIGH | `levelUpAudio.ts` |
| **3** | Add CSS fireworks animation | HIGH | `FireworksEffect.tsx`, `LevelUpPopup.tsx` |
| **4** | Integrate chat message | MEDIUM | `useLevelUpState.ts` |
| **5** | Add skill unlocks data | MEDIUM | `skill-unlocks.ts`, `UnlocksSection.tsx` |
| **6** | Integrate with CoreUI | HIGH | `CoreUI.tsx` |
| **7** | Polish & testing | LOW | All files |

---

## Technical Considerations

### 1. Event Deduplication

The XPProgressOrb already tracks level-ups via `previousLevelsRef`. The new LevelUpNotification should either:
- **Option A**: Share the same ref (extract to shared hook)
- **Option B**: Use its own ref (slight duplication but isolated)

**Recommendation**: Option B - keep systems isolated for SRP. The orb shows the celebration animation, the notification shows the popup. Both can independently detect level-ups.

### 2. Audio Context Reuse

Always reuse the ClientAudio system's AudioContext to avoid:
- Creating multiple contexts (browser limit)
- Issues with autoplay restrictions

### 3. Queue System

Multiple level-ups (e.g., gaining several levels at once) should queue and display one at a time, not stack.

### 4. Non-Blocking Design

Following RuneScape's design:
- Popup appears but doesn't block gameplay
- Auto-dismisses after 5 seconds
- Click anywhere to dismiss early
- Player can continue actions while popup is visible

### 5. Mobile Considerations

- Popup should be appropriately sized for touch
- Tap to dismiss should work
- Consider reduced particle count for performance

---

## Future Enhancements

1. **Skill-Specific Jingles**: Different audio for different skills (like OSRS)
2. **3D World Fireworks**: Use Particles system for world-space effects
3. **Level 99 Special**: Enhanced celebration for max level
4. **Broadcast Option**: Announce to other players ("Player has reached level 99 Woodcutting!")
5. **Achievement Integration**: Tie into broader achievement system
6. **Skill Guide Button**: Button to open full skill guide from popup

---

## Testing Checklist

- [ ] Level-up detected correctly from XP_DROP_RECEIVED
- [ ] Popup appears with correct skill icon and level
- [ ] Placeholder sound plays at correct volume
- [ ] Milestone levels play enhanced fanfare
- [ ] Fireworks animation displays correctly
- [ ] Chat message appears in chat box
- [ ] Popup auto-dismisses after 5 seconds
- [ ] Click dismisses popup early
- [ ] Multiple level-ups queue properly
- [ ] Works on mobile (touch dismiss)
- [ ] Respects SFX volume setting (mute = no sound)
- [ ] Build passes with no TypeScript errors
- [ ] No memory leaks (cleanup on unmount)
