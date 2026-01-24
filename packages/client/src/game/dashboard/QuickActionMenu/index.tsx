import { useState, useRef, useEffect } from "react";
import {
  Grid3X3,
  X,
  ChevronUp,
  ChevronDown,
  MapPin,
  Target,
  Zap,
  Backpack,
  Building2,
  Flame,
  TreePine,
  Fish,
  Anvil,
  Store,
  Swords,
  Package,
  Compass,
  Pickaxe,
  Square,
  Pause,
} from "lucide-react";
import type {
  QuickActionMenuProps,
  NearbyLocation,
  QuickCommand,
  InventoryItem,
  AvailableGoal,
} from "./types";
import { useQuickActionData } from "./useQuickActionData";
import { GAME_API_URL } from "../../../lib/api-config";

// Icon mapping for location types
const locationIcons: Record<string, React.ReactNode> = {
  bank: <Building2 size={16} />,
  furnace: <Flame size={16} />,
  tree: <TreePine size={16} />,
  fishing_spot: <Fish size={16} />,
  anvil: <Anvil size={16} />,
  store: <Store size={16} />,
  mob: <Swords size={16} />,
};

// Icon mapping for quick commands
const commandIcons: Record<string, React.ReactNode> = {
  Swords: <Swords size={18} />,
  TreePine: <TreePine size={18} />,
  Package: <Package size={18} />,
  Building2: <Building2 size={18} />,
  Fish: <Fish size={18} />,
  Pickaxe: <Pickaxe size={18} />,
  Square: <Square size={18} fill="currentColor" />,
  Pause: <Pause size={18} />,
};

// Section component for collapsible sections
function Section({
  title,
  icon,
  children,
  defaultOpen = true,
  count,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
  count?: number;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="border-b border-[#8b4513]/30 last:border-b-0">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-3 py-2 hover:bg-[#f2d08a]/5 transition-colors"
      >
        <div className="flex items-center gap-2 text-[#f2d08a]">
          {icon}
          <span className="text-sm font-medium">{title}</span>
          {count !== undefined && count > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#f2d08a]/20 text-[#f2d08a]">
              {count}
            </span>
          )}
        </div>
        {isOpen ? (
          <ChevronUp size={16} className="text-[#f2d08a]/60" />
        ) : (
          <ChevronDown size={16} className="text-[#f2d08a]/60" />
        )}
      </button>
      {isOpen && <div className="px-2 pb-2">{children}</div>}
    </div>
  );
}

// Nearby Locations Section
function NearbyLocationsSection({
  locations,
  onSelect,
}: {
  locations: NearbyLocation[];
  onSelect: (location: NearbyLocation) => void;
}) {
  if (locations.length === 0) {
    return (
      <div className="text-center py-3 text-[#e8ebf4]/40 text-xs">
        No locations nearby
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {locations.map((location) => (
        <button
          key={location.id}
          onClick={() => onSelect(location)}
          className="w-full flex items-center justify-between px-2 py-1.5 rounded-lg hover:bg-[#f2d08a]/10 transition-colors group"
        >
          <div className="flex items-center gap-2">
            <span className="text-[#f2d08a]/60 group-hover:text-[#f2d08a]">
              {locationIcons[location.type] || <MapPin size={16} />}
            </span>
            <span className="text-sm text-[#e8ebf4]/80 group-hover:text-[#e8ebf4]">
              {location.name}
            </span>
          </div>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#0b0a15]/50 text-[#f2d08a]/60">
            {location.distance}m
          </span>
        </button>
      ))}
    </div>
  );
}

// Available Goals Section
function AvailableGoalsSection({
  goals,
  onSelect,
  agentId,
  authToken,
}: {
  goals: AvailableGoal[];
  onSelect: (goal: AvailableGoal) => void;
  agentId: string;
  authToken?: string;
}) {
  const handleGoalSelect = async (goal: AvailableGoal) => {
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (authToken) {
        headers["Authorization"] = `Bearer ${authToken}`;
      }

      await fetch(`${GAME_API_URL}/api/agents/${agentId}/goal`, {
        method: "POST",
        headers,
        body: JSON.stringify({ goalId: goal.id }),
      });

      onSelect(goal);
    } catch (err) {
      console.error("Failed to set goal:", err);
    }
  };

  if (goals.length === 0) {
    return (
      <div className="text-center py-3 text-[#e8ebf4]/40 text-xs">
        No goals available
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {goals.map((goal) => (
        <button
          key={goal.id}
          onClick={() => handleGoalSelect(goal)}
          className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-[#f2d08a]/10 transition-colors text-left group"
        >
          <Compass
            size={16}
            className="text-[#f2d08a]/60 group-hover:text-[#f2d08a] flex-shrink-0"
          />
          <div className="flex-1 min-w-0">
            <div className="text-sm text-[#e8ebf4]/80 group-hover:text-[#e8ebf4] truncate">
              {goal.description}
            </div>
          </div>
          {goal.priority >= 70 && (
            <span className="text-[9px] px-1 py-0.5 rounded bg-[#f2d08a]/20 text-[#f2d08a] flex-shrink-0">
              Recommended
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

// Quick Commands Section
function QuickCommandsSection({
  commands,
  onSelect,
}: {
  commands: QuickCommand[];
  onSelect: (command: QuickCommand) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-1.5">
      {commands.map((cmd) => (
        <button
          key={cmd.id}
          onClick={() => cmd.available && onSelect(cmd)}
          disabled={!cmd.available}
          className={`flex flex-col items-center justify-center gap-1 p-2.5 rounded-lg transition-colors ${
            cmd.available
              ? "bg-[#1a1005] hover:bg-[#f2d08a]/10 border border-[#8b4513]/30 hover:border-[#f2d08a]/50"
              : "bg-[#0b0a15]/50 border border-[#8b4513]/20 opacity-50 cursor-not-allowed"
          }`}
          title={cmd.reason}
        >
          <span
            className={cmd.available ? "text-[#f2d08a]" : "text-[#f2d08a]/30"}
          >
            {commandIcons[cmd.icon] || <Zap size={18} />}
          </span>
          <span
            className={`text-[11px] ${cmd.available ? "text-[#e8ebf4]/80" : "text-[#e8ebf4]/30"}`}
          >
            {cmd.label}
          </span>
        </button>
      ))}
    </div>
  );
}

// Inventory Actions Section
function InventoryActionsSection({
  items,
  onAction,
}: {
  items: InventoryItem[];
  onAction: (item: InventoryItem, action: "equip" | "use" | "drop") => void;
}) {
  if (items.length === 0) {
    return (
      <div className="text-center py-3 text-[#e8ebf4]/40 text-xs">
        Inventory is empty
      </div>
    );
  }

  return (
    <div className="space-y-1 max-h-32 overflow-y-auto scrollbar-thin">
      {items.map((item) => (
        <div
          key={item.id}
          className="flex items-center justify-between px-2 py-1.5 rounded-lg bg-[#1a1005]/50 border border-[#8b4513]/20"
        >
          <div className="flex items-center gap-2 min-w-0">
            <Package size={14} className="text-[#f2d08a]/60 flex-shrink-0" />
            <span className="text-xs text-[#e8ebf4]/80 truncate">
              {item.name}
            </span>
            {item.quantity > 1 && (
              <span className="text-[10px] text-[#f2d08a]/60">
                x{item.quantity}
              </span>
            )}
          </div>
          <div className="flex gap-1 flex-shrink-0">
            {item.canEquip && (
              <button
                onClick={() => onAction(item, "equip")}
                className="px-1.5 py-0.5 text-[9px] rounded bg-[#f2d08a]/10 text-[#f2d08a] hover:bg-[#f2d08a]/20 transition-colors"
              >
                Equip
              </button>
            )}
            {item.canUse && (
              <button
                onClick={() => onAction(item, "use")}
                className="px-1.5 py-0.5 text-[9px] rounded bg-[#f2d08a]/10 text-[#f2d08a] hover:bg-[#f2d08a]/20 transition-colors"
              >
                Use
              </button>
            )}
            {item.canDrop && (
              <button
                onClick={() => onAction(item, "drop")}
                className="px-1.5 py-0.5 text-[9px] rounded bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
              >
                Drop
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// Main QuickActionMenu Component
export function QuickActionMenu({
  agentId,
  onCommandSend,
  authToken,
  disabled = false,
}: QuickActionMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const { data, loading, error } = useQuickActionData(
    agentId,
    isOpen,
    authToken,
  );

  // Close on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setIsExpanded(false);
      }
    }

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () =>
        document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isOpen]);

  // Close on Escape
  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
        setIsExpanded(false);
      }
    }

    if (isOpen) {
      document.addEventListener("keydown", handleEscape);
      return () => document.removeEventListener("keydown", handleEscape);
    }
  }, [isOpen]);

  const handleLocationSelect = (location: NearbyLocation) => {
    onCommandSend(`go to ${location.name}`);
    setIsOpen(false);
    setIsExpanded(false);
  };

  const handleGoalSelect = () => {
    // Goal is already set via API call in the section
    setIsOpen(false);
    setIsExpanded(false);
  };

  const handleCommandSelect = (command: QuickCommand) => {
    onCommandSend(command.command);
    setIsOpen(false);
    setIsExpanded(false);
  };

  const handleInventoryAction = (
    item: InventoryItem,
    action: "equip" | "use" | "drop",
  ) => {
    onCommandSend(`${action} ${item.name}`);
    setIsOpen(false);
    setIsExpanded(false);
  };

  return (
    <div ref={menuRef} className="relative">
      {/* Trigger Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        disabled={disabled}
        className={`p-2 transition-colors rounded-lg ${
          isOpen
            ? "text-[#f2d08a] bg-[#f2d08a]/10"
            : "text-[#f2d08a]/40 hover:text-[#f2d08a] hover:bg-[#f2d08a]/5"
        } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
        title="Quick Actions"
      >
        <Grid3X3 size={20} />
      </button>

      {/* Menu Panel */}
      {isOpen && (
        <div
          className={`absolute z-50 bg-[#0b0a15] border border-[#8b4513]/50 rounded-xl shadow-2xl shadow-black/50 overflow-hidden transition-all duration-300 ${
            isExpanded
              ? "bottom-full left-0 mb-2 w-[320px] max-h-[60vh]"
              : "bottom-full left-0 mb-2 w-[280px] max-h-[400px]"
          }`}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-[#8b4513]/30 bg-[#1a1005]/50">
            <span className="text-sm font-medium text-[#f2d08a]">
              Quick Actions
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="p-1 text-[#f2d08a]/40 hover:text-[#f2d08a] transition-colors rounded"
                title={isExpanded ? "Collapse" : "Expand"}
              >
                {isExpanded ? (
                  <ChevronDown size={16} />
                ) : (
                  <ChevronUp size={16} />
                )}
              </button>
              <button
                onClick={() => {
                  setIsOpen(false);
                  setIsExpanded(false);
                }}
                className="p-1 text-[#f2d08a]/40 hover:text-[#f2d08a] transition-colors rounded"
              >
                <X size={16} />
              </button>
            </div>
          </div>

          {/* Content */}
          <div
            className="overflow-y-auto scrollbar-thin"
            style={{ maxHeight: isExpanded ? "calc(60vh - 40px)" : "360px" }}
          >
            {loading && !data ? (
              <div className="flex items-center justify-center py-8">
                <div className="w-6 h-6 border-2 border-[#f2d08a]/20 border-t-[#f2d08a] rounded-full animate-spin" />
              </div>
            ) : error ? (
              <div className="text-center py-6 px-4">
                <p className="text-red-400 text-sm">{error}</p>
              </div>
            ) : (
              <>
                {/* Nearby Locations */}
                <Section
                  title="Nearby Locations"
                  icon={<MapPin size={16} />}
                  count={data?.nearbyLocations.length}
                  defaultOpen={true}
                >
                  <NearbyLocationsSection
                    locations={data?.nearbyLocations || []}
                    onSelect={handleLocationSelect}
                  />
                </Section>

                {/* Quick Commands */}
                <Section
                  title="Quick Commands"
                  icon={<Zap size={16} />}
                  defaultOpen={true}
                >
                  <QuickCommandsSection
                    commands={data?.quickCommands || []}
                    onSelect={handleCommandSelect}
                  />
                </Section>

                {/* Available Goals */}
                <Section
                  title="Goals"
                  icon={<Target size={16} />}
                  count={data?.availableGoals.length}
                  defaultOpen={isExpanded}
                >
                  <AvailableGoalsSection
                    goals={data?.availableGoals || []}
                    onSelect={handleGoalSelect}
                    agentId={agentId}
                    authToken={authToken}
                  />
                </Section>

                {/* Inventory Actions */}
                <Section
                  title="Inventory"
                  icon={<Backpack size={16} />}
                  count={data?.inventory.length}
                  defaultOpen={isExpanded}
                >
                  <InventoryActionsSection
                    items={data?.inventory || []}
                    onAction={handleInventoryAction}
                  />
                </Section>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default QuickActionMenu;
