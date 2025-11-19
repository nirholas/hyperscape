/**
 * InventoryViewer Component
 *
 * Displays player's 28-slot inventory in a RuneScape-style grid.
 * Shows item icons, quantities, and provides hover information.
 */

import React from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useInventory } from "../../hooks/hyperscape/useHyperscapeAgent.js";
import type { InventoryItem } from "../../types/hyperscape/index.js";
import { Package, Package2 } from "lucide-react";

import type { UUID } from "@elizaos/core";

interface InventoryViewerProps {
  agentId: UUID | string;
}

const INVENTORY_ROWS = 4;
const INVENTORY_COLS = 7;
const TOTAL_SLOTS = 28;

export function InventoryViewer({ agentId }: InventoryViewerProps) {
  const {
    data: inventory,
    isLoading,
    error,
  } = useInventory(agentId as UUID | undefined);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Package className="w-5 h-5" />
            Inventory
          </CardTitle>
          <CardDescription>Loading inventory...</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-7 gap-1">
            {[...Array(TOTAL_SLOTS)].map((_, i) => (
              <div
                key={i}
                className="aspect-square bg-muted animate-pulse rounded"
              />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Package className="w-5 h-5" />
            Inventory
          </CardTitle>
          <CardDescription className="text-destructive">
            Failed to load inventory
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {error instanceof Error ? error.message : "Unknown error"}
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!inventory) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Package className="w-5 h-5" />
            Inventory
          </CardTitle>
          <CardDescription>No inventory data</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  // Create a map of slot -> item
  const itemsBySlot = new Map<number, InventoryItem>();
  inventory.items.forEach((item) => {
    itemsBySlot.set(item.slot, item);
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Package className="w-5 h-5" />
              Inventory
            </CardTitle>
            <CardDescription>
              {inventory.usedSlots} / {inventory.maxSlots} slots used
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Badge variant="secondary">{inventory.freeSlots} free</Badge>
            <Badge
              variant={inventory.freeSlots === 0 ? "destructive" : "default"}
            >
              {((inventory.usedSlots / inventory.maxSlots) * 100).toFixed(0)}%
              full
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-7 gap-1">
          {[...Array(TOTAL_SLOTS)].map((_, index) => {
            const item = itemsBySlot.get(index);
            return <InventorySlot key={index} slot={index} item={item} />;
          })}
        </div>

        {/* Inventory Summary */}
        {inventory.usedSlots > 0 && (
          <div className="mt-4 pt-4 border-t">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Total items:</span>
              <span className="font-medium">
                {inventory.items.reduce((sum, item) => sum + item.quantity, 0)}
              </span>
            </div>
            {inventory.items.some((item) => item.value) && (
              <div className="flex items-center justify-between text-sm mt-1">
                <span className="text-muted-foreground">Total value:</span>
                <span className="font-medium text-yellow-600">
                  {inventory.items
                    .reduce(
                      (sum, item) => sum + (item.value || 0) * item.quantity,
                      0,
                    )
                    .toLocaleString()}{" "}
                  gold
                </span>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface InventorySlotProps {
  slot: number;
  item?: InventoryItem;
}

function InventorySlot({
  slot,
  item,
}: InventorySlotProps & { key?: React.Key }) {
  if (!item) {
    return (
      <div className="aspect-square bg-muted/30 rounded border border-border flex items-center justify-center">
        <span className="text-xs text-muted-foreground/30">{slot + 1}</span>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="aspect-square bg-muted rounded border border-border hover:border-primary hover:bg-muted/80 transition-colors cursor-pointer flex items-center justify-center relative group">
            {/* Item Icon or Placeholder */}
            {item.icon ? (
              <img
                src={item.icon}
                alt={item.name}
                className="w-full h-full object-contain p-1"
              />
            ) : (
              <Package2 className="w-6 h-6 text-muted-foreground" />
            )}

            {/* Quantity Badge */}
            {item.stackable && item.quantity > 1 && (
              <div className="absolute bottom-0 right-0 bg-black/80 text-white text-xs px-1 rounded-tl">
                {item.quantity > 999999
                  ? `${(item.quantity / 1000000).toFixed(1)}M`
                  : item.quantity > 999
                    ? `${(item.quantity / 1000).toFixed(1)}K`
                    : item.quantity}
              </div>
            )}

            {/* Hover Effect */}
            <div className="absolute inset-0 bg-primary/10 opacity-0 group-hover:opacity-100 transition-opacity rounded" />
          </div>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs">
          <div className="space-y-1">
            <p className="font-semibold">{item.name}</p>
            {item.quantity > 1 && (
              <p className="text-sm text-muted-foreground">
                Quantity: {item.quantity.toLocaleString()}
              </p>
            )}
            {item.value && (
              <p className="text-sm text-yellow-600">
                Value: {item.value.toLocaleString()} gold each
                {item.quantity > 1 &&
                  ` (${(item.value * item.quantity).toLocaleString()} total)`}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Slot {item.slot + 1} {item.stackable ? "(Stackable)" : ""}
            </p>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
