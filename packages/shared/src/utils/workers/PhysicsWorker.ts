/**
 * PhysicsWorker - Offloads PhysX simulation to a Web Worker
 *
 * Moves the heavy PhysX WASM simulation off the main thread to reduce jank.
 * The worker loads PhysX from CDN using importScripts.
 *
 * Architecture:
 * - Worker loads PhysX WASM independently (not shared with main thread)
 * - Main thread sends actor data (positions, velocities, shapes)
 * - Worker runs simulate() and fetchResults()
 * - Worker returns updated transforms back to main thread
 *
 * Limitations:
 * - Actor creation/destruction must be mirrored to worker
 * - Complex callbacks (contacts, triggers) serialized as events
 * - Raycasts still run on main thread (or batched to worker)
 *
 * Message Protocol:
 * - Main → Worker: init, simulate, addActor, removeActor, setTransform, destroy
 * - Worker → Main: initialized, simulated, error
 */

// ============================================================================
// MESSAGE TYPES
// ============================================================================

/** Actor types supported by the physics worker */
export type PhysicsActorType = "static" | "kinematic" | "dynamic";

/** Serialized shape data for transfer to worker */
export type SerializedShape =
  | { type: "box"; halfExtents: [number, number, number] }
  | { type: "sphere"; radius: number }
  | { type: "capsule"; radius: number; halfHeight: number }
  | { type: "plane" };
// Note: trimesh not supported in worker (too complex to serialize)

/** Serialized actor data for transfer to worker */
export interface SerializedActor {
  id: number;
  type: PhysicsActorType;
  position: [number, number, number];
  quaternion: [number, number, number, number];
  shape: SerializedShape;
  mass?: number;
  linearDamping?: number;
  angularDamping?: number;
  isTrigger?: boolean;
}

/** Transform data returned from simulation */
export interface ActorTransform {
  id: number;
  position: [number, number, number];
  quaternion: [number, number, number, number];
}

/** Velocity data for setting actor velocities */
export interface ActorVelocity {
  id: number;
  linear: [number, number, number];
  angular?: [number, number, number];
}

/** Contact event from simulation */
export interface SerializedContactEvent {
  actorA: number;
  actorB: number;
  type: "start" | "end";
}

/** Trigger event from simulation */
export interface SerializedTriggerEvent {
  triggerActor: number;
  otherActor: number;
  type: "enter" | "leave";
}

// ============================================================================
// WORKER INPUT/OUTPUT MESSAGE TYPES
// ============================================================================

/** Input messages sent TO the worker */
export type PhysicsWorkerInput =
  | {
      type: "init";
      gravity: [number, number, number];
      actors: SerializedActor[];
      cdnUrl: string;
    }
  | {
      type: "simulate";
      delta: number;
      kinematicTargets?: ActorTransform[];
      velocities?: ActorVelocity[];
    }
  | { type: "addActor"; actor: SerializedActor }
  | { type: "removeActor"; actorId: number }
  | { type: "setTransform"; actorId: number; transform: ActorTransform }
  | { type: "setVelocity"; actorId: number; velocity: ActorVelocity }
  | { type: "destroy" };

/** Output messages sent FROM the worker */
export type PhysicsWorkerOutput =
  | { type: "initialized"; success: boolean; error?: string }
  | {
      type: "simulated";
      transforms: ActorTransform[];
      contacts: SerializedContactEvent[];
      triggers: SerializedTriggerEvent[];
      simulationTimeMs: number;
    }
  | { type: "error"; message: string };

// ============================================================================
// WORKER CODE (runs in worker context)
// ============================================================================

/**
 * Inline worker code that loads PhysX from CDN and runs simulation.
 *
 * This code runs in a separate thread. It:
 * 1. Loads PhysX JS via importScripts from CDN
 * 2. Initializes PhysX with WASM from CDN
 * 3. Creates a scene and manages actors
 * 4. Runs simulate() and fetchResults() on command
 * 5. Returns active transforms to main thread
 */
const PHYSICS_WORKER_CODE = `
// PhysX globals
let PHYSX = null;
let foundation = null;
let physics = null;
let scene = null;
let cpuDispatcher = null;
let cdnBaseUrl = '';

// Actor tracking (id → PxRigidActor)
const actors = new Map();
const actorTypes = new Map(); // id → 'static' | 'kinematic' | 'dynamic'
const triggerActors = new Set();

// Contact/trigger events collected during simulation
let contactEvents = [];
let triggerEvents = [];

/**
 * Initialize PhysX in the worker
 */
async function initPhysX(gravity, initialActors, cdnUrl) {
  cdnBaseUrl = cdnUrl;
  
  // Load PhysX JS from CDN
  const jsUrl = cdnBaseUrl + '/web/physx-js-webidl.js?v=1.0.0';
  importScripts(jsUrl);
  
  // The PhysX script sets a global 'PhysX' function (same as window.PhysX in browser)
  // In worker context, this becomes self.PhysX
  if (typeof PhysX === 'undefined') {
    return { success: false, error: 'PhysX global not found after loading script from ' + jsUrl };
  }
  
  // Initialize PhysX with WASM location
  PHYSX = await PhysX({
    locateFile: (file) => {
      if (file.endsWith('.wasm')) {
        return cdnBaseUrl + '/web/' + file + '?v=1.0.0';
      }
      return file;
    }
  });
  
  // Create foundation (memory allocator + error callback)
  const version = PHYSX.PHYSICS_VERSION;
  const allocator = new PHYSX.PxDefaultAllocator();
  const errorCb = new PHYSX.PxDefaultErrorCallback();
  foundation = PHYSX.CreateFoundation(version, allocator, errorCb);
  
  if (!foundation) {
    return { success: false, error: 'Failed to create PhysX foundation' };
  }
  
  // Create physics SDK
  const tolerances = new PHYSX.PxTolerancesScale();
  physics = PHYSX.CreatePhysics(version, foundation, tolerances);
  
  if (!physics) {
    return { success: false, error: 'Failed to create PhysX physics' };
  }
  
  // Create CPU dispatcher (single thread in worker)
  cpuDispatcher = PHYSX.PxDefaultCpuDispatcherCreate(1);
  
  // Create scene
  const sceneDesc = new PHYSX.PxSceneDesc(tolerances);
  sceneDesc.set_gravity(new PHYSX.PxVec3(gravity[0], gravity[1], gravity[2]));
  sceneDesc.set_cpuDispatcher(cpuDispatcher);
  sceneDesc.set_filterShader(PHYSX.PxDefaultSimulationFilterShader);
  
  // Enable active actors tracking for efficient transform retrieval
  sceneDesc.set_flags(PHYSX.PxSceneFlag.eENABLE_ACTIVE_ACTORS);
  
  scene = physics.createScene(sceneDesc);
  
  if (!scene) {
    return { success: false, error: 'Failed to create PhysX scene' };
  }
  
  // Add initial actors
  for (const actorData of initialActors) {
    addActorInternal(actorData);
  }
  
  return { success: true };
}

/**
 * Create a PxGeometry from serialized shape data
 */
function createGeometry(shape) {
  switch (shape.type) {
    case 'box':
      return new PHYSX.PxBoxGeometry(
        shape.halfExtents[0],
        shape.halfExtents[1],
        shape.halfExtents[2]
      );
    case 'sphere':
      return new PHYSX.PxSphereGeometry(shape.radius);
    case 'capsule':
      return new PHYSX.PxCapsuleGeometry(shape.radius, shape.halfHeight);
    case 'plane':
      return new PHYSX.PxPlaneGeometry();
    default:
      console.warn('[PhysicsWorker] Unknown shape type:', shape.type);
      return null;
  }
}

/**
 * Add actor to scene
 */
function addActorInternal(data) {
  if (!physics || !scene) return;
  
  const { id, type, position, quaternion, shape, mass, isTrigger } = data;
  
  // Create transform
  const pos = new PHYSX.PxVec3(position[0], position[1], position[2]);
  const quat = new PHYSX.PxQuat(quaternion[0], quaternion[1], quaternion[2], quaternion[3]);
  const pose = new PHYSX.PxTransform(pos, quat);
  
  // Create actor
  let actor;
  if (type === 'static') {
    actor = physics.createRigidStatic(pose);
  } else {
    actor = physics.createRigidDynamic(pose);
    if (type === 'kinematic') {
      actor.setRigidBodyFlag(PHYSX.PxRigidBodyFlag.eKINEMATIC, true);
    }
    if (mass && mass > 0) {
      PHYSX.PxRigidBodyExt.prototype.setMassAndUpdateInertia(actor, mass);
    }
  }
  
  if (!actor) {
    console.warn('[PhysicsWorker] Failed to create actor:', id);
    return;
  }
  
  // Create shape
  const geometry = createGeometry(shape);
  if (!geometry) {
    console.warn('[PhysicsWorker] Failed to create geometry for actor:', id);
    return;
  }
  
  // Create material (friction: 0.5, restitution: 0.1)
  const material = physics.createMaterial(0.5, 0.5, 0.1);
  
  // Create shape flags
  let shapeFlags;
  if (isTrigger) {
    shapeFlags = new PHYSX.PxShapeFlags(PHYSX.PxShapeFlag.eTRIGGER_SHAPE);
    triggerActors.add(id);
  } else {
    shapeFlags = new PHYSX.PxShapeFlags(
      PHYSX.PxShapeFlag.eSCENE_QUERY_SHAPE | PHYSX.PxShapeFlag.eSIMULATION_SHAPE
    );
  }
  
  const pxShape = physics.createShape(geometry, material, true, shapeFlags);
  actor.attachShape(pxShape);
  
  // Add to scene
  scene.addActor(actor);
  actors.set(id, actor);
  actorTypes.set(id, type);
}

/**
 * Remove actor from scene
 */
function removeActorInternal(actorId) {
  const actor = actors.get(actorId);
  if (actor && scene) {
    scene.removeActor(actor);
    actor.release();
    actors.delete(actorId);
    actorTypes.delete(actorId);
    triggerActors.delete(actorId);
  }
}

/**
 * Run simulation step
 */
function simulateStep(delta, kinematicTargets, velocities) {
  if (!scene) {
    return { transforms: [], contacts: [], triggers: [], simulationTimeMs: 0 };
  }
  
  const startTime = performance.now();
  
  // Apply kinematic targets
  if (kinematicTargets) {
    for (const t of kinematicTargets) {
      const actor = actors.get(t.id);
      if (actor && actorTypes.get(t.id) === 'kinematic') {
        const pos = new PHYSX.PxVec3(t.position[0], t.position[1], t.position[2]);
        const quat = new PHYSX.PxQuat(t.quaternion[0], t.quaternion[1], t.quaternion[2], t.quaternion[3]);
        const pose = new PHYSX.PxTransform(pos, quat);
        actor.setKinematicTarget(pose);
      }
    }
  }
  
  // Apply velocities
  if (velocities) {
    for (const v of velocities) {
      const actor = actors.get(v.id);
      if (actor && actorTypes.get(v.id) === 'dynamic') {
        actor.setLinearVelocity(new PHYSX.PxVec3(v.linear[0], v.linear[1], v.linear[2]));
        if (v.angular) {
          actor.setAngularVelocity(new PHYSX.PxVec3(v.angular[0], v.angular[1], v.angular[2]));
        }
      }
    }
  }
  
  // Run simulation
  scene.simulate(delta);
  scene.fetchResults(true);
  
  // Get active actors (actors that moved this frame)
  const transforms = [];
  
  // Use getActiveActors if available
  if (scene.getActiveActors) {
    const activeCount = scene.getNbActiveActors();
    if (activeCount > 0) {
      // Get active actors array
      const activeActorsBuffer = new PHYSX.PxActorVector();
      scene.getActiveActors(activeActorsBuffer);
      
      for (let i = 0; i < activeCount; i++) {
        const actor = activeActorsBuffer.get(i);
        const pose = actor.getGlobalPose();
        
        // Find the actor ID
        for (const [id, a] of actors) {
          if (a === actor) {
            transforms.push({
              id,
              position: [pose.p.x, pose.p.y, pose.p.z],
              quaternion: [pose.q.x, pose.q.y, pose.q.z, pose.q.w]
            });
            break;
          }
        }
      }
    }
  } else {
    // Fallback: iterate all dynamic actors
    for (const [id, actor] of actors) {
      const type = actorTypes.get(id);
      if (type === 'dynamic') {
        const pose = actor.getGlobalPose();
        transforms.push({
          id,
          position: [pose.p.x, pose.p.y, pose.p.z],
          quaternion: [pose.q.x, pose.q.y, pose.q.z, pose.q.w]
        });
      }
    }
  }
  
  const simulationTimeMs = performance.now() - startTime;
  
  // Return results (contacts/triggers would need callback setup)
  return {
    transforms,
    contacts: [],
    triggers: [],
    simulationTimeMs
  };
}

/**
 * Cleanup PhysX resources
 */
function destroy() {
  // Remove all actors
  for (const [id, actor] of actors) {
    if (scene) scene.removeActor(actor);
    actor.release();
  }
  actors.clear();
  actorTypes.clear();
  triggerActors.clear();
  
  // Release PhysX objects
  if (scene) {
    scene.release();
    scene = null;
  }
  if (cpuDispatcher) {
    cpuDispatcher.release();
    cpuDispatcher = null;
  }
  if (physics) {
    physics.release();
    physics = null;
  }
  if (foundation) {
    foundation.release();
    foundation = null;
  }
}

// Message handler
self.onmessage = async function(e) {
  const msg = e.data;
  
  switch (msg.type) {
    case 'init': {
      const result = await initPhysX(msg.gravity, msg.actors, msg.cdnUrl);
      self.postMessage({ type: 'initialized', ...result });
      break;
    }
    
    case 'simulate': {
      const result = simulateStep(msg.delta, msg.kinematicTargets, msg.velocities);
      self.postMessage({ type: 'simulated', ...result });
      break;
    }
    
    case 'addActor': {
      addActorInternal(msg.actor);
      break;
    }
    
    case 'removeActor': {
      removeActorInternal(msg.actorId);
      break;
    }
    
    case 'setTransform': {
      const actor = actors.get(msg.actorId);
      if (actor) {
        const t = msg.transform;
        const pos = new PHYSX.PxVec3(t.position[0], t.position[1], t.position[2]);
        const quat = new PHYSX.PxQuat(t.quaternion[0], t.quaternion[1], t.quaternion[2], t.quaternion[3]);
        actor.setGlobalPose(new PHYSX.PxTransform(pos, quat));
      }
      break;
    }
    
    case 'setVelocity': {
      const actor = actors.get(msg.actorId);
      if (actor && actorTypes.get(msg.actorId) === 'dynamic') {
        const v = msg.velocity;
        actor.setLinearVelocity(new PHYSX.PxVec3(v.linear[0], v.linear[1], v.linear[2]));
        if (v.angular) {
          actor.setAngularVelocity(new PHYSX.PxVec3(v.angular[0], v.angular[1], v.angular[2]));
        }
      }
      break;
    }
    
    case 'destroy': {
      destroy();
      break;
    }
    
    default:
      console.warn('[PhysicsWorker] Unknown message type:', msg.type);
  }
};
`;

// ============================================================================
// MAIN THREAD API
// ============================================================================

/** Worker instance */
let physicsWorker: Worker | null = null;
let workerReady = false;
let initPromise: Promise<boolean> | null = null;

/** Pending simulation callbacks */
const pendingSimulations: Array<{
  resolve: (result: {
    transforms: ActorTransform[];
    contacts: SerializedContactEvent[];
    triggers: SerializedTriggerEvent[];
    simulationTimeMs: number;
  }) => void;
  reject: (error: Error) => void;
}> = [];

/**
 * Check if physics worker is available (browser with Worker + Blob support)
 */
export function isPhysicsWorkerAvailable(): boolean {
  return typeof Worker !== "undefined" && typeof Blob !== "undefined";
}

/**
 * Get the CDN URL for PhysX assets
 */
function getCdnUrl(): string {
  if (typeof window !== "undefined") {
    const windowWithCdn = window as Window & { __CDN_URL?: string };
    return windowWithCdn.__CDN_URL || "http://localhost:8080";
  }
  return "http://localhost:8080";
}

/**
 * Initialize the physics worker
 *
 * @param gravity - World gravity vector [x, y, z]
 * @param initialActors - Actors to create on init
 * @returns Promise resolving to true if worker initialized successfully
 */
export async function initPhysicsWorker(
  gravity: [number, number, number] = [0, -9.81, 0],
  initialActors: SerializedActor[] = [],
): Promise<boolean> {
  if (!isPhysicsWorkerAvailable()) {
    console.warn("[PhysicsWorker] Workers not available in this environment");
    return false;
  }

  if (initPromise) {
    return initPromise;
  }

  initPromise = new Promise((resolve) => {
    try {
      // Create worker from inline code
      const blob = new Blob([PHYSICS_WORKER_CODE], {
        type: "application/javascript",
      });
      const url = URL.createObjectURL(blob);
      physicsWorker = new Worker(url);
      URL.revokeObjectURL(url);

      // Handle messages from worker
      physicsWorker.onmessage = (e: MessageEvent<PhysicsWorkerOutput>) => {
        const msg = e.data;

        switch (msg.type) {
          case "initialized":
            workerReady = msg.success;
            if (!msg.success) {
              console.error(
                "[PhysicsWorker] Initialization failed:",
                msg.error,
              );
            } else {
              console.log("[PhysicsWorker] Initialized successfully");
            }
            resolve(msg.success);
            break;

          case "simulated": {
            const pending = pendingSimulations.shift();
            if (pending) {
              pending.resolve({
                transforms: msg.transforms,
                contacts: msg.contacts,
                triggers: msg.triggers,
                simulationTimeMs: msg.simulationTimeMs,
              });
            }
            break;
          }

          case "error": {
            console.error("[PhysicsWorker] Error:", msg.message);
            const pendingErr = pendingSimulations.shift();
            if (pendingErr) {
              pendingErr.reject(new Error(msg.message));
            }
            break;
          }
        }
      };

      physicsWorker.onerror = (e) => {
        console.error("[PhysicsWorker] Worker error:", e.message);
        resolve(false);
      };

      // Send init message
      const initMsg: PhysicsWorkerInput = {
        type: "init",
        gravity,
        actors: initialActors,
        cdnUrl: getCdnUrl(),
      };
      physicsWorker.postMessage(initMsg);
    } catch (error) {
      console.error("[PhysicsWorker] Failed to create worker:", error);
      resolve(false);
    }
  });

  return initPromise;
}

/**
 * Check if physics worker is ready for simulation
 */
export function isPhysicsWorkerReady(): boolean {
  return workerReady && physicsWorker !== null;
}

/**
 * Run physics simulation step in worker
 *
 * @param delta - Time step in seconds
 * @param kinematicTargets - Target poses for kinematic actors
 * @param velocities - Velocities to apply to dynamic actors
 * @returns Promise resolving to simulation results
 */
export function simulateInWorker(
  delta: number,
  kinematicTargets?: ActorTransform[],
  velocities?: ActorVelocity[],
): Promise<{
  transforms: ActorTransform[];
  contacts: SerializedContactEvent[];
  triggers: SerializedTriggerEvent[];
  simulationTimeMs: number;
}> {
  return new Promise((resolve, reject) => {
    if (!physicsWorker || !workerReady) {
      reject(new Error("Physics worker not initialized"));
      return;
    }

    pendingSimulations.push({ resolve, reject });

    const msg: PhysicsWorkerInput = {
      type: "simulate",
      delta,
      kinematicTargets,
      velocities,
    };
    physicsWorker.postMessage(msg);
  });
}

/**
 * Add an actor to the worker's physics scene
 */
export function addActorToWorker(actor: SerializedActor): void {
  if (!physicsWorker || !workerReady) return;

  const msg: PhysicsWorkerInput = { type: "addActor", actor };
  physicsWorker.postMessage(msg);
}

/**
 * Remove an actor from the worker's physics scene
 */
export function removeActorFromWorker(actorId: number): void {
  if (!physicsWorker || !workerReady) return;

  const msg: PhysicsWorkerInput = { type: "removeActor", actorId };
  physicsWorker.postMessage(msg);
}

/**
 * Set an actor's transform in the worker
 */
export function setWorkerActorTransform(
  actorId: number,
  transform: ActorTransform,
): void {
  if (!physicsWorker || !workerReady) return;

  const msg: PhysicsWorkerInput = { type: "setTransform", actorId, transform };
  physicsWorker.postMessage(msg);
}

/**
 * Set an actor's velocity in the worker
 */
export function setWorkerActorVelocity(
  actorId: number,
  velocity: ActorVelocity,
): void {
  if (!physicsWorker || !workerReady) return;

  const msg: PhysicsWorkerInput = { type: "setVelocity", actorId, velocity };
  physicsWorker.postMessage(msg);
}

/**
 * Destroy the physics worker and release resources
 */
export function destroyPhysicsWorker(): void {
  if (physicsWorker) {
    const msg: PhysicsWorkerInput = { type: "destroy" };
    physicsWorker.postMessage(msg);
    physicsWorker.terminate();
    physicsWorker = null;
    workerReady = false;
    initPromise = null;

    // Reject any pending simulations
    for (const pending of pendingSimulations) {
      pending.reject(new Error("Physics worker destroyed"));
    }
    pendingSimulations.length = 0;
  }
}
