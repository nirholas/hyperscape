/**
 * LoadTestBot - Headless bot for load testing
 */

import { createNodeClientWorld } from "../runtime/createNodeClientWorld";
import type { World as ClientWorld } from "../core/World";

export type LoadTestBehavior = "idle" | "wander" | "explore" | "sprint";

export type LoadTestBotConfig = {
  wsUrl: string;
  name: string;
  behavior: LoadTestBehavior;
  updateInterval?: number;
  wanderRadius?: number;
  exploreRadius?: number;
};

export type LoadTestBotMetrics = {
  distanceTraveled: number;
  moveCommandsSent: number;
  errors: number;
  connectedAt: number;
  lastMessageAt: number;
  isConnected: boolean;
  networkUnavailableCount: number;
  positionUnavailableCount: number;
  connectionLostAt: number;
  disconnectReason: string;
};

type Position = { x: number; y: number; z: number };
type PlayerPositionSource = {
  node?: { position?: Position };
  position?: Position;
  getPosition?: () => Position;
  data?: { position?: Position | [number, number, number] };
};
type NetworkSender = {
  send: (method: string, data: unknown) => void;
  connected?: boolean;
  id?: string | null;
};

export class LoadTestBot {
  private config: Required<LoadTestBotConfig>;
  private clientWorld: ClientWorld | null = null;
  private behaviorTimer: ReturnType<typeof setInterval> | null = null;
  private connectionCheckTimer: ReturnType<typeof setInterval> | null = null;
  private isActive = false;
  private lastPosition: Position = { x: 0, y: 0, z: 0 };
  private connectionVerified = false;

  readonly metrics: LoadTestBotMetrics = {
    distanceTraveled: 0,
    moveCommandsSent: 0,
    errors: 0,
    connectedAt: 0,
    lastMessageAt: 0,
    isConnected: false,
    networkUnavailableCount: 0,
    positionUnavailableCount: 0,
    connectionLostAt: 0,
    disconnectReason: "",
  };

  constructor(config: LoadTestBotConfig) {
    this.config = {
      updateInterval: 3000,
      wanderRadius: 10,
      exploreRadius: 50,
      ...config,
    };
  }

  async connect(): Promise<void> {
    const url = new URL(this.config.wsUrl);
    url.searchParams.set("loadTestBot", "true");
    url.searchParams.set("botName", this.config.name);

    const clientWorld = createNodeClientWorld();
    await clientWorld.init({
      wsUrl: url.toString(),
      name: this.config.name,
    } as {
      wsUrl: string;
      name: string;
    });

    this.clientWorld = clientWorld;
    this.metrics.connectedAt = Date.now();

    // Wait for network.connected = true
    const startWait = Date.now();
    while (Date.now() - startWait < 5000) {
      if (this.getNetworkSystem()?.connected === true) {
        this.connectionVerified = true;
        this.metrics.isConnected = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 100));
    }

    if (!this.connectionVerified) {
      if (this.getNetworkSystem()?.connected === false) {
        this.metrics.disconnectReason = "Connection rejected";
        this.metrics.isConnected = false;
        throw new Error(`Connection rejected for ${this.config.name}`);
      }
    }

    // Ensure snapshot processed so network id is set before enterWorld.
    const startSnapshotWait = Date.now();
    while (Date.now() - startSnapshotWait < 5000) {
      const network = this.getNetworkSystem();
      if (network?.id) break;
      await new Promise((r) => setTimeout(r, 100));
    }

    this.sendPacket("enterWorld", {
      loadTestBot: true,
      botName: this.config.name,
    });
    await new Promise((r) => setTimeout(r, 500));

    if (!this.isNetworkConnected()) {
      this.metrics.disconnectReason = "Disconnected after enterWorld";
      this.metrics.isConnected = false;
      throw new Error(`${this.config.name} disconnected after enterWorld`);
    }

    // Give the client a brief window to receive the player entity, but don't
    // fail the connection if it arrives later (load tests can be slow).
    const playerWaitMs = 5000;
    const startPlayerWait = Date.now();
    while (Date.now() - startPlayerWait < playerWaitMs) {
      if (this.getLocalPlayerEntity()) break;
      await new Promise((r) => setTimeout(r, 100));
    }

    const pos = this.getPlayerPosition();
    if (pos) this.lastPosition = pos;

    this.isActive = true;
    this.startConnectionMonitor();
    this.startBehaviorLoop();
  }

  disconnect(): void {
    this.isActive = false;
    this.connectionVerified = false;
    if (this.behaviorTimer) clearInterval(this.behaviorTimer);
    if (this.connectionCheckTimer) clearInterval(this.connectionCheckTimer);
    this.behaviorTimer = null;
    this.connectionCheckTimer = null;
    if (this.clientWorld) this.clientWorld.destroy();
    this.clientWorld = null;
    this.metrics.isConnected = false;
  }

  private startConnectionMonitor(): void {
    this.connectionCheckTimer = setInterval(() => {
      if (!this.isActive) return;
      if (!this.isNetworkConnected() && this.metrics.isConnected) {
        this.metrics.connectionLostAt = Date.now();
        this.metrics.isConnected = false;
        this.metrics.disconnectReason = "Connection lost";
      }
    }, 1000);
  }

  private isNetworkConnected(): boolean {
    return this.getNetworkSystem()?.connected === true;
  }

  private getNetworkSystem(): NetworkSender | null {
    if (!this.clientWorld) return null;
    const network = this.clientWorld.getSystem("network");
    return network ? (network as unknown as NetworkSender) : null;
  }

  private startBehaviorLoop(): void {
    if (this.config.behavior === "idle") {
      this.behaviorTimer = setInterval(() => {
        if (this.isActive) this.updateMetrics();
      }, this.config.updateInterval);
      return;
    }

    this.executeBehavior();
    this.behaviorTimer = setInterval(() => {
      if (!this.isActive) return;
      this.executeBehavior();
      this.updateMetrics();
    }, this.config.updateInterval);
  }

  private executeBehavior(): void {
    if (!this.isNetworkConnected()) {
      this.metrics.networkUnavailableCount++;
      return;
    }

    const pos = this.getPlayerPosition();
    if (!pos) {
      this.metrics.positionUnavailableCount++;
      return;
    }

    const { behavior, wanderRadius, exploreRadius } = this.config;
    const angle = Math.random() * Math.PI * 2;
    let distance: number;
    let runMode = false;

    switch (behavior) {
      case "wander":
        distance = Math.random() * wanderRadius;
        break;
      case "explore":
        distance =
          wanderRadius + Math.random() * (exploreRadius - wanderRadius);
        break;
      case "sprint":
        distance = 20 + Math.random() * 30;
        runMode = true;
        break;
      default:
        return;
    }

    const targetX = pos.x + Math.cos(angle) * distance;
    const targetZ = pos.z + Math.sin(angle) * distance;
    this.sendPacket("moveRequest", { target: [targetX, 0, targetZ], runMode });
    this.metrics.moveCommandsSent++;
  }

  private sendPacket(method: string, data: unknown): void {
    const network = this.getNetworkSystem();
    if (!network?.send || network.connected === false) {
      this.metrics.errors++;
      this.metrics.networkUnavailableCount++;
      return;
    }
    network.send(method, data);
    this.metrics.lastMessageAt = Date.now();
  }

  private getLocalPlayerEntity(): PlayerPositionSource | null {
    const entities = this.clientWorld?.entities;
    if (!entities) return null;
    if (entities.player) return entities.player as PlayerPositionSource;

    const networkId = this.getNetworkSystem()?.id;
    if (!networkId) return null;
    const playerFromMap = entities.players?.get(networkId);
    if (playerFromMap) return playerFromMap as PlayerPositionSource;
    return null;
  }

  private getPlayerPosition(): Position | null {
    const player = this.getLocalPlayerEntity();
    if (!player) return null;

    if (player.node?.position) return player.node.position;
    if (player.position) return player.position;
    if (player.getPosition) return player.getPosition();

    const dataPos = player.data?.position;
    if (Array.isArray(dataPos) && dataPos.length === 3) {
      return { x: dataPos[0], y: dataPos[1], z: dataPos[2] };
    }
    if (dataPos && !Array.isArray(dataPos)) return dataPos;

    return null;
  }

  private updateMetrics(): void {
    const pos = this.getPlayerPosition();
    if (!pos) {
      this.metrics.positionUnavailableCount++;
      return;
    }

    const dx = pos.x - this.lastPosition.x;
    const dy = pos.y - this.lastPosition.y;
    const dz = pos.z - this.lastPosition.z;
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

    if (distance > 0.01) {
      this.metrics.distanceTraveled += distance;
      this.lastPosition = { ...pos };
    }
  }

  get name(): string {
    return this.config.name;
  }

  get connected(): boolean {
    return (
      this.connectionVerified &&
      this.metrics.isConnected &&
      this.isActive &&
      this.isNetworkConnected()
    );
  }
}
