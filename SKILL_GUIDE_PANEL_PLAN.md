# Skill Guide Panel Implementation Plan

## Overview

This document outlines the implementation plan for adding OSRS-style Skill Guide panels to Hyperscape. When a player clicks on a skill in their Skills tab, a panel opens showing what they can unlock at each level.

**Core Features:**
- Click any skill in Skills Panel to open its guide
- Shows all unlocks with level requirements
- Visual distinction between unlocked (achieved) and locked (future) items
- Scrollable list for skills with many unlocks
- Type indicators (item vs ability)
- Matches existing OSRS-style UI theme

---

## OSRS Reference: How Skill Guides Work

### UX Flow (from [OSRS Wiki](https://oldschool.runescape.wiki/w/Skills))

1. **Trigger**: Player clicks on a skill icon in the Skills tab
2. **Panel Opens**: A dedicated interface appears showing that skill's guide
3. **Content**: Lists everything unlockable at each level with:
   - Level requirement number
   - Description of what's unlocked
   - Visual indicator if already achieved
4. **Categories**: Some skills have sub-tabs (e.g., Agility has "courses" tab)
5. **Close**: Click X or click outside to close

### Visual Design Elements

- Dark brown background matching game theme
- Gold/yellow accent colors for level numbers
- Green checkmarks or highlights for unlocked content
- Grayed out or dimmed appearance for locked content
- Scrollable when content exceeds panel height
- Header showing skill name and icon

---

## Current Codebase Analysis

### 1. SkillsPanel.tsx (Current Implementation)

**File:** `packages/client/src/game/panels/SkillsPanel.tsx`

**Current State:**
- Displays 12 skills in a grid layout (ranged is hidden for melee-only MVP)
- Skills: attack, constitution, strength, defense, woodcutting, mining, fishing, firemaking, cooking, smithing, agility, prayer
- Each skill shows icon, level, and XP on hover
- **No click handler** - skills are display-only
- Uses `SkillBox` component (lines 47-121) for each skill

**Key Code Pattern:**
```tsx
const skills: Skill[] = [
  {
    key: "attack",
    label: "Attack",
    icon: "⚔️",
    level: s?.attack?.level || 1,
    xp: s?.attack?.xp || 0,
  },
  // ... more skills
];
```

### 2. skill-unlocks.json (Data Source)

**File:** `packages/server/world/assets/manifests/skill-unlocks.json`

**Structure:**
```json
{
  "skills": {
    "skillName": [
      {
        "level": 1,
        "description": "Bronze weapons, Iron weapons",
        "type": "item"
      },
      {
        "level": 40,
        "description": "Rune weapons",
        "type": "item"
      }
    ]
  }
}
```

**Current Skills with Unlocks:**
| Skill | Unlock Count | Level Range |
|-------|--------------|-------------|
| attack | 9 | 1-75 |
| strength | 2 | 1-99 |
| defence | 10 | 1-70 |
| constitution | 2 | 10-99 |
| prayer | 29 | 1-77 |
| woodcutting | 9 | 1-90 |
| mining | 8 | 1-85 |
| fishing | 10 | 1-76 |
| cooking | 10 | 1-80 |
| firemaking | 9 | 1-90 |
| smithing | 8 | 1-85 |
| agility | 6 | 1-99 |

**Type Values:**
- `"item"` - Equipment, resources, or craftable items
- `"ability"` - Passive bonuses, prayers, or unlocked actions

### 3. Existing Panel Patterns

**DialoguePanel.tsx** - Simple modal pattern:
```tsx
interface DialoguePanelProps {
  visible: boolean;
  onClose: () => void;
  // ...data props
}

if (!visible) return null;
// render panel
```

**BankPanel.tsx** - Complex scrollable grid:
- Fixed positioning with z-[9999]
- Tab system for categories
- Scrollable content area
- Close button in header

**SmithingPanel.tsx** - Selection interface:
- Category grouping
- Level requirement display
- Locked/unlocked states

### 4. Color Palette (Extracted from existing panels)

```
Primary Gold:     #c9b386
Bright Yellow:    #ffff00 (level numbers)
Gold Accent:      #fbbf24
Dark Brown BG:    rgba(20, 15, 10, 0.95)
Medium Brown:     rgba(30, 20, 10, 0.9)
Border Brown:     rgba(139, 69, 19, 0.6)
Unlocked Green:   #22c55e
Locked Gray:      #6b7280
Locked Red:       #ef4444
```

---

## Implementation Plan

### Phase 1: Data Infrastructure (ALREADY EXISTS)

**Status:** Complete - no work needed.

The skill unlocks system already exists in `packages/shared/src/data/skill-unlocks.ts`:

```typescript
// Already available exports from @hyperscape/shared:
import {
  getAllSkillUnlocks,      // Get all skill unlocks
  getUnlocksAtLevel,       // Get unlocks at specific level
  getUnlocksUpToLevel,     // Get unlocks up to level
  SkillUnlock,             // Type interface
} from "@hyperscape/shared";

// SkillUnlock interface already defined:
interface SkillUnlock {
  level: number;
  description: string;
  type: "item" | "ability" | "area" | "quest" | "activity";
}
```

Data is loaded automatically via DataManager from `skill-unlocks.json` manifest.

---

### Phase 2: SkillGuidePanel Component

**Goal:** Create the popup panel that displays skill unlocks.

#### 2.1 Create SkillGuidePanel.tsx

**File:** `packages/client/src/game/panels/SkillGuidePanel.tsx`

**Props Interface:**
```typescript
interface SkillGuidePanelProps {
  visible: boolean;
  skillKey: string;           // "attack", "mining", etc.
  skillLabel: string;         // "Attack", "Mining", etc.
  skillIcon: string;          // "⚔️", "⛏️", etc.
  playerLevel: number;        // Current player level in this skill
  unlocks: SkillUnlock[];     // From skill-unlocks.json
  onClose: () => void;
}
```

**Component Structure:**
```
┌─────────────────────────────────────┐
│ [Icon] Skill Name Guide        [X] │  <- Header
├─────────────────────────────────────┤
│ Your Level: 45                      │  <- Current level
├─────────────────────────────────────┤
│ ┌─────────────────────────────────┐ │
│ │ ✓ Lvl 1   Bronze weapons       │ │  <- Unlocked (green)
│ │ ✓ Lvl 5   Steel weapons        │ │
│ │ ✓ Lvl 40  Rune weapons         │ │
│ │ 🔒 Lvl 60 Dragon weapons       │ │  <- Locked (dimmed)
│ │ 🔒 Lvl 70 Abyssal whip         │ │
│ │ 🔒 Lvl 75 Godswords            │ │
│ └─────────────────────────────────┘ │  <- Scrollable
└─────────────────────────────────────┘
```

**Key Features:**
- Portal render for proper z-index layering
- Click outside to close
- ESC key to close
- Smooth scroll for long lists
- Type badge (item/ability) with different colors
- Handle empty unlocks gracefully (show "No unlocks data available" message)

#### 2.2 Unlock Row Component

```typescript
interface UnlockRowProps {
  unlock: SkillUnlock;
  isUnlocked: boolean;  // playerLevel >= unlock.level
}
```

**Visual States:**
- **Unlocked**: Green checkmark, full opacity, gold level number
- **Locked**: Lock icon, 60% opacity, gray level number
- **Next Unlock**: Highlighted border (optional enhancement)

---

### Phase 3: Integration with SkillsPanel

**Goal:** Add click handlers to open the guide panel.

#### 3.1 Modify SkillBox Component

**File:** `packages/client/src/game/panels/SkillsPanel.tsx`

**Current SkillBox signature (line 47-55):**
```typescript
function SkillBox({
  skill,
  onHover,
  onLeave,
}: {
  skill: Skill;
  onHover: (skill: Skill, e: React.MouseEvent) => void;
  onLeave: () => void;
})
```

**Add onClick prop:**
```typescript
function SkillBox({
  skill,
  onHover,
  onLeave,
  onClick,  // NEW
}: {
  skill: Skill;
  onHover: (skill: Skill, e: React.MouseEvent) => void;
  onLeave: () => void;
  onClick: (skill: Skill) => void;  // NEW
})
```

**Modify the button element (currently line 57):**
```tsx
<button
  className="relative group flex flex-col items-center p-0.5"
  onMouseEnter={(e) => onHover(skill, e)}
  onMouseMove={(e) => onHover(skill, e)}
  onMouseLeave={onLeave}
  onClick={() => onClick(skill)}  // NEW
  style={{
    // ... existing styles
    cursor: "pointer",  // CHANGE from "default"
  }}
>
```

#### 3.2 Add State to SkillsPanel

```typescript
const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);
const [isGuideOpen, setIsGuideOpen] = useState(false);

const handleSkillClick = (skill: Skill) => {
  setSelectedSkill(skill);
  setIsGuideOpen(true);
};

const handleGuideClose = () => {
  setIsGuideOpen(false);
  setSelectedSkill(null);
};
```

#### 3.3 Import and Render SkillGuidePanel

```tsx
// At top of SkillsPanel.tsx
import { getAllSkillUnlocks } from "@hyperscape/shared";
import { SkillGuidePanel } from "./SkillGuidePanel";

// Inside component, get unlocks data
const skillUnlocks = getAllSkillUnlocks();

// Render the panel
{selectedSkill && (
  <SkillGuidePanel
    visible={isGuideOpen}
    skillKey={selectedSkill.key}
    skillLabel={selectedSkill.label}
    skillIcon={selectedSkill.icon}
    playerLevel={selectedSkill.level}
    unlocks={skillUnlocks[selectedSkill.key] || []}
    onClose={handleGuideClose}
  />
)}
```

---

### Phase 4: Polish & Enhancements

#### 4.1 Animations
- Fade in/out on open/close
- Subtle slide up animation

#### 4.2 Progress Indicator
- Show "X of Y unlocks achieved"
- Optional progress bar

#### 4.3 Next Unlock Highlight
- Highlight the next unlock the player is working toward
- Show "X more levels to unlock..."

#### 4.4 Sound Effects (Optional)
- Panel open sound
- Matches existing UI sounds

---

## File Change Checklist

### New Files
- [ ] `packages/client/src/game/panels/SkillGuidePanel.tsx` - Main panel component

### Modified Files
- [ ] `packages/client/src/game/panels/SkillsPanel.tsx` - Add click handlers and state

### Bug Fix Required
- [ ] `packages/shared/src/data/skill-unlocks.ts` - Add spelling normalization for "defence" → "defense"
  - The JSON uses British spelling "defence" but UI uses American "defense"
  - Add alias mapping in `loadSkillUnlocks()` or `getSkillUnlocks()`:
    ```typescript
    // In loadSkillUnlocks(), after loading:
    if (loadedUnlocks["defence"] && !loadedUnlocks["defense"]) {
      loadedUnlocks["defense"] = loadedUnlocks["defence"];
    }
    ```

### No Changes Needed
- `skill-unlocks.json` - Already has all the data we need (keep British spelling for OSRS accuracy)
- Server files - No backend changes required (client-only feature)
- `packages/shared/src/index.ts` - Already exports skill unlocks

---

## Detailed Component Specifications

### SkillGuidePanel.tsx

```typescript
import React, { useEffect } from "react";
import { createPortal } from "react-dom";
import type { SkillUnlock } from "@hyperscape/shared";

interface SkillGuidePanelProps {
  visible: boolean;
  skillKey: string;
  skillLabel: string;
  skillIcon: string;
  playerLevel: number;
  unlocks: readonly SkillUnlock[];
  onClose: () => void;
}

export function SkillGuidePanel({
  visible,
  skillKey,
  skillLabel,
  skillIcon,
  playerLevel,
  unlocks,
  onClose,
}: SkillGuidePanelProps) {
  // Close on ESC key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    if (visible) {
      window.addEventListener("keydown", handleKeyDown);
      return () => window.removeEventListener("keydown", handleKeyDown);
    }
  }, [visible, onClose]);

  if (!visible) return null;

  const sortedUnlocks = [...unlocks].sort((a, b) => a.level - b.level);
  const unlockedCount = unlocks.filter(u => u.level <= playerLevel).length;

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="relative bg-[rgba(20,15,10,0.98)] border-2 border-[rgba(139,69,19,0.8)] rounded-lg shadow-2xl w-80 max-h-[500px] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-3 border-b border-[rgba(139,69,19,0.5)]">
          <div className="flex items-center gap-2">
            <span className="text-2xl">{skillIcon}</span>
            <span className="text-[#c9b386] font-bold">{skillLabel} Guide</span>
          </div>
          <button onClick={onClose} className="text-[#c9b386] hover:text-white">
            ✕
          </button>
        </div>

        {/* Current Level */}
        <div className="px-3 py-2 text-sm text-[#c9b386] border-b border-[rgba(139,69,19,0.3)]">
          Your Level: <span className="text-[#ffff00] font-bold">{playerLevel}</span>
          <span className="float-right text-xs">
            {unlockedCount}/{unlocks.length} unlocked
          </span>
        </div>

        {/* Unlocks List */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {sortedUnlocks.length === 0 ? (
            <div className="text-center text-gray-400 py-4">
              No unlock data available for this skill.
            </div>
          ) : (
            sortedUnlocks.map((unlock, idx) => (
              <UnlockRow
                key={idx}
                unlock={unlock}
                isUnlocked={playerLevel >= unlock.level}
              />
            ))
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
```

### UnlockRow Component

```typescript
interface UnlockRowProps {
  unlock: SkillUnlock;
  isUnlocked: boolean;
}

function UnlockRow({ unlock, isUnlocked }: UnlockRowProps) {
  return (
    <div
      className={`
        flex items-center gap-2 p-2 rounded
        ${isUnlocked
          ? "bg-[rgba(34,197,94,0.1)] border border-[rgba(34,197,94,0.3)]"
          : "bg-[rgba(0,0,0,0.2)] opacity-60"
        }
      `}
    >
      {/* Status Icon */}
      <span className={isUnlocked ? "text-green-500" : "text-gray-500"}>
        {isUnlocked ? "✓" : "🔒"}
      </span>

      {/* Level Badge */}
      <span className={`
        w-12 text-center text-sm font-bold rounded px-1
        ${isUnlocked ? "text-[#ffff00]" : "text-gray-400"}
      `}>
        Lvl {unlock.level}
      </span>

      {/* Description */}
      <span className={`flex-1 text-sm ${isUnlocked ? "text-white" : "text-gray-400"}`}>
        {unlock.description}
      </span>

      {/* Type Badge */}
      <span className={`
        text-xs px-1.5 py-0.5 rounded
        ${unlock.type === "item"
          ? "bg-blue-900/50 text-blue-300"
          : "bg-purple-900/50 text-purple-300"
        }
      `}>
        {unlock.type}
      </span>
    </div>
  );
}
```

---

## Testing Checklist

- [ ] Click on each skill opens correct guide
- [ ] Correct unlocks shown for each skill (especially Defense - verify spelling normalization works)
- [ ] Player's current level displayed correctly
- [ ] Unlocked items show green/checkmark
- [ ] Locked items show dimmed/lock icon
- [ ] Scroll works for skills with many unlocks (Prayer has 29!)
- [ ] Click outside closes panel
- [ ] ESC key closes panel
- [ ] X button closes panel
- [ ] Panel doesn't interfere with other UI elements
- [ ] Works on different screen sizes
- [ ] Empty unlocks handled gracefully (shows appropriate message)

---

## Future Enhancements (Out of Scope)

1. **Search/Filter** - Filter unlocks by type or search by name
2. **Goal Setting** - Mark specific unlocks as goals
3. **XP Calculator** - Show XP needed to reach specific levels
4. **Training Tips** - Add tips for how to train each skill
5. **Sub-categories** - Group unlocks by type (weapons, armor, etc.)

---

## Resources

- [OSRS Wiki - Skills](https://oldschool.runescape.wiki/w/Skills)
- [OSRS Wiki - Interface](https://oldschool.runescape.wiki/w/Interface)
- Existing panel implementations in `packages/client/src/game/panels/`
