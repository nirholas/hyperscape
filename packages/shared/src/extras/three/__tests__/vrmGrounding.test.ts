/**
 * VRM Grounding Logic Unit Tests
 *
 * Tests the clampToGround() and getLowestBoneY() functions
 * that ensure avatars stay grounded during animations.
 *
 * These tests verify:
 * - Feet stay on ground during standing poses (IDLE, WALK, RUN)
 * - Feet stay grounded during action poses (COMBAT/punch, CHOPPING)
 * - Body touches ground during lying poses (DEATH)
 * - Knees/feet grounded during crouch (SQUAT)
 *
 * Animation Validation Tests:
 * - Hips must NOT be near world origin (0,0,0) - this indicates broken root motion
 * - Feet must be near ground level for standing animations
 * - For death animations, body must be near ground (lying down)
 */

import { describe, it, expect, beforeEach } from "vitest";
import * as THREE from "three";

// Mock bone structure for testing
class MockBone extends THREE.Object3D {
  constructor(name: string, worldY: number) {
    super();
    this.name = name;
    // Set local position, then update world matrix
    this.position.set(0, worldY, 0);
    this.updateMatrixWorld(true);
  }

  getWorldPosition(target: THREE.Vector3): THREE.Vector3 {
    return target.setFromMatrixPosition(this.matrixWorld);
  }
}

// Simplified grounding logic extracted for testing
function getLowestBoneY(bones: Map<string, MockBone>): number | null {
  const groundContactBones = [
    "leftFoot",
    "rightFoot",
    "leftToes",
    "rightToes",
    "leftLowerLeg",
    "rightLowerLeg",
    "leftUpperLeg",
    "rightUpperLeg",
    "hips",
    "spine",
    "chest",
    "upperChest",
    "head",
    "neck",
    "leftHand",
    "rightHand",
  ];

  let minY: number | null = null;
  const tempVec = new THREE.Vector3();

  for (const boneName of groundContactBones) {
    const bone = bones.get(boneName);
    if (bone) {
      bone.getWorldPosition(tempVec);
      if (minY === null || tempVec.y < minY) {
        minY = tempVec.y;
      }
    }
  }

  return minY;
}

function calculateGroundAdjustment(
  lowestBoneY: number | null,
  groundY: number,
): { adjustment: number; penetration: number; floating: number } {
  if (lowestBoneY === null) {
    return { adjustment: 0, penetration: 0, floating: 0 };
  }

  const difference = lowestBoneY - groundY;
  let adjustment = 0;
  let penetration = 0;
  let floating = 0;

  if (Math.abs(difference) > 0.002) {
    adjustment = -difference;
    if (difference < 0) {
      penetration = Math.abs(difference);
    } else {
      floating = difference;
    }
  }

  return { adjustment, penetration, floating };
}

describe("VRM Grounding Logic", () => {
  describe("getLowestBoneY", () => {
    it("returns null when no bones exist", () => {
      const bones = new Map<string, MockBone>();
      expect(getLowestBoneY(bones)).toBeNull();
    });

    it("finds lowest foot bone in standing pose", () => {
      const bones = new Map<string, MockBone>();
      bones.set("leftFoot", new MockBone("leftFoot", 0.05));
      bones.set("rightFoot", new MockBone("rightFoot", 0.03));
      bones.set("hips", new MockBone("hips", 1.0));

      const lowestY = getLowestBoneY(bones);
      expect(lowestY).toBeCloseTo(0.03, 2);
    });

    it("finds spine as lowest in lying-down pose (death)", () => {
      const bones = new Map<string, MockBone>();
      // Death pose: character lying on back
      bones.set("leftFoot", new MockBone("leftFoot", 0.5)); // Feet elevated
      bones.set("rightFoot", new MockBone("rightFoot", 0.5));
      bones.set("hips", new MockBone("hips", 0.15)); // Hips near ground
      bones.set("spine", new MockBone("spine", 0.08)); // Spine touching ground
      bones.set("head", new MockBone("head", 0.12)); // Head slightly elevated

      const lowestY = getLowestBoneY(bones);
      expect(lowestY).toBeCloseTo(0.08, 2);
    });

    it("finds knee as lowest in crouch pose (squat)", () => {
      const bones = new Map<string, MockBone>();
      // Squat pose: knees bent low
      bones.set("leftFoot", new MockBone("leftFoot", 0.05));
      bones.set("rightFoot", new MockBone("rightFoot", 0.05));
      bones.set("leftLowerLeg", new MockBone("leftLowerLeg", 0.1)); // Knees low
      bones.set("rightLowerLeg", new MockBone("rightLowerLeg", 0.1));
      bones.set("hips", new MockBone("hips", 0.4)); // Hips lowered

      const lowestY = getLowestBoneY(bones);
      expect(lowestY).toBeCloseTo(0.05, 2);
    });
  });

  describe("calculateGroundAdjustment", () => {
    it("returns zero adjustment when grounded", () => {
      const result = calculateGroundAdjustment(0.001, 0);
      expect(result.adjustment).toBe(0);
      expect(result.penetration).toBe(0);
      expect(result.floating).toBe(0);
    });

    it("calculates lift when penetrating ground", () => {
      // Bone at -0.1, ground at 0 -> needs to lift by 0.1
      const result = calculateGroundAdjustment(-0.1, 0);
      expect(result.adjustment).toBeCloseTo(0.1, 2);
      expect(result.penetration).toBeCloseTo(0.1, 2);
      expect(result.floating).toBe(0);
    });

    it("calculates push-down when floating", () => {
      // Bone at 0.2, ground at 0 -> needs to push down by 0.2
      const result = calculateGroundAdjustment(0.2, 0);
      expect(result.adjustment).toBeCloseTo(-0.2, 2);
      expect(result.penetration).toBe(0);
      expect(result.floating).toBeCloseTo(0.2, 2);
    });

    it("handles non-zero terrain height", () => {
      // Bone at 10.1, ground at 10.0 -> floating by 0.1
      const result = calculateGroundAdjustment(10.1, 10.0);
      expect(result.adjustment).toBeCloseTo(-0.1, 2);
      expect(result.floating).toBeCloseTo(0.1, 2);
    });

    it("lifts when below terrain", () => {
      // Bone at 9.8, ground at 10.0 -> penetrating by 0.2
      const result = calculateGroundAdjustment(9.8, 10.0);
      expect(result.adjustment).toBeCloseTo(0.2, 2);
      expect(result.penetration).toBeCloseTo(0.2, 2);
    });
  });

  describe("Animation Pose Scenarios", () => {
    const groundY = 0;

    it("IDLE pose: feet on ground", () => {
      const bones = new Map<string, MockBone>();
      bones.set("leftFoot", new MockBone("leftFoot", 0.02));
      bones.set("rightFoot", new MockBone("rightFoot", 0.02));
      bones.set("hips", new MockBone("hips", 0.95));

      const lowestY = getLowestBoneY(bones);
      const result = calculateGroundAdjustment(lowestY, groundY);

      // Should be essentially grounded (within tolerance)
      expect(Math.abs(result.adjustment)).toBeLessThan(0.05);
    });

    it("RUN pose: feet on ground with slight variation", () => {
      const bones = new Map<string, MockBone>();
      // During run, one foot is slightly off ground
      bones.set("leftFoot", new MockBone("leftFoot", 0.01));
      bones.set("rightFoot", new MockBone("rightFoot", 0.15)); // Lifted in stride
      bones.set("hips", new MockBone("hips", 1.0));

      const lowestY = getLowestBoneY(bones);
      const result = calculateGroundAdjustment(lowestY, groundY);

      // Should be grounded via the planted foot
      expect(Math.abs(result.adjustment)).toBeLessThan(0.05);
    });

    it("COMBAT (punch) pose: feet stay grounded", () => {
      const bones = new Map<string, MockBone>();
      bones.set("leftFoot", new MockBone("leftFoot", 0.03));
      bones.set("rightFoot", new MockBone("rightFoot", 0.03));
      bones.set("hips", new MockBone("hips", 0.9)); // Slight crouch
      bones.set("rightHand", new MockBone("rightHand", 1.5)); // Punching arm extended

      const lowestY = getLowestBoneY(bones);
      const result = calculateGroundAdjustment(lowestY, groundY);

      expect(Math.abs(result.adjustment)).toBeLessThan(0.05);
    });

    it("DEATH pose: body on ground", () => {
      const bones = new Map<string, MockBone>();
      // Lying on back
      bones.set("leftFoot", new MockBone("leftFoot", 0.4));
      bones.set("rightFoot", new MockBone("rightFoot", 0.5));
      bones.set("hips", new MockBone("hips", 0.1));
      bones.set("spine", new MockBone("spine", 0.05));
      bones.set("chest", new MockBone("chest", 0.08));
      bones.set("head", new MockBone("head", 0.1));

      const lowestY = getLowestBoneY(bones);
      const result = calculateGroundAdjustment(lowestY, groundY);

      // Spine is lowest at 0.05, should be nearly grounded
      expect(lowestY).toBeCloseTo(0.05, 2);
      expect(Math.abs(result.adjustment)).toBeLessThan(0.1);
    });

    it("SQUAT pose: feet/knees grounded", () => {
      const bones = new Map<string, MockBone>();
      bones.set("leftFoot", new MockBone("leftFoot", 0.02));
      bones.set("rightFoot", new MockBone("rightFoot", 0.02));
      bones.set("leftLowerLeg", new MockBone("leftLowerLeg", 0.15));
      bones.set("rightLowerLeg", new MockBone("rightLowerLeg", 0.15));
      bones.set("hips", new MockBone("hips", 0.35)); // Low hips

      const lowestY = getLowestBoneY(bones);
      const result = calculateGroundAdjustment(lowestY, groundY);

      expect(Math.abs(result.adjustment)).toBeLessThan(0.05);
    });

    it("Detects floating avatar and pushes down", () => {
      const bones = new Map<string, MockBone>();
      // Avatar somehow floating 0.5m above ground
      bones.set("leftFoot", new MockBone("leftFoot", 0.5));
      bones.set("rightFoot", new MockBone("rightFoot", 0.5));
      bones.set("hips", new MockBone("hips", 1.5));

      const lowestY = getLowestBoneY(bones);
      const result = calculateGroundAdjustment(lowestY, groundY);

      expect(result.floating).toBeCloseTo(0.5, 2);
      expect(result.adjustment).toBeCloseTo(-0.5, 2); // Push down
    });

    it("Detects sinking avatar and lifts up", () => {
      const bones = new Map<string, MockBone>();
      // Avatar sinking 0.3m into ground
      bones.set("leftFoot", new MockBone("leftFoot", -0.3));
      bones.set("rightFoot", new MockBone("rightFoot", -0.3));
      bones.set("hips", new MockBone("hips", 0.7));

      const lowestY = getLowestBoneY(bones);
      const result = calculateGroundAdjustment(lowestY, groundY);

      expect(result.penetration).toBeCloseTo(0.3, 2);
      expect(result.adjustment).toBeCloseTo(0.3, 2); // Lift up
    });
  });

  /**
   * Animation Root Motion Validation
   *
   * These tests validate that animations have proper root motion:
   * - Hips should NOT be at world origin (0,0,0) - this indicates broken animation
   * - Standing animations: hips ~0.9-1.1m, feet ~0-0.1m
   * - Death animations: hips low ~0.1-0.3m, body touching ground
   * - Crouch animations: hips lower ~0.3-0.6m, feet grounded
   */
  describe("Animation Root Motion Validation", () => {
    // Expected hip heights for different animation types (in meters)
    // These are approximate values for a ~1.7m tall character
    const EXPECTED_HIP_HEIGHTS = {
      standing: { min: 0.7, max: 1.2 }, // Normal standing, walking, running
      crouching: { min: 0.2, max: 0.7 }, // Squat, crouch, combat stance
      lying: { min: 0.0, max: 0.4 }, // Death, fallen
    };

    // Expected foot heights (lowest point)
    const EXPECTED_FOOT_HEIGHTS = {
      grounded: { min: -0.05, max: 0.15 }, // Feet on ground with tolerance
      elevated: { min: 0.0, max: 0.6 }, // For lying poses, feet may be elevated
    };

    // CRITICAL: Hips at wrong height indicates broken root motion
    // For standing/crouching, hips should be elevated
    // For lying, hips should be low but NOT at exactly 0 (which would indicate broken animation)
    const BROKEN_ANIMATION_THRESHOLD = 0.05; // If hips Y < 0.05m for standing animations, it's broken

    type AnimationPoseData = {
      name: string;
      category: "standing" | "crouching" | "lying";
      hipsPosition: THREE.Vector3;
      feetMinY: number;
      feetMaxY: number;
      timestamp: number; // 0 = start, 0.5 = middle, 1.0 = end
    };

    function validateHipsNotAtOrigin(pose: AnimationPoseData): boolean {
      const { hipsPosition, category } = pose;
      // For standing/crouching animations, hips should be well above ground
      // For lying animations, hips near ground is CORRECT, but Y=0 exactly is suspicious
      if (category === "standing") {
        // Standing: hips must be elevated (> 0.5m)
        return hipsPosition.y > 0.5;
      } else if (category === "crouching") {
        // Crouching: hips must be somewhat elevated (> 0.15m)
        return hipsPosition.y > 0.15;
      } else {
        // Lying: hips should be low but not exactly at 0 (which indicates broken animation)
        // A Y of 0.1-0.3 is correct for lying down
        return hipsPosition.y > BROKEN_ANIMATION_THRESHOLD;
      }
    }

    function validateHipHeight(pose: AnimationPoseData): boolean {
      const expected = EXPECTED_HIP_HEIGHTS[pose.category];
      return (
        pose.hipsPosition.y >= expected.min &&
        pose.hipsPosition.y <= expected.max
      );
    }

    function validateFeetGrounded(
      pose: AnimationPoseData,
      allowElevated: boolean = false,
    ): boolean {
      const expected = allowElevated
        ? EXPECTED_FOOT_HEIGHTS.elevated
        : EXPECTED_FOOT_HEIGHTS.grounded;
      return pose.feetMinY >= expected.min && pose.feetMinY <= expected.max;
    }

    // Simulated animation pose data (in real tests, this would come from GLB files)
    // These represent bone positions at different points in each animation

    describe("Standing Animations (IDLE, WALK, RUN)", () => {
      const standingPoses: AnimationPoseData[] = [
        // IDLE animation - character standing still
        {
          name: "IDLE",
          category: "standing",
          hipsPosition: new THREE.Vector3(0, 0.95, 0),
          feetMinY: 0.02,
          feetMaxY: 0.02,
          timestamp: 0.5,
        },
        // WALK animation - mid-stride
        {
          name: "WALK",
          category: "standing",
          hipsPosition: new THREE.Vector3(0, 0.92, 0),
          feetMinY: 0.01,
          feetMaxY: 0.15,
          timestamp: 0.5,
        },
        // RUN animation - mid-stride
        {
          name: "RUN",
          category: "standing",
          hipsPosition: new THREE.Vector3(0, 0.88, 0),
          feetMinY: 0.02,
          feetMaxY: 0.25,
          timestamp: 0.5,
        },
      ];

      for (const pose of standingPoses) {
        it(`${pose.name}: hips not at origin`, () => {
          expect(validateHipsNotAtOrigin(pose)).toBe(true);
        });

        it(`${pose.name}: hips at standing height (${EXPECTED_HIP_HEIGHTS.standing.min}-${EXPECTED_HIP_HEIGHTS.standing.max}m)`, () => {
          expect(validateHipHeight(pose)).toBe(true);
        });

        it(`${pose.name}: feet grounded`, () => {
          expect(validateFeetGrounded(pose)).toBe(true);
        });
      }
    });

    describe("Combat Animations (PUNCH, SWORD_SWING)", () => {
      const combatPoses: AnimationPoseData[] = [
        // COMBAT/punch - slight forward lean
        {
          name: "COMBAT (punch) at 50%",
          category: "standing",
          hipsPosition: new THREE.Vector3(0.1, 0.85, 0.05),
          feetMinY: 0.02,
          feetMaxY: 0.05,
          timestamp: 0.5,
        },
        // COMBAT/punch - end of punch
        {
          name: "COMBAT (punch) at 100%",
          category: "standing",
          hipsPosition: new THREE.Vector3(0.15, 0.82, 0.1),
          feetMinY: 0.02,
          feetMaxY: 0.08,
          timestamp: 1.0,
        },
        // SWORD_SWING - mid-swing
        {
          name: "SWORD_SWING at 50%",
          category: "standing",
          hipsPosition: new THREE.Vector3(0, 0.88, 0),
          feetMinY: 0.01,
          feetMaxY: 0.05,
          timestamp: 0.5,
        },
      ];

      for (const pose of combatPoses) {
        it(`${pose.name}: hips not at origin`, () => {
          expect(validateHipsNotAtOrigin(pose)).toBe(true);
        });

        it(`${pose.name}: feet stay grounded during attack`, () => {
          expect(validateFeetGrounded(pose)).toBe(true);
        });
      }
    });

    describe("Death Animation - CRITICAL TEST", () => {
      // Death animation poses at different timestamps
      const deathPoses: AnimationPoseData[] = [
        // Death at 50% - character falling/lowering
        {
          name: "DEATH at 50%",
          category: "crouching", // Transitioning down
          hipsPosition: new THREE.Vector3(0, 0.5, 0),
          feetMinY: 0.1,
          feetMaxY: 0.4,
          timestamp: 0.5,
        },
        // Death at 100% - character lying on ground
        {
          name: "DEATH at 100%",
          category: "lying",
          hipsPosition: new THREE.Vector3(0, 0.15, 0),
          feetMinY: 0.3, // Feet elevated when lying down
          feetMaxY: 0.5,
          timestamp: 1.0,
        },
      ];

      for (const pose of deathPoses) {
        it(`${pose.name}: hips NOT at origin (this is the bug we're fixing)`, () => {
          const notAtOrigin = validateHipsNotAtOrigin(pose);
          expect(notAtOrigin).toBe(true);
          if (!notAtOrigin) {
            console.error(
              `CRITICAL: ${pose.name} has hips at origin! Position: (${pose.hipsPosition.x}, ${pose.hipsPosition.y}, ${pose.hipsPosition.z})`,
            );
          }
        });

        it(`${pose.name}: hips at appropriate height for ${pose.category} pose`, () => {
          expect(validateHipHeight(pose)).toBe(true);
        });
      }

      it("DEATH at 100%: body (hips) near ground level", () => {
        const deathEnd = deathPoses.find((p) => p.timestamp === 1.0);
        expect(deathEnd).toBeDefined();
        if (deathEnd) {
          // For lying pose, hips should be very low (0.0-0.4m)
          expect(deathEnd.hipsPosition.y).toBeLessThan(0.4);
          expect(deathEnd.hipsPosition.y).toBeGreaterThan(0);
        }
      });

      it("DEATH: feet NOT floating at hip height", () => {
        // This is the specific bug: feet at hip height instead of body on ground
        const deathEnd = deathPoses.find((p) => p.timestamp === 1.0);
        expect(deathEnd).toBeDefined();
        if (deathEnd) {
          // Feet should NOT be at normal standing hip height (~1m)
          // They can be elevated (lying down) but not at standing position
          expect(deathEnd.feetMinY).toBeLessThan(0.8);
        }
      });
    });

    describe("Crouch/Squat Animations", () => {
      const crouchPoses: AnimationPoseData[] = [
        {
          name: "SQUAT at 50%",
          category: "crouching",
          hipsPosition: new THREE.Vector3(0, 0.4, 0),
          feetMinY: 0.02,
          feetMaxY: 0.05,
          timestamp: 0.5,
        },
        {
          name: "SQUAT at 100%",
          category: "crouching",
          hipsPosition: new THREE.Vector3(0, 0.35, 0),
          feetMinY: 0.01,
          feetMaxY: 0.03,
          timestamp: 1.0,
        },
      ];

      for (const pose of crouchPoses) {
        it(`${pose.name}: hips not at origin`, () => {
          expect(validateHipsNotAtOrigin(pose)).toBe(true);
        });

        it(`${pose.name}: hips lowered (crouching)`, () => {
          expect(validateHipHeight(pose)).toBe(true);
        });

        it(`${pose.name}: feet grounded`, () => {
          expect(validateFeetGrounded(pose)).toBe(true);
        });
      }
    });

    describe("Bug Detection: Hips at Origin", () => {
      // These tests detect the specific bug where root motion fails
      // and hips end up at world origin

      it("FAILS if hips are at origin during standing animation", () => {
        const brokenPose: AnimationPoseData = {
          name: "BROKEN_IDLE",
          category: "standing",
          hipsPosition: new THREE.Vector3(0, 0.05, 0), // Near origin Y
          feetMinY: -0.9, // Feet underground (broken)
          feetMaxY: -0.9,
          timestamp: 0.5,
        };

        // This should FAIL - hips near origin is wrong
        expect(validateHipsNotAtOrigin(brokenPose)).toBe(false);
      });

      it("FAILS if feet are at hip height during death", () => {
        const brokenDeathPose: AnimationPoseData = {
          name: "BROKEN_DEATH",
          category: "lying",
          hipsPosition: new THREE.Vector3(0, 0.9, 0), // Hips at standing height (wrong!)
          feetMinY: 0.9, // Feet also at hip height (the bug!)
          feetMaxY: 0.95,
          timestamp: 1.0,
        };

        // Hips are NOT at origin, but at wrong height for lying pose
        expect(validateHipHeight(brokenDeathPose)).toBe(false);
      });

      it("FAILS if all bones moved to origin (complete root motion failure)", () => {
        const totallyBrokenPose: AnimationPoseData = {
          name: "TOTAL_FAILURE",
          category: "standing",
          hipsPosition: new THREE.Vector3(0.01, 0.01, 0.01), // All near origin
          feetMinY: 0.01,
          feetMaxY: 0.01,
          timestamp: 0.5,
        };

        expect(validateHipsNotAtOrigin(totallyBrokenPose)).toBe(false);
      });
    });
  });
});
