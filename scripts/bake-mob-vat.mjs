#!/usr/bin/env node
/**
 * Bake Vertex Animation Textures (VAT) for mob models.
 *
 * VAT encodes per-frame skinned vertex positions into a texture, enabling
 * GPU-driven animation without CPU skeleton updates.
 *
 * Texture Format:
 *   - Width: vertexCount (up to 4096)
 *   - Height: totalFrames across all animations
 *   - Format: RGBA32F (posX, posY, posZ, normalPacked)
 *   - Row layout: [IDLE frames][WALK frames][ATTACK frames][DEATH frames]
 *
 * Output:
 *   - {modelName}.vat.ktx2 - Compressed VAT texture (ASTC/BC7/ETC2)
 *   - {modelName}.vat.json - Metadata (frame counts, vertex count, animation offsets)
 *
 * Usage:
 *   node scripts/bake-mob-vat.mjs --input models/goblin.glb --output assets/vat/
 *   node scripts/bake-mob-vat.mjs --input-dir models/mobs/ --output assets/vat/
 *
 * Options:
 *   --input <file>      Single model to bake
 *   --input-dir <dir>   Directory of models to bake
 *   --output <dir>      Output directory (default: assets/vat)
 *   --fps <n>           Frames per second for sampling (default: 30)
 *   --max-frames <n>    Max frames per animation (default: 30)
 *   --dry-run           Report only, no file output
 */

import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";
import * as THREE from "three";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "fs";
import { basename, dirname, extname, join, resolve } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = resolve(__dirname, "..");
const DEFAULT_OUTPUT_DIR = resolve(ROOT_DIR, "assets", "vat");

// Animation names to bake (in order)
const ANIMATIONS_TO_BAKE = ["idle", "walk", "attack", "death"];
const ANIMATION_ALIASES = {
  idle: ["idle", "stand", "breathing", "default"],
  walk: ["walk", "walking", "run", "running", "move"],
  attack: ["attack", "attack1", "punch", "swing", "hit"],
  death: ["death", "die", "dying", "dead", "fall"],
};

// Parse command line arguments
const args = process.argv.slice(2);
const options = {
  input: getArgValue("--input"),
  inputDir: getArgValue("--input-dir"),
  output: getArgValue("--output") || DEFAULT_OUTPUT_DIR,
  fps: parseNumberArg("--fps", 30),
  maxFrames: parseNumberArg("--max-frames", 30),
  dryRun: args.includes("--dry-run"),
};

const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({
    "meshopt.decoder": MeshoptDecoder,
    "meshopt.encoder": MeshoptEncoder,
  });

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

function log(message, level = "info") {
  const prefix = { info: "[info]", warn: "[warn]", error: "[error]" }[level];
  console.log(`${prefix} ${message}`);
}

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function findModelFiles(dir) {
  if (!existsSync(dir)) return [];
  const results = [];
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findModelFiles(fullPath));
    } else if (entry.isFile()) {
      const ext = extname(entry.name).toLowerCase();
      if (ext === ".glb" || ext === ".gltf" || ext === ".vrm") {
        results.push(fullPath);
      }
    }
  }
  return results;
}

function findAnimation(animations, targetName) {
  const aliases = ANIMATION_ALIASES[targetName] || [targetName];
  for (const animation of animations) {
    const name = (animation.getName() || "").toLowerCase();
    for (const alias of aliases) {
      if (name.includes(alias)) {
        return animation;
      }
    }
  }
  return null;
}

function buildNodeTree(nodes) {
  const nodeInfos = nodes.map((node, index) => {
    const parent = node.getParentNode();
    const translation = node.getTranslation();
    const rotation = node.getRotation();
    const scale = node.getScale();
    return {
      node,
      index,
      name: node.getName() || "",
      parent,
      parentIndex: null,
      baseTranslation: new THREE.Vector3(...translation),
      baseRotation: new THREE.Quaternion(...rotation),
      baseScale: new THREE.Vector3(...scale),
      children: [],
    };
  });

  const indexByNode = new Map();
  nodeInfos.forEach((info, index) => indexByNode.set(info.node, index));

  nodeInfos.forEach((info) => {
    if (!info.parent) return;
    const parentIndex = indexByNode.get(info.parent);
    if (parentIndex !== undefined) {
      info.parentIndex = parentIndex;
      nodeInfos[parentIndex].children.push(info.index);
    }
  });

  return { nodeInfos, indexByNode };
}

function buildSkinData(document, nodeInfos, indexByNode) {
  const root = document.getRoot();
  const nodes = root.listNodes();
  const skinEntries = [];

  for (const node of nodes) {
    const mesh = node.getMesh();
    const skin = node.getSkin();
    if (!mesh || !skin) continue;

    const nodeIndex = indexByNode.get(node);
    if (nodeIndex === undefined) continue;

    const joints = skin.listJoints();
    if (joints.length === 0) continue;

    const jointIndices = [];
    for (const joint of joints) {
      const jointIndex = indexByNode.get(joint);
      if (jointIndex === undefined) break;
      jointIndices.push(jointIndex);
    }
    if (jointIndices.length !== joints.length) continue;

    const inverseBindMatrices = [];
    const ibmAccessor = skin.getInverseBindMatrices();
    if (ibmAccessor) {
      const temp = new Array(16).fill(0);
      for (let i = 0; i < joints.length; i++) {
        ibmAccessor.getElement(i, temp);
        const mat = new THREE.Matrix4();
        mat.fromArray(temp);
        inverseBindMatrices.push(mat);
      }
    } else {
      for (let i = 0; i < joints.length; i++) {
        inverseBindMatrices.push(new THREE.Matrix4());
      }
    }

    const primitives = [];
    for (const primitive of mesh.listPrimitives()) {
      const position = primitive.getAttribute("POSITION");
      const normal = primitive.getAttribute("NORMAL");
      const joints0 = primitive.getAttribute("JOINTS_0");
      const weights0 = primitive.getAttribute("WEIGHTS_0");
      if (!position || !joints0 || !weights0) continue;
      primitives.push({
        position,
        normal,
        joints: joints0,
        weights: weights0,
        count: position.getCount(),
      });
    }

    if (primitives.length === 0) continue;

    skinEntries.push({
      nodeIndex,
      jointIndices,
      inverseBindMatrices,
      primitives,
      jointMatrices: jointIndices.map(() => new THREE.Matrix4()),
    });
  }

  return skinEntries;
}

function getAnimationDuration(animation) {
  let maxTime = 0;
  for (const channel of animation.listChannels()) {
    const sampler = channel.getSampler();
    const input = sampler.getInput();
    if (!input) continue;
    const times = input.getArray();
    if (times.length > 0) {
      maxTime = Math.max(maxTime, times[times.length - 1]);
    }
  }
  return maxTime;
}

function sampleAnimation(animation, nodeInfos, time) {
  const channelMap = new Map();
  for (const channel of animation.listChannels()) {
    const targetNode = channel.getTargetNode();
    if (!targetNode) continue;
    if (!channelMap.has(targetNode)) {
      channelMap.set(targetNode, {});
    }
    channelMap.get(targetNode)[channel.getTargetPath()] = channel;
  }

  const locals = nodeInfos.map((info) => ({
    translation: info.baseTranslation.clone(),
    rotation: info.baseRotation.clone(),
    scale: info.baseScale.clone(),
    matrix: new THREE.Matrix4(),
  }));

  // Sample each node's animation
  for (let i = 0; i < nodeInfos.length; i++) {
    const info = nodeInfos[i];
    const channels = channelMap.get(info.node);
    const local = locals[i];

    if (channels?.translation) {
      sampleChannel(channels.translation, time, local.translation);
    }
    if (channels?.rotation) {
      sampleChannelQuat(channels.rotation, time, local.rotation);
    }
    if (channels?.scale) {
      sampleChannel(channels.scale, time, local.scale);
    }

    local.matrix.compose(local.translation, local.rotation, local.scale);
  }

  // Build world matrices
  const worlds = nodeInfos.map(() => new THREE.Matrix4());
  const stack = nodeInfos
    .filter((info) => info.parentIndex === null)
    .map((info) => info.index);

  while (stack.length > 0) {
    const index = stack.pop();
    const info = nodeInfos[index];
    const localMatrix = locals[index].matrix;
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

  return worlds;
}

function sampleChannel(channel, time, outVec3) {
  const sampler = channel.getSampler();
  const input = sampler.getInput();
  const output = sampler.getOutput();
  if (!input || !output) return;

  const times = input.getArray();
  const values = output.getArray();
  const elementSize = output.getElementSize();

  const { i0, i1, alpha } = findKeyframes(times, time);
  const base0 = i0 * elementSize;
  const base1 = i1 * elementSize;

  outVec3.set(
    values[base0] + (values[base1] - values[base0]) * alpha,
    values[base0 + 1] + (values[base1 + 1] - values[base0 + 1]) * alpha,
    values[base0 + 2] + (values[base1 + 2] - values[base0 + 2]) * alpha,
  );
}

function sampleChannelQuat(channel, time, outQuat) {
  const sampler = channel.getSampler();
  const input = sampler.getInput();
  const output = sampler.getOutput();
  if (!input || !output) return;

  const times = input.getArray();
  const values = output.getArray();
  const elementSize = output.getElementSize();

  const { i0, i1, alpha } = findKeyframes(times, time);
  const base0 = i0 * elementSize;
  const base1 = i1 * elementSize;

  const q0 = new THREE.Quaternion(
    values[base0],
    values[base0 + 1],
    values[base0 + 2],
    values[base0 + 3],
  );
  const q1 = new THREE.Quaternion(
    values[base1],
    values[base1 + 1],
    values[base1 + 2],
    values[base1 + 3],
  );
  outQuat.slerpQuaternions(q0, q1, alpha);
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
    if (times[mid] === time) return { i0: mid, i1: mid, alpha: 0 };
    if (times[mid] < time) low = mid + 1;
    else high = mid - 1;
  }

  const i1 = Math.max(1, low);
  const i0 = i1 - 1;
  const t0 = times[i0];
  const t1 = times[i1];
  const alpha = t1 === t0 ? 0 : (time - t0) / (t1 - t0);
  return { i0, i1, alpha };
}

function computeSkinnedPositions(skinEntries, worlds) {
  const positions = [];
  const normals = [];

  const positionElement = [0, 0, 0];
  const normalElement = [0, 0, 0];
  const jointsElement = [0, 0, 0, 0];
  const weightsElement = [0, 0, 0, 0];
  const tempPos = new THREE.Vector3();
  const tempNorm = new THREE.Vector3();
  const skinnedPos = new THREE.Vector3();
  const skinnedNorm = new THREE.Vector3();

  for (const entry of skinEntries) {
    const meshWorld = worlds[entry.nodeIndex];

    // Compute joint matrices
    for (let j = 0; j < entry.jointIndices.length; j++) {
      const jointIndex = entry.jointIndices[j];
      entry.jointMatrices[j]
        .copy(worlds[jointIndex])
        .multiply(entry.inverseBindMatrices[j]);
    }

    for (const primitive of entry.primitives) {
      for (let i = 0; i < primitive.count; i++) {
        primitive.position.getElement(i, positionElement);
        primitive.joints.getElement(i, jointsElement);
        primitive.weights.getElement(i, weightsElement);

        const hasNormal = primitive.normal !== null;
        if (hasNormal) {
          primitive.normal.getElement(i, normalElement);
        }

        const weightSum =
          weightsElement[0] +
          weightsElement[1] +
          weightsElement[2] +
          weightsElement[3];
        if (weightSum <= 0) {
          positions.push(positionElement[0], positionElement[1], positionElement[2]);
          normals.push(hasNormal ? normalElement[0] : 0, hasNormal ? normalElement[1] : 1, hasNormal ? normalElement[2] : 0);
          continue;
        }

        const invSum = 1 / weightSum;
        skinnedPos.set(0, 0, 0);
        skinnedNorm.set(0, 0, 0);

        for (let k = 0; k < 4; k++) {
          const weight = weightsElement[k] * invSum;
          if (weight <= 0) continue;
          const jointIdx = Math.round(jointsElement[k]);
          if (jointIdx < 0 || jointIdx >= entry.jointMatrices.length) continue;

          tempPos
            .set(positionElement[0], positionElement[1], positionElement[2])
            .applyMatrix4(entry.jointMatrices[jointIdx]);
          skinnedPos.addScaledVector(tempPos, weight);

          if (hasNormal) {
            tempNorm
              .set(normalElement[0], normalElement[1], normalElement[2])
              .transformDirection(entry.jointMatrices[jointIdx]);
            skinnedNorm.addScaledVector(tempNorm, weight);
          }
        }

        // Apply mesh world transform
        skinnedPos.applyMatrix4(meshWorld);
        positions.push(skinnedPos.x, skinnedPos.y, skinnedPos.z);

        if (hasNormal) {
          skinnedNorm.normalize();
          normals.push(skinnedNorm.x, skinnedNorm.y, skinnedNorm.z);
        } else {
          normals.push(0, 1, 0);
        }
      }
    }
  }

  return { positions, normals };
}

function packNormal(nx, ny, nz) {
  // Pack normal into a single float using spherical coordinates
  // This gives us good precision for normals
  const phi = Math.atan2(ny, nx);
  const theta = Math.acos(Math.max(-1, Math.min(1, nz)));
  // Pack into 0-65535 range (16 bits each)
  const phiPacked = Math.floor(((phi + Math.PI) / (2 * Math.PI)) * 65535);
  const thetaPacked = Math.floor((theta / Math.PI) * 65535);
  // Combine into single float (lose some precision but good enough)
  return phiPacked + thetaPacked * 65536;
}

async function bakeModel(modelPath) {
  log(`Processing: ${modelPath}`);

  let document;
  try {
    document = await io.read(modelPath);
  } catch (error) {
    log(`Failed to load: ${error.message}`, "error");
    return null;
  }

  const root = document.getRoot();
  const nodes = root.listNodes();
  const animations = root.listAnimations();

  if (animations.length === 0) {
    log("No animations found", "warn");
    return null;
  }

  const { nodeInfos, indexByNode } = buildNodeTree(nodes);
  const skinEntries = buildSkinData(document, nodeInfos, indexByNode);

  if (skinEntries.length === 0) {
    log("No skinned meshes found", "warn");
    return null;
  }

  // Count total vertices
  let totalVertices = 0;
  for (const entry of skinEntries) {
    for (const primitive of entry.primitives) {
      totalVertices += primitive.count;
    }
  }

  if (totalVertices === 0) {
    log("No vertices found", "warn");
    return null;
  }

  if (totalVertices > 4096) {
    log(`Warning: ${totalVertices} vertices exceeds 4096 limit`, "warn");
  }

  log(`  Vertices: ${totalVertices}`);
  log(`  Animations: ${animations.length}`);

  // Find and bake each animation
  const animationData = [];
  let totalFrames = 0;

  for (const animName of ANIMATIONS_TO_BAKE) {
    const animation = findAnimation(animations, animName);
    if (!animation) {
      log(`  Animation "${animName}" not found, using frame 0 fallback`, "warn");
      animationData.push({
        name: animName,
        frames: 1,
        startFrame: totalFrames,
        duration: 0,
        loop: animName === "idle" || animName === "walk",
      });
      totalFrames += 1;
      continue;
    }

    const duration = getAnimationDuration(animation);
    const frameCount = Math.min(
      options.maxFrames,
      Math.max(1, Math.ceil(duration * options.fps)),
    );

    log(`  Animation "${animName}": ${frameCount} frames, ${duration.toFixed(2)}s`);

    animationData.push({
      name: animName,
      frames: frameCount,
      startFrame: totalFrames,
      duration,
      loop: animName === "idle" || animName === "walk",
    });
    totalFrames += frameCount;
  }

  if (totalFrames === 0) {
    log("No frames to bake", "warn");
    return null;
  }

  log(`  Total frames: ${totalFrames}`);

  // Create VAT texture data (RGBA32F: posX, posY, posZ, normalPacked)
  const textureWidth = totalVertices;
  const textureHeight = totalFrames;
  const textureData = new Float32Array(textureWidth * textureHeight * 4);

  // Bake each frame
  let frameIndex = 0;
  for (const animInfo of animationData) {
    const animation = findAnimation(animations, animInfo.name);

    for (let f = 0; f < animInfo.frames; f++) {
      const time = animInfo.duration > 0
        ? (f / Math.max(1, animInfo.frames - 1)) * animInfo.duration
        : 0;

      // Sample animation at this time
      const worlds = animation
        ? sampleAnimation(animation, nodeInfos, time)
        : nodeInfos.map((info) => {
            const mat = new THREE.Matrix4();
            mat.compose(info.baseTranslation, info.baseRotation, info.baseScale);
            return mat;
          });

      // Compute skinned positions
      const { positions, normals } = computeSkinnedPositions(skinEntries, worlds);

      // Write to texture
      const rowOffset = frameIndex * textureWidth * 4;
      for (let v = 0; v < totalVertices; v++) {
        const pixelOffset = rowOffset + v * 4;
        const vertOffset = v * 3;
        textureData[pixelOffset + 0] = positions[vertOffset + 0];
        textureData[pixelOffset + 1] = positions[vertOffset + 1];
        textureData[pixelOffset + 2] = positions[vertOffset + 2];
        textureData[pixelOffset + 3] = packNormal(
          normals[vertOffset + 0],
          normals[vertOffset + 1],
          normals[vertOffset + 2],
        );
      }

      frameIndex++;
    }
  }

  const modelName = basename(modelPath, extname(modelPath));

  return {
    modelName,
    vertexCount: totalVertices,
    totalFrames,
    textureWidth,
    textureHeight,
    textureData,
    animations: animationData,
  };
}

async function writeVATOutput(vatData) {
  ensureDir(options.output);

  const { modelName, textureData, textureWidth, textureHeight, animations, vertexCount, totalFrames } = vatData;

  // Write metadata JSON
  const metadataPath = join(options.output, `${modelName}.vat.json`);
  const metadata = {
    version: 1,
    modelName,
    vertexCount,
    totalFrames,
    textureWidth,
    textureHeight,
    format: "RGBA32F",
    animations: animations.map((a) => ({
      name: a.name,
      frames: a.frames,
      startFrame: a.startFrame,
      duration: a.duration,
      loop: a.loop,
    })),
  };
  writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
  log(`  Wrote metadata: ${metadataPath}`);

  // Write raw texture data (for now, as .bin - KTX2 compression requires additional tooling)
  const texturePath = join(options.output, `${modelName}.vat.bin`);
  const buffer = Buffer.from(textureData.buffer);
  writeFileSync(texturePath, buffer);
  log(`  Wrote texture: ${texturePath} (${(buffer.length / 1024 / 1024).toFixed(2)} MB)`);

  log(`  To compress to KTX2, run: toktx --encode astc ${modelName}.vat.ktx2 ${modelName}.vat.bin`);
}

async function main() {
  log("VAT Baking Tool");
  log(`FPS: ${options.fps}, Max frames: ${options.maxFrames}`);
  log(`Output: ${options.output}`);
  if (options.dryRun) log("Dry run mode - no files will be written");

  const files = [];

  if (options.input) {
    if (!existsSync(options.input)) {
      log(`Input file not found: ${options.input}`, "error");
      process.exit(1);
    }
    files.push(options.input);
  } else if (options.inputDir) {
    if (!existsSync(options.inputDir)) {
      log(`Input directory not found: ${options.inputDir}`, "error");
      process.exit(1);
    }
    files.push(...findModelFiles(options.inputDir));
  } else {
    log("No input specified. Use --input <file> or --input-dir <dir>", "error");
    process.exit(1);
  }

  if (files.length === 0) {
    log("No model files found", "warn");
    process.exit(0);
  }

  log(`Found ${files.length} model(s) to process`);

  let processed = 0;
  let errors = 0;

  for (const file of files) {
    try {
      const vatData = await bakeModel(file);
      if (vatData) {
        if (!options.dryRun) {
          await writeVATOutput(vatData);
        }
        processed++;
      }
    } catch (error) {
      log(`Error processing ${file}: ${error.message}`, "error");
      errors++;
    }
  }

  log(`Done. Processed: ${processed}, Errors: ${errors}`);
}

main().catch((error) => {
  log(`Fatal error: ${error.message}`, "error");
  console.error(error);
  process.exit(1);
});
