/**
 * Armor Fitting API Route
 * Performs hull-based or shrinkwrap armor fitting to avatar body
 */

import { NextRequest, NextResponse } from "next/server";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { getServiceFactory } from "@/lib/services";
import { logger } from "@/lib/utils";

const log = logger.child("API:armor/fit");

// Store fitted armors temporarily for binding/export operations
const fittedArmorCache = new Map<
  string,
  {
    armorMesh: THREE.Mesh;
    skinnedArmor: THREE.SkinnedMesh | null;
    avatarMesh: THREE.SkinnedMesh;
    avatarSkeleton: THREE.Skeleton;
    timestamp: number;
  }
>();

// Clean up old cache entries (older than 30 minutes)
function cleanupCache() {
  const now = Date.now();
  const maxAge = 30 * 60 * 1000; // 30 minutes
  for (const [key, value] of fittedArmorCache.entries()) {
    if (now - value.timestamp > maxAge) {
      fittedArmorCache.delete(key);
    }
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { avatarUrl, armorUrl, config = {}, action } = body;

    // Handle different actions
    if (action === "bind") {
      return handleBind(body);
    }
    if (action === "export") {
      return handleExport(body);
    }

    // Default action: fit armor
    if (!avatarUrl || !armorUrl) {
      return NextResponse.json(
        { error: "Both avatarUrl and armorUrl required" },
        { status: 400 },
      );
    }

    const loader = new GLTFLoader();
    const factory = getServiceFactory();
    const armorFittingService = factory.getArmorFittingService();
    const meshFittingService = factory.getMeshFittingService();

    log.info({ avatarUrl }, "Loading avatar");
    log.info({ armorUrl }, "Loading armor");

    // Load both models
    const [avatarGltf, armorGltf] = await Promise.all([
      loader.loadAsync(avatarUrl),
      loader.loadAsync(armorUrl),
    ]);

    // Find skinned mesh in avatar
    let foundAvatarMesh: THREE.SkinnedMesh | null = null;
    let foundAvatarSkeleton: THREE.Skeleton | null = null;
    avatarGltf.scene.traverse((child) => {
      if (child instanceof THREE.SkinnedMesh && !foundAvatarMesh) {
        foundAvatarMesh = child;
        foundAvatarSkeleton = child.skeleton;
      }
    });

    if (!foundAvatarMesh || !foundAvatarSkeleton) {
      return NextResponse.json(
        { error: "No skinned mesh found in avatar" },
        { status: 400 },
      );
    }

    // Re-assign to const for TypeScript narrowing
    const avatarMesh = foundAvatarMesh;
    const avatarSkeleton = foundAvatarSkeleton;

    // Find mesh in armor
    let foundArmorMesh: THREE.Mesh | null = null;
    armorGltf.scene.traverse((child) => {
      if (child instanceof THREE.Mesh && !foundArmorMesh) {
        foundArmorMesh = child;
      }
    });

    if (!foundArmorMesh) {
      return NextResponse.json(
        { error: "No mesh found in armor model" },
        { status: 400 },
      );
    }

    // Re-assign to a const for TypeScript narrowing
    const armorMesh = foundArmorMesh;

    log.info("Starting fitting process...");

    // Compute body regions
    const bodyRegions = armorFittingService.computeBodyRegions(
      avatarMesh,
      avatarSkeleton,
    );

    log.info({ bodyRegionsCount: bodyRegions.size }, "Found body regions");

    // Perform fitting config
    const fittingConfig = {
      method: (config.method as string) || "hull",
      margin: (config.margin as number) || 0.02,
      targetOffset: (config.targetOffset as number) || 0.02,
      iterations: (config.iterations as number) || 10,
      rigidity: (config.rigidity as number) || 0.7,
      smoothingPasses: (config.smoothingPasses as number) || 3,
    };

    // Get target body region based on equipment slot
    const equipmentSlot = (config.equipmentSlot as string) || "Spine2";
    // Map slot names to body region names
    const slotToRegion: Record<string, string> = {
      Head: "head",
      Spine2: "torso",
      Pelvis: "hips",
    };
    const regionName = slotToRegion[equipmentSlot] || "torso";
    const targetRegion = bodyRegions.get(regionName);

    if (targetRegion) {
      // Fit armor to body region bounding box
      armorFittingService.fitArmorToBoundingBox(
        armorMesh,
        targetRegion,
        fittingConfig.margin,
      );
    }

    // Perform shrinkwrap fit using MeshFittingService
    meshFittingService.fitArmorToBody(armorMesh, avatarMesh as THREE.Mesh, {
      iterations: fittingConfig.iterations,
      targetOffset: fittingConfig.targetOffset,
      rigidity: fittingConfig.rigidity,
      smoothingPasses: fittingConfig.smoothingPasses,
    });

    log.info("Fitting complete");

    // Get vertex count from the modified armor mesh
    const geom = armorMesh.geometry as THREE.BufferGeometry;
    const vertexCount = geom?.attributes?.position?.count || 0;

    // Generate a session ID for this fitting operation
    const sessionId = `fit_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Cache the fitted armor for binding/export
    cleanupCache();
    fittedArmorCache.set(sessionId, {
      armorMesh,
      skinnedArmor: null,
      avatarMesh,
      avatarSkeleton,
      timestamp: Date.now(),
    });

    // Export fitted armor as GLB for preview
    const exporter = new GLTFExporter();
    const exportScene = new THREE.Scene();
    exportScene.add(armorMesh.clone());

    const glbBuffer = await new Promise<ArrayBuffer>((resolve, reject) => {
      exporter.parse(
        exportScene,
        (result) => resolve(result as ArrayBuffer),
        (error) => reject(error),
        { binary: true },
      );
    });

    // Convert to base64 for JSON response
    const base64Glb = Buffer.from(glbBuffer).toString("base64");

    return NextResponse.json({
      success: true,
      message: "Armor fitting completed",
      sessionId,
      fittedArmorGlb: base64Glb,
      stats: {
        bodyRegions: bodyRegions.size,
        vertexCount,
        method: fittingConfig.method,
        iterations: fittingConfig.iterations,
      },
    });
  } catch (error) {
    log.error({ error }, "Armor fitting failed");
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Armor fitting failed",
      },
      { status: 500 },
    );
  }
}

/**
 * Handle binding fitted armor to skeleton
 */
async function handleBind(body: { sessionId?: string }): Promise<NextResponse> {
  const { sessionId } = body;

  if (!sessionId) {
    return NextResponse.json(
      { error: "sessionId required for binding" },
      { status: 400 },
    );
  }

  const cached = fittedArmorCache.get(sessionId);
  if (!cached) {
    return NextResponse.json(
      { error: "Session expired or not found. Please refit armor." },
      { status: 404 },
    );
  }

  try {
    const factory = getServiceFactory();
    const armorFittingService = factory.getArmorFittingService();

    log.info("Binding fitted armor to skeleton...");

    // Bind armor to avatar skeleton
    const skinnedArmor = armorFittingService.bindArmorToSkeleton(
      cached.armorMesh,
      cached.avatarMesh,
      { searchRadius: 0.05, applyGeometryTransform: true },
    );

    // Update cache with skinned armor
    cached.skinnedArmor = skinnedArmor;
    cached.timestamp = Date.now();

    log.info("Binding complete");

    return NextResponse.json({
      success: true,
      message: "Armor bound to skeleton",
      boneCount: skinnedArmor.skeleton?.bones.length || 0,
    });
  } catch (error) {
    log.error({ error }, "Binding failed");
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Binding failed" },
      { status: 500 },
    );
  }
}

/**
 * Handle exporting bound armor
 */
async function handleExport(body: {
  sessionId?: string;
  exportMethod?: "minimal" | "full" | "static";
}): Promise<NextResponse> {
  const { sessionId, exportMethod = "minimal" } = body;

  if (!sessionId) {
    return NextResponse.json(
      { error: "sessionId required for export" },
      { status: 400 },
    );
  }

  const cached = fittedArmorCache.get(sessionId);
  if (!cached) {
    return NextResponse.json(
      { error: "Session expired or not found. Please refit armor." },
      { status: 404 },
    );
  }

  if (!cached.skinnedArmor) {
    return NextResponse.json(
      {
        error: "Armor must be bound before exporting. Call bind action first.",
      },
      { status: 400 },
    );
  }

  try {
    const factory = getServiceFactory();
    const armorFittingService = factory.getArmorFittingService();

    log.info({ exportMethod }, "Exporting fitted armor...");

    // Export using the ArmorFittingService
    const glbBuffer = await armorFittingService.exportFittedArmor(
      cached.skinnedArmor,
      { method: exportMethod },
    );

    // Clean up session after export
    fittedArmorCache.delete(sessionId);

    // Return as binary download
    return new NextResponse(glbBuffer, {
      status: 200,
      headers: {
        "Content-Type": "model/gltf-binary",
        "Content-Disposition": 'attachment; filename="fitted-armor.glb"',
        "Content-Length": glbBuffer.byteLength.toString(),
      },
    });
  } catch (error) {
    log.error({ error }, "Export failed");
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Export failed" },
      { status: 500 },
    );
  }
}

export async function GET() {
  return NextResponse.json({
    name: "Armor Fitting API",
    description:
      "Fit armor meshes to avatar bodies using hull-based or shrinkwrap methods",
    usage: {
      method: "POST",
      body: {
        avatarUrl: "URL to avatar GLB/VRM",
        armorUrl: "URL to armor GLB",
        config: {
          equipmentSlot: "Spine2 | Head | Pelvis",
          method: "hull | shrinkwrap | collision",
          margin: "Gap between armor and body (default: 0.02)",
          hullIterations: "Number of fitting iterations (default: 5)",
        },
      },
    },
  });
}
