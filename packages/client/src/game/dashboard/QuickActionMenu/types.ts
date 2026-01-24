export interface NearbyLocation {
  id: string;
  name: string;
  type:
    | "bank"
    | "furnace"
    | "tree"
    | "fishing_spot"
    | "anvil"
    | "store"
    | "mob";
  distance: number;
}

export interface AvailableGoal {
  id: string;
  type: string;
  description: string;
  priority: number;
}

export interface QuickCommand {
  id: string;
  label: string;
  command: string;
  icon: string;
  available: boolean;
  reason?: string;
}

export interface InventoryItem {
  id: string;
  name: string;
  slot: number;
  quantity: number;
  canEquip: boolean;
  canUse: boolean;
  canDrop: boolean;
}

export interface QuickActionsData {
  nearbyLocations: NearbyLocation[];
  availableGoals: AvailableGoal[];
  quickCommands: QuickCommand[];
  inventory: InventoryItem[];
  playerPosition: [number, number, number] | null;
}

export interface QuickActionMenuProps {
  agentId: string;
  onCommandSend: (command: string) => void;
  authToken?: string;
  disabled?: boolean;
}
