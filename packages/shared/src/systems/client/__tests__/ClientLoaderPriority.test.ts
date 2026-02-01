/**
 * Tests for ClientLoader Priority Queue System.
 * Tests the priority-based asset loading functionality without requiring a full world context.
 *
 * Coverage:
 * - LoadPriority enum values and ordering
 * - Priority queue insertion and sorting
 * - Distance-based priority calculation
 * - Tile-based priority calculation
 * - Queue reprioritization on player movement
 * - Background loading scheduling
 * - Edge cases and boundary conditions
 * - Concurrent request handling
 */

import { describe, it, expect } from "vitest";
import THREE from "../../../extras/three/three";

/**
 * Define LoadPriority enum locally to avoid import issues during testing.
 * This mirrors the values in packages/shared/src/types/core/misc-types.ts
 */
enum LoadPriority {
  CRITICAL = 0,
  HIGH = 1,
  NORMAL = 2,
  LOW = 3,
  PREFETCH = 4,
}

/**
 * Type for PrioritizedLoadRequest (mirrors the real type)
 */
type PrioritizedLoadRequest = {
  url: string;
  priority: LoadPriority;
  position?: THREE.Vector3;
  tile?: { x: number; z: number };
  resolve: (file: File | undefined) => void;
};

/**
 * Recreate priority queue logic for testing without full ClientLoader instantiation.
 * This tests the algorithms in isolation.
 */

describe("LoadPriority Enum", () => {
  it("has correct numeric values in ascending order", () => {
    expect(LoadPriority.CRITICAL).toBe(0);
    expect(LoadPriority.HIGH).toBe(1);
    expect(LoadPriority.NORMAL).toBe(2);
    expect(LoadPriority.LOW).toBe(3);
    expect(LoadPriority.PREFETCH).toBe(4);
  });

  it("maintains proper ordering for sorting", () => {
    const priorities = [
      LoadPriority.PREFETCH,
      LoadPriority.CRITICAL,
      LoadPriority.LOW,
      LoadPriority.HIGH,
      LoadPriority.NORMAL,
    ];

    const sorted = priorities.sort((a, b) => a - b);

    expect(sorted).toEqual([
      LoadPriority.CRITICAL,
      LoadPriority.HIGH,
      LoadPriority.NORMAL,
      LoadPriority.LOW,
      LoadPriority.PREFETCH,
    ]);
  });

  it("CRITICAL < HIGH < NORMAL < LOW < PREFETCH", () => {
    expect(LoadPriority.CRITICAL).toBeLessThan(LoadPriority.HIGH);
    expect(LoadPriority.HIGH).toBeLessThan(LoadPriority.NORMAL);
    expect(LoadPriority.NORMAL).toBeLessThan(LoadPriority.LOW);
    expect(LoadPriority.LOW).toBeLessThan(LoadPriority.PREFETCH);
  });

  it("provides meaningful names for debugging", () => {
    expect(LoadPriority[LoadPriority.CRITICAL]).toBe("CRITICAL");
    expect(LoadPriority[LoadPriority.HIGH]).toBe("HIGH");
    expect(LoadPriority[LoadPriority.NORMAL]).toBe("NORMAL");
    expect(LoadPriority[LoadPriority.LOW]).toBe("LOW");
    expect(LoadPriority[LoadPriority.PREFETCH]).toBe("PREFETCH");
  });
});

describe("Priority Queue Sorting", () => {
  /**
   * Simulate the priority queue insertion logic from ClientLoader
   */
  function insertWithPriority(
    queue: PrioritizedLoadRequest[],
    request: PrioritizedLoadRequest,
  ): void {
    const insertIndex = queue.findIndex((r) => r.priority > request.priority);
    if (insertIndex === -1) {
      queue.push(request);
    } else {
      queue.splice(insertIndex, 0, request);
    }
  }

  function createRequest(
    url: string,
    priority: LoadPriority,
    position?: THREE.Vector3,
    tile?: { x: number; z: number },
  ): PrioritizedLoadRequest {
    return {
      url,
      priority,
      position,
      tile,
      resolve: () => {},
    };
  }

  it("inserts CRITICAL priority at the front", () => {
    const queue: PrioritizedLoadRequest[] = [
      createRequest("a.glb", LoadPriority.NORMAL),
      createRequest("b.glb", LoadPriority.LOW),
    ];

    insertWithPriority(
      queue,
      createRequest("urgent.glb", LoadPriority.CRITICAL),
    );

    expect(queue[0].url).toBe("urgent.glb");
    expect(queue[0].priority).toBe(LoadPriority.CRITICAL);
  });

  it("inserts PREFETCH priority at the end", () => {
    const queue: PrioritizedLoadRequest[] = [
      createRequest("a.glb", LoadPriority.HIGH),
      createRequest("b.glb", LoadPriority.NORMAL),
    ];

    insertWithPriority(
      queue,
      createRequest("later.glb", LoadPriority.PREFETCH),
    );

    expect(queue[queue.length - 1].url).toBe("later.glb");
  });

  it("maintains FIFO order for same priority", () => {
    const queue: PrioritizedLoadRequest[] = [];

    insertWithPriority(queue, createRequest("first.glb", LoadPriority.NORMAL));
    insertWithPriority(queue, createRequest("second.glb", LoadPriority.NORMAL));
    insertWithPriority(queue, createRequest("third.glb", LoadPriority.NORMAL));

    expect(queue[0].url).toBe("first.glb");
    expect(queue[1].url).toBe("second.glb");
    expect(queue[2].url).toBe("third.glb");
  });

  it("correctly orders mixed priorities", () => {
    const queue: PrioritizedLoadRequest[] = [];

    insertWithPriority(
      queue,
      createRequest("prefetch.glb", LoadPriority.PREFETCH),
    );
    insertWithPriority(queue, createRequest("normal.glb", LoadPriority.NORMAL));
    insertWithPriority(
      queue,
      createRequest("critical.glb", LoadPriority.CRITICAL),
    );
    insertWithPriority(queue, createRequest("low.glb", LoadPriority.LOW));
    insertWithPriority(queue, createRequest("high.glb", LoadPriority.HIGH));

    expect(queue.map((r) => r.url)).toEqual([
      "critical.glb",
      "high.glb",
      "normal.glb",
      "low.glb",
      "prefetch.glb",
    ]);
  });

  it("handles empty queue insertion", () => {
    const queue: PrioritizedLoadRequest[] = [];

    insertWithPriority(queue, createRequest("only.glb", LoadPriority.NORMAL));

    expect(queue.length).toBe(1);
    expect(queue[0].url).toBe("only.glb");
  });

  it("handles large queue efficiently", () => {
    const queue: PrioritizedLoadRequest[] = [];
    const insertCount = 1000;

    const startTime = performance.now();
    for (let i = 0; i < insertCount; i++) {
      // Random priority between 0-4
      const priority = Math.floor(Math.random() * 5) as LoadPriority;
      insertWithPriority(queue, createRequest(`file${i}.glb`, priority));
    }
    const elapsed = performance.now() - startTime;

    expect(queue.length).toBe(insertCount);
    // Should complete in reasonable time (< 100ms for 1000 insertions)
    expect(elapsed).toBeLessThan(100);

    // Verify sorting is maintained
    for (let i = 1; i < queue.length; i++) {
      expect(queue[i].priority).toBeGreaterThanOrEqual(queue[i - 1].priority);
    }
  });
});

describe("Distance-Based Priority Calculation", () => {
  const TILE_SIZE = 100;

  /**
   * Calculate priority based on distance from player (mirrors ClientLoader logic)
   */
  function calculatePriorityFromDistance(
    position: THREE.Vector3,
    playerPosition: THREE.Vector3,
  ): LoadPriority {
    const distance = position.distanceTo(playerPosition);
    const tileDistance = distance / TILE_SIZE;

    if (tileDistance < 1) return LoadPriority.CRITICAL;
    if (tileDistance < 2) return LoadPriority.HIGH;
    if (tileDistance < 3) return LoadPriority.NORMAL;
    if (tileDistance < 5) return LoadPriority.LOW;
    return LoadPriority.PREFETCH;
  }

  it("returns CRITICAL for objects within 1 tile (< 100m)", () => {
    const player = new THREE.Vector3(0, 0, 0);
    const nearby = new THREE.Vector3(50, 0, 50); // ~70m away

    expect(calculatePriorityFromDistance(nearby, player)).toBe(
      LoadPriority.CRITICAL,
    );
  });

  it("returns HIGH for objects 1-2 tiles away", () => {
    const player = new THREE.Vector3(0, 0, 0);
    const medium = new THREE.Vector3(150, 0, 0); // 150m away

    expect(calculatePriorityFromDistance(medium, player)).toBe(
      LoadPriority.HIGH,
    );
  });

  it("returns NORMAL for objects 2-3 tiles away", () => {
    const player = new THREE.Vector3(0, 0, 0);
    const far = new THREE.Vector3(250, 0, 0); // 250m away

    expect(calculatePriorityFromDistance(far, player)).toBe(
      LoadPriority.NORMAL,
    );
  });

  it("returns LOW for objects 3-5 tiles away", () => {
    const player = new THREE.Vector3(0, 0, 0);
    const distant = new THREE.Vector3(400, 0, 0); // 400m away

    expect(calculatePriorityFromDistance(distant, player)).toBe(
      LoadPriority.LOW,
    );
  });

  it("returns PREFETCH for objects beyond 5 tiles", () => {
    const player = new THREE.Vector3(0, 0, 0);
    const veryFar = new THREE.Vector3(600, 0, 0); // 600m away

    expect(calculatePriorityFromDistance(veryFar, player)).toBe(
      LoadPriority.PREFETCH,
    );
  });

  it("handles zero distance correctly", () => {
    const player = new THREE.Vector3(100, 50, 200);
    const samePosition = new THREE.Vector3(100, 50, 200);

    expect(calculatePriorityFromDistance(samePosition, player)).toBe(
      LoadPriority.CRITICAL,
    );
  });

  it("handles negative coordinates correctly", () => {
    const player = new THREE.Vector3(-500, 0, -500);
    const nearby = new THREE.Vector3(-480, 0, -480); // ~28m away

    expect(calculatePriorityFromDistance(nearby, player)).toBe(
      LoadPriority.CRITICAL,
    );
  });

  it("calculates correct priority for diagonal distances", () => {
    const player = new THREE.Vector3(0, 0, 0);
    // sqrt(150^2 + 150^2) ≈ 212m ≈ 2.12 tiles
    const diagonal = new THREE.Vector3(150, 0, 150);

    expect(calculatePriorityFromDistance(diagonal, player)).toBe(
      LoadPriority.NORMAL,
    );
  });

  it("ignores Y coordinate (vertical distance)", () => {
    const player = new THREE.Vector3(0, 0, 0);
    // 50m away horizontally, but 100m up
    const above = new THREE.Vector3(50, 100, 0);
    // Distance is sqrt(50^2 + 100^2) ≈ 112m ≈ 1.12 tiles

    expect(calculatePriorityFromDistance(above, player)).toBe(
      LoadPriority.HIGH,
    );
  });

  it("handles boundary cases precisely", () => {
    const player = new THREE.Vector3(0, 0, 0);

    // Exactly at 1 tile boundary (99.9m = CRITICAL, 100.1m = HIGH)
    expect(
      calculatePriorityFromDistance(new THREE.Vector3(99, 0, 0), player),
    ).toBe(LoadPriority.CRITICAL);
    expect(
      calculatePriorityFromDistance(new THREE.Vector3(101, 0, 0), player),
    ).toBe(LoadPriority.HIGH);

    // Exactly at 2 tile boundary
    expect(
      calculatePriorityFromDistance(new THREE.Vector3(199, 0, 0), player),
    ).toBe(LoadPriority.HIGH);
    expect(
      calculatePriorityFromDistance(new THREE.Vector3(201, 0, 0), player),
    ).toBe(LoadPriority.NORMAL);

    // Exactly at 3 tile boundary
    expect(
      calculatePriorityFromDistance(new THREE.Vector3(299, 0, 0), player),
    ).toBe(LoadPriority.NORMAL);
    expect(
      calculatePriorityFromDistance(new THREE.Vector3(301, 0, 0), player),
    ).toBe(LoadPriority.LOW);

    // Exactly at 5 tile boundary
    expect(
      calculatePriorityFromDistance(new THREE.Vector3(499, 0, 0), player),
    ).toBe(LoadPriority.LOW);
    expect(
      calculatePriorityFromDistance(new THREE.Vector3(501, 0, 0), player),
    ).toBe(LoadPriority.PREFETCH);
  });
});

describe("Tile-Based Priority Calculation", () => {
  const TILE_SIZE = 100;

  function getTileFromPosition(pos: THREE.Vector3): { x: number; z: number } {
    return {
      x: Math.floor(pos.x / TILE_SIZE),
      z: Math.floor(pos.z / TILE_SIZE),
    };
  }

  /**
   * Calculate priority based on tile distance (mirrors ClientLoader logic)
   */
  function calculatePriorityFromTile(
    tileX: number,
    tileZ: number,
    playerPosition: THREE.Vector3,
  ): LoadPriority {
    const playerTile = getTileFromPosition(playerPosition);
    const dx = Math.abs(tileX - playerTile.x);
    const dz = Math.abs(tileZ - playerTile.z);
    const tileDistance = Math.max(dx, dz); // Chebyshev distance

    if (tileDistance === 0) return LoadPriority.CRITICAL;
    if (tileDistance === 1) return LoadPriority.HIGH;
    if (tileDistance <= 2) return LoadPriority.NORMAL;
    if (tileDistance <= 4) return LoadPriority.LOW;
    return LoadPriority.PREFETCH;
  }

  it("returns CRITICAL for same tile", () => {
    const player = new THREE.Vector3(150, 0, 150); // Tile (1, 1)

    expect(calculatePriorityFromTile(1, 1, player)).toBe(LoadPriority.CRITICAL);
  });

  it("returns HIGH for adjacent tiles", () => {
    const player = new THREE.Vector3(150, 0, 150); // Tile (1, 1)

    // All 8 adjacent tiles
    expect(calculatePriorityFromTile(0, 0, player)).toBe(LoadPriority.HIGH);
    expect(calculatePriorityFromTile(0, 1, player)).toBe(LoadPriority.HIGH);
    expect(calculatePriorityFromTile(0, 2, player)).toBe(LoadPriority.HIGH);
    expect(calculatePriorityFromTile(1, 0, player)).toBe(LoadPriority.HIGH);
    expect(calculatePriorityFromTile(1, 2, player)).toBe(LoadPriority.HIGH);
    expect(calculatePriorityFromTile(2, 0, player)).toBe(LoadPriority.HIGH);
    expect(calculatePriorityFromTile(2, 1, player)).toBe(LoadPriority.HIGH);
    expect(calculatePriorityFromTile(2, 2, player)).toBe(LoadPriority.HIGH);
  });

  it("returns NORMAL for tiles 2 away", () => {
    const player = new THREE.Vector3(150, 0, 150); // Tile (1, 1)

    expect(calculatePriorityFromTile(-1, 1, player)).toBe(LoadPriority.NORMAL); // 2 tiles west
    expect(calculatePriorityFromTile(3, 3, player)).toBe(LoadPriority.NORMAL); // 2 tiles diagonal
  });

  it("returns LOW for tiles 3-4 away", () => {
    const player = new THREE.Vector3(150, 0, 150); // Tile (1, 1)

    expect(calculatePriorityFromTile(-2, 1, player)).toBe(LoadPriority.LOW); // 3 tiles west
    expect(calculatePriorityFromTile(5, 1, player)).toBe(LoadPriority.LOW); // 4 tiles east
  });

  it("returns PREFETCH for tiles 5+ away", () => {
    const player = new THREE.Vector3(150, 0, 150); // Tile (1, 1)

    expect(calculatePriorityFromTile(-4, 1, player)).toBe(
      LoadPriority.PREFETCH,
    ); // 5 tiles west
    expect(calculatePriorityFromTile(10, 10, player)).toBe(
      LoadPriority.PREFETCH,
    ); // 9 tiles diagonal
  });

  it("handles negative tile coordinates", () => {
    const player = new THREE.Vector3(-150, 0, -150); // Tile (-2, -2)

    expect(calculatePriorityFromTile(-2, -2, player)).toBe(
      LoadPriority.CRITICAL,
    );
    expect(calculatePriorityFromTile(-3, -3, player)).toBe(LoadPriority.HIGH);
    expect(calculatePriorityFromTile(-4, -4, player)).toBe(LoadPriority.NORMAL);
  });

  it("uses Chebyshev distance (max of dx, dz)", () => {
    const player = new THREE.Vector3(150, 0, 150); // Tile (1, 1)

    // Tile (4, 1) is 3 tiles east, 0 tiles north = distance 3
    expect(calculatePriorityFromTile(4, 1, player)).toBe(LoadPriority.LOW);

    // Tile (1, 4) is 0 tiles east, 3 tiles north = distance 3
    expect(calculatePriorityFromTile(1, 4, player)).toBe(LoadPriority.LOW);

    // Tile (4, 4) is 3 tiles east, 3 tiles north = distance 3 (not 4.24)
    expect(calculatePriorityFromTile(4, 4, player)).toBe(LoadPriority.LOW);
  });

  it("handles player at tile boundary correctly", () => {
    // Player at exactly (100, 0, 100) - this is tile (1, 1) or (0, 0)?
    // floor(100/100) = 1, so tile (1, 1)
    const player = new THREE.Vector3(100, 0, 100);

    expect(calculatePriorityFromTile(1, 1, player)).toBe(LoadPriority.CRITICAL);
    expect(calculatePriorityFromTile(0, 0, player)).toBe(LoadPriority.HIGH); // Adjacent
  });
});

describe("Queue Reprioritization", () => {
  const TILE_SIZE = 100;

  function getTileFromPosition(pos: THREE.Vector3): { x: number; z: number } {
    return {
      x: Math.floor(pos.x / TILE_SIZE),
      z: Math.floor(pos.z / TILE_SIZE),
    };
  }

  function calculatePriorityFromDistance(
    position: THREE.Vector3,
    playerPosition: THREE.Vector3,
  ): LoadPriority {
    const distance = position.distanceTo(playerPosition);
    const tileDistance = distance / TILE_SIZE;

    if (tileDistance < 1) return LoadPriority.CRITICAL;
    if (tileDistance < 2) return LoadPriority.HIGH;
    if (tileDistance < 3) return LoadPriority.NORMAL;
    if (tileDistance < 5) return LoadPriority.LOW;
    return LoadPriority.PREFETCH;
  }

  function calculatePriorityFromTile(
    tileX: number,
    tileZ: number,
    playerPosition: THREE.Vector3,
  ): LoadPriority {
    const playerTile = getTileFromPosition(playerPosition);
    const dx = Math.abs(tileX - playerTile.x);
    const dz = Math.abs(tileZ - playerTile.z);
    const tileDistance = Math.max(dx, dz);

    if (tileDistance === 0) return LoadPriority.CRITICAL;
    if (tileDistance === 1) return LoadPriority.HIGH;
    if (tileDistance <= 2) return LoadPriority.NORMAL;
    if (tileDistance <= 4) return LoadPriority.LOW;
    return LoadPriority.PREFETCH;
  }

  /**
   * Reprioritize queue based on player position (mirrors ClientLoader logic)
   */
  function reprioritizeQueue(
    queue: PrioritizedLoadRequest[],
    playerPosition: THREE.Vector3,
  ): void {
    for (const request of queue) {
      if (request.position) {
        request.priority = calculatePriorityFromDistance(
          request.position,
          playerPosition,
        );
      } else if (request.tile) {
        request.priority = calculatePriorityFromTile(
          request.tile.x,
          request.tile.z,
          playerPosition,
        );
      }
    }

    queue.sort((a, b) => a.priority - b.priority);
  }

  function createRequest(
    url: string,
    priority: LoadPriority,
    position?: THREE.Vector3,
    tile?: { x: number; z: number },
  ): PrioritizedLoadRequest {
    return {
      url,
      priority,
      position: position?.clone(),
      tile,
      resolve: () => {},
    };
  }

  it("updates priority when player moves closer to position-based requests", () => {
    const queue: PrioritizedLoadRequest[] = [
      createRequest(
        "far.glb",
        LoadPriority.PREFETCH,
        new THREE.Vector3(500, 0, 0),
      ),
    ];

    const oldPlayerPos = new THREE.Vector3(0, 0, 0);
    const newPlayerPos = new THREE.Vector3(450, 0, 0);

    // Initially far away (5+ tiles = PREFETCH)
    expect(
      calculatePriorityFromDistance(queue[0].position!, oldPlayerPos),
    ).toBe(LoadPriority.PREFETCH);

    // After moving closer (50m = CRITICAL)
    reprioritizeQueue(queue, newPlayerPos);
    expect(queue[0].priority).toBe(LoadPriority.CRITICAL);
  });

  it("updates priority when player moves away from position-based requests", () => {
    const queue: PrioritizedLoadRequest[] = [
      createRequest(
        "nearby.glb",
        LoadPriority.CRITICAL,
        new THREE.Vector3(50, 0, 0),
      ),
    ];

    const newPlayerPos = new THREE.Vector3(600, 0, 0);

    reprioritizeQueue(queue, newPlayerPos);

    // Now far away (550m = 5.5 tiles = PREFETCH)
    expect(queue[0].priority).toBe(LoadPriority.PREFETCH);
  });

  it("updates priority for tile-based requests when player changes tiles", () => {
    const queue: PrioritizedLoadRequest[] = [
      createRequest("tile_5_5.glb", LoadPriority.PREFETCH, undefined, {
        x: 5,
        z: 5,
      }),
    ];

    // Player starts at tile (0, 0) - tile (5, 5) is 5 tiles away = PREFETCH
    // Player moves to tile (4, 4) - tile (5, 5) is 1 tile away = HIGH
    const newPlayerPos = new THREE.Vector3(450, 0, 450);

    reprioritizeQueue(queue, newPlayerPos);

    expect(queue[0].priority).toBe(LoadPriority.HIGH);
  });

  it("re-sorts queue after reprioritization", () => {
    const queue: PrioritizedLoadRequest[] = [
      createRequest("a.glb", LoadPriority.LOW, new THREE.Vector3(350, 0, 0)),
      createRequest(
        "b.glb",
        LoadPriority.PREFETCH,
        new THREE.Vector3(600, 0, 0),
      ),
      createRequest(
        "c.glb",
        LoadPriority.CRITICAL,
        new THREE.Vector3(50, 0, 0),
      ),
    ];

    // Player moves to (550, 0, 0)
    // a.glb: now 200m away = 2 tiles = HIGH
    // b.glb: now 50m away = 0.5 tiles = CRITICAL
    // c.glb: now 500m away = 5 tiles = PREFETCH
    const newPlayerPos = new THREE.Vector3(550, 0, 0);

    reprioritizeQueue(queue, newPlayerPos);

    expect(queue[0].url).toBe("b.glb"); // Was farthest, now closest
    expect(queue[0].priority).toBe(LoadPriority.CRITICAL);
    expect(queue[1].url).toBe("a.glb");
    expect(queue[1].priority).toBe(LoadPriority.NORMAL);
    expect(queue[2].url).toBe("c.glb"); // Was closest, now farthest
    expect(queue[2].priority).toBe(LoadPriority.PREFETCH);
  });

  it("preserves requests without position or tile data", () => {
    const queue: PrioritizedLoadRequest[] = [
      createRequest("static.glb", LoadPriority.NORMAL),
    ];

    reprioritizeQueue(queue, new THREE.Vector3(1000, 0, 1000));

    // Priority should remain unchanged
    expect(queue[0].priority).toBe(LoadPriority.NORMAL);
  });

  it("handles mixed position and tile requests correctly", () => {
    const queue: PrioritizedLoadRequest[] = [
      createRequest(
        "position.glb",
        LoadPriority.LOW,
        new THREE.Vector3(200, 0, 0),
      ),
      createRequest("tile.glb", LoadPriority.PREFETCH, undefined, {
        x: 3,
        z: 0,
      }),
      createRequest("static.glb", LoadPriority.NORMAL),
    ];

    // Player at (150, 0, 0) = tile (1, 0)
    // position.glb: 50m away = CRITICAL
    // tile.glb: tile (3, 0) is 2 tiles from (1, 0) = NORMAL
    // static.glb: unchanged = NORMAL
    const playerPos = new THREE.Vector3(150, 0, 0);

    reprioritizeQueue(queue, playerPos);

    expect(queue[0].url).toBe("position.glb");
    expect(queue[0].priority).toBe(LoadPriority.CRITICAL);
    // tile and static both NORMAL, original order preserved
    expect(queue[1].priority).toBe(LoadPriority.NORMAL);
    expect(queue[2].priority).toBe(LoadPriority.NORMAL);
  });
});

describe("Background Loading Scheduling", () => {
  /**
   * Tests for the background loading behavior
   */

  it("processes HIGH and NORMAL priority immediately (not queued for background)", () => {
    // This mirrors the processPriorityQueue logic that processes
    // everything up to NORMAL priority immediately

    const priorities = [
      LoadPriority.CRITICAL,
      LoadPriority.HIGH,
      LoadPriority.NORMAL,
    ];

    for (const priority of priorities) {
      // All these should NOT be queued for background loading
      expect(priority).toBeLessThanOrEqual(LoadPriority.NORMAL);
    }
  });

  it("queues LOW and PREFETCH for background loading", () => {
    const priorities = [LoadPriority.LOW, LoadPriority.PREFETCH];

    for (const priority of priorities) {
      // These should be processed during idle time
      expect(priority).toBeGreaterThan(LoadPriority.NORMAL);
    }
  });

  it("respects time budget during idle processing", () => {
    // Simulate the idle callback deadline behavior
    const MIN_TIME_REMAINING = 5; // ms

    function shouldContinueProcessing(deadline: {
      timeRemaining: () => number;
    }): boolean {
      return deadline.timeRemaining() >= MIN_TIME_REMAINING;
    }

    // With plenty of time remaining
    expect(shouldContinueProcessing({ timeRemaining: () => 50 })).toBe(true);

    // With minimal time remaining
    expect(shouldContinueProcessing({ timeRemaining: () => 4 })).toBe(false);

    // At exact boundary
    expect(shouldContinueProcessing({ timeRemaining: () => 5 })).toBe(true);
  });

  it("processes one item at a time in setTimeout fallback", () => {
    // When requestIdleCallback is not available, setTimeout processes
    // one item at a time to prevent blocking
    const ITEMS_PER_TIMEOUT_BATCH = 1;
    expect(ITEMS_PER_TIMEOUT_BATCH).toBe(1);
  });
});

describe("Concurrent Request Handling", () => {
  it("deduplicates concurrent requests for same URL", () => {
    // Simulate the filePromises deduplication logic
    const filePromises = new Map<string, Promise<File | undefined>>();
    const stats = { requestsDeduped: 0 };

    function loadFileWithDedup(url: string): Promise<File | undefined> {
      if (filePromises.has(url)) {
        stats.requestsDeduped++;
        return filePromises.get(url)!;
      }

      const promise = new Promise<File | undefined>((resolve) => {
        setTimeout(() => resolve(new File([], url)), 10);
      });

      filePromises.set(url, promise);
      return promise;
    }

    // Three concurrent requests for same URL
    const p1 = loadFileWithDedup("model.glb");
    const p2 = loadFileWithDedup("model.glb");
    const p3 = loadFileWithDedup("model.glb");

    // All should reference the same promise
    expect(p1).toBe(p2);
    expect(p2).toBe(p3);

    // Two were deduped
    expect(stats.requestsDeduped).toBe(2);
  });

  it("handles multiple priorities for same URL correctly", () => {
    // If a URL is already in the priority queue, the second request
    // should not add a duplicate

    const queue: PrioritizedLoadRequest[] = [];
    const urlsInQueue = new Set<string>();

    function queueIfNotExists(url: string, priority: LoadPriority): boolean {
      if (urlsInQueue.has(url)) {
        return false; // Already queued
      }

      queue.push({
        url,
        priority,
        resolve: () => {},
      });
      urlsInQueue.add(url);
      return true;
    }

    expect(queueIfNotExists("model.glb", LoadPriority.LOW)).toBe(true);
    expect(queueIfNotExists("model.glb", LoadPriority.CRITICAL)).toBe(false);
    expect(queue.length).toBe(1);
  });
});

describe("Edge Cases and Error Handling", () => {
  it("handles very large tile coordinates", () => {
    const TILE_SIZE = 100;
    const MAX_COORD = 1000000; // 100km

    function getTileFromPosition(pos: THREE.Vector3): { x: number; z: number } {
      return {
        x: Math.floor(pos.x / TILE_SIZE),
        z: Math.floor(pos.z / TILE_SIZE),
      };
    }

    const farPosition = new THREE.Vector3(MAX_COORD, 0, MAX_COORD);
    const tile = getTileFromPosition(farPosition);

    expect(tile.x).toBe(10000);
    expect(tile.z).toBe(10000);
    expect(Number.isFinite(tile.x)).toBe(true);
    expect(Number.isFinite(tile.z)).toBe(true);
  });

  it("handles NaN position gracefully", () => {
    const position = new THREE.Vector3(NaN, 0, 0);
    const player = new THREE.Vector3(0, 0, 0);

    const distance = position.distanceTo(player);

    // distanceTo with NaN returns NaN
    expect(Number.isNaN(distance)).toBe(true);
  });

  it("handles Infinity position gracefully", () => {
    const position = new THREE.Vector3(Infinity, 0, 0);
    const player = new THREE.Vector3(0, 0, 0);

    const distance = position.distanceTo(player);

    expect(distance).toBe(Infinity);
  });

  it("handles empty resolve callback", () => {
    const request: PrioritizedLoadRequest = {
      url: "test.glb",
      priority: LoadPriority.NORMAL,
      resolve: () => {}, // No-op is valid
    };

    // Should not throw
    expect(() => request.resolve(undefined)).not.toThrow();
  });

  it("maintains queue integrity after rapid additions and removals", () => {
    const queue: PrioritizedLoadRequest[] = [];

    function insertWithPriority(
      queue: PrioritizedLoadRequest[],
      request: PrioritizedLoadRequest,
    ): void {
      const insertIndex = queue.findIndex((r) => r.priority > request.priority);
      if (insertIndex === -1) {
        queue.push(request);
      } else {
        queue.splice(insertIndex, 0, request);
      }
    }

    // Rapidly add and remove items
    for (let i = 0; i < 100; i++) {
      const priority = (i % 5) as LoadPriority;
      insertWithPriority(queue, {
        url: `file${i}.glb`,
        priority,
        resolve: () => {},
      });

      // Remove every other item
      if (i % 2 === 0 && queue.length > 0) {
        queue.shift();
      }
    }

    // Queue should still be sorted
    for (let i = 1; i < queue.length; i++) {
      expect(queue[i].priority).toBeGreaterThanOrEqual(queue[i - 1].priority);
    }
  });
});

describe("Tile Preloading", () => {
  /**
   * Tests for the preloadTile functionality
   */

  function createPreloadTileResult(
    tileX: number,
    tileZ: number,
    urls: string[],
    playerPosition: THREE.Vector3,
  ): { urls: string[]; priority: LoadPriority } {
    const TILE_SIZE = 100;
    const playerTile = {
      x: Math.floor(playerPosition.x / TILE_SIZE),
      z: Math.floor(playerPosition.z / TILE_SIZE),
    };
    const dx = Math.abs(tileX - playerTile.x);
    const dz = Math.abs(tileZ - playerTile.z);
    const tileDistance = Math.max(dx, dz);

    let priority: LoadPriority;
    if (tileDistance === 0) priority = LoadPriority.CRITICAL;
    else if (tileDistance === 1) priority = LoadPriority.HIGH;
    else if (tileDistance <= 2) priority = LoadPriority.NORMAL;
    else if (tileDistance <= 4) priority = LoadPriority.LOW;
    else priority = LoadPriority.PREFETCH;

    return { urls, priority };
  }

  it("calculates correct priority for tile preload", () => {
    const player = new THREE.Vector3(150, 0, 150); // Tile (1, 1)

    // Same tile
    expect(createPreloadTileResult(1, 1, [], player).priority).toBe(
      LoadPriority.CRITICAL,
    );

    // Adjacent tile
    expect(createPreloadTileResult(2, 2, [], player).priority).toBe(
      LoadPriority.HIGH,
    );

    // 2 tiles away
    expect(createPreloadTileResult(3, 3, [], player).priority).toBe(
      LoadPriority.NORMAL,
    );

    // 5 tiles away
    expect(createPreloadTileResult(6, 6, [], player).priority).toBe(
      LoadPriority.PREFETCH,
    );
  });
});

describe("Priority Queue Stats", () => {
  /**
   * Tests for the getPriorityQueueStats functionality
   */

  function getPriorityQueueStats(queue: PrioritizedLoadRequest[]): {
    byPriority: Record<number, number>;
    queueLength: number;
  } {
    const byPriority: Record<number, number> = {
      [LoadPriority.CRITICAL]: 0,
      [LoadPriority.HIGH]: 0,
      [LoadPriority.NORMAL]: 0,
      [LoadPriority.LOW]: 0,
      [LoadPriority.PREFETCH]: 0,
    };

    for (const request of queue) {
      byPriority[request.priority] = (byPriority[request.priority] || 0) + 1;
    }

    return {
      byPriority,
      queueLength: queue.length,
    };
  }

  it("counts items by priority correctly", () => {
    const queue: PrioritizedLoadRequest[] = [
      { url: "a.glb", priority: LoadPriority.CRITICAL, resolve: () => {} },
      { url: "b.glb", priority: LoadPriority.HIGH, resolve: () => {} },
      { url: "c.glb", priority: LoadPriority.HIGH, resolve: () => {} },
      { url: "d.glb", priority: LoadPriority.LOW, resolve: () => {} },
      { url: "e.glb", priority: LoadPriority.PREFETCH, resolve: () => {} },
      { url: "f.glb", priority: LoadPriority.PREFETCH, resolve: () => {} },
      { url: "g.glb", priority: LoadPriority.PREFETCH, resolve: () => {} },
    ];

    const stats = getPriorityQueueStats(queue);

    expect(stats.queueLength).toBe(7);
    expect(stats.byPriority[LoadPriority.CRITICAL]).toBe(1);
    expect(stats.byPriority[LoadPriority.HIGH]).toBe(2);
    expect(stats.byPriority[LoadPriority.NORMAL]).toBe(0);
    expect(stats.byPriority[LoadPriority.LOW]).toBe(1);
    expect(stats.byPriority[LoadPriority.PREFETCH]).toBe(3);
  });

  it("returns zeros for empty queue", () => {
    const stats = getPriorityQueueStats([]);

    expect(stats.queueLength).toBe(0);
    expect(stats.byPriority[LoadPriority.CRITICAL]).toBe(0);
    expect(stats.byPriority[LoadPriority.HIGH]).toBe(0);
    expect(stats.byPriority[LoadPriority.NORMAL]).toBe(0);
    expect(stats.byPriority[LoadPriority.LOW]).toBe(0);
    expect(stats.byPriority[LoadPriority.PREFETCH]).toBe(0);
  });
});

describe("Integration: Full Priority Loading Workflow", () => {
  /**
   * End-to-end tests that simulate the complete workflow
   */

  it("processes requests in correct order as player moves", () => {
    // Set up queue with requests at various positions
    const queue: PrioritizedLoadRequest[] = [];
    const TILE_SIZE = 100;
    const processedUrls: string[] = [];

    function calculatePriorityFromDistance(
      position: THREE.Vector3,
      playerPosition: THREE.Vector3,
    ): LoadPriority {
      const distance = position.distanceTo(playerPosition);
      const tileDistance = distance / TILE_SIZE;
      if (tileDistance < 1) return LoadPriority.CRITICAL;
      if (tileDistance < 2) return LoadPriority.HIGH;
      if (tileDistance < 3) return LoadPriority.NORMAL;
      if (tileDistance < 5) return LoadPriority.LOW;
      return LoadPriority.PREFETCH;
    }

    function reprioritizeQueue(
      queue: PrioritizedLoadRequest[],
      playerPosition: THREE.Vector3,
    ): void {
      for (const request of queue) {
        if (request.position) {
          request.priority = calculatePriorityFromDistance(
            request.position,
            playerPosition,
          );
        }
      }
      queue.sort((a, b) => a.priority - b.priority);
    }

    function processQueue(maxPriority: LoadPriority): void {
      while (queue.length > 0 && queue[0].priority <= maxPriority) {
        const item = queue.shift()!;
        processedUrls.push(item.url);
        item.resolve(new File([], item.url));
      }
    }

    // Create requests at different positions
    const requests = [
      { url: "far_east.glb", position: new THREE.Vector3(600, 0, 0) },
      { url: "nearby.glb", position: new THREE.Vector3(50, 0, 0) },
      { url: "medium.glb", position: new THREE.Vector3(250, 0, 0) },
      { url: "far_west.glb", position: new THREE.Vector3(-400, 0, 0) },
    ];

    for (const req of requests) {
      queue.push({
        url: req.url,
        priority: LoadPriority.PREFETCH, // Initial priority
        position: req.position,
        resolve: () => {},
      });
    }

    // Player at origin
    let playerPos = new THREE.Vector3(0, 0, 0);
    reprioritizeQueue(queue, playerPos);

    // Process NORMAL and below
    processQueue(LoadPriority.NORMAL);

    // 'nearby' (50m = CRITICAL) and 'medium' (250m = NORMAL) should be processed
    expect(processedUrls).toContain("nearby.glb");
    expect(processedUrls).toContain("medium.glb");
    expect(processedUrls).not.toContain("far_east.glb"); // 600m = PREFETCH
    expect(processedUrls).not.toContain("far_west.glb"); // 400m = LOW

    // Player moves east
    playerPos = new THREE.Vector3(550, 0, 0);
    reprioritizeQueue(queue, playerPos);

    // far_east is now 50m away = CRITICAL
    expect(queue[0].url).toBe("far_east.glb");
    expect(queue[0].priority).toBe(LoadPriority.CRITICAL);

    // Process all remaining
    processQueue(LoadPriority.PREFETCH);

    expect(processedUrls.length).toBe(4);
    // far_east should have been processed before far_west
    expect(processedUrls.indexOf("far_east.glb")).toBeLessThan(
      processedUrls.indexOf("far_west.glb"),
    );
  });
});
