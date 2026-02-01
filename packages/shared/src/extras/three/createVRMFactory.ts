/**
 * createVRMFactory.ts - VRM Character Avatar Factory
 *
 * Creates instances of VRM character models with animations, bone access, and performance optimization.
 * VRM is a standard format for 3D humanoid avatars used in VR/AR and games.
 *
 * **VRM Features:**
 * - Standardized humanoid skeleton (hips, spine, head, limbs)
 * - Expression/blend shapes (happy, sad, blink, etc.)
 * - First-person view setup (hide head in FP mode)
 * - Spring bone physics (hair, clothes)
 * - Metadata (author, usage rights, etc.)
 *
 * **Factory Pattern:**
 * - One factory per VRM model (shared across multiple instances)
 * - create() method spawns new instances
 * - Instances share skeleton structure but have independent poses
 * - Reduces memory and processing for multiple copies
 *
 * **Performance Optimizations:**
 * - Distance-based update rate (far avatars update less frequently)
 * - Detached bind mode for skinned meshes
 * - Manual matrix updates only when needed
 * - Shared geometry across instances via SkeletonUtils.clone
 * - BVH raycasting acceleration
 *
 * **Instance Features:**
 * - setEmote(url): Play animation
 * - move(matrix): Update position/rotation
 * - getBoneTransform(boneName): Get bone matrix
 * - setFirstPerson(bool): Toggle first-person visibility
 * - height, headToHeight: Avatar dimensions
 *
 * **CSM Shadow Integration:**
 * - Calls setupMaterial() on all materials for shadow support
 * - Sets shadowSide to BackSide to prevent shadow acne
 *
 * **Referenced by:** Avatar nodes, PlayerLocal, PlayerRemote
 */

import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";

import type { GLBData } from "../../types";
import type { VRMHooks } from "../../types/systems/physics";
import type { VRMHumanBoneName } from "@pixiv/three-vrm";

import { getTextureBytesFromMaterial } from "./getTextureBytesFromMaterial";
import { getTrianglesFromGeometry } from "./getTrianglesFromGeometry";
import THREE, { MeshStandardNodeMaterial } from "./three";
import { MeshBasicNodeMaterial } from "three/webgpu";

const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();
const _boneWorldPos = new THREE.Vector3();
const _scenePos = new THREE.Vector3();

// Pre-allocated matrices for VRM instance move() to avoid per-frame allocations
// These are used by the create() closure for each instance
const _rotationMatrix = new THREE.Matrix4();
const _scaleMatrix = new THREE.Matrix4();
const _tempMatrix1 = new THREE.Matrix4();
const _tempMatrix2 = new THREE.Matrix4();

// VRM Factory Animation Update Architecture:
// All animation throttling is handled externally by AnimationLOD at the entity level.
// This ensures consistent throttling behavior across all entity types (PlayerLocal,
// PlayerRemote, MobEntity, NPCEntity) and avoids conflicting rate limiting.
//
// The VRM factory's update() function passes delta directly to the AnimationMixer
// without any internal accumulation or rate limiting.

const material = new MeshBasicNodeMaterial();

/**
 * Create VRM Avatar Factory
 *
 * Prepares a VRM model for instancing with animations and optimizations.
 *
 * @param glb - Loaded VRM GLB data
 * @param setupMaterial - Optional material setup function (for CSM shadows)
 * @returns Factory object with create() method and stats tracking
 */
export function createVRMFactory(
  glb: GLBData,
  setupMaterial?: (material: THREE.Material) => void,
) {
  // we'll update matrix ourselves
  glb.scene.matrixAutoUpdate = false;
  glb.scene.matrixWorldAutoUpdate = false;
  // remove expressions from scene
  const expressions = glb.scene.children.filter(n => n.type === 'VRMExpression') // prettier-ignore
  for (const node of expressions) node.removeFromParent();
  // KEEP VRMHumanoidRig - we need normalized bones for A-pose support (Asset Forge approach)
  // const vrmHumanoidRigs = glb.scene.children.filter(n => n.name === 'VRMHumanoidRig') // prettier-ignore
  // for (const node of vrmHumanoidRigs) node.removeFromParent()
  // remove secondary
  const secondaries = glb.scene.children.filter(n => n.name === 'secondary') // prettier-ignore
  for (const node of secondaries) node.removeFromParent();
  // enable shadows and convert MToon materials to MeshStandardMaterial for proper lighting
  glb.scene.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.castShadow = true;
      obj.receiveShadow = true;

      // Convert materials to MeshStandardNodeMaterial for WebGPU-native TSL support
      const convertMaterial = (
        mat: THREE.Material,
      ): MeshStandardNodeMaterial => {
        // Extract textures and colors from original material
        const originalMat = mat as THREE.Material & {
          map?: THREE.Texture | null;
          normalMap?: THREE.Texture | null;
          emissiveMap?: THREE.Texture | null;
          color?: THREE.Color;
          emissive?: THREE.Color;
          emissiveIntensity?: number;
          opacity?: number;
          transparent?: boolean;
          alphaTest?: number;
          side?: THREE.Side;
          // MToon specific properties
          shadeMultiplyTexture?: THREE.Texture | null;
          matcapTexture?: THREE.Texture | null;
        };

        // Use base color for emissive so avatars pop at night (subtle self-illumination)
        // If original has emissive, use it; otherwise derive from diffuse color
        const baseColor =
          originalMat.color?.clone() || new THREE.Color(0xffffff);
        const emissiveColor =
          originalMat.emissive?.clone() ||
          baseColor.clone().multiplyScalar(0.15);

        // NOTE: Only include texture properties if they actually exist
        // Passing undefined explicitly triggers THREE.js warnings
        // Setting null causes WebGPU texture cache corruption (WeakMap key error)
        const materialParams: THREE.MeshStandardMaterialParameters = {
          color: baseColor,
          emissive: emissiveColor,
          emissiveIntensity: 0.3, // Subtle glow - matches PlayerEntity placeholder
          opacity: originalMat.opacity ?? 1,
          transparent: originalMat.transparent ?? false,
          alphaTest: originalMat.alphaTest ?? 0,
          side: originalMat.side ?? THREE.FrontSide,
          roughness: 1.0,
          metalness: 0.0,
          envMapIntensity: 1.0, // Respond to environment map
        };

        // Only add texture properties if they exist (avoids THREE.js warnings)
        if (originalMat.map) materialParams.map = originalMat.map;
        if (originalMat.normalMap)
          materialParams.normalMap = originalMat.normalMap;
        if (originalMat.emissiveMap)
          materialParams.emissiveMap = originalMat.emissiveMap;

        const newMat = new MeshStandardNodeMaterial(materialParams);

        // Copy name for debugging
        newMat.name = originalMat.name || "VRM_Standard";

        // Dispose old material
        originalMat.dispose();

        return newMat;
      };

      if (Array.isArray(obj.material)) {
        obj.material = obj.material.map(convertMaterial);
      } else {
        obj.material = convertMaterial(obj.material);
      }
    }
  });
  // MMO APPROACH: Use cloning with raw bones for memory efficiency
  const humanoid = glb.userData?.vrm?.humanoid;
  const bones = humanoid?._rawHumanBones?.humanBones || {};
  const normBones = humanoid?._normalizedHumanBones?.humanBones || {};

  // Calculate root to hips offset (needed for animation retargeting)
  const hipsPosition = v1.setFromMatrixPosition(
    bones.hips?.node?.matrixWorld || new THREE.Matrix4(),
  );
  const rootPosition = v2.set(0, 0, 0);
  const rootToHips = hipsPosition.y - rootPosition.y;

  // Get VRM version
  const vrmData = glb.userData?.vrm;
  const version = vrmData?.meta?.metaVersion;
  // VRM 1.0+ check: version string starts with "1" or higher
  const isVRM1OrHigher =
    version !== "0" &&
    (!version || (typeof version === "string" && !version.startsWith("0.")));

  // Setup skinned meshes with NORMAL bind mode (for normalized bone compatibility)
  // DetachedBindMode is incompatible with normalized bones in scene graph
  const skinnedMeshes: THREE.SkinnedMesh[] = [];
  glb.scene.traverse((node) => {
    if (node instanceof THREE.SkinnedMesh) {
      const skinnedMesh = node;
      // Use default bind mode (NormalBindMode) - compatible with normalized bones
      // DetachedBindMode requires bones to be detached, but we keep them in scene for vrm.humanoid.update()
      skinnedMeshes.push(skinnedMesh);
    }
    if (node instanceof THREE.Mesh) {
      const mesh = node;
      // bounds tree
      mesh.geometry.computeBoundsTree();
      // fix csm shadow banding
      if (Array.isArray(mesh.material)) {
        mesh.material.forEach((mat) => {
          (mat as THREE.Material & { shadowSide: THREE.Side }).shadowSide =
            THREE.BackSide;
        });
      } else {
        (
          mesh.material as THREE.Material & { shadowSide: THREE.Side }
        ).shadowSide = THREE.BackSide;
      }
      // csm material setup
      if (setupMaterial) {
        if (Array.isArray(mesh.material)) {
          mesh.material.forEach((mat) => setupMaterial!(mat));
        } else {
          setupMaterial(mesh.material);
        }
      }
    }
  });

  // HYBRID APPROACH: Using Asset Forge's normalized bone system for automatic A-pose handling
  // By keeping VRMHumanoidRig and using getNormalizedBoneNode() for bone names,
  // the VRM library's normalized bone abstraction layer handles bind pose compensation automatically

  // Get height from bounding box BEFORE normalization
  let originalHeight = 0.5; // minimum
  for (const mesh of skinnedMeshes) {
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    originalHeight = Math.max(originalHeight, mesh.geometry.boundingBox!.max.y);
  }

  // Normalize avatar height to 1.6m (standard human height)
  const targetHeight = 1.6;
  const scaleFactor = targetHeight / originalHeight;

  // Apply scale to entire scene
  glb.scene.scale.setScalar(scaleFactor);
  glb.scene.updateMatrixWorld(true);

  // Update bounding boxes after scaling
  for (const mesh of skinnedMeshes) {
    mesh.geometry.computeBoundingBox();
  }

  const height = targetHeight;

  // Calculate head to height for camera positioning
  const headPos = normBones.head?.node?.getWorldPosition(v1) || v1.set(0, 0, 0);
  const headToHeight = height - headPos.y;

  return {
    create,
    applyStats(stats: {
      geometries: Set<string>;
      materials: Set<string>;
      triangles: number;
      textureBytes: number;
    }) {
      glb.scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          if (obj.geometry && !stats.geometries.has(obj.geometry.uuid)) {
            stats.geometries.add(obj.geometry.uuid);
            stats.triangles += getTrianglesFromGeometry(obj.geometry);
          }
          if (obj.material) {
            const materials = Array.isArray(obj.material)
              ? obj.material
              : [obj.material];
            materials.forEach((mat) => {
              if (!stats.materials.has(mat.uuid)) {
                stats.materials.add(mat.uuid);
                stats.textureBytes += getTextureBytesFromMaterial(mat);
              }
            });
          }
        }
      });
    },
  };

  function create(
    matrix: THREE.Matrix4,
    hooks: VRMHooks,
    node?: { ctx?: { entity?: unknown } },
  ) {
    const nodeWithCtx = node as unknown as {
      ctx?: { stage?: { scene?: THREE.Scene } };
    };
    const alternateScene = nodeWithCtx?.ctx?.stage?.scene;

    // MMO APPROACH: Clone the VRM for each player instance
    // This is memory efficient - shared geometry/textures, only skeleton is duplicated
    // VRM humanoid is shared (only used for bone lookup, not for animation updates)
    const vrm = cloneGLB(glb);
    const _tvrm = vrm.userData?.vrm;

    const skinnedMeshes = getSkinnedMeshes(vrm.scene as THREE.Scene);
    const skeleton = skinnedMeshes[0].skeleton;
    const rootBone = skeleton.bones[0];
    // CRITICAL: Keep rootBone in scene graph for normalized bone system to work
    // Detaching breaks normalized bones → raw bone propagation
    // rootBone.parent?.remove(rootBone)  // REMOVED - keep in scene
    rootBone.updateMatrixWorld(true);

    // HYBRID APPROACH: Use NORMALIZED bone names (Asset Forge method)
    // This allows VRM library's automatic bind pose handling to work
    // Normalized bones are cloned with the scene, so each instance has its own
    // CRITICAL: Use the CLONED humanoid (_tvrm?.humanoid) for bone lookups, not the original
    const clonedHumanoid = _tvrm?.humanoid;

    const getBoneName = (vrmBoneName: string): string | undefined => {
      // Guard against undefined/null bone names
      if (!vrmBoneName || !clonedHumanoid) return undefined;

      // Get normalized bone node from CLONED humanoid - this handles A-pose automatically
      const normalizedNode = clonedHumanoid.getNormalizedBoneNode?.(
        vrmBoneName as VRMHumanBoneName,
      );
      if (!normalizedNode) {
        // Don't warn for finger bones - many VRMs don't have them
        const isFingerBone =
          vrmBoneName.includes("Thumb") ||
          vrmBoneName.includes("Index") ||
          vrmBoneName.includes("Middle") ||
          vrmBoneName.includes("Ring") ||
          vrmBoneName.includes("Little");
        if (!isFingerBone) {
          console.warn(
            "[VRMFactory.getBoneName] Normalized bone not found:",
            vrmBoneName,
          );
        }
        return undefined;
      }

      // Return the normalized bone name directly - it's already in the cloned scene
      return normalizedNode.name;
    };

    // VRM 1.0+ models face +Z by default, but game expects -Z forward
    // Apply 180-degree Y-axis rotation only for VRM 1.0+
    // VRM 0.x models already face the correct direction
    let finalMatrix = matrix;
    if (isVRM1OrHigher) {
      const rotationMatrix = new THREE.Matrix4().makeRotationY(Math.PI);
      finalMatrix = new THREE.Matrix4().multiplyMatrices(
        matrix,
        rotationMatrix,
      );
    }

    // CRITICAL: Compose scale into the matrix to preserve height normalization
    // The cloned scene has scale set, but direct matrix assignment would ignore it
    const scaleMatrix = new THREE.Matrix4().makeScale(
      vrm.scene.scale.x,
      vrm.scene.scale.y,
      vrm.scene.scale.z,
    );
    finalMatrix = new THREE.Matrix4().multiplyMatrices(
      finalMatrix,
      scaleMatrix,
    );

    vrm.scene.matrix.copy(finalMatrix);
    vrm.scene.matrixWorld.copy(finalMatrix);
    vrm.scene.matrixAutoUpdate = false;
    vrm.scene.matrixWorldAutoUpdate = false;

    // A-pose compensation is handled automatically by VRM normalized bones
    // Cloned instances have their own normalized bones for independent animation

    // PERFORMANCE: Set VRM scene to layer 1 (main camera only, not minimap)
    // Minimap only renders terrain (layer 0) and uses 2D dots for entities
    vrm.scene.layers.set(1);
    vrm.scene.traverse((child) => {
      child.layers.set(1);
    });

    if (hooks?.scene) {
      hooks.scene.add(vrm.scene);
    } else if (alternateScene) {
      console.warn(
        "[VRMFactory] WARNING: No scene in hooks, using alternate scene from node.ctx.stage.scene",
      );
      alternateScene.add(vrm.scene);
    } else if (!hooks?.templateMode) {
      // Only log error if not in template mode - template extraction doesn't need a scene
      console.error(
        "[VRMFactory] ERROR: No scene available, VRM will not be visible!",
      );
    }

    const getEntity = () => node?.ctx?.entity;

    // spatial capsule
    const cRadius = 0.3;
    const sItem: {
      matrix: THREE.Matrix4;
      geometry: THREE.BufferGeometry;
      material: THREE.Material;
      getEntity: () => unknown;
    } = {
      matrix,
      geometry: createCapsule(cRadius, height - cRadius * 2),
      material,
      getEntity,
    };
    if (hooks?.octree) {
      hooks.octree.insert(sItem);
    }

    // debug capsule
    // const foo = new THREE.Mesh(
    //   sItem.geometry,
    //   new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.5 })
    // )
    // vrm.scene.add(foo)

    // link back entity for raycasts

    vrm.scene.traverse((o) => {
      Object.defineProperty(o, "getEntity", {
        value: getEntity,
        writable: true,
        enumerable: false,
        configurable: true,
      });
    });

    // HYBRID APPROACH: AnimationMixer on vrm.scene (Asset Forge method)
    // Animations target normalized bone names (Normalized_Hips, Normalized_Spine, etc.)
    // VRM library's normalized bone system handles A-pose automatically via vrm.humanoid.update()
    // Each clone has its own vrm.scene with cloned normalized bones
    // CRITICAL: Mixer must be on vrm.scene where normalized bones live
    const mixer = new THREE.AnimationMixer(vrm.scene);

    // IDEA: we should use a global frame "budget" to distribute across avatars
    // https://chatgpt.com/c/4bbd469d-982e-4987-ad30-97e9c5ee6729

    let hasLoggedUpdatePipeline = false;
    // Track death animation state for future debugging/logging
    let _deathAnimationActive = false;
    let _deathUpdateLogCount = 0;

    // Track if we've applied idle pose as fallback (only log once)
    let hasAppliedIdleFallback = false;

    /**
     * Update animation with delta time.
     *
     * Animation throttling is handled externally by AnimationLOD at the entity level.
     * This function passes delta directly to the mixer without internal accumulation
     * or rate limiting, ensuring consistent timing across all entity types.
     *
     * CRITICAL: If no emote is playing (during loading or when cleared), we apply
     * the VRM's normalized rest pose to prevent showing T-pose. This ensures the
     * avatar always shows a reasonable pose, never the raw bind pose.
     *
     * @param delta - Delta time from AnimationLOD.effectiveDelta (may be accumulated for skipped frames)
     */
    const update = (delta: number) => {
      // Skip negative delta (invalid state)
      // NOTE: delta=0 is allowed - it applies current animation state without advancing time
      // This is needed for impostor baking (prepareForBake calls update(0))
      if (delta < 0) return;

      // HYBRID APPROACH - Asset Forge animation pipeline:

      // Check if we have a valid animation playing
      const hasValidAnimation = currentEmote?.action && !currentEmote.loading;

      // Step 1: Update AnimationMixer (animates normalized bones)
      // delta=0 applies current state without advancing time (useful for baking)
      if (mixer && hasValidAnimation) {
        mixer.update(delta);
      } else if (
        clonedHumanoid &&
        "resetPose" in clonedHumanoid &&
        !hasValidAnimation
      ) {
        // NO ANIMATION PLAYING: Apply rest pose to prevent T-pose
        // This happens during emote loading or when no emote is set
        // resetPose() sets the VRM to its normalized rest pose (usually A-pose)
        // which is much better than showing T-pose
        (clonedHumanoid as { resetPose: () => void }).resetPose();

        if (!hasAppliedIdleFallback) {
          hasAppliedIdleFallback = true;
          // Only log once to avoid spam
          console.log(
            `[VRM] Applied rest pose fallback - no valid animation playing`,
          );
        }
      }

      // Step 2: CRITICAL - Propagate normalized bone transforms to raw bones
      // This is where the VRM library's automatic A-pose handling happens
      // Without this, normalized bone changes never reach the visible skeleton
      if (_tvrm?.humanoid?.update) {
        _tvrm.humanoid.update(delta);
      } else if (!hasLoggedUpdatePipeline) {
        hasLoggedUpdatePipeline = true;
        console.warn(
          `[VRM] ⚠️ humanoid.update NOT available - animations may not propagate to visible skeleton!`,
        );
      }

      // Step 3: Update skeleton matrices for skinning
      // Use for-loop instead of forEach to avoid callback allocation
      const bones = skeleton.bones;
      for (let i = 0; i < bones.length; i++) {
        const bone = bones[i];
        if (bone) {
          bone.updateMatrixWorld();
        }
      }
      skeleton.update();

      // Reset the fallback flag once we have a valid animation again
      if (hasValidAnimation) {
        hasAppliedIdleFallback = false;
      }
    };
    // world.updater.add(update)
    interface EmoteData {
      url: string;
      loading: boolean;
      action: THREE.AnimationAction | null;
    }

    const emotes: { [url: string]: EmoteData } = {
      // [url]: {
      //   url: String
      //   loading: Boolean
      //   action: AnimationAction
      // }
    };
    let currentEmote: EmoteData | null;
    const setEmote = (url) => {
      if (currentEmote?.url === url) {
        return;
      }
      if (currentEmote) {
        currentEmote.action?.fadeOut(0.15);
        // Reset death animation tracking when switching to a different emote
        if (currentEmote.url?.includes("death") && !url?.includes("death")) {
          _deathAnimationActive = false;
          _deathUpdateLogCount = 0;
        }
        currentEmote = null;
      }
      if (!url) {
        _deathAnimationActive = false; // Also reset if emote is cleared
        return;
      }
      const opts = getQueryParams(url);
      const loop = opts.l !== "0";
      const speed = parseFloat(opts.s || "1");

      if (emotes[url]) {
        currentEmote = emotes[url];
        if (currentEmote.action) {
          const action = currentEmote.action;
          // CRITICAL FIX: Fully reset action state before replaying
          // After clampWhenFinished animations complete, they enter a "finished" state
          // that requires explicit enabling and weight reset to play again
          action.stop(); // Stop any current playback
          action.enabled = true; // Ensure action is enabled (disabled after stop in some cases)
          action.setEffectiveWeight(1); // Reset weight in case it was faded out
          action.setEffectiveTimeScale(speed); // Use speed from URL param (e.g. ?s=2.0)
          action.clampWhenFinished = !loop;
          action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
          action.reset().fadeIn(0.15).play();
          // Track death animation state for update timing
          if (url?.includes("death")) {
            _deathAnimationActive = true;
            _deathUpdateLogCount = 0;
          }
        }
      } else {
        const newEmote: EmoteData = {
          url,
          loading: true,
          action: null,
        };
        emotes[url] = newEmote;
        currentEmote = newEmote;
        type LoaderType = {
          load: (
            type: string,
            url: string,
          ) => Promise<{ toClip: (opts: unknown) => THREE.AnimationClip }>;
        };
        (hooks.loader as LoaderType)
          .load("emote", url)
          .then((emo) => {
            const clip = emo.toClip({
              rootToHips,
              version,
              getBoneName,
            });
            // NOTE: Main branch does NOT filter tracks - the mixer handles missing bones gracefully
            // Track filtering was causing ALL tracks to be removed for some VRMs
            const action = mixer.clipAction(clip);
            action.timeScale = speed;
            newEmote.action = action;
            newEmote.loading = false;
            // if its still this emote, play it!
            if (currentEmote === newEmote) {
              action.clampWhenFinished = !loop;
              action.setLoop(
                loop ? THREE.LoopRepeat : THREE.LoopOnce,
                Infinity,
              );
              // CRITICAL: Use same reset().fadeIn().play() sequence as cached animations
              // Without this, the animation won't blend properly with the previous one
              action.reset().fadeIn(0.15).play();
              // Track death animation state for update timing
              if (url?.includes("death")) {
                _deathAnimationActive = true;
                _deathUpdateLogCount = 0;
              }
            }
          })
          .catch((err) => {
            console.error(`[VRM] Failed to load emote:`, url, err);
          });
      }
    };

    /**
     * Pre-load an emote without playing it.
     * Use this to warm the emote cache and prevent T-pose flash on first use.
     * Fire-and-forget - doesn't block or return a promise.
     *
     * @param url - Emote URL to pre-load
     */
    const preloadEmote = (url: string) => {
      if (!url || emotes[url]) {
        // Already loaded or loading
        return;
      }

      const opts = getQueryParams(url);
      const speed = parseFloat(opts.s || "1");

      const newEmote: EmoteData = {
        url,
        loading: true,
        action: null,
      };
      emotes[url] = newEmote;

      type LoaderType = {
        load: (
          type: string,
          url: string,
        ) => Promise<{ toClip: (opts: unknown) => THREE.AnimationClip }>;
      };

      (hooks.loader as LoaderType)
        .load("emote", url)
        .then((emo) => {
          const clip = emo.toClip({
            rootToHips,
            version,
            getBoneName,
          });
          // NOTE: Main branch does NOT filter tracks - the mixer handles missing bones gracefully
          const action = mixer.clipAction(clip);
          action.timeScale = speed;
          newEmote.action = action;
          newEmote.loading = false;
          // Don't play - just cache it
        })
        .catch((err) => {
          console.warn(`[VRM] Failed to preload emote:`, url, err);
          // Remove failed emote from cache so it can be retried
          delete emotes[url];
        });
    };

    /**
     * Set emote and wait for it to be fully loaded and playing.
     * Returns a Promise that resolves when the emote animation is ready.
     * Use this when you need to guarantee the animation is visible before showing the avatar.
     *
     * @param url - Emote URL to load and play
     * @param timeoutMs - Maximum time to wait (default 3000ms)
     * @returns Promise that resolves when emote is playing, rejects on timeout or error
     */
    const setEmoteAndWait = (url: string, timeoutMs = 3000): Promise<void> => {
      return new Promise((resolve, reject) => {
        if (!url) {
          // No emote requested - resolve immediately (will show rest pose)
          resolve();
          return;
        }

        // Check if emote is already cached and ready
        const cached = emotes[url];
        if (cached && cached.action && !cached.loading) {
          // Emote is ready - set it and resolve
          setEmote(url);
          // Apply first frame immediately
          if (mixer) {
            mixer.update(0);
          }
          resolve();
          return;
        }

        // Need to load the emote - set up timeout
        const timeoutId = setTimeout(() => {
          reject(
            new Error(
              `[VRM] setEmoteAndWait timed out after ${timeoutMs}ms for: ${url}`,
            ),
          );
        }, timeoutMs);

        const opts = getQueryParams(url);
        const loop = opts.l !== "0";
        const speed = parseFloat(opts.s || "1");

        // Check if already loading
        if (cached && cached.loading) {
          // Poll for completion
          const checkInterval = setInterval(() => {
            if (cached.action && !cached.loading) {
              clearInterval(checkInterval);
              clearTimeout(timeoutId);
              setEmote(url);
              if (mixer) {
                mixer.update(0);
              }
              resolve();
            }
          }, 16); // Check every frame
          return;
        }

        // Start loading
        const newEmote: EmoteData = {
          url,
          loading: true,
          action: null,
        };
        emotes[url] = newEmote;
        currentEmote = newEmote;

        type LoaderType = {
          load: (
            type: string,
            url: string,
          ) => Promise<{ toClip: (opts: unknown) => THREE.AnimationClip }>;
        };

        (hooks.loader as LoaderType)
          .load("emote", url)
          .then((emo) => {
            clearTimeout(timeoutId);

            const clip = emo.toClip({
              rootToHips,
              version,
              getBoneName,
            });
            // NOTE: Main branch does NOT filter tracks - the mixer handles missing bones gracefully
            const action = mixer.clipAction(clip);
            action.timeScale = speed;
            newEmote.action = action;
            newEmote.loading = false;

            // Play if still the current emote
            if (currentEmote === newEmote) {
              action.clampWhenFinished = !loop;
              action.setLoop(
                loop ? THREE.LoopRepeat : THREE.LoopOnce,
                Infinity,
              );
              action.reset().fadeIn(0.15).play();

              // Apply first frame immediately
              if (mixer) {
                mixer.update(0);
              }

              if (url?.includes("death")) {
                _deathAnimationActive = true;
                _deathUpdateLogCount = 0;
              }
            }

            resolve();
          })
          .catch((err) => {
            clearTimeout(timeoutId);
            console.error(`[VRM] setEmoteAndWait failed:`, url, err);
            reject(err);
          });
      });
    };

    const bonesByName = {};
    const findBone = (name) => {
      // name is the official vrm bone name eg 'leftHand'
      // actualName is the actual bone name used in the skeleton which may different across vrms
      // CRITICAL: Use clonedHumanoid (not original humanoid) for bone lookups
      if (!bonesByName[name]) {
        let actualName = "";
        if (clonedHumanoid) {
          const node = clonedHumanoid.getRawBoneNode?.(name);
          actualName = node?.name || "";
        }
        bonesByName[name] = skeleton.getBoneByName(actualName);
      }
      return bonesByName[name];
    };

    let firstPersonActive = false;
    const setFirstPerson = (active) => {
      if (firstPersonActive === active) return;
      const head = findBone("neck");
      head.scale.setScalar(active ? 0 : 1);
      firstPersonActive = active;
    };

    const m1 = new THREE.Matrix4();
    const getBoneTransform = (boneName: string): THREE.Matrix4 | null => {
      const bone = findBone(boneName);
      if (!bone) return null;
      // combine the scene's world matrix with the bone's world matrix
      return m1.multiplyMatrices(vrm.scene.matrixWorld, bone.matrixWorld);
    };

    // Create a wrapped update function with logging
    const wrappedUpdate = (delta: number) => {
      update(delta);
    };

    /**
     * Get the lowest bone Y position in world space after animation
     * Checks ALL major bones to find the absolute lowest point - critical for death animations
     * where the character lies down and spine/hips may be lower than feet
     * @returns World-space Y coordinate of the lowest bone, or null if bones not found
     */
    const getLowestBoneY = (): number | null => {
      // Check ALL bones that could be the lowest point in any pose
      // For standing: feet/toes are lowest
      // For lying down (death): spine/hips/head may be lowest
      // For crouching: knees/feet may be lowest
      const groundContactBones = [
        // Feet and toes (standing poses)
        "leftFoot",
        "rightFoot",
        "leftToes",
        "rightToes",
        // Legs (crouching, kneeling)
        "leftLowerLeg",
        "rightLowerLeg",
        "leftUpperLeg",
        "rightUpperLeg",
        // Spine and torso (lying down, death)
        "hips",
        "spine",
        "chest",
        "upperChest",
        // Head (lying face down or back)
        "head",
        "neck",
        // Hands (some poses have hands touching ground)
        "leftHand",
        "rightHand",
      ];

      let minY: number | null = null;

      for (const boneName of groundContactBones) {
        const bone = findBone(boneName);
        if (bone) {
          // Get bone world position (includes VRM scene transform + animation)
          bone.getWorldPosition(_boneWorldPos);
          if (minY === null || _boneWorldPos.y < minY) {
            minY = _boneWorldPos.y;
          }
        }
      }

      return minY;
    };

    /**
     * Clamp avatar to ground - ensures feet touch terrain (not below, not floating)
     * Call this AFTER update() and move() to verify ground contact
     *
     * CRITICAL: move() sets vrm.scene.matrix directly, so vrm.scene.position is STALE.
     * We must extract position from matrix, not use the position property.
     *
     * @param groundY - Terrain height at the avatar's position
     * @returns The Y adjustment applied (positive = lifted up, negative = pushed down)
     */
    const clampToGround = (groundY: number): number => {
      const lowestY = getLowestBoneY();
      if (lowestY === null) return 0;

      // Foot mesh extends below the bone position (bones are at joint centers)
      // Add offset so the mesh touches ground, not the bone
      const FOOT_MESH_OFFSET = 0.1; // 10cm - foot mesh extends below bone

      // Calculate target Y for the lowest bone (should be above ground by offset amount)
      const targetBoneY = groundY + FOOT_MESH_OFFSET;

      // Calculate how far the bone is from target
      // Positive = bone above target (floating), Negative = bone below target (sinking)
      const difference = lowestY - targetBoneY;

      // Only adjust if bone is significantly off target (tolerance for floating point)
      if (Math.abs(difference) > 0.002) {
        // Extract current position from matrix (NOT from position property - it's stale!)
        _scenePos.setFromMatrixPosition(vrm.scene.matrix);

        // Adjust Y to bring bone to target height (offset above ground)
        // If difference > 0 (bone too high), we subtract to push down
        // If difference < 0 (bone too low), we subtract a negative (add) to lift up
        _scenePos.y -= difference;

        // Update the matrix with new position (setPosition modifies in place)
        vrm.scene.matrix.setPosition(_scenePos);
        vrm.scene.matrixWorld.setPosition(_scenePos);

        // Force update all children to reflect the new position
        vrm.scene.updateMatrixWorld(true);

        // Return the adjustment made (negative of difference)
        // Positive return = lifted up, Negative return = pushed down
        return -difference;
      }

      return 0;
    };

    // Track the last ground adjustment to apply in move()
    // This ensures ground clamping persists across frames without modifying node.position
    // (modifying node.position would cause camera jitter since camera follows node.position)
    let lastGroundAdjustment = 0;

    return {
      raw: vrm,
      height,
      headToHeight,
      setEmote,
      preloadEmote,
      setEmoteAndWait,
      setFirstPerson,
      update: wrappedUpdate,
      getBoneTransform,
      getLowestBoneY,
      clampToGround,
      /**
       * Store a ground adjustment to be applied in subsequent move() calls.
       * This is called AFTER clampToGround() to persist the adjustment without
       * modifying the entity's node.position (which would cause camera jitter).
       */
      setGroundAdjustment(adjustment: number) {
        lastGroundAdjustment = adjustment;
      },
      /**
       * Get the current stored ground adjustment
       */
      getGroundAdjustment(): number {
        return lastGroundAdjustment;
      },
      move(_matrix: THREE.Matrix4) {
        matrix.copy(_matrix);
        // CRITICAL: Also update the VRM scene's transform to follow the player
        // Apply 180-degree Y-axis rotation only for VRM 1.0+ models
        // Using pre-allocated matrices to avoid per-frame allocations
        let finalMatrix = _matrix;
        if (isVRM1OrHigher) {
          _rotationMatrix.makeRotationY(Math.PI);
          _tempMatrix1.multiplyMatrices(_matrix, _rotationMatrix);
          finalMatrix = _tempMatrix1;
        }
        // CRITICAL: Compose scale into the matrix to preserve height normalization
        _scaleMatrix.makeScale(
          vrm.scene.scale.x,
          vrm.scene.scale.y,
          vrm.scene.scale.z,
        );
        _tempMatrix2.multiplyMatrices(finalMatrix, _scaleMatrix);

        // Apply stored ground adjustment to keep VRM grounded
        // This adjustment was calculated by clampToGround() and stored via setGroundAdjustment()
        if (Math.abs(lastGroundAdjustment) > 0.001) {
          _scenePos.setFromMatrixPosition(_tempMatrix2);
          _scenePos.y += lastGroundAdjustment;
          _tempMatrix2.setPosition(_scenePos);
        }

        vrm.scene.matrix.copy(_tempMatrix2);
        vrm.scene.matrixWorld.copy(_tempMatrix2);
        vrm.scene.updateMatrixWorld(true); // Force update all children
        if (hooks?.octree && hooks.octree.move) {
          hooks.octree.move(sItem);
        }
      },
      disableRateCheck() {
        // No-op: Rate checking has been removed from VRM factory.
        // All animation throttling is now handled by AnimationLOD at the entity level.
        // This method is kept for backward compatibility with existing code.
      },
      destroy() {
        if (hooks?.scene) {
          hooks.scene.remove(vrm.scene);
        }
        // world.updater.remove(update)
        if (hooks?.octree && hooks.octree.remove) {
          hooks.octree.remove(sItem);
        }
      },
    };
  }
}

/**
 * Clone GLB data for multiple instances (HYBRID APPROACH)
 *
 * Uses SkeletonUtils.clone() for efficient cloning:
 * - Shares geometries and textures (memory efficient)
 * - Duplicates skeleton (independent animations)
 * - CLONES VRM humanoid and remaps bone references (for vrm.humanoid.update())
 *
 * This hybrid approach combines:
 * - Asset Forge: normalized bones + vrm.humanoid.update()
 * - Hyperscape: efficient cloning for multiple instances
 */
function cloneGLB(glb: GLBData): GLBData {
  // Validate skeletons before cloning - filter out undefined bones (can happen with WebGPU)
  glb.scene.traverse((child) => {
    if (child instanceof THREE.SkinnedMesh && child.skeleton) {
      const validBones = child.skeleton.bones.filter(
        (bone): bone is THREE.Bone => bone !== undefined && bone !== null,
      );
      if (validBones.length !== child.skeleton.bones.length) {
        child.skeleton.bones = validBones;
      }
    }
  });

  // Deep clone the scene (including skeleton and skinned meshes)
  const clonedScene = SkeletonUtils.clone(glb.scene) as THREE.Scene;

  // Validate cloned skeletons - filter out undefined bones (can happen with WebGPU)
  clonedScene.traverse((child) => {
    if (child instanceof THREE.SkinnedMesh && child.skeleton) {
      const validBones = child.skeleton.bones.filter(
        (bone): bone is THREE.Bone => bone !== undefined && bone !== null,
      );
      if (validBones.length !== child.skeleton.bones.length) {
        child.skeleton.bones = validBones;
      }
    }
  });

  // CRITICAL: Preserve scale from original scene (height normalization)
  clonedScene.scale.copy(glb.scene.scale);
  clonedScene.updateMatrixWorld(true);

  const originalVRM = glb.userData?.vrm;

  // If no VRM or no humanoid, just return cloned scene
  if (!originalVRM?.humanoid?.clone) {
    return { ...glb, scene: clonedScene };
  }

  // Clone the VRM humanoid
  const clonedHumanoid = originalVRM.humanoid.clone();

  // CRITICAL: Remap humanoid bone references to cloned scene
  remapHumanoidBonesToClonedScene(clonedHumanoid, clonedScene);

  // Create cloned VRM with remapped humanoid
  const clonedVRM = {
    ...originalVRM,
    scene: clonedScene,
    humanoid: clonedHumanoid,
  };

  return {
    ...glb,
    scene: clonedScene,
    userData: { vrm: clonedVRM },
  };
}

/**
 * Remap VRM humanoid bone references to cloned scene
 *
 * After SkeletonUtils.clone(), bones are cloned but VRM humanoid still references
 * original bones. VRMHumanoid.clone() does a SHALLOW clone - the humanBones object
 * is SHARED between all clones!
 *
 * This function:
 * 1. Creates NEW humanBones objects (not shared)
 * 2. Updates bone node references to point to cloned scene's bones
 *
 * CRITICAL: We replace the `humanBones` PROPERTY on the rigs, not the rigs themselves.
 * This preserves the VRMHumanoidRig class methods (getBoneNode, update, etc.)
 */
function remapHumanoidBonesToClonedScene(
  humanoid: {
    _rawHumanBones?: {
      humanBones?: Record<string, { node?: THREE.Object3D }>;
    };
    _normalizedHumanBones?: {
      humanBones?: Record<string, { node?: THREE.Object3D }>;
    };
  },
  clonedScene: THREE.Scene,
): void {
  // Build map of cloned bones by name
  const clonedBonesByName = new Map<string, THREE.Bone>();
  const clonedObjectsByName = new Map<string, THREE.Object3D>();

  clonedScene.traverse((obj) => {
    if (obj instanceof THREE.Bone) {
      clonedBonesByName.set(obj.name, obj);
    }
    // Also track all objects for normalized bones
    if (obj.name) {
      clonedObjectsByName.set(obj.name, obj);
    }
  });

  // Create NEW humanBones object for raw bones (don't mutate shared reference!)
  const rawRig = humanoid._rawHumanBones;
  if (rawRig?.humanBones) {
    const newHumanBones: Record<string, { node?: THREE.Object3D }> = {};
    for (const [boneName, boneData] of Object.entries(rawRig.humanBones)) {
      const typedBoneData = boneData as { node?: THREE.Object3D };
      if (typedBoneData?.node) {
        const clonedBone = clonedBonesByName.get(typedBoneData.node.name);
        if (clonedBone) {
          // Create NEW bone data object with cloned bone reference
          newHumanBones[boneName] = { ...typedBoneData, node: clonedBone };
        } else {
          console.warn(
            "[remapHumanoid] Raw bone not found in cloned scene:",
            typedBoneData.node.name,
          );
          newHumanBones[boneName] = { ...typedBoneData };
        }
      }
    }
    // Replace the humanBones property (keeps VRMRig methods intact)
    rawRig.humanBones = newHumanBones;
  }

  // Create NEW humanBones object for normalized bones (don't mutate shared reference!)
  const normRig = humanoid._normalizedHumanBones;
  if (normRig?.humanBones) {
    const newHumanBones: Record<string, { node?: THREE.Object3D }> = {};
    for (const [boneName, boneData] of Object.entries(normRig.humanBones)) {
      const typedBoneData = boneData as { node?: THREE.Object3D };
      if (typedBoneData?.node) {
        const clonedNode = clonedObjectsByName.get(typedBoneData.node.name);
        if (clonedNode) {
          // Create NEW bone data object with cloned node reference
          newHumanBones[boneName] = { ...typedBoneData, node: clonedNode };
        } else {
          console.warn(
            "[remapHumanoid] Normalized bone not found in cloned scene:",
            typedBoneData.node.name,
          );
          newHumanBones[boneName] = { ...typedBoneData };
        }
      }
    }
    // Replace the humanBones property (keeps VRMHumanoidRig methods intact)
    normRig.humanBones = newHumanBones;
  }
}

function getSkinnedMeshes(scene: THREE.Scene): THREE.SkinnedMesh[] {
  const meshes: THREE.SkinnedMesh[] = [];
  scene.traverse((o) => {
    if (o instanceof THREE.SkinnedMesh) {
      meshes.push(o);
    }
  });
  return meshes;
}

function createCapsule(radius: number, height: number): THREE.BufferGeometry {
  const fullHeight = radius + height + radius;
  const geometry = new THREE.CapsuleGeometry(radius, height);
  geometry.translate(0, fullHeight / 2, 0);
  return geometry;
}

const queryParams = {};
function getQueryParams(url: string): Record<string, string> {
  if (!queryParams[url]) {
    const urlObj = new URL(url);
    const params = {};
    for (const [key, value] of urlObj.searchParams.entries()) {
      params[key] = value;
    }
    queryParams[url] = params;
  }
  return queryParams[url];
}
