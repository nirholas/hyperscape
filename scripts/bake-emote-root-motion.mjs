#!/usr/bin/env node
/**
 * Bake grounded hip translation into Mixamo emote animations.
 *
 * - Reviews root/hips motion in GLB emotes
 * - Removes horizontal root motion (XZ)
 * - Bakes per-frame hip Y so at least one foot touches ground
 *
 * Usage:
 *   node scripts/bake-emote-root-motion.mjs [options]
 *
 * Options:
 *   --dry-run           Report only, no file changes
 *   --in-place          Overwrite original files
 *   --input <dir>       Input directory (default: assets/emotes)
 *   --output <dir>      Output directory (default: assets/emotes-baked)
 *   --sample-rate <n>   Sample rate (default: 60)
 *   --skip <list>       Comma-separated filename tokens to skip
 *   --no-skip           Disable default skip tokens
 *   --tolerance <n>     Ground tolerance in meters (default: 0.002)
 */

import { Accessor, NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";
import * as THREE from "three";
import { existsSync, mkdirSync, readdirSync } from "fs";
import { basename, dirname, extname, join, relative, resolve } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = resolve(__dirname, "..");
const DEFAULT_INPUT_DIR = resolve(ROOT_DIR, "assets", "emotes");
const DEFAULT_OUTPUT_DIR = resolve(ROOT_DIR, "assets", "emotes-baked");

const DEFAULT_SKIP_TOKENS = ["jump", "flip", "fall", "float"];

const args = process.argv.slice(2);
const options = {
  dryRun: args.includes("--dry-run"),
  inPlace: args.includes("--in-place"),
  inputDir: getArgValue("--input") || DEFAULT_INPUT_DIR,
  outputDir: getArgValue("--output") || DEFAULT_OUTPUT_DIR,
  sampleRate: parseNumberArg("--sample-rate", 60),
  tolerance: parseNumberArg("--tolerance", 0.002),
  skipTokens: parseSkipTokens(),
};

if (options.inPlace) {
  options.outputDir = options.inputDir;
}

const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({
    "meshopt.decoder": MeshoptDecoder,
    "meshopt.encoder": MeshoptEncoder,
  });

const stats = {
  processed: 0,
  baked: 0,
  skipped: 0,
  errors: 0,
};

function getArgValue(flag) {
  const index = args.indexOf(flag);
  if (index === -1) return null;
  const value = args[index + 1];
  return value && !value.startsWith("--") ? value : null;
}

function parseNumberArg(flag, fallback) {
  const raw = getArgValue(flag);
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function parseSkipTokens() {
  if (args.includes("--no-skip")) return [];
  const raw = getArgValue("--skip");
  if (!raw) return DEFAULT_SKIP_TOKENS;
  return raw
    .split(",")
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length > 0);
}

function log(message, level = "info") {
  const prefix = { info: "[info]", warn: "[warn]", error: "[error]" }[level];
  console.log(`${prefix} ${message}`);
}

function ensureDir(filePath) {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function findFiles(dir, results = []) {
  if (!existsSync(dir)) return results;
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      findFiles(fullPath, results);
    } else if (entry.isFile()) {
      const ext = extname(entry.name).toLowerCase();
      if (ext === ".glb" || ext === ".gltf") {
        results.push(fullPath);
      }
    }
  }
  return results;
}

function shouldSkip(filePath) {
  const name = basename(filePath).toLowerCase();
  return options.skipTokens.some((token) => name.includes(token));
}

function buildNodeInfos(nodes) {
  const nodeInfos = nodes.map((node) => {
    const parent = node.getParentNode();
    const translation = node.getTranslation();
    const rotation = node.getRotation();
    const scale = node.getScale();
    return {
      node,
      name: node.getName() || "",
      parent,
      parentIndex: null,
      baseTranslation: new THREE.Vector3(
        translation[0],
        translation[1],
        translation[2],
      ),
      baseRotation: new THREE.Quaternion(
        rotation[0],
        rotation[1],
        rotation[2],
        rotation[3],
      ),
      baseScale: new THREE.Vector3(scale[0], scale[1], scale[2]),
      children: [],
    };
  });

  const indexByNode = new Map();
  nodeInfos.forEach((info, index) => indexByNode.set(info.node, index));

  nodeInfos.forEach((info) => {
    if (!info.parent) return;
    const parentIndex = indexByNode.get(info.parent);
    const childIndex = indexByNode.get(info.node);
    if (parentIndex !== undefined && childIndex !== undefined) {
      info.parentIndex = parentIndex;
      nodeInfos[parentIndex].children.push(childIndex);
    }
  });

  return { nodeInfos, indexByNode };
}

function findNodeIndex(nodeInfos, candidates) {
  const lowerMap = new Map();
  nodeInfos.forEach((info, index) => {
    const name = info.name.toLowerCase();
    if (name) lowerMap.set(name, index);
  });

  for (const candidate of candidates) {
    const direct = lowerMap.get(candidate);
    if (direct !== undefined) return direct;
  }

  for (const [name, index] of lowerMap.entries()) {
    for (const candidate of candidates) {
      if (name.endsWith(candidate) || name.includes(candidate)) {
        return index;
      }
    }
  }

  return null;
}

function getChannelData(channel) {
  const sampler = channel.getSampler();
  const input = sampler.getInput();
  const output = sampler.getOutput();
  if (!input || !output) return null;
  return {
    inputArray: input.getArray(),
    outputArray: output.getArray(),
    elementSize: output.getElementSize(),
    interpolation: sampler.getInterpolation() || "LINEAR",
  };
}

function getValueOffset(keyIndex, elementSize, interpolation) {
  const stride =
    interpolation === "CUBICSPLINE" ? elementSize * 3 : elementSize;
  const valueOffset = interpolation === "CUBICSPLINE" ? elementSize : 0;
  return keyIndex * stride + valueOffset;
}

function findKeyframes(times, time) {
  const count = times.length;
  if (count === 0) return { i0: 0, i1: 0, alpha: 0 };
  if (time <= times[0]) return { i0: 0, i1: 0, alpha: 0 };
  if (time >= times[count - 1]) {
    return { i0: count - 1, i1: count - 1, alpha: 0 };
  }

  let low = 0;
  let high = count - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const midTime = times[mid];
    if (midTime === time) {
      return { i0: mid, i1: mid, alpha: 0 };
    }
    if (midTime < time) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  const i1 = Math.max(1, low);
  const i0 = i1 - 1;
  const t0 = times[i0];
  const t1 = times[i1];
  const alpha = t1 === t0 ? 0 : (time - t0) / (t1 - t0);
  return { i0, i1, alpha };
}

function sampleVec3(channelData, time, out) {
  const times = channelData.inputArray;
  const values = channelData.outputArray;
  const { i0, i1, alpha } = findKeyframes(times, time);
  const elementSize = channelData.elementSize;
  const interp = channelData.interpolation;
  const base0 = getValueOffset(i0, elementSize, interp);
  const base1 = getValueOffset(i1, elementSize, interp);

  const x0 = values[base0];
  const y0 = values[base0 + 1];
  const z0 = values[base0 + 2];
  const x1 = values[base1];
  const y1 = values[base1 + 1];
  const z1 = values[base1 + 2];

  out.set(
    x0 + (x1 - x0) * alpha,
    y0 + (y1 - y0) * alpha,
    z0 + (z1 - z0) * alpha,
  );
}

const tempQuat0 = new THREE.Quaternion();
const tempQuat1 = new THREE.Quaternion();

function sampleQuat(channelData, time, out) {
  const times = channelData.inputArray;
  const values = channelData.outputArray;
  const { i0, i1, alpha } = findKeyframes(times, time);
  const elementSize = channelData.elementSize;
  const interp = channelData.interpolation;
  const base0 = getValueOffset(i0, elementSize, interp);
  const base1 = getValueOffset(i1, elementSize, interp);

  tempQuat0.set(
    values[base0],
    values[base0 + 1],
    values[base0 + 2],
    values[base0 + 3],
  );
  tempQuat1.set(
    values[base1],
    values[base1 + 1],
    values[base1 + 2],
    values[base1 + 3],
  );
  out.slerpQuaternions(tempQuat0, tempQuat1, alpha);
}

function computeDuration(animation) {
  let maxTime = 0;
  for (const channel of animation.listChannels()) {
    const data = getChannelData(channel);
    if (!data || data.inputArray.length === 0) continue;
    const last = data.inputArray[data.inputArray.length - 1];
    if (last > maxTime) maxTime = last;
  }
  return maxTime;
}

function computeTranslationRange(channelData) {
  const values = channelData.outputArray;
  const elementSize = channelData.elementSize;
  const interp = channelData.interpolation;
  const count = channelData.inputArray.length;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < count; i++) {
    const base = getValueOffset(i, elementSize, interp);
    for (let c = 0; c < 3; c++) {
      const v = values[base + c];
      if (v < min[c]) min[c] = v;
      if (v > max[c]) max[c] = v;
    }
  }
  return { min, max };
}

function createSampleTimes(duration, sampleRate) {
  if (duration <= 0) return new Float32Array([0]);
  const step = 1 / sampleRate;
  const count = Math.floor(duration / step) + 1;
  const times = new Float32Array(count + 1);
  for (let i = 0; i < count; i++) {
    times[i] = i * step;
  }
  times[count] = duration;
  return times;
}

function buildChannelMap(animation) {
  const channelMap = new Map();
  for (const channel of animation.listChannels()) {
    const targetNode = channel.getTargetNode();
    if (!targetNode) continue;
    const targetPath = channel.getTargetPath();
    if (!channelMap.has(targetNode)) {
      channelMap.set(targetNode, {});
    }
    const entry = channelMap.get(targetNode);
    entry[targetPath] = channel;
  }
  return channelMap;
}

function buildLocalTransforms(nodeInfos, channelMap, time, locals) {
  for (let i = 0; i < nodeInfos.length; i++) {
    const info = nodeInfos[i];
    const channels = channelMap.get(info.node);
    const translation = locals.translations[i];
    const rotation = locals.rotations[i];
    const scale = locals.scales[i];

    translation.copy(info.baseTranslation);
    rotation.copy(info.baseRotation);
    scale.copy(info.baseScale);

    if (channels?.translation) {
      const data = getChannelData(channels.translation);
      if (data) sampleVec3(data, time, translation);
    }
    if (channels?.rotation) {
      const data = getChannelData(channels.rotation);
      if (data) sampleQuat(data, time, rotation);
    }
    if (channels?.scale) {
      const data = getChannelData(channels.scale);
      if (data) sampleVec3(data, time, scale);
    }

    locals.matrices[i].compose(translation, rotation, scale);
  }
}

function buildWorldMatrices(nodeInfos, locals, worlds) {
  const stack = [];
  for (let i = 0; i < nodeInfos.length; i++) {
    const info = nodeInfos[i];
    if (!info.parent) stack.push(i);
  }

  while (stack.length > 0) {
    const index = stack.pop();
    const info = nodeInfos[index];
    const localMatrix = locals.matrices[index];
    const worldMatrix = worlds[index];

    if (info.parentIndex !== null) {
      worldMatrix.multiplyMatrices(worlds[info.parentIndex], localMatrix);
    } else {
      worldMatrix.copy(localMatrix);
    }

    for (const childIndex of info.children) {
      stack.push(childIndex);
    }
  }
}

function createLocalBuffers(nodeCount) {
  const translations = [];
  const rotations = [];
  const scales = [];
  const matrices = [];
  const worlds = [];
  for (let i = 0; i < nodeCount; i++) {
    translations.push(new THREE.Vector3());
    rotations.push(new THREE.Quaternion());
    scales.push(new THREE.Vector3(1, 1, 1));
    matrices.push(new THREE.Matrix4());
    worlds.push(new THREE.Matrix4());
  }
  return { translations, rotations, scales, matrices, worlds };
}

function removeTranslationChannels(animation, hipsNodeNameLower) {
  const channels = animation.listChannels();
  for (const channel of channels) {
    const targetNode = channel.getTargetNode();
    if (!targetNode) continue;
    if (channel.getTargetPath() !== "translation") continue;
    const name = (targetNode.getName() || "").toLowerCase();
    const isRoot = name === "root" || name.endsWith(":root");
    if (isRoot || name === hipsNodeNameLower) {
      animation.removeChannel(channel);
    }
  }
}

function addHipsTranslationChannel(document, animation, hipsNode, times, values) {
  const sampler = document.createSampler();
  const input = document
    .createAccessor()
    .setType(Accessor.Type.SCALAR)
    .setArray(times);
  const output = document
    .createAccessor()
    .setType(Accessor.Type.VEC3)
    .setArray(values);
  sampler.setInput(input).setOutput(output).setInterpolation("LINEAR");

  const channel = document
    .createChannel()
    .setSampler(sampler)
    .setTargetNode(hipsNode)
    .setTargetPath("translation");
  animation.addChannel(channel);
}

function processAnimation({
  document,
  animation,
  nodeInfos,
  channelMap,
  hipsIndex,
  footIndices,
  sampleRate,
  tolerance,
}) {
  const duration = computeDuration(animation);
  const times = createSampleTimes(duration, sampleRate);
  const locals = createLocalBuffers(nodeInfos.length);
  const worlds = locals.worlds;

  let minFootY = Infinity;
  let maxFootY = -Infinity;
  let framesAbove = 0;
  let framesBelow = 0;

  const bakedValues = new Float32Array(times.length * 3);

  const tempPos = new THREE.Vector3();

  for (let i = 0; i < times.length; i++) {
    const t = times[i];
    buildLocalTransforms(nodeInfos, channelMap, t, locals);
    buildWorldMatrices(nodeInfos, locals, worlds);

    let frameMinFootY = Infinity;
    for (const footIndex of footIndices) {
      tempPos.setFromMatrixPosition(worlds[footIndex]);
      if (tempPos.y < frameMinFootY) frameMinFootY = tempPos.y;
    }

    minFootY = Math.min(minFootY, frameMinFootY);
    maxFootY = Math.max(maxFootY, frameMinFootY);
    if (frameMinFootY > tolerance) framesAbove += 1;
    if (frameMinFootY < -tolerance) framesBelow += 1;

    const hipsTranslation = locals.translations[hipsIndex];
    const deltaY = -frameMinFootY;
    const base = i * 3;
    bakedValues[base] = 0;
    bakedValues[base + 1] = hipsTranslation.y + deltaY;
    bakedValues[base + 2] = 0;
  }

  return {
    duration,
    times,
    bakedValues,
    minFootY,
    maxFootY,
    framesAbove,
    framesBelow,
  };
}

function formatNumber(value) {
  return Number.isFinite(value) ? value.toFixed(4) : "n/a";
}

function summarizeRange(range) {
  if (!range) return "n/a";
  return `x[${formatNumber(range.min[0])}, ${formatNumber(range.max[0])}] ` +
    `y[${formatNumber(range.min[1])}, ${formatNumber(range.max[1])}] ` +
    `z[${formatNumber(range.min[2])}, ${formatNumber(range.max[2])}]`;
}

async function processFile(filePath) {
  if (shouldSkip(filePath)) {
    stats.skipped += 1;
    log(`skip: ${relative(options.inputDir, filePath)} (skip list)`, "warn");
    return;
  }

  let document;
  try {
    document = await io.read(filePath);
  } catch (error) {
    stats.errors += 1;
    log(`failed to read: ${filePath} (${error.message})`, "error");
    return;
  }

  const root = document.getRoot();
  const animations = root.listAnimations();
  if (animations.length === 0) {
    stats.skipped += 1;
    log(`skip: ${relative(options.inputDir, filePath)} (no animations)`, "warn");
    return;
  }

  const nodes = root.listNodes();
  const { nodeInfos } = buildNodeInfos(nodes);

  const hipsIndex = findNodeIndex(nodeInfos, [
    "mixamorighips",
    "hips",
    "mixamorig:hips",
    "mixamorighips",
  ]);
  const leftFootIndex = findNodeIndex(nodeInfos, [
    "mixamorigleftfoot",
    "leftfoot",
    "lefttoe",
    "mixamoriglefttoebase",
    "lefttoebase",
  ]);
  const rightFootIndex = findNodeIndex(nodeInfos, [
    "mixamorigrightfoot",
    "rightfoot",
    "righttoe",
    "mixamorigrighttoebase",
    "righttoebase",
  ]);

  if (
    hipsIndex === null ||
    leftFootIndex === null ||
    rightFootIndex === null
  ) {
    stats.skipped += 1;
    log(
      `skip: ${relative(options.inputDir, filePath)} (missing hips/feet)`,
      "warn",
    );
    return;
  }

  const footIndices = [leftFootIndex, rightFootIndex];
  const hipsNode = nodeInfos[hipsIndex].node;
  const hipsNodeNameLower = nodeInfos[hipsIndex].name.toLowerCase();

  let fileBaked = false;

  log(`review: ${relative(options.inputDir, filePath)}`);

  for (const animation of animations) {
    const channelMap = buildChannelMap(animation);
    const hipsChannel = channelMap.get(hipsNode)?.translation || null;
    const rootChannel = Array.from(channelMap.entries()).find(([node, entry]) => {
      const name = (node.getName() || "").toLowerCase();
      const isRoot = name === "root" || name.endsWith(":root");
      return isRoot && entry.translation;
    });

    const hipsData = hipsChannel ? getChannelData(hipsChannel) : null;
    const hipsRange = hipsData ? computeTranslationRange(hipsData) : null;
    const rootData = rootChannel ? getChannelData(rootChannel[1].translation) : null;
    const rootRange = rootData ? computeTranslationRange(rootData) : null;

    const result = processAnimation({
      document,
      animation,
      nodeInfos,
      channelMap,
      hipsIndex,
      footIndices,
      sampleRate: options.sampleRate,
      tolerance: options.tolerance,
    });

    log(
      `  anim "${animation.getName() || "clip"}": duration ${formatNumber(
        result.duration,
      )}s, footY min ${formatNumber(result.minFootY)} max ${formatNumber(
        result.maxFootY,
      )}, above ${result.framesAbove}, below ${result.framesBelow}`,
    );
    log(`  hips range: ${summarizeRange(hipsRange)}`);
    log(`  root range: ${summarizeRange(rootRange)}`);

    if (!options.dryRun) {
      removeTranslationChannels(animation, hipsNodeNameLower);
      addHipsTranslationChannel(
        document,
        animation,
        hipsNode,
        result.times,
        result.bakedValues,
      );
      fileBaked = true;
    }
  }

  if (!options.dryRun && fileBaked) {
    const rel = relative(options.inputDir, filePath);
    const outputPath = options.inPlace
      ? filePath
      : join(options.outputDir, rel);
    ensureDir(outputPath);
    await io.write(outputPath, document);
    stats.baked += 1;
    log(`  wrote: ${outputPath}`);
  }

  stats.processed += 1;
}

async function main() {
  log(`input: ${options.inputDir}`);
  log(`output: ${options.outputDir}`);
  log(`sample-rate: ${options.sampleRate} fps`);
  log(`tolerance: ${options.tolerance}m`);
  if (options.dryRun) log("dry-run enabled");
  if (options.skipTokens.length > 0) {
    log(`skip: ${options.skipTokens.join(", ")}`);
  }

  if (!existsSync(options.inputDir)) {
    log(`input directory not found: ${options.inputDir}`, "error");
    process.exit(1);
  }

  const files = findFiles(options.inputDir);
  if (files.length === 0) {
    log("no GLB files found", "warn");
    return;
  }

  for (const filePath of files) {
    await processFile(filePath);
  }

  log(
    `done. processed ${stats.processed}, baked ${stats.baked}, skipped ${stats.skipped}, errors ${stats.errors}`,
  );
}

main().catch((error) => {
  log(`fatal: ${error.message}`, "error");
  process.exit(1);
});
