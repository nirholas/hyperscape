"use client";

import { VRMLoaderPlugin, VRM, VRMHumanBoneName } from "@pixiv/three-vrm";
import { logger } from "@/lib/utils";

const log = logger.child("EquipmentViewer");

/**
 * VRM meta type for accessing name across VRM0 and VRM1 versions
 * VRM0 uses 'title', VRM1 uses 'name' - this covers both
 */
interface VRMMeta {
  name?: string;
  title?: string;
}
import React, {
  useEffect,
  useRef,
  useState,
  useCallback,
  forwardRef,
  useImperativeHandle,
} from "react";
import * as THREE from "three";
import { SkeletonHelper } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

export interface EquipmentViewerProps {
  /** VRM avatar URL */
  avatarUrl?: string | null;
  /** Equipment (weapon) URL */
  equipmentUrl?: string | null;
  /** Equipment attachment slot */
  equipmentSlot?: string;
  /** Show skeleton helper */
  showSkeleton?: boolean;
  /** Avatar height for auto-scaling */
  avatarHeight?: number;
  /** Enable auto-scale based on avatar height */
  autoScale?: boolean;
  /** Manual scale override */
  scaleOverride?: number;
  /** Grip point offset from AI detection */
  gripOffset?: Vector3 | null;
  /** Manual position offset */
  positionOffset?: Vector3;
  /** Manual rotation offset (degrees) */
  rotationOffset?: Vector3;
  /** Whether animations are playing */
  isAnimating?: boolean;
  /** Which animation to play */
  animationType?: "tpose" | "walking" | "running";
  /** Enable interactive transform controls */
  interactiveMode?: boolean;
  /** Transform mode: translate, rotate, or scale */
  transformMode?: "translate" | "rotate" | "scale";
  /** Callback when position changes via interactive drag */
  onPositionChange?: (position: Vector3) => void;
  /** Callback when rotation changes via interactive drag */
  onRotationChange?: (rotation: Vector3) => void;
  /** Callback when scale changes via interactive drag */
  onScaleChange?: (scale: number) => void;
  /** Custom className */
  className?: string;
}

export interface EquipmentViewerRef {
  exportEquippedModel: () => Promise<ArrayBuffer>;
  exportAlignedEquipment: () => Promise<ArrayBuffer>;
  reattachEquipment: () => void;
  resetCamera: () => void;
  takeScreenshot: () => string | null;
  getScene: () => THREE.Scene | null;
  getVRM: () => VRM | null;
  forceRender: () => void;
}

// VRM bone name mapping from slot IDs
const SLOT_TO_VRM_BONE: Record<string, VRMHumanBoneName> = {
  Hand_R: VRMHumanBoneName.RightHand,
  Hand_L: VRMHumanBoneName.LeftHand,
  Back: VRMHumanBoneName.Spine,
  Hip_R: VRMHumanBoneName.RightUpperLeg,
  Hip_L: VRMHumanBoneName.LeftUpperLeg,
  Head: VRMHumanBoneName.Head,
  Spine2: VRMHumanBoneName.Chest,
  Hips: VRMHumanBoneName.Hips,
};

// Default offsets for weapon types based on slot
const getDefaultOffsets = (
  slot: string,
  isRightHand: boolean,
): { position: Vector3; rotation: Vector3 } => {
  const handOffset = isRightHand ? 0.076 : -0.076;

  if (slot === "Hand_R" || slot === "Hand_L") {
    return {
      position: { x: handOffset, y: 0.077, z: 0.028 },
      rotation: { x: 92, y: 0, z: 0 },
    };
  }

  return {
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
  };
};

const EquipmentViewer = forwardRef<EquipmentViewerRef, EquipmentViewerProps>(
  (props, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const sceneRef = useRef<THREE.Scene | null>(null);
    const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
    const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
    const orbitControlsRef = useRef<OrbitControls | null>(null);
    const transformControlsRef = useRef<TransformControls | null>(null);
    const vrmRef = useRef<VRM | null>(null);
    const avatarRef = useRef<THREE.Object3D | null>(null);
    const equipmentRef = useRef<THREE.Object3D | null>(null);
    const equipmentWrapperRef = useRef<THREE.Group | null>(null);
    const skeletonHelperRef = useRef<SkeletonHelper | null>(null);
    const loaderRef = useRef<GLTFLoader | null>(null);
    const animationMixerRef = useRef<THREE.AnimationMixer | null>(null);
    const clockRef = useRef<THREE.Clock | null>(null);
    const currentActionRef = useRef<THREE.AnimationAction | null>(null);
    const animationClipsRef = useRef<THREE.AnimationClip[]>([]);
    const isAnimatingRef = useRef(false);
    const isDraggingRef = useRef(false);
    const animationTimeRef = useRef(0);
    const proceduralAnimationRef = useRef<number | null>(null);

    const {
      avatarUrl,
      equipmentUrl,
      equipmentSlot = "Hand_R",
      showSkeleton = false,
      avatarHeight = 1.83,
      autoScale = true,
      scaleOverride = 1.0,
      gripOffset,
      positionOffset = { x: 0, y: 0, z: 0 },
      rotationOffset = { x: 0, y: 0, z: 0 },
      isAnimating = false,
      animationType = "tpose",
      interactiveMode = false,
      transformMode = "translate",
      onPositionChange,
      onRotationChange,
      onScaleChange,
      className = "",
    } = props;

    const [isInitialized, setIsInitialized] = useState(false);

    // Initialize Three.js scene
    useEffect(() => {
      if (!containerRef.current) return;

      const container = containerRef.current;

      // Scene
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x1a1a2e);
      sceneRef.current = scene;

      // Camera
      const camera = new THREE.PerspectiveCamera(
        50,
        container.clientWidth / container.clientHeight,
        0.1,
        100,
      );
      camera.position.set(2, 1.5, 2);
      camera.lookAt(0, 1, 0);
      cameraRef.current = camera;

      // Renderer
      const renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
      });
      renderer.setSize(container.clientWidth, container.clientHeight);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1;
      container.appendChild(renderer.domElement);
      rendererRef.current = renderer;

      // Lighting
      const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
      scene.add(ambientLight);

      const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
      directionalLight.position.set(5, 5, 5);
      directionalLight.castShadow = true;
      scene.add(directionalLight);

      const backLight = new THREE.DirectionalLight(0x4488ff, 0.3);
      backLight.position.set(-5, 3, -5);
      scene.add(backLight);

      // Orbit controls
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.target.set(0, 1, 0);
      controls.enableDamping = true;
      controls.dampingFactor = 0.1;
      controls.update();
      orbitControlsRef.current = controls;

      // Transform controls will be added lazily when interactive mode is enabled

      // Grid
      const gridHelper = new THREE.GridHelper(10, 10, 0x444444, 0x222222);
      scene.add(gridHelper);

      // Ground
      const groundGeometry = new THREE.PlaneGeometry(20, 20);
      const groundMaterial = new THREE.MeshStandardMaterial({
        color: 0x222233,
        roughness: 0.9,
        metalness: 0.1,
      });
      const ground = new THREE.Mesh(groundGeometry, groundMaterial);
      ground.rotation.x = -Math.PI / 2;
      ground.receiveShadow = true;
      scene.add(ground);

      // Initialize loader with VRM plugin
      const loader = new GLTFLoader();
      loader.register((parser) => new VRMLoaderPlugin(parser));
      loaderRef.current = loader;

      // Clock for animations
      clockRef.current = new THREE.Clock();

      setIsInitialized(true);

      // Animation loop
      let animationId: number;
      const animate = () => {
        animationId = requestAnimationFrame(animate);

        controls.update();

        // Update animation mixer
        if (
          animationMixerRef.current &&
          isAnimatingRef.current &&
          clockRef.current
        ) {
          const delta = clockRef.current.getDelta();
          animationMixerRef.current.update(delta);
        }

        // Update VRM (for blinking, etc.)
        if (vrmRef.current && clockRef.current) {
          vrmRef.current.update(clockRef.current.getDelta());
        }

        renderer.render(scene, camera);
      };
      animate();

      // Handle resize
      const handleResize = () => {
        if (!container) return;
        camera.aspect = container.clientWidth / container.clientHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(container.clientWidth, container.clientHeight);
      };
      window.addEventListener("resize", handleResize);

      return () => {
        window.removeEventListener("resize", handleResize);
        globalThis.cancelAnimationFrame(animationId);
        // Dispose transform controls if they were created
        if (transformControlsRef.current) {
          transformControlsRef.current.detach();
          transformControlsRef.current.dispose();
          const helper = transformControlsRef.current.getHelper();
          if (helper.parent) {
            helper.parent.remove(helper);
          }
          transformControlsRef.current = null;
        }
        renderer.dispose();
        if (container.contains(renderer.domElement)) {
          container.removeChild(renderer.domElement);
        }
      };
    }, []);

    // Load avatar (VRM)
    useEffect(() => {
      if (
        !isInitialized ||
        !avatarUrl ||
        !sceneRef.current ||
        !loaderRef.current
      )
        return;

      const loader = loaderRef.current;
      const scene = sceneRef.current;

      const loadAvatar = async () => {
        log.info("Loading avatar:", avatarUrl);

        try {
          // Cleanup previous avatar
          if (avatarRef.current) {
            scene.remove(avatarRef.current);
            avatarRef.current = null;
          }
          if (vrmRef.current) {
            vrmRef.current.scene.removeFromParent();
            vrmRef.current = null;
          }
          if (skeletonHelperRef.current) {
            scene.remove(skeletonHelperRef.current);
            skeletonHelperRef.current = null;
          }

          // Clean up animations
          if (currentActionRef.current) {
            currentActionRef.current.stop();
            currentActionRef.current = null;
          }
          if (animationMixerRef.current) {
            animationMixerRef.current.stopAllAction();
            animationMixerRef.current = null;
          }
          animationClipsRef.current = [];

          const gltf = await loader.loadAsync(avatarUrl);
          const avatar = gltf.scene;

          // Check for VRM
          if (gltf.userData.vrm) {
            const vrm = gltf.userData.vrm as VRM;
            vrmRef.current = vrm;
            // VRM1 uses 'name', VRM0 uses 'title' - handle both
            const meta = vrm.meta as VRMMeta;
            const vrmName = meta?.name ?? meta?.title ?? "Unknown VRM";
            log.info("VRM loaded:", vrmName);
          }

          // Setup animations if available
          if (gltf.animations && gltf.animations.length > 0) {
            log.info(`Found ${gltf.animations.length} animations`);
            animationClipsRef.current = gltf.animations;
            animationMixerRef.current = new THREE.AnimationMixer(avatar);
          }

          avatar.position.set(0, 0, 0);
          avatar.traverse((child) => {
            if (child instanceof THREE.Mesh) {
              child.castShadow = true;
              child.receiveShadow = true;
            }
          });

          avatarRef.current = avatar;
          scene.add(avatar);

          log.info("Avatar loaded successfully");

          // Update skeleton helper
          updateSkeletonHelper();

          // Reattach equipment if loaded
          if (equipmentRef.current) {
            setTimeout(() => attachEquipmentToAvatar(), 100);
          }
        } catch (error) {
          log.error("Failed to load avatar:", error);
        }
      };

      loadAvatar();
    }, [isInitialized, avatarUrl]);

    // Load equipment
    useEffect(() => {
      if (
        !isInitialized ||
        !equipmentUrl ||
        !sceneRef.current ||
        !loaderRef.current
      )
        return;

      const loader = loaderRef.current;
      const scene = sceneRef.current;

      const loadEquipment = async () => {
        log.info("Loading equipment:", equipmentUrl);

        try {
          // Cleanup previous equipment
          if (equipmentRef.current) {
            if (equipmentRef.current.parent) {
              equipmentRef.current.parent.remove(equipmentRef.current);
            }
            equipmentRef.current = null;
          }
          if (equipmentWrapperRef.current) {
            if (equipmentWrapperRef.current.parent) {
              equipmentWrapperRef.current.parent.remove(
                equipmentWrapperRef.current,
              );
            }
            equipmentWrapperRef.current = null;
          }

          const gltf = await loader.loadAsync(equipmentUrl);
          let equipment = gltf.scene;

          // If we have a grip offset, normalize the weapon
          if (
            gripOffset &&
            (gripOffset.x !== 0 || gripOffset.y !== 0 || gripOffset.z !== 0)
          ) {
            equipment = createNormalizedWeapon(equipment, gripOffset);
          }

          equipment.userData.isEquipment = true;
          equipment.traverse((child) => {
            if (child instanceof THREE.Mesh) {
              child.castShadow = true;
              child.receiveShadow = true;
            }
          });

          equipmentRef.current = equipment;
          log.info("Equipment loaded successfully");

          // Attach to avatar if loaded
          if (avatarRef.current && vrmRef.current) {
            attachEquipmentToAvatar();
          } else {
            // Add to scene directly if no avatar
            equipment.position.set(0.5, 0, 0);
            scene.add(equipment);
          }
        } catch (error) {
          log.error("Failed to load equipment:", error);
        }
      };

      loadEquipment();
    }, [
      isInitialized,
      equipmentUrl,
      gripOffset?.x,
      gripOffset?.y,
      gripOffset?.z,
    ]);

    // Create normalized weapon with grip at origin
    const createNormalizedWeapon = (
      mesh: THREE.Object3D,
      grip: Vector3,
    ): THREE.Group => {
      const group = new THREE.Group();
      group.name = "NormalizedWeapon";

      const clonedMesh = mesh.clone();
      clonedMesh.position.set(-grip.x, -grip.y, -grip.z);

      group.add(clonedMesh);
      group.userData.isNormalized = true;

      return group;
    };

    // Calculate avatar height from model
    const calculateAvatarHeight = useCallback(
      (avatar: THREE.Object3D): number => {
        avatar.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(avatar);
        const height = box.max.y - box.min.y;
        return height > 0.1 && height < 10 ? height : 1.8;
      },
      [],
    );

    // Calculate weapon scale based on avatar
    const calculateWeaponScale = useCallback(
      (
        weapon: THREE.Object3D,
        avatar: THREE.Object3D,
        height: number,
      ): number => {
        const weaponBox = new THREE.Box3().setFromObject(weapon);
        const weaponSize = new THREE.Vector3();
        weaponBox.getSize(weaponSize);
        const weaponLength = Math.max(weaponSize.x, weaponSize.y, weaponSize.z);

        // Weapon should be about 65% of avatar height for standard swords
        const targetProportion = 0.65;
        const targetLength = height * targetProportion;

        return targetLength / weaponLength;
      },
      [],
    );

    // Attach equipment to VRM bone
    const attachEquipmentToAvatar = useCallback(() => {
      if (!vrmRef.current || !equipmentRef.current || !sceneRef.current) {
        log.warn("Cannot attach: missing VRM or equipment");
        return;
      }

      const vrm = vrmRef.current;
      const equipment = equipmentRef.current;

      // Get target bone from VRM
      const vrmBoneName = SLOT_TO_VRM_BONE[equipmentSlot];
      if (!vrmBoneName) {
        log.warn("Unknown equipment slot:", equipmentSlot);
        return;
      }

      const targetBone = vrm.humanoid.getNormalizedBoneNode(vrmBoneName);
      if (!targetBone) {
        log.warn("Could not find bone:", vrmBoneName);
        return;
      }

      log.info(`Attaching to bone: ${vrmBoneName}`);

      // Remove from previous parent
      if (equipment.parent) {
        equipment.parent.remove(equipment);
      }
      if (equipmentWrapperRef.current?.parent) {
        equipmentWrapperRef.current.parent.remove(equipmentWrapperRef.current);
      }

      // Create wrapper group for transforms
      const wrapper = new THREE.Group();
      wrapper.name = "EquipmentWrapper";
      equipmentWrapperRef.current = wrapper;

      // Apply scaling
      const effectiveHeight = avatarRef.current
        ? calculateAvatarHeight(avatarRef.current)
        : avatarHeight;
      let finalScale = scaleOverride;

      if (autoScale && avatarRef.current) {
        const autoScaleFactor = calculateWeaponScale(
          equipment,
          avatarRef.current,
          effectiveHeight,
        );
        finalScale = scaleOverride * autoScaleFactor;
      }

      // Get bone world scale for compensation
      targetBone.updateMatrixWorld(true);
      const boneWorldScale = new THREE.Vector3();
      targetBone.getWorldScale(boneWorldScale);
      const compensatedScale = finalScale / boneWorldScale.x;

      equipment.scale.set(compensatedScale, compensatedScale, compensatedScale);

      // Apply default offsets
      const isRightHand =
        equipmentSlot.includes("_R") || equipmentSlot.includes("Right");
      const defaults = getDefaultOffsets(equipmentSlot, isRightHand);

      // Set wrapper position (in bone local space)
      const basePosition = new THREE.Vector3(
        defaults.position.x + positionOffset.x,
        defaults.position.y + positionOffset.y,
        defaults.position.z + positionOffset.z,
      );
      wrapper.position.copy(basePosition.divideScalar(boneWorldScale.x));

      // Set wrapper rotation
      wrapper.rotation.set(
        THREE.MathUtils.degToRad(defaults.rotation.x + rotationOffset.x),
        THREE.MathUtils.degToRad(defaults.rotation.y + rotationOffset.y),
        THREE.MathUtils.degToRad(defaults.rotation.z + rotationOffset.z),
      );

      // Add equipment to wrapper
      wrapper.add(equipment);

      // Add wrapper to bone
      targetBone.add(wrapper);

      log.info("Equipment attached successfully");
    }, [
      equipmentSlot,
      avatarHeight,
      autoScale,
      scaleOverride,
      positionOffset,
      rotationOffset,
      calculateAvatarHeight,
      calculateWeaponScale,
    ]);

    // Update equipment position/rotation when offsets change
    useEffect(() => {
      if (
        isInitialized &&
        equipmentRef.current &&
        vrmRef.current &&
        equipmentWrapperRef.current
      ) {
        const wrapper = equipmentWrapperRef.current;
        const isRightHand =
          equipmentSlot.includes("_R") || equipmentSlot.includes("Right");
        const defaults = getDefaultOffsets(equipmentSlot, isRightHand);

        // Get bone scale
        const vrmBoneName = SLOT_TO_VRM_BONE[equipmentSlot];
        const targetBone =
          vrmRef.current.humanoid.getNormalizedBoneNode(vrmBoneName);
        if (!targetBone) return;

        targetBone.updateMatrixWorld(true);
        const boneWorldScale = new THREE.Vector3();
        targetBone.getWorldScale(boneWorldScale);

        // Update position
        const newPosition = new THREE.Vector3(
          defaults.position.x + positionOffset.x,
          defaults.position.y + positionOffset.y,
          defaults.position.z + positionOffset.z,
        );
        wrapper.position.copy(newPosition.divideScalar(boneWorldScale.x));

        // Update rotation
        wrapper.rotation.set(
          THREE.MathUtils.degToRad(defaults.rotation.x + rotationOffset.x),
          THREE.MathUtils.degToRad(defaults.rotation.y + rotationOffset.y),
          THREE.MathUtils.degToRad(defaults.rotation.z + rotationOffset.z),
        );

        wrapper.updateMatrix();
        wrapper.updateMatrixWorld(true);
      }
    }, [
      isInitialized,
      positionOffset.x,
      positionOffset.y,
      positionOffset.z,
      rotationOffset.x,
      rotationOffset.y,
      rotationOffset.z,
      equipmentSlot,
    ]);

    // Re-attach when slot changes
    useEffect(() => {
      if (isInitialized && equipmentRef.current && vrmRef.current) {
        attachEquipmentToAvatar();
      }
    }, [isInitialized, equipmentSlot, attachEquipmentToAvatar]);

    // Update skeleton helper
    const updateSkeletonHelper = useCallback(() => {
      if (!sceneRef.current) return;

      // Remove existing helper
      if (skeletonHelperRef.current) {
        sceneRef.current.remove(skeletonHelperRef.current);
        skeletonHelperRef.current = null;
      }

      if (showSkeleton && avatarRef.current) {
        avatarRef.current.traverse((child) => {
          if (child instanceof THREE.SkinnedMesh && child.skeleton) {
            const helper = new SkeletonHelper(child.skeleton.bones[0]);
            (helper.material as THREE.LineBasicMaterial).color.set(0x00ff00);
            (helper.material as THREE.LineBasicMaterial).linewidth = 2;
            (helper.material as THREE.LineBasicMaterial).depthTest = false;
            sceneRef.current!.add(helper);
            skeletonHelperRef.current = helper;
          }
        });
      }
    }, [showSkeleton]);

    useEffect(() => {
      updateSkeletonHelper();
    }, [showSkeleton, updateSkeletonHelper]);

    // Handle interactive transform controls - create lazily when needed
    useEffect(() => {
      if (
        !sceneRef.current ||
        !cameraRef.current ||
        !rendererRef.current ||
        !orbitControlsRef.current
      )
        return;

      const scene = sceneRef.current;
      const camera = cameraRef.current;
      const renderer = rendererRef.current;
      const orbitControls = orbitControlsRef.current;

      if (interactiveMode && equipmentWrapperRef.current) {
        // Create transform controls if not already created
        if (!transformControlsRef.current) {
          const tc = new TransformControls(camera, renderer.domElement);
          tc.setSize(0.75);
          tc.addEventListener("dragging-changed", (event) => {
            const isDragging = (event as { value: boolean }).value;
            orbitControls.enabled = !isDragging;
            isDraggingRef.current = isDragging;
          });
          // Add the HELPER to the scene, not the TransformControls object directly
          scene.add(tc.getHelper());
          transformControlsRef.current = tc;
        }

        const transformControls = transformControlsRef.current;

        // Attach to equipment wrapper
        transformControls.attach(equipmentWrapperRef.current);
        transformControls.setMode(transformMode);

        // Handle transform changes
        const handleChange = () => {
          if (!equipmentWrapperRef.current || !isDraggingRef.current) return;

          const wrapper = equipmentWrapperRef.current;

          if (transformMode === "translate" && onPositionChange) {
            onPositionChange({
              x: wrapper.position.x,
              y: wrapper.position.y,
              z: wrapper.position.z,
            });
          } else if (transformMode === "rotate" && onRotationChange) {
            onRotationChange({
              x: THREE.MathUtils.radToDeg(wrapper.rotation.x),
              y: THREE.MathUtils.radToDeg(wrapper.rotation.y),
              z: THREE.MathUtils.radToDeg(wrapper.rotation.z),
            });
          } else if (transformMode === "scale" && onScaleChange) {
            const avgScale =
              (wrapper.scale.x + wrapper.scale.y + wrapper.scale.z) / 3;
            onScaleChange(avgScale);
          }
        };

        transformControls.addEventListener("change", handleChange);

        return () => {
          transformControls.removeEventListener("change", handleChange);
        };
      } else if (transformControlsRef.current) {
        // Detach when not in interactive mode
        transformControlsRef.current.detach();
      }
    }, [
      interactiveMode,
      transformMode,
      onPositionChange,
      onRotationChange,
      onScaleChange,
    ]);

    // Update transform mode when it changes
    useEffect(() => {
      if (transformControlsRef.current && interactiveMode) {
        transformControlsRef.current.setMode(transformMode);
      }
    }, [transformMode, interactiveMode]);

    // Procedural animation function for VRM humanoid
    const applyProceduralAnimation = useCallback(
      (vrm: VRM, time: number, type: "walking" | "running") => {
        const humanoid = vrm.humanoid;
        if (!humanoid) return;

        // Animation parameters
        const speed = type === "running" ? 8 : 4; // Cycle speed
        const t = time * speed;

        // Amplitude modifiers
        const legSwing = type === "running" ? 0.6 : 0.4;
        const armSwing = type === "running" ? 0.5 : 0.3;
        const hipBob = type === "running" ? 0.03 : 0.015;

        // Get bone nodes
        const leftUpperLeg = humanoid.getNormalizedBoneNode(
          VRMHumanBoneName.LeftUpperLeg,
        );
        const rightUpperLeg = humanoid.getNormalizedBoneNode(
          VRMHumanBoneName.RightUpperLeg,
        );
        const leftLowerLeg = humanoid.getNormalizedBoneNode(
          VRMHumanBoneName.LeftLowerLeg,
        );
        const rightLowerLeg = humanoid.getNormalizedBoneNode(
          VRMHumanBoneName.RightLowerLeg,
        );
        const leftUpperArm = humanoid.getNormalizedBoneNode(
          VRMHumanBoneName.LeftUpperArm,
        );
        const rightUpperArm = humanoid.getNormalizedBoneNode(
          VRMHumanBoneName.RightUpperArm,
        );
        const leftLowerArm = humanoid.getNormalizedBoneNode(
          VRMHumanBoneName.LeftLowerArm,
        );
        const rightLowerArm = humanoid.getNormalizedBoneNode(
          VRMHumanBoneName.RightLowerArm,
        );
        const spine = humanoid.getNormalizedBoneNode(VRMHumanBoneName.Spine);
        const hips = humanoid.getNormalizedBoneNode(VRMHumanBoneName.Hips);

        // Leg animation (opposite phase)
        if (leftUpperLeg) {
          leftUpperLeg.rotation.x = Math.sin(t) * legSwing;
        }
        if (rightUpperLeg) {
          rightUpperLeg.rotation.x = Math.sin(t + Math.PI) * legSwing;
        }

        // Lower leg (knee bend during back swing)
        if (leftLowerLeg) {
          const kneePhase = Math.sin(t);
          leftLowerLeg.rotation.x = kneePhase < 0 ? -kneePhase * 0.5 : 0;
        }
        if (rightLowerLeg) {
          const kneePhase = Math.sin(t + Math.PI);
          rightLowerLeg.rotation.x = kneePhase < 0 ? -kneePhase * 0.5 : 0;
        }

        // Arm swing (opposite to legs)
        if (leftUpperArm) {
          leftUpperArm.rotation.x = Math.sin(t + Math.PI) * armSwing;
        }
        if (rightUpperArm) {
          rightUpperArm.rotation.x = Math.sin(t) * armSwing;
        }

        // Forearm slight bend
        if (leftLowerArm) {
          leftLowerArm.rotation.x = 0.2;
        }
        if (rightLowerArm) {
          rightLowerArm.rotation.x = 0.2;
        }

        // Subtle spine rotation for natural movement
        if (spine) {
          spine.rotation.y = Math.sin(t) * 0.05;
        }

        // Hip bob (vertical movement illusion)
        if (hips) {
          hips.position.y = Math.abs(Math.sin(t * 2)) * hipBob;
        }
      },
      [],
    );

    // Reset VRM to T-pose
    const resetToTPose = useCallback((vrm: VRM) => {
      const humanoid = vrm.humanoid;
      if (!humanoid) return;

      // Reset all bones to default rotation
      const bonesToReset = [
        VRMHumanBoneName.LeftUpperLeg,
        VRMHumanBoneName.RightUpperLeg,
        VRMHumanBoneName.LeftLowerLeg,
        VRMHumanBoneName.RightLowerLeg,
        VRMHumanBoneName.LeftUpperArm,
        VRMHumanBoneName.RightUpperArm,
        VRMHumanBoneName.LeftLowerArm,
        VRMHumanBoneName.RightLowerArm,
        VRMHumanBoneName.Spine,
      ];

      for (const boneName of bonesToReset) {
        const bone = humanoid.getNormalizedBoneNode(boneName);
        if (bone) {
          bone.rotation.set(0, 0, 0);
        }
      }

      // Reset hip position
      const hips = humanoid.getNormalizedBoneNode(VRMHumanBoneName.Hips);
      if (hips) {
        hips.position.y = 0;
      }
    }, []);

    // Handle animation state with procedural animations
    useEffect(() => {
      isAnimatingRef.current = isAnimating;

      // Stop any previous procedural animation
      if (proceduralAnimationRef.current !== null) {
        globalThis.cancelAnimationFrame(proceduralAnimationRef.current);
        proceduralAnimationRef.current = null;
      }

      // Stop any mixer-based animation
      if (currentActionRef.current) {
        currentActionRef.current.stop();
        currentActionRef.current = null;
      }

      // Reset to T-pose when stopping or switching to T-pose
      if (vrmRef.current && (!isAnimating || animationType === "tpose")) {
        resetToTPose(vrmRef.current);
        return;
      }

      // Start procedural animation for VRM
      if (isAnimating && animationType !== "tpose" && vrmRef.current) {
        log.info(`Starting procedural ${animationType} animation`);

        animationTimeRef.current = 0;
        const startTime = performance.now();

        const animateFrame = () => {
          if (!isAnimatingRef.current || !vrmRef.current) return;

          const elapsed = (performance.now() - startTime) / 1000;
          animationTimeRef.current = elapsed;

          applyProceduralAnimation(
            vrmRef.current,
            elapsed,
            animationType as "walking" | "running",
          );

          proceduralAnimationRef.current = requestAnimationFrame(animateFrame);
        };

        proceduralAnimationRef.current = requestAnimationFrame(animateFrame);
      }

      // Cleanup
      return () => {
        if (proceduralAnimationRef.current !== null) {
          globalThis.cancelAnimationFrame(proceduralAnimationRef.current);
          proceduralAnimationRef.current = null;
        }
      };
    }, [isAnimating, animationType, applyProceduralAnimation, resetToTPose]);

    // Expose methods via ref
    useImperativeHandle(ref, () => ({
      exportEquippedModel: async () => {
        if (!avatarRef.current) return new ArrayBuffer(0);

        const exporter = new GLTFExporter();
        const gltf = await exporter.parseAsync(avatarRef.current, {
          binary: true,
          includeCustomExtensions: true,
        });
        return gltf as ArrayBuffer;
      },

      exportAlignedEquipment: async () => {
        if (!equipmentWrapperRef.current) return new ArrayBuffer(0);

        const wrapper = equipmentWrapperRef.current;
        const exportRoot = wrapper.clone(true);

        // Bake in the transform
        exportRoot.updateMatrix();

        // Add metadata for Hyperscape
        const vrmBoneName = SLOT_TO_VRM_BONE[equipmentSlot] || "rightHand";
        exportRoot.userData.hyperscape = {
          vrmBoneName: vrmBoneName,
          originalSlot: equipmentSlot,
          avatarHeight: avatarHeight,
          exportedFrom: "hyperforge-equipment-fitting",
          exportedAt: new Date().toISOString(),
        };

        const exporter = new GLTFExporter();
        const gltf = await exporter.parseAsync(exportRoot, {
          binary: true,
          includeCustomExtensions: true,
        });
        return gltf as ArrayBuffer;
      },

      reattachEquipment: () => {
        if (vrmRef.current && equipmentRef.current) {
          attachEquipmentToAvatar();
        }
      },

      resetCamera: () => {
        if (cameraRef.current && orbitControlsRef.current) {
          cameraRef.current.position.set(2, 1.5, 2);
          cameraRef.current.lookAt(0, 1, 0);
          orbitControlsRef.current.target.set(0, 1, 0);
          orbitControlsRef.current.update();
        }
      },

      takeScreenshot: () => {
        if (!rendererRef.current || !sceneRef.current || !cameraRef.current)
          return null;
        rendererRef.current.render(sceneRef.current, cameraRef.current);
        return rendererRef.current.domElement.toDataURL("image/png");
      },

      getScene: () => sceneRef.current,

      getVRM: () => vrmRef.current,

      forceRender: () => {
        if (rendererRef.current && sceneRef.current && cameraRef.current) {
          rendererRef.current.render(sceneRef.current, cameraRef.current);
        }
      },
    }));

    return <div ref={containerRef} className={`w-full h-full ${className}`} />;
  },
);

EquipmentViewer.displayName = "EquipmentViewer";

export { EquipmentViewer };
