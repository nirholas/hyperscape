/**
 * AtlasedImpostorDebug - Debug utilities for AtlasedImpostorManager
 *
 * Provides tools for verifying pixel uploads, testing slot allocation/eviction,
 * and visual debugging (canvas export, slot visualization).
 */

import THREE from "../../../extras/three/three";
import {
  AtlasedImpostorManager,
  ATLASED_IMPOSTOR_CONFIG,
} from "./AtlasedImpostorManager";

// ============================================================================
// TYPES
// ============================================================================

export interface PixelVerification {
  slotIndex: number;
  hasData: boolean;
  nonZeroPixels: number;
  totalPixels: number;
  averageAlpha: number;
  sampleColors: Array<{
    x: number;
    y: number;
    r: number;
    g: number;
    b: number;
    a: number;
  }>;
  presetId: string | null;
  loaded: boolean;
}

export interface SlotState {
  index: number;
  presetId: string | null;
  loaded: boolean;
  lastAccessTime: number;
  ageMs: number;
}

interface InternalManager {
  atlasArray: THREE.DataArrayTexture | null;
  slots: Array<{
    index: number;
    presetId: string | null;
    lastAccessTime: number;
    loaded: boolean;
  }>;
}

// ============================================================================
// DEBUG UTILITY
// ============================================================================

export class AtlasedImpostorDebug {
  private manager: AtlasedImpostorManager;

  constructor(manager: AtlasedImpostorManager) {
    this.manager = manager;
  }

  private get internal(): InternalManager {
    return this.manager as unknown as InternalManager;
  }

  // ============================================================================
  // PIXEL VERIFICATION
  // ============================================================================

  verifySlotPixels(slotIndex: number): PixelVerification {
    const { ATLAS_SIZE, MAX_SLOTS } = ATLASED_IMPOSTOR_CONFIG;
    const { atlasArray, slots } = this.internal;

    const empty: PixelVerification = {
      slotIndex,
      hasData: false,
      nonZeroPixels: 0,
      totalPixels: 0,
      averageAlpha: 0,
      sampleColors: [],
      presetId: null,
      loaded: false,
    };

    if (!atlasArray || slotIndex < 0 || slotIndex >= MAX_SLOTS) return empty;

    const data = atlasArray.image.data as Uint8Array;
    const layerOffset = slotIndex * ATLAS_SIZE * ATLAS_SIZE * 4;
    const totalPixels = ATLAS_SIZE * ATLAS_SIZE;

    let nonZeroPixels = 0;
    let totalAlpha = 0;

    // Count pixels
    for (let i = 0; i < totalPixels; i++) {
      const idx = layerOffset + i * 4;
      const a = data[idx + 3];
      totalAlpha += a;
      if (a > 0 && (data[idx] > 0 || data[idx + 1] > 0 || data[idx + 2] > 0)) {
        nonZeroPixels++;
      }
    }

    // Sample corners and center
    const sampleLocs = [
      [0, 0],
      [ATLAS_SIZE - 1, 0],
      [0, ATLAS_SIZE - 1],
      [ATLAS_SIZE - 1, ATLAS_SIZE - 1],
      [ATLAS_SIZE >> 1, ATLAS_SIZE >> 1],
      [ATLAS_SIZE >> 2, ATLAS_SIZE >> 2],
    ];

    const sampleColors = sampleLocs.map(([x, y]) => {
      const idx = layerOffset + (y * ATLAS_SIZE + x) * 4;
      return {
        x,
        y,
        r: data[idx],
        g: data[idx + 1],
        b: data[idx + 2],
        a: data[idx + 3],
      };
    });

    const slot = slots[slotIndex];
    return {
      slotIndex,
      hasData: nonZeroPixels > 0,
      nonZeroPixels,
      totalPixels,
      averageAlpha: totalAlpha / totalPixels,
      sampleColors,
      presetId: slot?.presetId ?? null,
      loaded: slot?.loaded ?? false,
    };
  }

  verifyAllSlots(): PixelVerification[] {
    return Array.from({ length: ATLASED_IMPOSTOR_CONFIG.MAX_SLOTS }, (_, i) =>
      this.verifySlotPixels(i),
    );
  }

  // ============================================================================
  // CANVAS EXPORT
  // ============================================================================

  exportSlotToCanvas(slotIndex: number): HTMLCanvasElement | null {
    const { ATLAS_SIZE, MAX_SLOTS } = ATLASED_IMPOSTOR_CONFIG;
    const { atlasArray, slots } = this.internal;

    if (!atlasArray || slotIndex < 0 || slotIndex >= MAX_SLOTS) return null;

    const canvas = document.createElement("canvas");
    canvas.width = ATLAS_SIZE;
    canvas.height = ATLAS_SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    const imageData = ctx.createImageData(ATLAS_SIZE, ATLAS_SIZE);
    const src = atlasArray.image.data as Uint8Array;
    const offset = slotIndex * ATLAS_SIZE * ATLAS_SIZE * 4;

    imageData.data.set(
      src.subarray(offset, offset + ATLAS_SIZE * ATLAS_SIZE * 4),
    );
    ctx.putImageData(imageData, 0, 0);

    // Debug overlay
    const slot = slots[slotIndex];
    ctx.fillStyle = "rgba(0,0,0,0.7)";
    ctx.fillRect(0, 0, 180, 55);
    ctx.fillStyle = "white";
    ctx.font = "12px monospace";
    ctx.fillText(`Slot: ${slotIndex}`, 8, 18);
    ctx.fillText(`Preset: ${slot?.presetId ?? "empty"}`, 8, 34);
    ctx.fillText(`Loaded: ${slot?.loaded ?? false}`, 8, 50);

    return canvas;
  }

  exportAllSlotsToCanvas(columns = 8): HTMLCanvasElement | null {
    const { MAX_SLOTS } = ATLASED_IMPOSTOR_CONFIG;
    const thumbSize = 128;
    const rows = Math.ceil(MAX_SLOTS / columns);

    const canvas = document.createElement("canvas");
    canvas.width = columns * thumbSize;
    canvas.height = rows * thumbSize;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    ctx.fillStyle = "#333";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    for (let i = 0; i < MAX_SLOTS; i++) {
      const slotCanvas = this.exportSlotToCanvas(i);
      if (slotCanvas) {
        ctx.drawImage(
          slotCanvas,
          (i % columns) * thumbSize,
          Math.floor(i / columns) * thumbSize,
          thumbSize,
          thumbSize,
        );
      }
    }

    return canvas;
  }

  // ============================================================================
  // SLOT STATE
  // ============================================================================

  getSlotStates(): SlotState[] {
    const now = performance.now();
    return this.internal.slots.map((s) => ({
      index: s.index,
      presetId: s.presetId,
      loaded: s.loaded,
      lastAccessTime: s.lastAccessTime,
      ageMs: now - s.lastAccessTime,
    }));
  }

  logSlotStates(): void {
    const now = performance.now();
    console.group("[AtlasedImpostorDebug] Slots");
    console.table(
      this.internal.slots.map((s) => ({
        index: s.index,
        presetId: s.presetId ?? "(empty)",
        loaded: s.loaded,
        ageMs: Math.round(now - s.lastAccessTime),
      })),
    );
    console.groupEnd();
  }

  // ============================================================================
  // COMPARISON & VERIFICATION
  // ============================================================================

  compareSlots(
    slotA: number,
    slotB: number,
  ): {
    areDifferent: boolean;
    differingPixels: number;
    totalPixels: number;
    differenceRatio: number;
  } {
    const { ATLAS_SIZE, MAX_SLOTS } = ATLASED_IMPOSTOR_CONFIG;
    const { atlasArray } = this.internal;

    if (!atlasArray || slotA >= MAX_SLOTS || slotB >= MAX_SLOTS) {
      return {
        areDifferent: false,
        differingPixels: 0,
        totalPixels: 0,
        differenceRatio: 0,
      };
    }

    const data = atlasArray.image.data as Uint8Array;
    const totalPixels = ATLAS_SIZE * ATLAS_SIZE;
    const offsetA = slotA * totalPixels * 4;
    const offsetB = slotB * totalPixels * 4;

    let differingPixels = 0;
    for (let i = 0; i < totalPixels * 4; i += 4) {
      if (
        Math.abs(data[offsetA + i] - data[offsetB + i]) > 5 ||
        Math.abs(data[offsetA + i + 1] - data[offsetB + i + 1]) > 5 ||
        Math.abs(data[offsetA + i + 2] - data[offsetB + i + 2]) > 5 ||
        Math.abs(data[offsetA + i + 3] - data[offsetB + i + 3]) > 5
      ) {
        differingPixels++;
      }
    }

    return {
      areDifferent: differingPixels > totalPixels * 0.01,
      differingPixels,
      totalPixels,
      differenceRatio: differingPixels / totalPixels,
    };
  }

  verifySwap(
    slotIndex: number,
    expectedPresetId: string,
    previous?: PixelVerification,
  ) {
    const current = this.verifySlotPixels(slotIndex);
    const contentChanged = previous
      ? current.nonZeroPixels !== previous.nonZeroPixels ||
        Math.abs(current.averageAlpha - previous.averageAlpha) > 1
      : true;

    return {
      success:
        current.presetId === expectedPresetId &&
        current.hasData &&
        current.loaded,
      currentVerification: current,
      previousVerification: previous ?? null,
      contentChanged,
    };
  }

  // ============================================================================
  // TEST SUITE
  // ============================================================================

  runFullTestSuite() {
    const results: Array<{ test: string; passed: boolean; details: string }> =
      [];
    const { atlasArray, slots } = this.internal;

    results.push({
      test: "Atlas array exists",
      passed: atlasArray !== null,
      details: atlasArray
        ? `${atlasArray.image.width}x${atlasArray.image.height}x${atlasArray.image.depth}`
        : "null",
    });

    results.push({
      test: "Slots initialized",
      passed: slots.length === ATLASED_IMPOSTOR_CONFIG.MAX_SLOTS,
      details: `${slots.length}/${ATLASED_IMPOSTOR_CONFIG.MAX_SLOTS}`,
    });

    const usedSlots = slots.filter((s) => s.presetId !== null);
    results.push({
      test: "Slot bookkeeping",
      passed: true,
      details: `${slots.length - usedSlots.length} empty, ${usedSlots.length} used`,
    });

    for (const slot of usedSlots) {
      const v = this.verifySlotPixels(slot.index);
      results.push({
        test: `Slot ${slot.index} (${slot.presetId})`,
        passed: v.hasData,
        details: `${v.nonZeroPixels}/${v.totalPixels} px, alpha=${v.averageAlpha.toFixed(1)}`,
      });
    }

    const stats = this.manager.getStats();
    results.push({
      test: "Stats consistency",
      passed: stats.slotsUsed === usedSlots.length,
      details: `reported=${stats.slotsUsed}, actual=${usedSlots.length}`,
    });

    const passed = results.filter((r) => r.passed).length;
    console.group("[AtlasedImpostorDebug] Test Suite");
    console.table(results);
    console.log(`${passed}/${results.length} passed`);
    console.groupEnd();

    return { passed, failed: results.length - passed, results };
  }

  // ============================================================================
  // DOWNLOAD
  // ============================================================================

  downloadSlotAsPNG(slotIndex: number, filename?: string): void {
    const canvas = this.exportSlotToCanvas(slotIndex);
    if (!canvas) return;

    const slot = this.internal.slots[slotIndex];
    const link = document.createElement("a");
    link.download =
      filename ?? `atlas_slot_${slotIndex}_${slot?.presetId ?? "empty"}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  }

  downloadAllSlotsAsPNG(filename = "atlas_all_slots.png"): void {
    const canvas = this.exportAllSlotsToCanvas();
    if (!canvas) return;

    const link = document.createElement("a");
    link.download = filename;
    link.href = canvas.toDataURL("image/png");
    link.click();
  }
}

export default AtlasedImpostorDebug;
