# Hyperscape Components

This directory contains Hyperscape RPG-specific components for monitoring and managing AI agents playing in the Hyperscape game world.

## 📁 Structure

```
components/hyperscape/
├── HyperscapeDashboard.tsx       # Main dashboard view
├── PlayerStatsPanel.tsx          # Player skills & stats display
├── InventoryViewer.tsx           # 28-slot inventory grid
└── index.ts                      # Component exports
```

## ✅ Components

### HyperscapeDashboard
**Purpose**: Main dashboard view combining all Hyperscape data
**Features**:
- Connection status indicator
- Quick stats cards (health, position, combat, nearby entities)
- Performance metrics overview
- Integrated PlayerStatsPanel and InventoryViewer
- Real-time data with auto-refresh

**Usage**:
```tsx
import { HyperscapeDashboard } from '@hyperscape/plugin-hyperscape/frontend';

<HyperscapeDashboard agentId="agent-123" />
```

### PlayerStatsPanel
**Purpose**: Display player's 9 RuneScape-style skills
**Features**:
- Grouped by category (Combat, Gathering, Processing)
- XP progress bars with percentages
- Level indicators
- Total level badge
- Individual skill tooltips

**Skills Displayed**:
- **Combat**: Attack, Strength, Defense, Constitution, Ranged
- **Gathering**: Woodcutting, Fishing
- **Processing**: Firemaking, Cooking

### InventoryViewer
**Purpose**: Visual 28-slot inventory display
**Features**:
- 7x4 grid layout (RuneScape-style)
- Item icons and quantities
- Stack indicators
- Hover tooltips with item details
- Inventory usage statistics
- Total value calculation

## 🔗 Related Files

### Hooks
**Location**: `src/frontend/hooks/hyperscape/useHyperscapeAgent.ts`

Custom React hooks for data fetching via WebSocket:
- `useHyperscapeAgent()` - Complete agent status
- `useWorldStatus()` - World connection status
- `usePlayerStats()` - Skill levels and XP
- `useInventory()` - Inventory items
- `usePosition()` - Player position
- `useNearbyEntities()` - Nearby players/mobs/objects
- `useCombatSession()` - Current combat state
- `usePerformanceMetrics()` - Performance stats
- `useHyperscapeDashboard()` - Combined data hook

**Location**: `src/frontend/hooks/use-hyperscape-plugin.ts`

Plugin detection hook:
- `useHyperscapePlugin(agentId)` - Detects if agent has Hyperscape plugin and provides WebSocket URL

**Location**: `src/frontend/hooks/use-hyperscape-websocket.ts`

WebSocket connection hook:
- `useHyperscapeWebSocket(options)` - Manages real-time connection to Hyperscape game server

### Types
**Location**: `src/frontend/types/hyperscape/index.ts`

TypeScript interfaces for:
- PlayerStats, PlayerHealth, CombatStats
- Inventory, Equipment, InventoryItem
- WorldPosition, NearbyEntity
- GameAction, AgentActivity
- CombatEvent, CombatSession
- PerformanceMetrics
- HyperscapeAgentStatus (complete agent state)

## 🎯 Integration Points

### WebSocket Connection
The UI connects directly to the Hyperscape game server via WebSocket:

```typescript
// Default connection
ws://localhost:5555/ws?agentId={agentId}

// Custom connection (stored in agent metadata)
agent.metadata.hyperscapeWorld = 'ws://custom-server:5555/ws'
```

### WebSocket Message Types
The Hyperscape server sends the following message types:

```typescript
// Full state update (sent on connection)
{ type: 'full_state', data: HyperscapeAgentStatus }

// Incremental updates
{ type: 'agent_status', data: HyperscapeAgentStatus }
{ type: 'player_stats', data: PlayerStats }
{ type: 'player_health', data: PlayerHealth }
{ type: 'inventory_update', data: Inventory }
{ type: 'position_update', data: WorldPosition }
{ type: 'nearby_entities', data: NearbyEntity[] }
{ type: 'combat_session', data: CombatSession }
{ type: 'performance_metrics', data: PerformanceMetrics }

// Error messages
{ type: 'error', error: string }
```

### Plugin Detection
The UI automatically detects if an agent has the Hyperscape plugin:

```typescript
// Check agent.plugins array for '@hyperscape/plugin-hyperscape' or '@elizaos/plugin-hyperscape'
const { isActive, worldUrl } = useHyperscapePlugin(agentId);

// Only shows Hyperscape tab if plugin is active
if (isActive) {
  // Connect to Hyperscape WebSocket at worldUrl
  // Display Hyperscape dashboard
}
```

## 📊 Data Flow

```
User opens agent with Hyperscape plugin
  ↓
useHyperscapePlugin detects plugin in agent.plugins
  ↓
HyperscapeDashboard component loads
  ↓
useHyperscapeWebSocket connects to ws://localhost:5555/ws?agentId={id}
  ↓
WebSocket sends 'request_state' message
  ↓
Hyperscape server responds with 'full_state' message
  ↓
Hook updates state with game data
  ↓
Data flows to child components:
  - PlayerStatsPanel (stats & skills)
  - InventoryViewer (inventory items)
  - Quick stat cards (health, position, etc.)
  ↓
WebSocket continues sending real-time updates
  ↓
User sees live game state with no polling
```

