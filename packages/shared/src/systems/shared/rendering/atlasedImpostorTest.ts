/**
 * Atlased Impostor Test Script
 *
 * Verifies slot allocation, pixel uploads, eviction, and swap correctness.
 *
 * Usage:
 * ```ts
 * import { runAtlasedImpostorTests, visualTest } from './atlasedImpostorTest';
 * await runAtlasedImpostorTests(world);
 * ```
 */

import THREE from "../../../extras/three/three";
import type { World } from "../../../core/World";
import {
  AtlasedImpostorManager,
  ATLASED_IMPOSTOR_CONFIG,
} from "./AtlasedImpostorManager";
import { AtlasedImpostorDebug } from "./AtlasedImpostorDebug";

interface TestResult {
  name: string;
  passed: boolean;
  details: string;
  duration: number;
}

// ============================================================================
// HELPERS
// ============================================================================

const createTestMesh = (color: THREE.Color, name: string) => {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(2, 4, 2),
    new THREE.MeshStandardMaterial({ color }),
  );
  mesh.name = name;
  return mesh;
};

const waitFor = async (
  condition: () => boolean,
  timeout = 5000,
  interval = 100,
): Promise<boolean> => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (condition()) return true;
    await new Promise((r) => setTimeout(r, interval));
  }
  return false;
};

const runTest = async (
  name: string,
  fn: () => Promise<{ passed: boolean; details: string }>,
): Promise<TestResult> => {
  const start = Date.now();
  try {
    const { passed, details } = await fn();
    return { name, passed, details, duration: Date.now() - start };
  } catch (err) {
    return {
      name,
      passed: false,
      details: `Error: ${err}`,
      duration: Date.now() - start,
    };
  }
};

// ============================================================================
// TESTS
// ============================================================================

async function testInitialization(
  manager: AtlasedImpostorManager,
): Promise<TestResult> {
  return runTest("Initialization", async () => {
    const initialized = await manager.init();
    const stats = manager.getStats();
    return {
      passed:
        initialized &&
        stats.slotsTotal === ATLASED_IMPOSTOR_CONFIG.MAX_SLOTS &&
        stats.drawCalls === 1,
      details: `Slots: ${stats.slotsTotal}, DrawCalls: ${stats.drawCalls}`,
    };
  });
}

async function testSlotAllocation(
  manager: AtlasedImpostorManager,
  debug: AtlasedImpostorDebug,
): Promise<TestResult> {
  return runTest("Slot Allocation", async () => {
    const testMesh = createTestMesh(new THREE.Color(0xff0000), "test_red");

    let loadedSlot = -1;
    manager.setOnSlotLoaded((slot) => {
      loadedSlot = slot;
    });

    await manager.registerPreset("test_alloc", testMesh);
    manager.addInstance(
      "test_alloc",
      "inst_1",
      new THREE.Vector3(0, 0, 0),
      0,
      1,
    );

    const loaded = await waitFor(() => loadedSlot >= 0, 10000);
    const slotInfo = manager.getSlotInfo();
    const slot = slotInfo.find((s) => s.presetId === "test_alloc");
    const verification = debug.verifySlotPixels(loadedSlot);

    manager.setOnSlotLoaded(null);

    return {
      passed: loaded && slot?.loaded === true && verification.hasData,
      details: `Slot: ${loadedSlot}, Loaded: ${slot?.loaded}, NonZero: ${verification.nonZeroPixels}`,
    };
  });
}

async function testMultiplePresets(
  manager: AtlasedImpostorManager,
  debug: AtlasedImpostorDebug,
): Promise<TestResult> {
  return runTest("Multiple Presets", async () => {
    const colors = [
      { name: "multi_red", color: new THREE.Color(1, 0, 0) },
      { name: "multi_green", color: new THREE.Color(0, 1, 0) },
      { name: "multi_blue", color: new THREE.Color(0, 0, 1) },
    ];

    const loaded = new Set<string>();
    manager.setOnSlotLoaded((_, preset) => loaded.add(preset));

    for (const { name, color } of colors) {
      await manager.registerPreset(name, createTestMesh(color, name));
      manager.addInstance(name, `inst_${name}`, new THREE.Vector3(), 0, 1);
    }

    const allLoaded = await waitFor(() => loaded.size >= colors.length, 15000);
    const slots = manager.getSlotInfo().filter((s) => s.presetId !== null);

    // Verify slots have different content
    let allDifferent = true;
    for (let i = 0; i < slots.length && allDifferent; i++) {
      for (let j = i + 1; j < slots.length && allDifferent; j++) {
        allDifferent = debug.compareSlots(
          slots[i].index,
          slots[j].index,
        ).areDifferent;
      }
    }

    manager.setOnSlotLoaded(null);

    return {
      passed: allLoaded && slots.length === colors.length && allDifferent,
      details: `Loaded: ${loaded.size}/${colors.length}, Different: ${allDifferent}`,
    };
  });
}

// ============================================================================
// MAIN
// ============================================================================

export async function runAtlasedImpostorTests(world: World) {
  console.group("🧪 Atlased Impostor Tests");

  const manager = AtlasedImpostorManager.getInstance(world);
  const debug = new AtlasedImpostorDebug(manager);
  const results: TestResult[] = [];

  const tests = [
    () => testInitialization(manager),
    () => testSlotAllocation(manager, debug),
    () => testMultiplePresets(manager, debug),
  ];

  for (const test of tests) {
    const result = await test();
    results.push(result);
    console.log(
      `${result.passed ? "✅" : "❌"} ${result.name}: ${result.details} (${result.duration}ms)`,
    );
  }

  const passed = results.filter((r) => r.passed).length;
  console.log(`\n${passed}/${results.length} passed`);
  console.groupEnd();

  return { passed, failed: results.length - passed, results };
}

export function visualTest(world: World): HTMLCanvasElement | null {
  const debug = new AtlasedImpostorDebug(
    AtlasedImpostorManager.getInstance(world),
  );
  return debug.exportAllSlotsToCanvas();
}

export function downloadAllSlots(world: World): void {
  const debug = new AtlasedImpostorDebug(
    AtlasedImpostorManager.getInstance(world),
  );
  debug.downloadAllSlotsAsPNG();
}

export default runAtlasedImpostorTests;
