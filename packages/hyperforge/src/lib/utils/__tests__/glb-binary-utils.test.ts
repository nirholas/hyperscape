/**
 * GLB Binary Utils Tests
 *
 * Tests for GLB binary file parsing and building utilities.
 * These tests create real GLB binary data structures to validate parsing logic.
 */

import { describe, it, expect } from "vitest";
import { parseGLB, buildGLB, getGLBInfo } from "@/lib/utils/glb-binary-utils";

/** GLB magic number: "glTF" in little-endian (0x46546C67) */
const GLB_MAGIC = 0x46546c67;

/** JSON chunk type: "JSON" in little-endian */
const CHUNK_TYPE_JSON = 0x4e4f534a;

/** BIN chunk type: "BIN\0" in little-endian */
const CHUNK_TYPE_BIN = 0x004e4942;

/**
 * Create a minimal valid GLB ArrayBuffer for testing
 */
function createMinimalGLB(
  json: Record<string, unknown>,
  bin?: Uint8Array,
): ArrayBuffer {
  const jsonString = JSON.stringify(json);
  const jsonBuffer = new TextEncoder().encode(jsonString);
  // Pad JSON to 4-byte boundary
  const jsonPadded = Math.ceil(jsonBuffer.length / 4) * 4;
  const binPadded = bin ? Math.ceil(bin.length / 4) * 4 : 0;

  const totalLength = 12 + 8 + jsonPadded + (bin ? 8 + binPadded : 0);
  const buffer = new ArrayBuffer(totalLength);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  // Header (12 bytes)
  view.setUint32(0, GLB_MAGIC, true); // magic
  view.setUint32(4, 2, true); // version
  view.setUint32(8, totalLength, true); // length

  // JSON chunk header (8 bytes)
  view.setUint32(12, jsonPadded, true); // chunk length
  view.setUint32(16, CHUNK_TYPE_JSON, true); // chunk type

  // JSON chunk data
  bytes.set(jsonBuffer, 20);
  // Pad with spaces
  for (let i = jsonBuffer.length; i < jsonPadded; i++) {
    bytes[20 + i] = 0x20;
  }

  // BIN chunk if provided
  if (bin) {
    const binOffset = 20 + jsonPadded;
    view.setUint32(binOffset, binPadded, true); // chunk length
    view.setUint32(binOffset + 4, CHUNK_TYPE_BIN, true); // chunk type
    bytes.set(bin, binOffset + 8);
    // Pad with zeros
    for (let i = bin.length; i < binPadded; i++) {
      bytes[binOffset + 8 + i] = 0x00;
    }
  }

  return buffer;
}

describe("GLB Binary Utils", () => {
  describe("GLB Magic Number Validation", () => {
    it("validates GLB magic bytes (0x46546C67)", () => {
      const json = { asset: { version: "2.0" } };
      const glb = createMinimalGLB(json);
      const view = new DataView(glb);

      const magic = view.getUint32(0, true);
      expect(magic).toBe(GLB_MAGIC);
      expect(magic).toBe(0x46546c67);
    });

    it("rejects invalid magic numbers", () => {
      const json = { asset: { version: "2.0" } };
      const glb = createMinimalGLB(json);
      const view = new DataView(glb);

      // Corrupt the magic number
      view.setUint32(0, 0x12345678, true);

      expect(() => parseGLB(glb)).toThrow("Invalid GLB: wrong magic number");
    });

    it("rejects empty buffer", () => {
      const emptyBuffer = new ArrayBuffer(0);

      expect(() => parseGLB(emptyBuffer)).toThrow();
    });

    it("rejects buffer too small for header", () => {
      const smallBuffer = new ArrayBuffer(8);

      expect(() => parseGLB(smallBuffer)).toThrow();
    });
  });

  describe("GLB Header Parsing", () => {
    it("extracts version number", () => {
      const json = { asset: { version: "2.0" } };
      const glb = createMinimalGLB(json);

      const info = getGLBInfo(glb);
      expect(info.version).toBe(2);
    });

    it("extracts total length", () => {
      const json = { asset: { version: "2.0" }, nodes: [{ name: "test" }] };
      const glb = createMinimalGLB(json);

      const info = getGLBInfo(glb);
      expect(info.totalLength).toBe(glb.byteLength);
    });

    it("validates header structure", () => {
      const json = { asset: { version: "2.0" } };
      const glb = createMinimalGLB(json);
      const view = new DataView(glb);

      // Header is 12 bytes: magic (4) + version (4) + length (4)
      expect(glb.byteLength).toBeGreaterThanOrEqual(12);

      // Validate header fields
      const magic = view.getUint32(0, true);
      const version = view.getUint32(4, true);
      const length = view.getUint32(8, true);

      expect(magic).toBe(GLB_MAGIC);
      expect(version).toBe(2);
      expect(length).toBe(glb.byteLength);
    });

    it("rejects unsupported GLB version", () => {
      const json = { asset: { version: "2.0" } };
      const glb = createMinimalGLB(json);
      const view = new DataView(glb);

      // Set version to 1 (unsupported)
      view.setUint32(4, 1, true);

      expect(() => parseGLB(glb)).toThrow("Invalid GLB: unsupported version 1");
    });
  });

  describe("Chunk Parsing", () => {
    it("identifies JSON chunk (0x4E4F534A)", () => {
      const json = { asset: { version: "2.0" }, meshes: [] };
      const glb = createMinimalGLB(json);
      const view = new DataView(glb);

      // JSON chunk type is at offset 16
      const chunkType = view.getUint32(16, true);
      expect(chunkType).toBe(CHUNK_TYPE_JSON);
      expect(chunkType).toBe(0x4e4f534a);
    });

    it("identifies BIN chunk (0x004E4942)", () => {
      const json = { asset: { version: "2.0" } };
      const binData = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
      const glb = createMinimalGLB(json, binData);

      // Calculate BIN chunk offset
      const view = new DataView(glb);
      const jsonChunkLength = view.getUint32(12, true);
      const binChunkOffset = 12 + 8 + jsonChunkLength;

      const binChunkType = view.getUint32(binChunkOffset + 4, true);
      expect(binChunkType).toBe(CHUNK_TYPE_BIN);
      expect(binChunkType).toBe(0x004e4942);
    });

    it("extracts JSON chunk data correctly", () => {
      const json = {
        asset: { version: "2.0", generator: "test" },
        scene: 0,
        scenes: [{ name: "Scene", nodes: [0] }],
        nodes: [{ name: "TestNode", mesh: 0 }],
      };
      const glb = createMinimalGLB(json);

      const parsed = parseGLB(glb);

      expect(parsed.json).toEqual(json);
      expect(parsed.json.asset).toEqual({ version: "2.0", generator: "test" });
      expect(parsed.json.nodes).toHaveLength(1);
    });

    it("extracts BIN chunk data correctly", () => {
      const json = { asset: { version: "2.0" } };
      const binData = new Uint8Array([10, 20, 30, 40, 50, 60, 70, 80]);
      const glb = createMinimalGLB(json, binData);

      const parsed = parseGLB(glb);

      expect(parsed.bin).not.toBeNull();
      expect(parsed.bin!.length).toBeGreaterThanOrEqual(binData.length);
      // Check first bytes match
      for (let i = 0; i < binData.length; i++) {
        expect(parsed.bin![i]).toBe(binData[i]);
      }
    });

    it("handles GLB without BIN chunk", () => {
      const json = { asset: { version: "2.0" }, meshes: [] };
      const glb = createMinimalGLB(json);

      const parsed = parseGLB(glb);

      expect(parsed.json).toEqual(json);
      expect(parsed.bin).toBeNull();
    });

    it("rejects GLB with non-JSON first chunk", () => {
      const json = { asset: { version: "2.0" } };
      const glb = createMinimalGLB(json);
      const view = new DataView(glb);

      // Corrupt the chunk type to something other than JSON
      view.setUint32(16, 0xdeadbeef, true);

      expect(() => parseGLB(glb)).toThrow(
        "Invalid GLB: first chunk is not JSON",
      );
    });
  });

  describe("GLB Building", () => {
    it("creates valid GLB from JSON only", () => {
      const json = {
        asset: { version: "2.0", generator: "test-builder" },
        scene: 0,
        scenes: [{ name: "TestScene" }],
      };

      const glb = buildGLB(json, null);

      // Verify we can parse it back
      const parsed = parseGLB(glb);
      expect(parsed.json).toEqual(json);
      expect(parsed.bin).toBeNull();
    });

    it("creates valid GLB with JSON and BIN chunks", () => {
      const json = {
        asset: { version: "2.0" },
        buffers: [{ byteLength: 16 }],
      };
      const bin = new Uint8Array([
        1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
      ]);

      const glb = buildGLB(json, bin);

      const parsed = parseGLB(glb);
      expect(parsed.json).toEqual(json);
      expect(parsed.bin).not.toBeNull();
      // Verify bin data
      for (let i = 0; i < bin.length; i++) {
        expect(parsed.bin![i]).toBe(bin[i]);
      }
    });

    it("pads JSON chunk to 4-byte boundary", () => {
      // Create JSON that doesn't align to 4 bytes naturally
      const json = { a: 1 }; // Very short JSON

      const glb = buildGLB(json, null);
      const view = new DataView(glb);

      const jsonChunkLength = view.getUint32(12, true);
      expect(jsonChunkLength % 4).toBe(0);
    });

    it("pads BIN chunk to 4-byte boundary", () => {
      const json = { asset: { version: "2.0" } };
      // 5 bytes - not aligned to 4
      const bin = new Uint8Array([1, 2, 3, 4, 5]);

      const glb = buildGLB(json, bin);
      const view = new DataView(glb);

      const jsonChunkLength = view.getUint32(12, true);
      const binChunkOffset = 12 + 8 + jsonChunkLength;
      const binChunkLength = view.getUint32(binChunkOffset, true);

      expect(binChunkLength % 4).toBe(0);
      expect(binChunkLength).toBe(8); // 5 bytes padded to 8
    });

    it("round-trips complex JSON structure", () => {
      const json = {
        asset: { version: "2.0", generator: "HyperForge" },
        scene: 0,
        scenes: [{ name: "MainScene", nodes: [0, 1, 2] }],
        nodes: [
          { name: "Node1", mesh: 0 },
          { name: "Node2", translation: [1, 2, 3] },
          { name: "Node3", rotation: [0, 0, 0, 1] },
        ],
        meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
        extensions: {
          VRMC_vrm: { specVersion: "1.0" },
        },
      };

      const glb = buildGLB(json, null);
      const parsed = parseGLB(glb);

      expect(parsed.json).toEqual(json);
    });
  });

  describe("getGLBInfo", () => {
    it("returns version and totalLength without full parse", () => {
      const json = { asset: { version: "2.0" }, largeData: "x".repeat(1000) };
      const glb = createMinimalGLB(json);

      const info = getGLBInfo(glb);

      expect(info.version).toBe(2);
      expect(info.totalLength).toBe(glb.byteLength);
    });

    it("throws for invalid magic number", () => {
      const buffer = new ArrayBuffer(20);
      const view = new DataView(buffer);
      view.setUint32(0, 0xbaadf00d, true);

      expect(() => getGLBInfo(buffer)).toThrow(
        "Invalid GLB: wrong magic number",
      );
    });
  });
});
