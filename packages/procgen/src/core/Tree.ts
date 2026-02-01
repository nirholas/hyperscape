/**
 * Tree Generation Class
 *
 * Main class for generating procedural trees using the Weber & Penn algorithm.
 * This is a direct port of the Python gen.py implementation.
 *
 * The algorithm works by:
 * 1. Creating a turtle at the tree base
 * 2. Recursively building stems (branches) by moving the turtle
 * 3. Recording Bezier curve points as the turtle moves
 * 4. Placing leaves at the deepest branch level
 *
 * Reference: Weber & Penn "Creation and Rendering of Realistic Trees"
 */

import * as THREE from "three";
import { SeededRandom, randInRange } from "../math/Random.js";
import { declination, radians } from "../math/Vector3.js";
import {
  calcPointOnBezier,
  calcTangentToBezier,
  type BezierSplinePoint,
} from "../math/Bezier.js";
import {
  calcHelixPoints,
  calcHelixPitch,
  calcHelixRadius,
} from "../math/Helix.js";
import {
  Turtle,
  applyTropism,
  makeBranchPosTurtle,
  makeBranchDirTurtle,
} from "./Turtle.js";
import { Stem, scaleBezierHandlesForFlare } from "./Stem.js";
import { Leaf } from "./Leaf.js";
import { shapeRatio, pointInsideEnvelope } from "./ShapeRatio.js";
import {
  BranchMode,
  TreeShape,
  type TreeParams,
  type TreeData,
  type TreeGenerationOptions,
  type StemData,
  type LeafData,
} from "../types.js";

/**
 * Tree generator using the Weber & Penn parametric algorithm.
 */
export class Tree {
  /** Tree parameters */
  private readonly params: TreeParams;

  /** Random number generator */
  private readonly rng: SeededRandom;

  /** Whether to generate leaves */
  private readonly generateLeaves: boolean;

  /** All generated stems */
  private stems: Stem[] = [];

  /** All generated leaves */
  private leaves: Leaf[] = [];

  /** Radius at each point for each stem (parallel arrays) */
  private stemRadii: Map<Stem, number[]> = new Map();

  /** Current stem index (for tracking) */
  private stemIndex = 0;

  /** Overall tree scale (with variation applied) */
  private treeScale = 0;

  /** Base length (portion of trunk with no branches) */
  private baseLength = 0;

  /** Trunk length */
  private trunkLength = 0;

  /** Floyd-Steinberg error accumulator for splits */
  private splitNumError: number[] = [0, 0, 0, 0, 0, 0, 0];

  /** The seed used for generation */
  private readonly seed: number;

  /**
   * Create a new tree generator.
   *
   * @param params - Tree parameters
   * @param options - Generation options
   */
  constructor(params: TreeParams, options: TreeGenerationOptions = {}) {
    this.params = params;
    this.seed = options.seed ?? Math.floor(Math.random() * 9999999);
    this.rng = new SeededRandom(this.seed);
    this.generateLeaves = options.generateLeaves ?? true;

    // Disable leaves if leafBlosNum is 0
    if (params.leafBlosNum === 0) {
      // Keep generateLeaves as requested but it will produce no leaves
    }
  }

  /**
   * Generate the tree.
   *
   * @returns Complete tree data
   */
  generate(): TreeData {
    // Reset state
    this.stems = [];
    this.leaves = [];
    this.stemRadii = new Map();
    this.stemIndex = 0;
    this.splitNumError = [0, 0, 0, 0, 0, 0, 0];

    // Generate trunk(s)
    this.createBranches();

    // Assign indices to all stems
    for (let i = 0; i < this.stems.length; i++) {
      this.stems[i]!.index = i;
    }

    // Convert to output format
    const stemData: StemData[] = this.stems.map((stem) => {
      const radii = this.stemRadii.get(stem) ?? [];
      return stem.toData(radii);
    });

    const leafData: LeafData[] = this.leaves.map((leaf) => leaf.toData());

    return {
      stems: stemData,
      leaves: leafData,
      params: this.params,
      seed: this.seed,
      treeScale: this.treeScale,
      trunkLength: this.trunkLength,
      baseLength: this.baseLength,
    };
  }

  /**
   * Calculate points for floor split (multiple trunks).
   * Returns positions and angles for each trunk.
   */
  private pointsForFloorSplit(): Array<{ pos: THREE.Vector3; theta: number }> {
    const array: Array<{ pos: THREE.Vector3; theta: number }> = [];

    // Calculate approximate spacing radius
    this.treeScale = this.params.gScale + this.params.gScaleV;
    const dummyStem = new Stem(0);
    dummyStem.length = this.calcStemLength(dummyStem);
    const rad = 2.5 * this.calcStemRadius(dummyStem);

    // Generate points using rejection sampling
    for (let i = 0; i < this.params.branches[0]; i++) {
      let pointOk = false;
      while (!pointOk) {
        // Distance proportional to number of trunks
        const dis = Math.sqrt(
          ((this.rng.random() * this.params.branches[0]) / 2.5) *
            this.params.gScale *
            this.params.ratio,
        );
        const theta = randInRange(this.rng, 0, 2 * Math.PI);
        const pos = new THREE.Vector3(
          dis * Math.cos(theta),
          dis * Math.sin(theta),
          0,
        );

        // Check against existing points
        let pointMOk = true;
        for (const point of array) {
          if (point.pos.distanceTo(pos) < rad) {
            pointMOk = false;
            break;
          }
        }

        if (pointMOk) {
          pointOk = true;
          array.push({ pos, theta });
        }
      }
    }

    return array;
  }

  /**
   * Create all branches starting from the trunk(s).
   */
  private createBranches(): void {
    let points: Array<{ pos: THREE.Vector3; theta: number }> = [];
    // Only call pointsForFloorSplit for multiple trunks (branches[0] > 1)
    // Python: if self.param.branches[0] > 1: points = self.points_for_floor_split()
    if (this.params.branches[0] > 1) {
      points = this.pointsForFloorSplit();
    }

    for (let ind = 0; ind < this.params.branches[0]; ind++) {
      // Apply scale variation per trunk
      this.treeScale =
        this.params.gScale + this.rng.uniform(-1, 1) * this.params.gScaleV;

      // Initialize turtle
      const turtle = new Turtle();
      turtle.pos.set(0, 0, 0);
      turtle.dir.set(0, 0, 1);
      turtle.right.set(1, 0, 0);

      if (this.params.branches[0] > 1) {
        // Position at floor split point
        const point = points[ind]!;
        turtle.rollRight((point.theta * 180) / Math.PI - 90);
        turtle.pos.copy(point.pos);
      } else {
        // Start at random rotation
        turtle.rollRight(randInRange(this.rng, 0, 360));
      }

      // Create trunk stem
      const trunk = new Stem(0);
      this.stems.push(trunk);
      this.stemRadii.set(trunk, []);

      this.makeStem(turtle, trunk);
    }
  }

  /**
   * Generate a stem and all its children recursively.
   *
   * @param turtle - Current turtle state
   * @param stem - Stem being generated
   * @param start - Starting segment index
   * @param splitCorrAngle - Split correction angle
   * @param numBranchesFactor - Factor for branch count
   * @param cloneProb - Probability of cloning
   * @param posCorrTurtle - Position correction turtle
   * @param clonedTurtle - Original turtle for clones
   */
  private makeStem(
    turtle: Turtle,
    stem: Stem,
    start = 0,
    splitCorrAngle = 0,
    numBranchesFactor = 1,
    cloneProb = 1,
    posCorrTurtle?: Turtle,
    clonedTurtle?: Turtle,
  ): void {
    // Check if stem is too thin
    if (stem.radiusLimit >= 0 && stem.radiusLimit < 0.0001) {
      return;
    }

    this.stemIndex++;

    const depth = stem.depth;
    const dPlus1 = Math.min(depth + 1, 3);

    // Calculate length and radius for new stems
    if (start === 0) {
      stem.lengthChildMax =
        this.params.length[dPlus1] +
        this.rng.uniform(-1, 1) * this.params.lengthV[dPlus1];
      stem.length = this.calcStemLength(stem);
      stem.radius = this.calcStemRadius(stem);
      if (depth === 0) {
        this.baseLength = stem.length * this.params.baseSize[0];
      }
    }

    // Reposition branch origin if needed
    if (posCorrTurtle) {
      posCorrTurtle.move(-Math.min(stem.radius, stem.radiusLimit));
      turtle.pos.copy(posCorrTurtle.pos);
    }

    // Apply pruning
    if (!clonedTurtle && this.params.pruneRatio > 0) {
      const startLength = stem.length;
      const rState = this.rng.getState();
      const splitErrState = [...this.splitNumError];

      let inEnvelope = this.testStem(
        turtle.clone(),
        stem,
        start,
        splitCorrAngle,
        cloneProb,
      );

      while (!inEnvelope) {
        stem.length *= 0.9;
        if (stem.length < 0.15 * startLength) {
          if (this.params.pruneRatio < 1) {
            stem.length = 0;
            break;
          } else {
            return;
          }
        }
        this.rng.setState(rState);
        this.splitNumError = [...splitErrState];
        inEnvelope = this.testStem(
          turtle.clone(),
          stem,
          start,
          splitCorrAngle,
          cloneProb,
        );
      }

      const fittingLength = stem.length;
      stem.length =
        startLength * (1 - this.params.pruneRatio) +
        fittingLength * this.params.pruneRatio;
      stem.radius = this.calcStemRadius(stem);
      this.rng.setState(rState);
      this.splitNumError = [...splitErrState];
    }

    // Get parameters
    const curveRes = Math.floor(this.params.curveRes[depth]);
    const segSplits = this.params.segSplits[depth];
    const segLength = stem.length / curveRes;

    // Calculate base segment index
    const baseSegInd = Math.ceil(
      this.params.baseSize[0] * this.params.curveRes[0],
    );

    // Calculate leaf/branch count
    // Multi-level leaf distribution: allow leaves at levels-1, levels-2, etc.
    let leafCount = 0;
    let branchCount = 0;
    let fLeavesOnSeg = 0;
    let fBranchesOnSeg = 0;

    // Determine how many levels from the deepest this branch is
    const levelsFromDeepest = this.params.levels - 1 - depth;
    const leafDistLevels = this.params.leafDistributionLevels ?? 1;
    const secondaryScale = this.params.leafSecondaryScale ?? 0.5;

    // Check if this branch level should have leaves
    // Leaves appear on the deepest N levels (where N = leafDistributionLevels)
    const shouldHaveLeaves =
      depth > 0 &&
      this.params.leafBlosNum !== 0 &&
      levelsFromDeepest < leafDistLevels;

    // Check if this branch level should have child branches
    // Branches are created if we're not at the deepest level
    // (Secondary leaf levels can have BOTH leaves and branches)
    const shouldHaveBranches = depth < this.params.levels - 1;

    if (shouldHaveLeaves) {
      leafCount = this.calcLeafCount(stem);
      leafCount *= 1 - start / curveRes;

      // Scale down leaves for non-deepest levels (secondary, tertiary, etc.)
      if (levelsFromDeepest > 0) {
        // Secondary levels get fewer leaves to avoid overwhelming the tree
        // The deeper we go toward trunk, the fewer leaves
        leafCount *= Math.pow(secondaryScale, levelsFromDeepest);
      }

      fLeavesOnSeg = leafCount / curveRes;
    }

    // Also calculate branches if not at deepest level
    if (shouldHaveBranches) {
      branchCount = this.calcBranchCount(stem);
      branchCount *= 1 - start / curveRes;
      branchCount *= numBranchesFactor;
      fBranchesOnSeg = branchCount / curveRes;
    }

    // Point resolution for flared base
    const maxPointsPerSeg = Math.ceil(Math.max(1.0, 100 / curveRes));
    let pointsPerSeg: number;
    if (depth === 0 || this.params.taper[depth] > 1) {
      pointsPerSeg = maxPointsPerSeg;
    } else {
      pointsPerSeg = 2;
    }

    // Floyd-Steinberg error accumulators
    let branchNumError = 0;
    let leafNumError = 0;

    // Rotation tracking
    const prevRotationAngle = [0];
    if (this.params.rotate[dPlus1] >= 0) {
      prevRotationAngle[0] = randInRange(this.rng, 0, 360);
    } else {
      prevRotationAngle[0] = 1;
    }

    // Helix parameters
    let helP0: THREE.Vector3 | null = null;
    let helP1: THREE.Vector3 | null = null;
    let helP2: THREE.Vector3 | null = null;
    let helAxis: THREE.Vector3 | null = null;

    if (this.params.curveV[depth] < 0) {
      const helPitch = calcHelixPitch(stem.length, curveRes, this.rng);
      const helRadius = calcHelixRadius(
        helPitch,
        this.params.curveV[depth],
        this.rng,
      );

      // Apply tropism
      if (depth > 1) {
        applyTropism(turtle, new THREE.Vector3(...this.params.tropism));
      } else {
        applyTropism(
          turtle,
          new THREE.Vector3(this.params.tropism[0], this.params.tropism[1], 0),
        );
      }

      const helixResult = calcHelixPoints(
        turtle.dir,
        helRadius,
        helPitch,
        this.rng,
      );
      helP0 = helixResult.p0;
      helP1 = helixResult.p1;
      helP2 = helixResult.p2;
      helAxis = helixResult.axis;
    }

    // Get or create radius array for this stem
    let radii = this.stemRadii.get(stem);
    if (!radii) {
      radii = [];
      this.stemRadii.set(stem, radii);
    }

    // Main segment loop
    for (let segInd = start; segInd <= curveRes; segInd++) {
      const remainingSegs = curveRes + 1 - segInd;

      // Set up next Bezier point
      if (this.params.curveV[depth] < 0) {
        // Helix branch
        this.makeHelixPoint(
          turtle,
          stem,
          segInd,
          helP0!,
          helP1!,
          helP2!,
          helAxis!,
          radii,
        );
      } else {
        // Normal curved branch
        this.makeNormalPoint(
          turtle,
          stem,
          segInd,
          start,
          segLength,
          clonedTurtle,
          radii,
        );
      }

      // Set radius
      const actualRadius = this.radiusAtOffset(stem, segInd / curveRes);
      radii.push(actualRadius);

      if (segInd > start) {
        // Calculate splits
        let numOfSplits = 0;
        if (this.params.curveV[depth] >= 0) {
          if (
            this.params.baseSplits > 0 &&
            depth === 0 &&
            segInd === baseSegInd
          ) {
            if (this.params.baseSplits < 0) {
              numOfSplits = Math.floor(
                this.rng.random() * (Math.abs(this.params.baseSplits) + 0.5),
              );
            } else {
              numOfSplits = Math.floor(this.params.baseSplits);
            }
          } else if (
            segSplits > 0 &&
            segInd < curveRes &&
            (depth > 0 || segInd > baseSegInd)
          ) {
            if (this.rng.random() <= cloneProb) {
              numOfSplits = Math.floor(segSplits + this.splitNumError[depth]!);
              this.splitNumError[depth] =
                this.splitNumError[depth]! - numOfSplits + segSplits;

              cloneProb /= numOfSplits + 1;
              numBranchesFactor /= numOfSplits + 1;
              numBranchesFactor = Math.max(0.8, numBranchesFactor);

              branchCount *= numBranchesFactor;
              fBranchesOnSeg = branchCount / curveRes;
            }
          }
        }

        // Add branches and/or leaves
        // Note: With multi-level leaf distribution, secondary leaf levels can have
        // BOTH branches AND leaves on the same segment
        const rState = this.rng.getState();

        // Generate branches (if not at deepest level)
        if (Math.abs(branchCount) > 0 && depth < this.params.levels - 1) {
          let branchesOnSeg: number;
          if (branchCount < 0) {
            // Fan branches at end
            branchesOnSeg = segInd === curveRes ? Math.floor(branchCount) : 0;
          } else {
            branchesOnSeg = Math.floor(fBranchesOnSeg + branchNumError);
            branchNumError -= branchesOnSeg - fBranchesOnSeg;
          }

          if (Math.abs(branchesOnSeg) > 0) {
            this.makeBranches(
              turtle,
              stem,
              segInd,
              branchesOnSeg,
              prevRotationAngle,
              false,
            );
          }
        }

        // Generate leaves (if on a leaf-bearing level)
        // This is now independent of branch generation for multi-level distribution
        if (Math.abs(leafCount) > 0 && depth > 0 && this.generateLeaves) {
          let leavesOnSeg: number;
          if (leafCount < 0) {
            // Fan leaves at end
            leavesOnSeg = segInd === curveRes ? leafCount : 0;
          } else {
            leavesOnSeg = Math.floor(fLeavesOnSeg + leafNumError);
            leafNumError -= leavesOnSeg - fLeavesOnSeg;
          }

          if (Math.abs(leavesOnSeg) > 0) {
            this.makeLeaves(
              turtle,
              stem,
              segInd,
              leavesOnSeg,
              prevRotationAngle,
            );
          }
        }

        this.rng.setState(rState);

        // Handle splits and curves
        if (this.params.curveV[depth] >= 0) {
          if (numOfSplits > 0) {
            const isBaseSplit =
              this.params.baseSplits > 0 &&
              depth === 0 &&
              segInd === baseSegInd;
            const usingDirectSplit = this.params.splitAngle[depth] < 0;

            let sprAngle: number;
            let splAngle: number;

            if (usingDirectSplit) {
              sprAngle =
                Math.abs(this.params.splitAngle[depth]) +
                this.rng.uniform(-1, 1) * this.params.splitAngleV[depth];
              splAngle = 0;
              splitCorrAngle = 0;
            } else {
              const decl = declination(turtle.dir);
              splAngle =
                this.params.splitAngle[depth] +
                this.rng.uniform(-1, 1) * this.params.splitAngleV[depth] -
                decl;
              splAngle = Math.max(0, splAngle);
              splitCorrAngle = splAngle / remainingSegs;
              sprAngle = -(
                20 +
                0.75 * (30 + Math.abs(decl - 90) * this.rng.random() ** 2)
              );
            }

            // Make clone branches
            const cloneRState = this.rng.getState();
            this.makeClones(
              turtle,
              segInd,
              splitCorrAngle,
              numBranchesFactor,
              cloneProb,
              stem,
              numOfSplits,
              splAngle,
              sprAngle,
              isBaseSplit,
            );
            this.rng.setState(cloneRState);

            // Apply split to base stem
            turtle.pitchDown(splAngle / 2);

            // Apply spread if not base split and only 2-way split
            if (!isBaseSplit && numOfSplits === 1) {
              if (usingDirectSplit) {
                turtle.turnRight(sprAngle / 2);
              } else {
                const quat = new THREE.Quaternion().setFromAxisAngle(
                  new THREE.Vector3(0, 0, 1),
                  radians(-sprAngle / 2),
                );
                turtle.dir.applyQuaternion(quat).normalize();
                turtle.right.applyQuaternion(quat).normalize();
              }
            }
          } else {
            // Apply curve and split correction
            turtle.turnLeft(
              (this.rng.uniform(-1, 1) * this.params.bendV[depth]) / curveRes,
            );
            const curveAngle = this.calcCurveAngle(depth, segInd);
            turtle.pitchDown(curveAngle - splitCorrAngle);
          }

          // Apply tropism
          if (depth > 1) {
            applyTropism(turtle, new THREE.Vector3(...this.params.tropism));
          } else {
            applyTropism(
              turtle,
              new THREE.Vector3(
                this.params.tropism[0],
                this.params.tropism[1],
                0,
              ),
            );
          }
        }

        // Increase point resolution for flared base
        if (pointsPerSeg > 2) {
          this.increaseBezierPointRes(stem, segInd, pointsPerSeg, radii);
        }
      }
    }

    // Scale handles for flared base
    if (pointsPerSeg > 2) {
      scaleBezierHandlesForFlare(stem, maxPointsPerSeg);
    }
  }

  /**
   * Make a helix-style branch point.
   */
  private makeHelixPoint(
    turtle: Turtle,
    stem: Stem,
    segInd: number,
    helP0: THREE.Vector3,
    helP1: THREE.Vector3,
    helP2: THREE.Vector3,
    helAxis: THREE.Vector3,
    _radii: number[],
  ): void {
    const pos = turtle.pos.clone();

    if (segInd === 0) {
      // First point
      stem.curvePoints.push({
        co: pos.clone(),
        handleLeft: pos.clone(),
        handleRight: helP0.clone().add(pos),
      });
    } else {
      let newCo: THREE.Vector3;
      let handleLeft: THREE.Vector3;

      if (segInd === 1) {
        newCo = helP2.clone().add(pos);
        handleLeft = helP1.clone().add(pos);
      } else {
        const prevPoint = stem.curvePoints[stem.curvePoints.length - 1]!;
        const rotQuat = new THREE.Quaternion().setFromAxisAngle(
          helAxis,
          (segInd - 1) * Math.PI,
        );
        newCo = helP2.clone().applyQuaternion(rotQuat).add(prevPoint.co);
        const difP = helP2.clone().sub(helP1).applyQuaternion(rotQuat);
        handleLeft = newCo.clone().sub(difP);
      }

      const handleRight = newCo.clone().multiplyScalar(2).sub(handleLeft);

      stem.curvePoints.push({
        co: newCo,
        handleLeft,
        handleRight,
      });

      turtle.pos.copy(newCo);
      turtle.dir.copy(handleRight).normalize();
    }
  }

  /**
   * Make a normal (non-helix) branch point.
   */
  private makeNormalPoint(
    turtle: Turtle,
    stem: Stem,
    segInd: number,
    start: number,
    segLength: number,
    clonedTurtle: Turtle | undefined,
    _radii: number[],
  ): void {
    const curveRes = Math.floor(this.params.curveRes[stem.depth]);

    if (segInd === start) {
      // First point
      const handleLength = stem.length / (curveRes * 3);
      stem.curvePoints.push({
        co: turtle.pos.clone(),
        handleLeft: turtle.pos
          .clone()
          .sub(turtle.dir.clone().multiplyScalar(handleLength)),
        handleRight: turtle.pos
          .clone()
          .add(turtle.dir.clone().multiplyScalar(handleLength)),
      });
    } else {
      // Move turtle
      turtle.move(segLength);

      const handleLength = stem.length / (curveRes * 3);

      // For clones, use original direction initially
      let handleDir: THREE.Vector3;
      if (clonedTurtle && segInd === start) {
        handleDir = clonedTurtle.dir;
      } else {
        handleDir = turtle.dir;
      }

      stem.curvePoints.push({
        co: turtle.pos.clone(),
        handleLeft: turtle.pos
          .clone()
          .sub(handleDir.clone().multiplyScalar(handleLength)),
        handleRight: turtle.pos
          .clone()
          .add(handleDir.clone().multiplyScalar(handleLength)),
      });
    }
  }

  /**
   * Test if a stem is inside the pruning envelope.
   */
  private testStem(
    turtle: Turtle,
    stem: Stem,
    start: number,
    splitCorrAngle: number,
    cloneProb: number,
  ): boolean {
    const depth = stem.depth;
    const dPlus1 = Math.min(depth + 1, 3);
    const curveRes = Math.floor(this.params.curveRes[depth]);
    const segSplits = this.params.segSplits[depth];
    const segLength = stem.length / curveRes;
    const baseSegInd = Math.ceil(
      this.params.baseSize[0] * this.params.curveRes[0],
    );

    const prevRotationAngle = [0];
    if (this.params.rotate[dPlus1] >= 0) {
      prevRotationAngle[0] = randInRange(this.rng, 0, 360);
    } else {
      prevRotationAngle[0] = 1;
    }

    // Helix setup
    let helP2: THREE.Vector3 | null = null;
    let helAxis: THREE.Vector3 | null = null;
    let previousHelixPoint: THREE.Vector3 | null = null;

    if (this.params.curveV[depth] < 0) {
      const helPitch = calcHelixPitch(stem.length, curveRes, this.rng);
      const helRadius = calcHelixRadius(
        helPitch,
        this.params.curveV[depth],
        this.rng,
      );

      if (depth > 1) {
        applyTropism(turtle, new THREE.Vector3(...this.params.tropism));
      } else {
        applyTropism(
          turtle,
          new THREE.Vector3(this.params.tropism[0], this.params.tropism[1], 0),
        );
      }

      const helixResult = calcHelixPoints(
        turtle.dir,
        helRadius,
        helPitch,
        this.rng,
      );
      helP2 = helixResult.p2;
      helAxis = helixResult.axis;
    }

    for (let segInd = start; segInd <= curveRes; segInd++) {
      const remainingSegs = curveRes + 1 - segInd;

      if (this.params.curveV[depth] < 0) {
        // Helix
        const pos = turtle.pos.clone();
        if (segInd === 0) {
          turtle.pos.copy(pos);
        } else if (segInd === 1) {
          turtle.pos.copy(helP2!.clone().add(pos));
        } else {
          const rotQuat = new THREE.Quaternion().setFromAxisAngle(
            helAxis!,
            (segInd - 1) * Math.PI,
          );
          turtle.pos.copy(
            helP2!.clone().applyQuaternion(rotQuat).add(previousHelixPoint!),
          );
        }
        previousHelixPoint = turtle.pos.clone();
      } else {
        // Normal
        if (segInd !== start) {
          turtle.move(segLength);
          if (!(stem.depth === 0 && start < baseSegInd)) {
            if (!this.pointInside(turtle.pos)) {
              return false;
            }
          }
        }
      }

      if (segInd > start) {
        // Calculate splits
        let numOfSplits = 0;
        if (this.params.curveV[depth] >= 0) {
          if (
            this.params.baseSplits > 0 &&
            depth === 0 &&
            segInd === baseSegInd
          ) {
            numOfSplits = Math.floor(
              this.rng.random() * (this.params.baseSplits + 0.5),
            );
          } else if (
            segSplits > 0 &&
            segInd < curveRes &&
            (depth > 0 || segInd > baseSegInd)
          ) {
            if (this.rng.random() <= cloneProb) {
              numOfSplits = Math.floor(segSplits + this.splitNumError[depth]!);
              this.splitNumError[depth] =
                this.splitNumError[depth]! - numOfSplits + segSplits;
              cloneProb /= numOfSplits + 1;
            }
          }

          if (numOfSplits > 0) {
            const isBaseSplit =
              this.params.baseSplits > 0 &&
              depth === 0 &&
              segInd === baseSegInd;
            const usingDirectSplit = this.params.splitAngle[depth] < 0;

            let sprAngle: number;
            let splAngle: number;

            if (usingDirectSplit) {
              sprAngle =
                Math.abs(this.params.splitAngle[depth]) +
                this.rng.uniform(-1, 1) * this.params.splitAngleV[depth];
              splAngle = 0;
              splitCorrAngle = 0;
            } else {
              const decl = declination(turtle.dir);
              splAngle =
                this.params.splitAngle[depth] +
                this.rng.uniform(-1, 1) * this.params.splitAngleV[depth] -
                decl;
              splAngle = Math.max(0, splAngle);
              splitCorrAngle = splAngle / remainingSegs;
              sprAngle = -(
                20 +
                0.75 * (30 + Math.abs(decl - 90) * this.rng.random() ** 2)
              );
            }

            turtle.pitchDown(splAngle / 2);

            if (!isBaseSplit && numOfSplits === 1) {
              if (usingDirectSplit) {
                turtle.turnLeft(sprAngle / 2);
              } else {
                const quat = new THREE.Quaternion().setFromAxisAngle(
                  new THREE.Vector3(0, 0, 1),
                  radians(-sprAngle / 2),
                );
                turtle.dir.applyQuaternion(quat).normalize();
                turtle.right.applyQuaternion(quat).normalize();
              }
            }
          } else {
            turtle.turnLeft(
              (this.rng.uniform(-1, 1) * this.params.bendV[depth]) / curveRes,
            );
            const curveAngle = this.calcCurveAngle(depth, segInd);
            turtle.pitchDown(curveAngle - splitCorrAngle);
          }

          if (depth > 1) {
            applyTropism(turtle, new THREE.Vector3(...this.params.tropism));
          } else {
            applyTropism(
              turtle,
              new THREE.Vector3(
                this.params.tropism[0],
                this.params.tropism[1],
                0,
              ),
            );
          }
        }
      }
    }

    return this.pointInside(turtle.pos);
  }

  /**
   * Make clone branches (splits).
   */
  private makeClones(
    turtle: Turtle,
    segInd: number,
    splitCorrAngle: number,
    numBranchesFactor: number,
    cloneProb: number,
    stem: Stem,
    numOfSplits: number,
    splAngle: number,
    sprAngle: number,
    isBaseSplit: boolean,
  ): void {
    const usingDirectSplit = this.params.splitAngle[stem.depth] < 0;
    const splitAngleV = this.params.splitAngleV[stem.depth];

    if (!isBaseSplit && numOfSplits > 2 && usingDirectSplit) {
      throw new Error("Only splitting up to 3 branches is supported");
    }

    for (let splitIndex = 0; splitIndex < numOfSplits; splitIndex++) {
      // Copy turtle
      const nTurtle = turtle.clone();
      nTurtle.pitchDown(splAngle / 2);

      // Calculate spread angle
      let effSprAngle: number;
      if (isBaseSplit && !usingDirectSplit) {
        effSprAngle =
          (splitIndex + 1) * (360 / (numOfSplits + 1)) +
          this.rng.uniform(-1, 1) * splitAngleV;
      } else {
        effSprAngle = splitIndex === 0 ? sprAngle / 2 : -sprAngle / 2;
      }

      if (usingDirectSplit) {
        nTurtle.turnLeft(effSprAngle);
      } else {
        const quat = new THREE.Quaternion().setFromAxisAngle(
          new THREE.Vector3(0, 0, 1),
          radians(effSprAngle),
        );
        nTurtle.dir.applyQuaternion(quat).normalize();
        nTurtle.right.applyQuaternion(quat).normalize();
      }

      // Create new clone stem
      const newStem = stem.copy();
      this.stems.push(newStem);
      this.stemRadii.set(newStem, []);

      const cloned =
        this.params.splitAngleV[stem.depth] >= 0 ? turtle : undefined;

      this.makeStem(
        nTurtle,
        newStem,
        segInd,
        splitCorrAngle,
        numBranchesFactor,
        cloneProb,
        undefined,
        cloned,
      );
    }
  }

  /**
   * Make branches for a segment.
   */
  private makeBranches(
    turtle: Turtle,
    stem: Stem,
    segInd: number,
    branchesOnSeg: number,
    prevRotationAngle: number[],
    isLeaves: boolean,
  ): void {
    const startPoint = stem.curvePoints[stem.curvePoints.length - 2]!;
    const endPoint = stem.curvePoints[stem.curvePoints.length - 1]!;
    const branchesArray: Array<{
      posTurtle: Turtle;
      dirTurtle: Turtle;
      radius: number;
      offset: number;
    }> = [];
    const dPlus1 = Math.min(3, stem.depth + 1);

    if (branchesOnSeg < 0) {
      // Fan branches
      for (
        let branchInd = 0;
        branchInd < Math.abs(Math.floor(branchesOnSeg));
        branchInd++
      ) {
        const stemOffset = 1;
        const result = this.setUpBranch(
          turtle,
          stem,
          BranchMode.Fan,
          1,
          startPoint,
          endPoint,
          stemOffset,
          branchInd,
          prevRotationAngle,
          Math.abs(branchesOnSeg),
        );
        branchesArray.push(result);
      }
    } else {
      const baseLength = stem.length * this.params.baseSize[stem.depth];
      const branchDist = this.params.branchDist[dPlus1];
      const curveRes = Math.floor(this.params.curveRes[stem.depth]);

      if (branchDist > 1) {
        // Whorled branches
        const numOfWhorls = Math.floor(branchesOnSeg / (branchDist + 1));
        const branchesPerWhorl = branchDist + 1;
        let branchWhorlError = 0;

        for (let whorlNum = 0; whorlNum < numOfWhorls; whorlNum++) {
          const offset = Math.max(0, Math.min(1, whorlNum / numOfWhorls));
          const stemOffset = ((segInd - 1 + offset) / curveRes) * stem.length;

          if (stemOffset > baseLength) {
            const branchesThisWhorl = Math.floor(
              branchesPerWhorl + branchWhorlError,
            );
            branchWhorlError -= branchesThisWhorl - branchesPerWhorl;

            for (
              let branchInd = 0;
              branchInd < branchesThisWhorl;
              branchInd++
            ) {
              const result = this.setUpBranch(
                turtle,
                stem,
                BranchMode.Whorled,
                offset,
                startPoint,
                endPoint,
                stemOffset,
                branchInd,
                prevRotationAngle,
                branchesThisWhorl,
              );
              branchesArray.push(result);
            }
          }

          prevRotationAngle[0] += this.params.rotate[dPlus1];
        }
      } else {
        // Alternating or opposite branches
        for (let branchInd = 0; branchInd < branchesOnSeg; branchInd++) {
          let offset: number;
          if (branchInd % 2 === 0) {
            offset = Math.max(0, Math.min(1, branchInd / branchesOnSeg));
          } else {
            offset = Math.max(
              0,
              Math.min(1, (branchInd - branchDist) / branchesOnSeg),
            );
          }

          const stemOffset = ((segInd - 1 + offset) / curveRes) * stem.length;

          if (stemOffset > baseLength) {
            const result = this.setUpBranch(
              turtle,
              stem,
              BranchMode.AltOpp,
              offset,
              startPoint,
              endPoint,
              stemOffset,
              branchInd,
              prevRotationAngle,
              0,
            );
            branchesArray.push(result);
          }
        }
      }
    }

    // Create branches or leaves
    if (isLeaves) {
      for (const { posTurtle, dirTurtle } of branchesArray) {
        this.leaves.push(
          new Leaf(posTurtle.pos, dirTurtle.dir, dirTurtle.right),
        );
      }
    } else {
      for (const { posTurtle, dirTurtle, radius, offset } of branchesArray) {
        const newStem = new Stem(dPlus1, stem, offset, radius);
        stem.addChild(newStem);
        this.stems.push(newStem);
        this.stemRadii.set(newStem, []);
        this.makeStem(dirTurtle, newStem, 0, 0, 1, 1, posTurtle);
      }
    }
  }

  /**
   * Make leaves for a segment.
   */
  private makeLeaves(
    turtle: Turtle,
    stem: Stem,
    segInd: number,
    leavesOnSeg: number,
    prevRotationAngle: number[],
  ): void {
    this.makeBranches(
      turtle,
      stem,
      segInd,
      leavesOnSeg,
      prevRotationAngle,
      true,
    );
  }

  /**
   * Set up a single branch.
   */
  private setUpBranch(
    turtle: Turtle,
    stem: Stem,
    branchMode: number,
    offset: number,
    startPoint: BezierSplinePoint,
    endPoint: BezierSplinePoint,
    stemOffset: number,
    branchInd: number,
    prevRotAngle: number[],
    branchesInGroup: number,
  ): { posTurtle: Turtle; dirTurtle: Turtle; radius: number; offset: number } {
    const dPlus1 = Math.min(3, stem.depth + 1);

    // Create branch direction turtle
    const tangent = calcTangentToBezier(
      offset,
      startPoint,
      endPoint,
    ).normalize();
    const branchDirTurtle = makeBranchDirTurtle(
      turtle,
      tangent,
      this.params.curveV[stem.depth] < 0,
    );

    // Calculate rotation angle
    let radiusLimit: number;

    if (branchMode === BranchMode.Fan) {
      let tAngle: number;
      if (branchesInGroup === 1) {
        tAngle = 0;
      } else {
        tAngle =
          this.params.rotate[dPlus1] *
            (branchInd / (branchesInGroup - 1) - 0.5) +
          this.rng.uniform(-1, 1) * this.params.rotateV[dPlus1];
      }
      branchDirTurtle.turnRight(tAngle);
      radiusLimit = 0;
    } else {
      let rAngle: number;
      if (branchMode === BranchMode.Whorled) {
        rAngle =
          prevRotAngle[0]! +
          (360 * branchInd) / branchesInGroup +
          this.rng.uniform(-1, 1) * this.params.rotateV[dPlus1];
      } else {
        rAngle = this.calcRotateAngle(dPlus1, prevRotAngle[0]!);
        if (this.params.rotate[dPlus1] >= 0) {
          prevRotAngle[0] = rAngle;
        } else {
          prevRotAngle[0] = -prevRotAngle[0]!;
        }
      }

      branchDirTurtle.rollRight(rAngle);
      radiusLimit = this.radiusAtOffset(stem, stemOffset / stem.length);
    }

    // Set position on bezier curve BEFORE creating position turtle
    branchDirTurtle.pos.copy(calcPointOnBezier(offset, startPoint, endPoint));

    // Create branch position turtle (needs correct position from dirTurtle)
    const branchPosTurtle = makeBranchPosTurtle(branchDirTurtle, radiusLimit);

    // Calculate down angle
    const dAngle = this.calcDownAngle(stem, stemOffset);
    branchDirTurtle.pitchDown(dAngle);

    return {
      posTurtle: branchPosTurtle,
      dirTurtle: branchDirTurtle,
      radius: radiusLimit,
      offset: stemOffset,
    };
  }

  /**
   * Increase Bezier point resolution for flared sections.
   */
  private increaseBezierPointRes(
    stem: Stem,
    segInd: number,
    pointsPerSeg: number,
    radii: number[],
  ): void {
    const curveRes = Math.floor(this.params.curveRes[stem.depth]);
    const segEndPoint = stem.curvePoints[stem.curvePoints.length - 1]!;
    const segStartPoint = stem.curvePoints[stem.curvePoints.length - 2]!;

    // Create copies
    const endPoint: BezierSplinePoint = {
      co: segEndPoint.co.clone(),
      handleLeft: segEndPoint.handleLeft.clone(),
      handleRight: segEndPoint.handleRight.clone(),
    };
    const startPoint: BezierSplinePoint = {
      co: segStartPoint.co.clone(),
      handleLeft: segStartPoint.handleLeft.clone(),
      handleRight: segStartPoint.handleRight.clone(),
    };

    for (let k = 0; k < pointsPerSeg; k++) {
      const offset = k / (pointsPerSeg - 1);

      if (k === 0) {
        // Already have start point
        continue;
      }

      let newCo: THREE.Vector3;
      let handleLeft: THREE.Vector3;
      let handleRight: THREE.Vector3;

      if (k === pointsPerSeg - 1) {
        newCo = endPoint.co;
        handleLeft = endPoint.handleLeft;
        handleRight = endPoint.handleRight;
      } else {
        newCo = calcPointOnBezier(offset, startPoint, endPoint);
        const tangent = calcTangentToBezier(
          offset,
          startPoint,
          endPoint,
        ).normalize();
        const dirVecMag = endPoint.handleLeft.distanceTo(endPoint.co);
        handleLeft = newCo
          .clone()
          .sub(tangent.clone().multiplyScalar(dirVecMag));
        handleRight = newCo
          .clone()
          .add(tangent.clone().multiplyScalar(dirVecMag));
      }

      if (k === 1) {
        // Replace end point (we'll add more after)
        stem.curvePoints[stem.curvePoints.length - 1] = {
          co: newCo,
          handleLeft,
          handleRight,
        };
      } else {
        stem.curvePoints.push({ co: newCo, handleLeft, handleRight });
      }

      const radius = this.radiusAtOffset(
        stem,
        (offset + segInd - 1) / curveRes,
      );
      radii.push(radius);
    }
  }

  // ============================================================================
  // CALCULATION METHODS
  // ============================================================================

  /**
   * Calculate stem length.
   */
  private calcStemLength(stem: Stem): number {
    let result: number;

    if (stem.depth === 0) {
      // Trunk
      result =
        this.treeScale *
        (this.params.length[0] +
          this.rng.uniform(-1, 1) * this.params.lengthV[0]);
      this.trunkLength = result;
    } else if (stem.depth === 1) {
      // First level branches
      const parent = stem.parent!;
      const shape = shapeRatio(
        this.params.shape,
        (parent.length - stem.offset) / (parent.length - this.baseLength),
        this.params,
      );
      result = parent.length * parent.lengthChildMax * shape;
    } else {
      // Higher level branches
      const parent = stem.parent!;
      result = parent.lengthChildMax * (parent.length - 0.7 * stem.offset);
    }

    // Clamp to non-negative (matches Python's max(0, result))
    return Math.max(0, result);
  }

  /**
   * Calculate stem radius.
   */
  private calcStemRadius(stem: Stem): number {
    if (stem.depth === 0) {
      // Trunk
      return stem.length * this.params.ratio * this.params.radiusMod[0];
    } else {
      // Branches
      const parent = stem.parent!;
      let result =
        this.params.radiusMod[stem.depth] *
        parent.radius *
        Math.pow(stem.length / parent.length, this.params.ratioPower);
      result = Math.max(0.005, result);
      result = Math.min(stem.radiusLimit, result);
      return result;
    }
  }

  /**
   * Calculate curve angle for a segment.
   */
  private calcCurveAngle(depth: number, segInd: number): number {
    const curve = this.params.curve[depth];
    const curveV = this.params.curveV[depth];
    const curveBack = this.params.curveBack[depth];
    const curveRes = Math.floor(this.params.curveRes[depth]);

    let curveAngle: number;
    if (curveBack === 0) {
      curveAngle = curve / curveRes;
    } else {
      if (segInd < curveRes / 2.0) {
        curveAngle = curve / (curveRes / 2.0);
      } else {
        curveAngle = curveBack / (curveRes / 2.0);
      }
    }

    curveAngle += this.rng.uniform(-1, 1) * (curveV / curveRes);
    return curveAngle;
  }

  /**
   * Calculate down angle.
   */
  private calcDownAngle(stem: Stem, stemOffset: number): number {
    const dPlus1 = Math.min(stem.depth + 1, 3);
    let dAngle: number;

    if (this.params.downAngleV[dPlus1] >= 0) {
      dAngle =
        this.params.downAngle[dPlus1] +
        this.rng.uniform(-1, 1) * this.params.downAngleV[dPlus1];
    } else {
      const shape = shapeRatio(
        TreeShape.Conical,
        (stem.length - stemOffset) /
          (stem.length * (1 - this.params.baseSize[stem.depth])),
        this.params,
      );
      dAngle =
        this.params.downAngle[dPlus1] +
        this.params.downAngleV[dPlus1] * (1 - 2 * shape);
      dAngle += this.rng.uniform(-1, 1) * Math.abs(dAngle * 0.1);
    }

    return dAngle;
  }

  /**
   * Calculate rotate angle.
   */
  private calcRotateAngle(depth: number, prevAngle: number): number {
    if (this.params.rotate[depth] >= 0) {
      return (
        (prevAngle +
          this.params.rotate[depth] +
          this.rng.uniform(-1, 1) * this.params.rotateV[depth]) %
        360
      );
    } else {
      return (
        prevAngle *
        (180 +
          this.params.rotate[depth] +
          this.rng.uniform(-1, 1) * this.params.rotateV[depth])
      );
    }
  }

  /**
   * Calculate leaf count.
   */
  private calcLeafCount(stem: Stem): number {
    if (this.params.leafBlosNum >= 0) {
      const parent = stem.parent!;
      const leaves =
        (this.params.leafBlosNum * this.treeScale) / this.params.gScale;
      return leaves * (stem.length / (parent.lengthChildMax * parent.length));
    } else {
      return this.params.leafBlosNum;
    }
  }

  /**
   * Calculate branch count.
   */
  private calcBranchCount(stem: Stem): number {
    const dPlus1 = Math.min(stem.depth + 1, 3);

    let result: number;
    if (stem.depth === 0) {
      result = this.params.branches[dPlus1] * (this.rng.random() * 0.2 + 0.9);
    } else if (this.params.branches[dPlus1] < 0) {
      result = this.params.branches[dPlus1];
    } else if (stem.depth === 1) {
      const parent = stem.parent!;
      result =
        this.params.branches[dPlus1] *
        (0.2 + (0.8 * (stem.length / parent.length)) / parent.lengthChildMax);
    } else {
      const parent = stem.parent!;
      result =
        this.params.branches[dPlus1] *
        (1.0 - (0.5 * stem.offset) / parent.length);
    }

    return result / (1 - this.params.baseSize[stem.depth]);
  }

  /**
   * Calculate radius at offset along stem.
   */
  private radiusAtOffset(stem: Stem, z1: number): number {
    const nTaper = this.params.taper[stem.depth];

    let unitTaper: number;
    if (nTaper < 1) {
      unitTaper = nTaper;
    } else if (nTaper < 2) {
      unitTaper = 2 - nTaper;
    } else {
      unitTaper = 0;
    }

    const taper = stem.radius * (1 - unitTaper * z1);

    let radius: number;
    if (nTaper < 1) {
      radius = taper;
    } else {
      const z2 = (1 - z1) * stem.length;
      let depth: number;
      if (nTaper < 2 || z2 < taper) {
        depth = 1;
      } else {
        depth = nTaper - 2;
      }

      let z3: number;
      if (nTaper < 2) {
        z3 = z2;
      } else {
        z3 = Math.abs(z2 - 2 * taper * Math.floor(z2 / (2 * taper) + 0.5));
      }

      if (nTaper < 2 && z3 >= taper) {
        radius = taper;
      } else {
        radius =
          (1 - depth) * taper +
          depth * Math.sqrt(taper ** 2 - (z3 - taper) ** 2);
      }
    }

    // Apply flare for trunk
    if (stem.depth === 0) {
      const yVal = Math.max(0, 1 - 8 * z1);
      const flare = this.params.flare * ((Math.pow(100, yVal) - 1) / 100) + 1;
      radius *= flare;
    }

    return radius;
  }

  /**
   * Check if point is inside pruning envelope.
   */
  private pointInside(point: THREE.Vector3): boolean {
    return pointInsideEnvelope(
      point,
      this.treeScale,
      this.params.baseSize[0],
      this.params.pruneWidth,
      this.params,
    );
  }
}
