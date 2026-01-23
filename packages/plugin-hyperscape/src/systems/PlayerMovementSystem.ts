// Math utilities for movement calculations
import { Vector3 } from "three";
import type { Vector3 as Vector3Type } from "three";
import type { World, Entity, Player, Position } from "../types/core-types";
import { EventEmitter } from "events";

// Pre-allocated temp objects for hot path optimizations (avoid GC pressure)
// Each operation gets its own temp vector to allow safe chaining without overwrites
const _subtractResult = new Vector3();
const _normalizeResult = new Vector3();
const _multiplyResult = new Vector3();
const _addResult = new Vector3();
const _lerpResult = new Vector3();
const _zeroVelocity = { x: 0, y: 0, z: 0 } as const;

const MathUtils = {
  distance2D: (a: { x: number; z: number }, b: { x: number; z: number }) =>
    Math.sqrt((a.x - b.x) ** 2 + (a.z - b.z) ** 2),
  subtract: (
    a: { x: number; y: number; z: number },
    b: { x: number; y: number; z: number },
  ) => _subtractResult.set(a.x - b.x, a.y - b.y, a.z - b.z),
  normalize: (v: { x: number; y: number; z: number }) => {
    _normalizeResult.set(v.x, v.y, v.z);
    const length = _normalizeResult.length();
    return length > 0
      ? _normalizeResult.divideScalar(length)
      : _normalizeResult.set(0, 0, 0);
  },
  multiply: (v: { x: number; y: number; z: number }, scalar: number) =>
    _multiplyResult.set(v.x * scalar, v.y * scalar, v.z * scalar),
  add: (
    a: { x: number; y: number; z: number },
    b: { x: number; y: number; z: number },
  ) => _addResult.set(a.x + b.x, a.y + b.y, a.z + b.z),
  lerp: (
    a: { x: number; y: number; z: number },
    b: { x: number; y: number; z: number },
    t: number,
  ) =>
    _lerpResult.set(
      a.x + (b.x - a.x) * t,
      a.y + (b.y - a.y) * t,
      a.z + (b.z - a.z) * t,
    ),
};

interface MovablePlayer {
  id: string;
  type: string;
  data?: Record<string, unknown>;
  node: {
    position: Vector3Type;
    quaternion?: { x: number; y: number; z: number; w: number };
  };
  base?: unknown;
  isMoving?: boolean;
  targetPosition?: Position;
  movementPath?: Position[];
  velocity: Position;
  speed?: number;
}

interface PathNode {
  position: Position;
  f: number;
  g: number;
  h: number;
  parent?: PathNode;
}

export class PlayerMovementSystem extends EventEmitter {
  private world: World;
  private movingPlayers: Map<string, { target: Position; path?: Position[] }> =
    new Map();
  private lastUpdateTime: number = Date.now();
  private updateInterval: number = 50; // Network update interval in ms
  private lastNetworkUpdate: number = Date.now();

  constructor(world: World) {
    super();
    this.world = world;
  }

  async moveTo(playerId: string, target: Position): Promise<void> {
    const worldWithEntities = this.world as {
      entities?: {
        players?: Map<string, Entity>;
        player?: Entity & { id?: string };
      };
    };
    const player =
      worldWithEntities.entities?.players?.get(playerId) ||
      (playerId === worldWithEntities.entities?.player?.id
        ? worldWithEntities.entities?.player
        : null);
    if (!player) return;

    // Find path to target
    const path = this.findPath(player.node.position as Position, target);
    if (!path) {
      throw new Error("No path found to target");
    }

    // Start movement
    this.startMovement(playerId, target, path);

    // Wait for movement to complete
    return new Promise((resolve) => {
      const checkComplete = () => {
        if (!this.movingPlayers.has(playerId)) {
          resolve();
        } else {
          setTimeout(checkComplete, 50);
        }
      };
      checkComplete();
    });
  }

  startMovement(playerId: string, target: Position, path?: Position[]): void {
    const worldWithEntities = this.world as {
      entities?: {
        players?: Map<string, Entity>;
        player?: Entity & { id?: string };
      };
      network?: { send?: (event: string, data: unknown) => void };
    };
    const player =
      worldWithEntities.entities?.players?.get(playerId) ||
      (playerId === worldWithEntities.entities?.player?.id
        ? worldWithEntities.entities?.player
        : null);
    if (!player) return;

    // Calculate path if not provided
    const finalPath = path ||
      this.findPath(player.node.position as Position, target) || [target];

    // Set player moving (simulate with custom property)
    const movablePlayer = player as unknown as MovablePlayer;
    movablePlayer.isMoving = true;
    movablePlayer.targetPosition = target;
    movablePlayer.movementPath = finalPath;
    this.movingPlayers.set(playerId, { target, path: finalPath });

    // Calculate initial velocity
    this.updatePlayerVelocity(movablePlayer, finalPath[0]);

    // Broadcast movement start via network
    if (worldWithEntities.network?.send) {
      worldWithEntities.network.send("player:moved", {
        playerId,
        position: player.node.position,
        velocity: movablePlayer.velocity,
      });
    }
  }

  stopMovement(playerId: string): void {
    const worldWithEntities = this.world as {
      entities?: {
        players?: Map<string, Entity>;
        player?: Entity & { id?: string };
      };
      network?: { send?: (event: string, data: unknown) => void };
    };
    const player =
      worldWithEntities.entities?.players?.get(playerId) ||
      (playerId === worldWithEntities.entities?.player?.id
        ? worldWithEntities.entities?.player
        : null);
    if (!player) return;

    // Stop player movement (simulate)
    const movablePlayer = player as unknown as MovablePlayer;
    movablePlayer.isMoving = false;
    // Reuse pre-allocated zero velocity reference (immutable, safe to share)
    movablePlayer.velocity = _zeroVelocity as Position;
    this.movingPlayers.delete(playerId);

    // Broadcast stop via network - use pre-allocated zero velocity
    if (worldWithEntities.network?.send) {
      worldWithEntities.network.send("player:moved", {
        playerId,
        position: player.node.position,
        velocity: _zeroVelocity,
      });
    }
  }

  update(deltaTime: number): void {
    const now = Date.now();
    const worldWithEntities = this.world as {
      entities?: {
        players?: Map<string, Entity>;
        player?: Entity & { id?: string };
      };
    };

    // Update all moving players
    for (const [playerId, movement] of this.movingPlayers) {
      const player =
        worldWithEntities.entities?.players?.get(playerId) ||
        (playerId === worldWithEntities.entities?.player?.id
          ? worldWithEntities.entities?.player
          : null);
      if (!player) {
        this.movingPlayers.delete(playerId);
        continue;
      }

      // Update player position (simulate)
      this.updatePlayerPosition(player, deltaTime);

      // Check for collisions
      if (this.checkCollisions(player)) {
        // Handle collision - stop or slide
        this.handleCollision(player as unknown as MovablePlayer, movement);
      }

      // Check if reached target
      if (!(player as unknown as MovablePlayer).isMoving) {
        this.movingPlayers.delete(playerId);
      }
    }

    // Send network updates at intervals
    if (now - this.lastNetworkUpdate >= this.updateInterval) {
      this.sendNetworkUpdates();
      this.lastNetworkUpdate = now;
    }
  }

  findPath(start: Position, end: Position): Position[] | null {
    // Simple A* pathfinding implementation
    const openSet: PathNode[] = [];
    const closedSet: Set<string> = new Set();
    const gridSize = 1; // 1 unit grid

    const startNode: PathNode = {
      position: this.snapToGrid(start, gridSize),
      f: 0,
      g: 0,
      h: MathUtils.distance2D(start, end),
    };

    openSet.push(startNode);

    while (openSet.length > 0) {
      // Get node with lowest f score
      openSet.sort((a, b) => a.f - b.f);
      const current = openSet.shift()!;

      // Check if reached goal
      if (MathUtils.distance2D(current.position, end) < gridSize) {
        return this.reconstructPath(current);
      }

      const key = `${Math.round(current.position.x)},${Math.round(current.position.z)}`;
      closedSet.add(key);

      // Check neighbors
      const neighbors = this.getNeighbors(current.position, gridSize);

      for (const neighborPos of neighbors) {
        const neighborKey = `${Math.round(neighborPos.x)},${Math.round(neighborPos.z)}`;
        if (closedSet.has(neighborKey)) continue;

        // Check if walkable
        if (this.checkWorldCollision(neighborPos)) continue;

        const g =
          current.g + MathUtils.distance2D(current.position, neighborPos);
        const h = MathUtils.distance2D(neighborPos, end);
        const f = g + h;

        // Check if already in open set
        const existing = openSet.find(
          (n) =>
            Math.abs(n.position.x - neighborPos.x) < 0.1 &&
            Math.abs(n.position.z - neighborPos.z) < 0.1,
        );

        if (existing && existing.g <= g) continue;

        const neighbor: PathNode = {
          position: neighborPos,
          f,
          g,
          h,
          parent: current,
        };

        if (existing) {
          // Update existing node
          const index = openSet.indexOf(existing);
          openSet[index] = neighbor;
        } else {
          openSet.push(neighbor);
        }
      }

      // Limit search
      if (closedSet.size > 1000) {
        return null; // Path too complex
      }
    }

    return null; // No path found
  }

  private snapToGrid(pos: Position, gridSize: number): Position {
    return {
      x: Math.round(pos.x / gridSize) * gridSize,
      y: pos.y,
      z: Math.round(pos.z / gridSize) * gridSize,
    } as Position;
  }

  private getNeighbors(pos: Position, gridSize: number): Position[] {
    const neighbors: Position[] = [];
    const directions = [
      { x: gridSize, z: 0 }, // Right
      { x: -gridSize, z: 0 }, // Left
      { x: 0, z: gridSize }, // Down
      { x: 0, z: -gridSize }, // Up
      { x: gridSize, z: gridSize }, // Diagonal
      { x: -gridSize, z: gridSize },
      { x: gridSize, z: -gridSize },
      { x: -gridSize, z: -gridSize },
    ];

    for (const dir of directions) {
      neighbors.push({
        x: pos.x + dir.x,
        y: pos.y,
        z: pos.z + dir.z,
      } as Position);
    }

    return neighbors;
  }

  private reconstructPath(node: PathNode): Position[] {
    const path: Position[] = [];
    let current: PathNode | undefined = node;

    while (current) {
      path.unshift(current.position);
      current = current.parent;
    }

    // Smooth path
    return this.smoothPath(path);
  }

  private smoothPath(path: Position[]): Position[] {
    if (path.length <= 2) return path;

    const smoothed: Position[] = [path[0]];
    let current = 0;

    while (current < path.length - 1) {
      let furthest = current + 1;

      // Find furthest point we can reach directly
      for (let i = current + 2; i < path.length; i++) {
        if (this.hasDirectPath(path[current], path[i])) {
          furthest = i;
        } else {
          break;
        }
      }

      smoothed.push(path[furthest]);
      current = furthest;
    }

    return smoothed;
  }

  private hasDirectPath(start: Position, end: Position): boolean {
    // Check if direct path is clear
    const steps = Math.ceil(MathUtils.distance2D(start, end));

    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const pos = MathUtils.lerp(start, end, t);

      if (this.checkWorldCollision(pos as Position)) {
        return false;
      }
    }

    return true;
  }

  private updatePlayerVelocity(player: MovablePlayer, target: Position): void {
    if (!player.node.position) {
      return;
    }

    const direction = MathUtils.subtract(
      target,
      player.node.position as Position,
    );
    const normalized = MathUtils.normalize(direction);

    if (player.speed) {
      player.velocity = MathUtils.multiply(
        normalized,
        player.speed,
      ) as Position;
    }
  }

  private checkCollisions(player: Entity): boolean {
    // Check ahead of player
    const movablePlayer = player as unknown as MovablePlayer;
    if (!player.node.position || !movablePlayer.velocity) {
      return false;
    }

    const lookAhead = MathUtils.add(
      player.node.position as Position,
      MathUtils.multiply(MathUtils.normalize(movablePlayer.velocity), 0.5),
    ) as Position;

    return this.checkWorldCollision(lookAhead);
  }

  private handleCollision(
    player: MovablePlayer,
    _movement: { target: Position; path?: Position[] },
  ): void {
    // Try to slide along obstacle
    const slideVelocity = this.calculateSlideVelocity(player);

    if (slideVelocity) {
      player.velocity = slideVelocity;
    } else {
      // Can't slide, stop
      this.stopMovement(player.id);
    }
  }

  // Pre-allocated perpendicular vectors for slide velocity calculation
  private readonly _perpendicular1 = { x: 0, y: 0, z: 0 };
  private readonly _perpendicular2 = { x: 0, y: 0, z: 0 };
  // Pre-allocated array to avoid allocation in calculateSlideVelocity loop
  private readonly _perps: Array<{ x: number; y: number; z: number }> = [
    this._perpendicular1,
    this._perpendicular2,
  ];

  private calculateSlideVelocity(player: MovablePlayer): Position | null {
    if (!player.velocity || !player.node.position || !player.speed) {
      return null;
    }

    // Try perpendicular directions - reuse pre-allocated objects
    const vel = player.velocity;
    this._perpendicular1.x = -(vel.z as number);
    this._perpendicular1.y = 0;
    this._perpendicular1.z = vel.x as number;

    this._perpendicular2.x = vel.z as number;
    this._perpendicular2.y = 0;
    this._perpendicular2.z = -(vel.x as number);

    // Test both directions - use pre-allocated array reference
    for (let i = 0; i < this._perps.length; i++) {
      const perp = this._perps[i];
      const testPos = MathUtils.add(
        player.node.position as Position,
        MathUtils.multiply(MathUtils.normalize(perp), 0.5),
      ) as Position;

      if (!this.checkWorldCollision(testPos)) {
        return MathUtils.multiply(
          MathUtils.normalize(perp),
          player.speed * 0.7,
        ) as Position;
      }
    }

    return null;
  }

  // Pre-allocated network update payload to avoid allocation per update
  private readonly _networkUpdatePayload: {
    playerId: string;
    position: Position | null;
    velocity: Position | null;
  } = {
    playerId: "",
    position: null,
    velocity: null,
  };

  private sendNetworkUpdates(): void {
    const worldWithNetwork = this.world as {
      entities?: {
        players?: Map<string, Entity>;
        player?: Entity & { id?: string };
      };
      network?: { send?: (event: string, data: unknown) => void };
    };

    // Send position updates for all moving players
    for (const [playerId, movement] of this.movingPlayers) {
      const player =
        worldWithNetwork.entities?.players?.get(playerId) ||
        (playerId === worldWithNetwork.entities?.player?.id
          ? worldWithNetwork.entities?.player
          : null);
      if (!player) continue;

      // Send via network - reuse pre-allocated payload object
      if (worldWithNetwork.network?.send) {
        this._networkUpdatePayload.playerId = playerId;
        this._networkUpdatePayload.position = player.node.position as Position;
        this._networkUpdatePayload.velocity = (
          player as unknown as MovablePlayer
        ).velocity;
        worldWithNetwork.network.send(
          "player:moved",
          this._networkUpdatePayload,
        );
      }
    }
  }

  // Helper methods to simulate missing World functionality
  private checkWorldCollision(position: Position): boolean {
    // Simulate basic collision detection
    // In a real implementation, this would check against world geometry
    return false;
  }

  private updatePlayerPosition(player: Entity, deltaTime: number): void {
    // Simulate player position update based on velocity
    const movablePlayer = player as unknown as MovablePlayer;
    if (movablePlayer.velocity && player.node.position) {
      const pos = player.node.position as { x: number; y: number; z: number };
      pos.x += movablePlayer.velocity.x * deltaTime;
      pos.y += movablePlayer.velocity.y * deltaTime;
      pos.z += movablePlayer.velocity.z * deltaTime;
    }
  }
}
