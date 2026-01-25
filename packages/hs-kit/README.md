# hs-kit

A standalone, reusable package for building customizable game UIs with draggable windows, tabs, presets, and edit mode. Designed for RS3-style interfaces with full accessibility support.

## Features

### Core Systems
- **Draggable Windows**: Move, resize, and layer windows with z-index management
- **Tab System**: Drag tabs between windows, merge and split panels, context menus
- **Edit Mode**: Lock/unlock interface customization with grid snapping (L key toggle)
- **Layout Presets**: Save and load UI layouts with F1-F4 hotkeys and IndexedDB persistence
- **Layout Sharing**: Generate share codes to share layouts with other players
- **Theme System**: Dark and light themes with full CSS variable support
- **Notification Badges**: Badge system for ribbon tabs and UI elements
- **Auto-collapse**: Panels collapse automatically after timeout
- **Headless Core**: Use just the hooks with your own styling
- **Styled Components**: Optional pre-built components with glassmorphism theme

### Game UI Components
- **Action Bars**: Combat ability bar with keybinds and cooldowns (RS3-style)
- **Minimap**: Resizable circular minimap with click-to-move and run orb
- **Ribbon**: Navigation ribbon with 5 categories and panel dropdowns
- **InterfaceManager**: Unified wrapper component for all hs-kit features

### Drag System
- **Pointer Drag**: Mouse/touch drag with activation threshold
- **Keyboard Drag**: Full keyboard accessibility (Space/Enter to grab, arrow keys to move)
- **Collision Detection**: 4 strategies (closestCenter, closestCorners, rectIntersection, pointerWithin)
- **Modifiers**: restrictToWindow, restrictToAxis, snapToGrid, composeModifiers
- **Auto-scroll**: Automatic scrolling when drag approaches viewport edges
- **Accessibility**: ARIA attributes, live region announcements, screen reader instructions

### Window System
- **8-direction Resize**: Resize from any edge or corner with minimum size constraints
- **Smart Snapping**: Grid snap (8px), edge snap, and alignment guides
- **Transparency Control**: Per-window transparency with backdrop blur

### Tab System
- **Tab Drag**: Drag tabs between windows with drop indicator
- **Context Menu**: Right-click for close tab, close others, split to new window
- **Tab Overflow**: Scroll buttons when tabs exceed container width

### Preset System
- **F1-F4 Hotkeys**: Quick load (F1-F4) and save (Shift+F1-F4)
- **Layout Validation**: Check for off-screen windows, required panels, occlusion
- **IndexedDB Persistence**: Automatic save/restore of layouts

## Installation

```bash
npm install hs-kit
# or
bun add hs-kit
```

## Quick Start

### Using Styled Components

```tsx
import { DragProvider, useWindowManager, useEditMode } from 'hs-kit';
import { Window, TabBar, EditModeOverlay, DragOverlay } from 'hs-kit/styled';

function App() {
  const { windows } = useWindowManager();
  const { mode } = useEditMode();

  return (
    <DragProvider>
      {mode === 'unlocked' && <EditModeOverlay />}
      {windows.map((w) => (
        <Window key={w.id} windowId={w.id}>
          <TabBar windowId={w.id} />
          <YourContent />
        </Window>
      ))}
      <DragOverlay />
    </DragProvider>
  );
}
```

### Using Headless Hooks

```tsx
import { useDrag, useDrop, useWindow, useEditMode } from 'hs-kit';

function MyCustomWindow({ id }: { id: string }) {
  const { window, updatePosition, bringToFront } = useWindow(id);
  const { mode } = useEditMode();
  const { isDragging, delta, dragHandleProps } = useDrag({
    id,
    type: 'window',
    disabled: mode === 'locked',
  });

  return (
    <div
      style={{
        position: 'absolute',
        left: window.position.x + (isDragging ? delta.x : 0),
        top: window.position.y + (isDragging ? delta.y : 0),
        width: window.size.width,
        height: window.size.height,
      }}
      onClick={bringToFront}
    >
      <div {...dragHandleProps}>Drag Handle</div>
      <div>Content</div>
    </div>
  );
}
```

### Keyboard Accessibility

```tsx
import { useKeyboardDrag } from 'hs-kit';

function AccessibleDraggable({ id }: { id: string }) {
  const { isDragging, keyboardDragProps, instructionsId, instructions } = 
    useKeyboardDrag({ id, type: 'item' });

  return (
    <>
      <div {...keyboardDragProps}>
        {isDragging ? 'Moving...' : 'Drag me'}
      </div>
      <span id={instructionsId} className="sr-only">{instructions}</span>
    </>
  );
}
```

## API Reference

### @dnd-kit Compatible API

hs-kit provides drop-in replacements for @dnd-kit, making migration easy:

```tsx
import {
  DndProvider,           // Replaces DndContext
  useDraggable,          // Same API as @dnd-kit/core
  useDroppable,          // Same API as @dnd-kit/core
  ComposableDragOverlay, // Replaces DragOverlay
  type DragStartEvent,
  type DragEndEvent,
} from 'hs-kit';

function InventoryGrid() {
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over) {
      moveItem(active.id, over.id);
    }
  };

  return (
    <DndProvider onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      {items.map((item) => (
        <DraggableItem key={item.id} item={item} />
      ))}
      <ComposableDragOverlay adjustToPointer>
        {({ item }) => <ItemPreview item={item} />}
      </ComposableDragOverlay>
    </DndProvider>
  );
}

function DraggableItem({ item }: { item: Item }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: item.id,
    data: { item },
  });

  return (
    <div ref={setNodeRef} {...attributes} {...listeners}>
      {item.name}
    </div>
  );
}
```

### Core Hooks

| Hook | Description |
|------|-------------|
| `useDrag` | Make an element draggable (returns `isDragging`, `delta`, `position`, `dragHandleProps`) |
| `useDrop` | Make an element a drop target (returns `isOver`, `canDrop`, `relativePosition`, `dropRect`, `dragItem`) |
| `useDraggable` | @dnd-kit compatible API (returns `attributes`, `listeners`, `setNodeRef`, `isDragging`, `transform`) |
| `useDroppable` | @dnd-kit compatible API (returns `setNodeRef`, `isOver`, `active`, `over`) |
| `useKeyboardDrag` | Keyboard-based drag and drop with full accessibility |
| `useWindow` | Manage single window state |
| `useWindowManager` | Manage all windows |
| `useResize` | 8-direction resize handles |
| `useSnap` | Grid and edge snapping |
| `useTabs` | Tab state within a window |
| `useTabDrag` | Drag tabs between windows (returns `isTabDragging`, `targetWindowId`, `setTargetWindow`) |
| `useTabContextMenu` | Right-click context menu for tabs |
| `useTabOverflow` | Tab scrolling when container overflows |
| `useEditMode` | Lock/unlock interface editing |
| `useGrid` | Grid snapping calculations |
| `useAlignmentGuides` | Smart alignment guides (returns `guides`, `snapToGuide`, `calculateGuides`) |
| `usePresets` | Save/load layout presets |
| `usePresetHotkeys` | F1-F4 hotkey support |
| `useLayoutValidation` | Validate layouts before saving |
| `useLayoutSharing` | Generate/import share codes for layouts |
| `useCloudSync` | Sync presets with server for cross-device persistence |
| `useAutoScroll` | Auto-scroll during drag operations |
| `useAutoCollapse` | Auto-collapse panels after timeout |
| `useRibbonAutoCollapse` | Ribbon-specific auto-collapse with panel tracking |
| `useBadge` | Single badge management |
| `useBadges` | Multiple badges management |
| `useAdvancedEditOptions` | Edit hidden/contextual panels in edit mode |
| `useTheme` | Get current theme |

### Collision Detection

```tsx
import { closestCenter, closestCorners, rectIntersection, pointerWithin } from 'hs-kit';

// Use different strategies for different scenarios
const targets = closestCenter(dragRect, dropTargets);
```

### Modifiers

```tsx
import { restrictToWindow, createSnapToGridModifier, composeModifiers } from 'hs-kit';

const modifier = composeModifiers([
  restrictToWindow(),
  createSnapToGridModifier(8),
]);
```

### Accessibility

```tsx
import { announce, getDraggableAriaAttributes, SCREEN_READER_INSTRUCTIONS } from 'hs-kit';

// Announce to screen readers
announce('Item picked up');

// Get ARIA attributes for draggable elements
const ariaProps = getDraggableAriaAttributes('item-1', isDragging);
```

### Styled Components

| Component | Description |
|-----------|-------------|
| `Window` | Styled draggable window with glassmorphism |
| `TabBar` | Horizontal tab strip with drag indicators |
| `Tab` | Single tab with close button |
| `TabContextMenu` | Right-click menu for tab operations |
| `DragOverlay` | Ghost element during drag |
| `EditModeOverlay` | Grid and toolbar overlay |
| `AlignmentGuides` | Visual snap guides |
| `TransparencySlider` | Window opacity control |
| `PresetPanel` | Save/load preset UI |
| `InterfaceManager` | Unified wrapper for all hs-kit features |
| `ActionBar` | Combat ability bar with keybinds and cooldowns |
| `Minimap` | Resizable circular minimap with run orb |
| `Ribbon` | Navigation ribbon with category dropdowns |

### Stores (Zustand)

```tsx
import { useDragStore, useWindowStore, useEditStore, usePresetStore, useThemeStore, useBadgeStore } from 'hs-kit';

// Access stores directly for advanced use cases
const isDragging = useDragStore((s) => s.isDragging);
const windows = useWindowStore((s) => s.getAllWindows());
const theme = useThemeStore((s) => s.theme);
```

## Theming

hs-kit supports dark and light themes with full CSS variable integration:

```tsx
import { useThemeStore, useTheme } from 'hs-kit';
import { themes, darkTheme, lightTheme } from 'hs-kit/styled';

// Get current theme
const theme = useTheme();

// Toggle between dark and light
function ThemeToggle() {
  const { themeName, toggleTheme } = useThemeStore();
  return (
    <button onClick={toggleTheme}>
      {themeName === 'dark' ? '🌙' : '☀️'}
    </button>
  );
}

// Access theme values
console.log(theme.colors.accent.primary); // #c9a54a
console.log(theme.spacing.md); // 16
console.log(theme.zIndex.modal); // 1000
```

## Layout Sharing

Share layouts with other players using encoded share codes:

```tsx
import { useLayoutSharing } from 'hs-kit';

function LayoutSharingUI() {
  const { generateShareCode, importFromShareCode, applySharedLayout, error } = useLayoutSharing();

  const handleShare = () => {
    const code = generateShareCode('My PvM Layout', true);
    navigator.clipboard.writeText(code);
  };

  const handleImport = (code: string) => {
    const layout = importFromShareCode(code);
    if (layout) {
      applySharedLayout(layout, true); // Scale to current resolution
    }
  };
}
```

## Cloud Sync

Sync layout presets with a server for cross-device persistence:

```tsx
import { useCloudSync } from 'hs-kit';

function LayoutSyncUI() {
  const {
    isSyncing,
    lastSyncAt,
    pushToCloud,
    pullFromCloud,
    error,
  } = useCloudSync({
    apiBaseUrl: '/api',
    userId: currentUser.id,
    autoSync: true, // Auto-sync on preset changes
    autoSyncDelay: 2000, // Debounce delay
  });

  return (
    <div>
      <button onClick={pullFromCloud} disabled={isSyncing}>
        {isSyncing ? 'Syncing...' : 'Load from Cloud'}
      </button>
      <button onClick={pushToCloud} disabled={isSyncing}>
        Save to Cloud
      </button>
      {lastSyncAt && <span>Last sync: {new Date(lastSyncAt).toLocaleString()}</span>}
      {error && <div className="error">{error}</div>}
    </div>
  );
}
```

The cloud sync requires server endpoints at:
- `GET /api/layouts?userId=...` - Fetch all presets
- `POST /api/layouts` - Save a preset
- `POST /api/layouts/sync` - Bulk sync all presets
- `DELETE /api/layouts/:slotIndex` - Delete a preset

## Notification Badges

Add notification badges to UI elements:

```tsx
import { useBadge, useBadges, BADGE_COLORS, getBadgeStyle } from 'hs-kit';

function RibbonTab({ id, label }: { id: string; label: string }) {
  const { badge, isVisible, setBadge, clearBadge } = useBadge(id);

  return (
    <button>
      {label}
      {isVisible && (
        <span style={getBadgeStyle(badge!)}>
          {badge!.count > 99 ? '99+' : badge!.count}
        </span>
      )}
    </button>
  );
}

// Set badges from anywhere
function NotificationHandler() {
  const { setBadge } = useBadge('community');
  
  useEffect(() => {
    setBadge(5, 'info', true); // 5 notifications, info type, pulsating
  }, []);
}
```

## Game UI Components

### InterfaceManager

The unified wrapper for all hs-kit features:

```tsx
import { InterfaceManager } from 'hs-kit/styled';

function Game() {
  return (
    <InterfaceManager
      showEditOverlay
      showDragOverlay
      enablePresetHotkeys
      enableEditHotkey
      onModeChange={(mode) => console.log('Mode:', mode)}
      renderWindow={(window) => <GameWindow window={window} />}
    >
      <GameViewport />
    </InterfaceManager>
  );
}
```

### Action Bars

RS3-style ability bars with keybinds:

```tsx
import { ActionBar, createActionBar } from 'hs-kit/styled';

function CombatUI() {
  const [bar] = useState(() => createActionBar(1));

  return (
    <ActionBar
      bar={bar}
      slotSize={40}
      onActionClick={(slot) => activateAbility(slot.action)}
      onLockToggle={() => setBar(b => ({ ...b, locked: !b.locked }))}
    />
  );
}
```

### Minimap

Resizable circular minimap:

```tsx
import { Minimap, createMinimapState } from 'hs-kit/styled';

function GameMinimap() {
  const [state] = useState(() => createMinimapState(200));

  return (
    <Minimap
      state={state}
      playerPosition={{ x: 3200, y: 3200 }}
      runEnergy={85}
      isRunning={true}
      onMinimapClick={(x, y) => walkTo(x, y)}
      onRunOrbClick={() => toggleRun()}
      icons={[
        { id: 'bank', type: 'object', x: 3205, y: 3210, icon: '🏦' },
      ]}
    />
  );
}
```

### Ribbon

Navigation ribbon with categories:

```tsx
import { Ribbon, DEFAULT_CATEGORIES } from 'hs-kit/styled';

function GameRibbon() {
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  return (
    <Ribbon
      categories={DEFAULT_CATEGORIES}
      activeCategory={activeCategory}
      onCategoryClick={setActiveCategory}
      onPanelClick={(panelId) => openPanel(panelId)}
      autoCollapse
      collapseDelay={3000}
    />
  );
}
```

## Dependencies

- `zustand` - State management
- React 18+ (peer dependency)

## Browser Support

- Modern browsers with ES2022 support
- IndexedDB for persistence (falls back gracefully)

## License

MIT
