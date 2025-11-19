/**
 * HyperscapeDashboard Component
 *
 * Main dashboard view for Hyperscape agent monitoring.
 * Displays player stats, inventory, position, combat status, and performance metrics.
 * This is the central hub for monitoring agents playing in the Hyperscape RPG.
 */

import React from "react";
import type { UUID } from "@elizaos/core";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { PlayerStatsPanel } from "./PlayerStatsPanel";
import { InventoryViewer } from "./InventoryViewer";
import {
  useHyperscapeDashboard,
  useIsConnected,
} from "../../hooks/hyperscape/useHyperscapeAgent.js";
import {
  Globe,
  MapPin,
  Activity,
  TrendingUp,
  Heart,
  Sword,
  AlertCircle,
  RefreshCw,
} from "lucide-react";

interface HyperscapeDashboardProps {
  agentId: UUID | string;
}

export function HyperscapeDashboard({ agentId }: HyperscapeDashboardProps) {
  const {
    worldStatus,
    position,
    nearbyEntities,
    combatSession,
    metrics,
    isLoading,
    error,
  } = useHyperscapeDashboard(agentId as UUID | undefined);

  const isConnected = useIsConnected(agentId as UUID | undefined);

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold">Hyperscape Dashboard</h1>
          <Badge variant="secondary">Loading...</Badge>
        </div>
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {[...Array(6)].map((_, i) => (
            <Card key={i}>
              <CardHeader>
                <div className="h-6 bg-muted animate-pulse rounded w-1/2" />
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="h-4 bg-muted animate-pulse rounded" />
                  <div className="h-4 bg-muted animate-pulse rounded w-3/4" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 space-y-6">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Failed to load Hyperscape data:{" "}
            {error instanceof Error ? error.message : "Unknown error"}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Globe className="w-8 h-8" />
            Hyperscape Dashboard
          </h1>
          <p className="text-muted-foreground mt-1">
            Monitor your agent playing in the Hyperscape RPG
          </p>
        </div>
        <div className="flex items-center gap-3">
          {worldStatus && (
            <Badge
              variant={isConnected ? "default" : "secondary"}
              className="text-sm"
            >
              {isConnected
                ? `Connected to ${worldStatus.worldName}`
                : "Disconnected"}
            </Badge>
          )}
          <Button variant="outline" size="sm">
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Connection Warning */}
      {!isConnected && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Agent is not connected to any Hyperscape world. Displayed data may
            be stale.
          </AlertDescription>
        </Alert>
      )}

      {/* Quick Stats Row */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {/* Health Status */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Heart className="w-4 h-4 text-red-500" />
              Health
            </CardTitle>
          </CardHeader>
          <CardContent>
            {worldStatus ? (
              <div className="space-y-2">
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-bold">100</span>
                  <span className="text-sm text-muted-foreground">/ 100</span>
                </div>
                <div className="w-full bg-muted rounded-full h-2">
                  <div
                    className="bg-red-500 h-2 rounded-full"
                    style={{ width: "100%" }}
                  />
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No data</p>
            )}
          </CardContent>
        </Card>

        {/* Position */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <MapPin className="w-4 h-4 text-blue-500" />
              Position
            </CardTitle>
          </CardHeader>
          <CardContent>
            {position ? (
              <div className="space-y-1">
                <p className="font-mono text-sm">
                  X: {position.position.x.toFixed(1)}
                </p>
                <p className="font-mono text-sm">
                  Y: {position.position.y.toFixed(1)}
                </p>
                <p className="font-mono text-sm">
                  Z: {position.position.z.toFixed(1)}
                </p>
                <p className="text-xs text-muted-foreground mt-2">
                  {position.areaName || "Unknown area"}
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No position data</p>
            )}
          </CardContent>
        </Card>

        {/* Combat Status */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Sword className="w-4 h-4 text-orange-500" />
              Combat
            </CardTitle>
          </CardHeader>
          <CardContent>
            {combatSession?.active ? (
              <div className="space-y-2">
                <Badge variant="destructive">In Combat</Badge>
                <p className="text-sm">Target: {combatSession.target}</p>
                <div className="text-xs text-muted-foreground">
                  <p>Damage: {combatSession.damageDealt}</p>
                  <p>Kills: {combatSession.kills}</p>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <Badge variant="secondary">Not in combat</Badge>
                <p className="text-xs text-muted-foreground">
                  Agent is idle or training skills
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Nearby Entities */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Activity className="w-4 h-4 text-green-500" />
              Nearby
            </CardTitle>
          </CardHeader>
          <CardContent>
            {nearbyEntities && nearbyEntities.length > 0 ? (
              <div className="space-y-1">
                <p className="text-2xl font-bold">{nearbyEntities.length}</p>
                <div className="text-xs space-y-1">
                  <p className="text-muted-foreground">
                    Players:{" "}
                    {nearbyEntities.filter((e) => e.type === "player").length}
                  </p>
                  <p className="text-muted-foreground">
                    Mobs:{" "}
                    {nearbyEntities.filter((e) => e.type === "mob").length}
                  </p>
                  <p className="text-muted-foreground">
                    Objects:{" "}
                    {nearbyEntities.filter((e) => e.type === "object").length}
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No entities nearby
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Main Content Grid */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Left Column */}
        <div className="space-y-6">
          <PlayerStatsPanel agentId={agentId} />

          {/* Performance Metrics */}
          {metrics && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="w-5 h-5" />
                  Performance Metrics
                </CardTitle>
                <CardDescription>
                  Efficiency and progression rates
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">
                      Total XP Gained
                    </p>
                    <p className="text-2xl font-bold">
                      {metrics.totalXPGained.toLocaleString()}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">Gold Earned</p>
                    <p className="text-2xl font-bold text-yellow-600">
                      {metrics.goldEarned.toLocaleString()}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">
                      Session Time
                    </p>
                    <p className="text-lg font-semibold">
                      {Math.floor(metrics.sessionDuration / 60)}h{" "}
                      {metrics.sessionDuration % 60}m
                    </p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">Actions/min</p>
                    <p className="text-lg font-semibold">
                      {metrics.actionsPerMinute.toFixed(1)}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right Column */}
        <div className="space-y-6">
          <InventoryViewer agentId={agentId} />

          {/* Recent Activity Placeholder */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Activity className="w-5 h-5" />
                Recent Activity
              </CardTitle>
              <CardDescription>Latest actions and events</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Activity timeline coming soon...
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
