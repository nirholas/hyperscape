"use client";

/**
 * StructureViewport - 3D editor for building structures
 *
 * Features:
 * - Three.js viewport with OrbitControls
 * - Loads actual GLB models from piece library
 * - Snap-to-grid placement
 * - Click-and-drag to move pieces (trackpad/mouse friendly)
 * - Ghost preview when placing pieces
 * - Hover highlighting
 * - Duplicate and delete support
 */

import {
  useRef,
  useState,
  useCallback,
  useEffect,
  Suspense,
  useMemo,
} from "react";
import { Canvas, useThree, useFrame, ThreeEvent } from "@react-three/fiber";
import {
  OrbitControls,
  Grid,
  Environment,
  GizmoHelper,
  GizmoViewport,
  useGLTF,
  Clone,
} from "@react-three/drei";
import * as THREE from "three";
import { logger } from "@/lib/utils";
import type {
  StructureDefinition,
  PlacedPiece,
  BuildingPiece,
  StructureEditorTool,
  TransformMode,
  GridSnapConfig,
  PieceTransform,
} from "@/types/structures";
import type { Position3D } from "@/types/core";

const log = logger.child("StructureViewport");

// Type for OrbitControls ref
type OrbitControlsType = THREE.EventDispatcher & { enabled: boolean };

// =============================================================================
// TYPES
// =============================================================================

interface StructureViewportProps {
  structure: StructureDefinition | null;
  selectedPieceId: string | null;
  onSelectPiece: (id: string | null) => void;
  placingPiece: BuildingPiece | null;
  onPlacePiece: (
    piece: BuildingPiece,
    position: { x: number; y: number; z: number },
  ) => void;
  onPlacingComplete: () => void;
  tool: StructureEditorTool;
  transformMode: TransformMode;
  gridConfig: GridSnapConfig;
  onTransformPiece: (
    pieceId: string,
    transform: Partial<PieceTransform>,
  ) => void;
  /** Piece library for looking up models */
  pieceLibrary?: BuildingPiece[];
  /** Callback to duplicate a piece */
  onDuplicatePiece?: (pieceInstanceId: string) => void;
  /** Callback to delete a piece */
  onDeletePiece?: (pieceInstanceId: string) => void;
}

// =============================================================================
// GLB MODEL COMPONENT
// =============================================================================

interface GLBModelProps {
  url: string;
  isSelected: boolean;
  onClick: () => void;
}

function GLBModel({ url, isSelected, onClick }: GLBModelProps) {
  const { scene } = useGLTF(url);

  return (
    <group
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      <Clone object={scene} />
      {isSelected && (
        <mesh>
          <boxGeometry args={[1.1, 1.1, 1.1]} />
          <meshBasicMaterial
            color="#00ffff"
            wireframe
            transparent
            opacity={0.5}
          />
        </mesh>
      )}
    </group>
  );
}

// =============================================================================
// PIECE MESH COMPONENT - Loads actual GLB or shows placeholder
// Supports drag-to-move and hover highlighting
// =============================================================================

interface PieceMeshProps {
  piece: PlacedPiece;
  buildingPiece: BuildingPiece | null;
  isSelected: boolean;
  isHovered: boolean;
  onClick: () => void;
  onHover: (hovered: boolean) => void;
  onDragStart: () => void;
  onDrag: (position: Position3D) => void;
  onDragEnd: () => void;
  gridConfig: GridSnapConfig;
  isDragging: boolean;
}

function PieceMesh({
  piece,
  buildingPiece,
  isSelected,
  isHovered,
  onClick,
  onHover,
  onDragStart,
  onDrag,
  onDragEnd,
  gridConfig,
  isDragging,
}: PieceMeshProps) {
  const groupRef = useRef<THREE.Group>(null);
  const { camera, raycaster, pointer } = useThree();
  const dragStartPos = useRef<THREE.Vector3 | null>(null);
  const initialPiecePos = useRef<Position3D | null>(null);

  // Color based on piece type for fallback
  const colors: Record<string, string> = {
    wall: "#8B4513",
    door: "#654321",
    window: "#87CEEB",
    roof: "#A0522D",
    floor: "#808080",
  };

  const pieceType = buildingPiece?.type || "wall";
  const baseColor = colors[pieceType] || "#888888";

  // Visual state colors
  const getColor = () => {
    if (isSelected) return "#00ffff";
    if (isHovered) return "#66ccff";
    return baseColor;
  };

  const hasModel = buildingPiece?.modelUrl && buildingPiece.modelUrl.length > 0;

  // Handle pointer down for drag start
  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();

    // Calculate intersection with ground plane
    const groundPlane = new THREE.Plane(
      new THREE.Vector3(0, 1, 0),
      -gridConfig.gridHeight,
    );
    const intersection = new THREE.Vector3();
    raycaster.setFromCamera(pointer, camera);
    raycaster.ray.intersectPlane(groundPlane, intersection);

    dragStartPos.current = intersection.clone();
    initialPiecePos.current = { ...piece.transform.position };

    onDragStart();

    // Add window listeners for drag
    const handlePointerMove = (moveEvent: PointerEvent) => {
      if (!dragStartPos.current || !initialPiecePos.current) return;

      // Update pointer for raycaster
      const rect = (moveEvent.target as HTMLElement)?.getBoundingClientRect?.();
      if (!rect) return;

      const x = ((moveEvent.clientX - rect.left) / rect.width) * 2 - 1;
      const y = -((moveEvent.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(new THREE.Vector2(x, y), camera);
      const newIntersection = new THREE.Vector3();
      raycaster.ray.intersectPlane(groundPlane, newIntersection);

      if (newIntersection) {
        const delta = newIntersection.clone().sub(dragStartPos.current);

        let newX = initialPiecePos.current.x + delta.x;
        let newZ = initialPiecePos.current.z + delta.z;
        const newY = initialPiecePos.current.y;

        // Snap to grid
        if (gridConfig.enabled) {
          newX = Math.round(newX / gridConfig.size) * gridConfig.size;
          newZ = Math.round(newZ / gridConfig.size) * gridConfig.size;
        }

        onDrag({ x: newX, y: newY, z: newZ });
      }
    };

    const handlePointerUp = () => {
      dragStartPos.current = null;
      initialPiecePos.current = null;
      onDragEnd();
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  };

  return (
    <group
      ref={groupRef}
      position={[
        piece.transform.position.x,
        piece.transform.position.y,
        piece.transform.position.z,
      ]}
      rotation={[
        THREE.MathUtils.degToRad(piece.transform.rotation.x),
        THREE.MathUtils.degToRad(piece.transform.rotation.y),
        THREE.MathUtils.degToRad(piece.transform.rotation.z),
      ]}
      scale={[
        piece.transform.scale.x,
        piece.transform.scale.y,
        piece.transform.scale.z,
      ]}
      onClick={(e) => {
        e.stopPropagation();
        if (!isDragging) onClick();
      }}
      onPointerDown={handlePointerDown}
      onPointerEnter={() => onHover(true)}
      onPointerLeave={() => onHover(false)}
    >
      {hasModel ? (
        <Suspense
          fallback={
            <mesh>
              <boxGeometry args={[1, 1, 1]} />
              <meshStandardMaterial color={getColor()} wireframe />
            </mesh>
          }
        >
          <group>
            <GLBModel
              url={buildingPiece.modelUrl}
              isSelected={isSelected}
              onClick={() => {}}
            />
            {/* Selection/hover outline */}
            {(isSelected || isHovered) && (
              <mesh>
                <boxGeometry args={[1.1, 1.1, 1.1]} />
                <meshBasicMaterial
                  color={isSelected ? "#00ffff" : "#66ccff"}
                  wireframe
                  transparent
                  opacity={isSelected ? 0.8 : 0.5}
                />
              </mesh>
            )}
          </group>
        </Suspense>
      ) : (
        // Fallback placeholder cube when no model URL
        <mesh>
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial
            color={getColor()}
            emissive={
              isSelected ? "#003333" : isHovered ? "#001a33" : "#000000"
            }
          />
          {(isSelected || isHovered) && (
            <lineSegments>
              <edgesGeometry args={[new THREE.BoxGeometry(1.02, 1.02, 1.02)]} />
              <lineBasicMaterial color={isSelected ? "#00ffff" : "#66ccff"} />
            </lineSegments>
          )}
        </mesh>
      )}
    </group>
  );
}

// =============================================================================
// GHOST PREVIEW COMPONENT
// =============================================================================

interface GhostPreviewProps {
  piece: BuildingPiece;
  gridConfig: GridSnapConfig;
}

function GhostPreview({ piece, gridConfig }: GhostPreviewProps) {
  const groupRef = useRef<THREE.Group>(null);
  const [position, setPosition] = useState<Position3D>({ x: 0, y: 0, z: 0 });
  const { camera, raycaster, pointer } = useThree();

  // Update position on mouse move
  useFrame(() => {
    const groundPlane = new THREE.Plane(
      new THREE.Vector3(0, 1, 0),
      -gridConfig.gridHeight,
    );
    const intersection = new THREE.Vector3();

    raycaster.setFromCamera(pointer, camera);
    raycaster.ray.intersectPlane(groundPlane, intersection);

    if (intersection) {
      let x = intersection.x;
      let z = intersection.z;
      const y = gridConfig.gridHeight;

      if (gridConfig.enabled) {
        x = Math.round(x / gridConfig.size) * gridConfig.size;
        z = Math.round(z / gridConfig.size) * gridConfig.size;
      }

      setPosition({ x, y, z });
    }
  });

  const colors: Record<string, string> = {
    wall: "#8B4513",
    door: "#654321",
    window: "#87CEEB",
    roof: "#A0522D",
    floor: "#808080",
  };

  const hasModel = piece.modelUrl && piece.modelUrl.length > 0;

  return (
    <group ref={groupRef} position={[position.x, position.y + 0.5, position.z]}>
      {hasModel ? (
        <Suspense
          fallback={
            <mesh>
              <boxGeometry args={[1, 1, 1]} />
              <meshStandardMaterial
                color={colors[piece.type]}
                transparent
                opacity={0.5}
                wireframe
              />
            </mesh>
          }
        >
          <group>
            <GLBModel
              url={piece.modelUrl}
              isSelected={false}
              onClick={() => {}}
            />
            {/* Overlay for ghost effect */}
            <mesh>
              <boxGeometry args={[1.05, 1.05, 1.05]} />
              <meshBasicMaterial
                color="#00ffff"
                transparent
                opacity={0.3}
                wireframe
              />
            </mesh>
          </group>
        </Suspense>
      ) : (
        <mesh>
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial
            color={colors[piece.type] || "#888888"}
            transparent
            opacity={0.5}
          />
        </mesh>
      )}
    </group>
  );
}

// =============================================================================
// PLACEMENT HANDLER
// =============================================================================

interface PlacementHandlerProps {
  piece: BuildingPiece;
  gridConfig: GridSnapConfig;
  onPlace: (position: Position3D) => void;
}

function PlacementHandler({
  piece,
  gridConfig,
  onPlace,
}: PlacementHandlerProps) {
  const { camera, raycaster, pointer } = useThree();

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (event.button !== 0) return;

      const groundPlane = new THREE.Plane(
        new THREE.Vector3(0, 1, 0),
        -gridConfig.gridHeight,
      );
      const intersection = new THREE.Vector3();

      raycaster.setFromCamera(pointer, camera);
      raycaster.ray.intersectPlane(groundPlane, intersection);

      if (intersection) {
        let x = intersection.x;
        let z = intersection.z;
        const y = gridConfig.gridHeight;

        if (gridConfig.enabled) {
          x = Math.round(x / gridConfig.size) * gridConfig.size;
          z = Math.round(z / gridConfig.size) * gridConfig.size;
        }

        onPlace({ x, y: y + 0.5, z });
      }
    };

    window.addEventListener("click", handleClick);
    return () => window.removeEventListener("click", handleClick);
  }, [piece, gridConfig, onPlace, camera, raycaster, pointer]);

  return null;
}

// =============================================================================
// SCENE CONTENT
// =============================================================================

interface SceneContentProps {
  structure: StructureDefinition | null;
  selectedPieceId: string | null;
  onSelectPiece: (id: string | null) => void;
  placingPiece: BuildingPiece | null;
  onPlacePiece: (
    piece: BuildingPiece,
    position: { x: number; y: number; z: number },
  ) => void;
  tool: StructureEditorTool;
  transformMode: TransformMode;
  gridConfig: GridSnapConfig;
  onTransformPiece: (
    pieceId: string,
    transform: Partial<PieceTransform>,
  ) => void;
  pieceLibrary: BuildingPiece[];
  onDuplicatePiece?: (pieceInstanceId: string) => void;
  onDeletePiece?: (pieceInstanceId: string) => void;
}

function SceneContent({
  structure,
  selectedPieceId,
  onSelectPiece,
  placingPiece,
  onPlacePiece,
  tool,
  transformMode: _transformMode,
  gridConfig,
  onTransformPiece,
  pieceLibrary,
  onDuplicatePiece,
  onDeletePiece,
}: SceneContentProps) {
  const orbitRef = useRef<OrbitControlsType>(null);
  const [hoveredPieceId, setHoveredPieceId] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Build a map for quick piece lookup
  const pieceMap = useMemo(() => {
    const map = new Map<string, BuildingPiece>();
    for (const p of pieceLibrary) {
      map.set(p.id, p);
    }
    return map;
  }, [pieceLibrary]);

  // Handle drag start - disable orbit controls
  const handleDragStart = useCallback(() => {
    setIsDragging(true);
    if (orbitRef.current) {
      orbitRef.current.enabled = false;
    }
  }, []);

  // Handle drag end - re-enable orbit controls
  const handleDragEnd = useCallback(() => {
    setIsDragging(false);
    if (orbitRef.current) {
      orbitRef.current.enabled = true;
    }
  }, []);

  // Handle piece drag (update position)
  const handlePieceDrag = useCallback(
    (pieceId: string, position: Position3D) => {
      onTransformPiece(pieceId, { position });
    },
    [onTransformPiece],
  );

  const handleBackgroundClick = useCallback(() => {
    if (tool === "select" && !isDragging) {
      onSelectPiece(null);
    }
  }, [tool, onSelectPiece, isDragging]);

  // Keyboard shortcuts for selected piece
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!selectedPieceId) return;

      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;

      // D = Duplicate
      if (e.key === "d" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        onDuplicatePiece?.(selectedPieceId);
      }

      // Delete/Backspace = Delete
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        onDeletePiece?.(selectedPieceId);
      }

      // R = Rotate 90 degrees
      if (e.key === "r" && !e.ctrlKey && !e.metaKey) {
        const piece = structure?.pieces.find((p) => p.id === selectedPieceId);
        if (piece) {
          onTransformPiece(selectedPieceId, {
            rotation: {
              ...piece.transform.rotation,
              y: piece.transform.rotation.y + 90,
            },
          });
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    selectedPieceId,
    onDuplicatePiece,
    onDeletePiece,
    onTransformPiece,
    structure,
  ]);

  return (
    <>
      <OrbitControls
        ref={orbitRef}
        makeDefault
        enableDamping
        dampingFactor={0.05}
      />

      <Environment preset="warehouse" />
      <ambientLight intensity={0.5} />
      <directionalLight position={[10, 10, 5]} intensity={1} castShadow />

      {gridConfig.showGrid && (
        <Grid
          args={[20, 20]}
          position={[0, gridConfig.gridHeight, 0]}
          cellSize={gridConfig.size}
          cellThickness={0.5}
          cellColor="#444444"
          sectionSize={gridConfig.size * 4}
          sectionThickness={1}
          sectionColor="#666666"
          fadeDistance={50}
          fadeStrength={1}
          followCamera={false}
          infiniteGrid
        />
      )}

      {/* Invisible ground plane for click-to-deselect */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, gridConfig.gridHeight - 0.01, 0]}
        onClick={handleBackgroundClick}
        visible={false}
      >
        <planeGeometry args={[100, 100]} />
        <meshBasicMaterial transparent opacity={0} />
      </mesh>

      {/* Render placed pieces with actual models */}
      {structure?.pieces.map((piece) => {
        const buildingPiece = pieceMap.get(piece.pieceId) || null;
        return (
          <PieceMesh
            key={piece.id}
            piece={piece}
            buildingPiece={buildingPiece}
            isSelected={piece.id === selectedPieceId}
            isHovered={piece.id === hoveredPieceId}
            onClick={() => {
              if (tool === "select" || tool === "delete") {
                onSelectPiece(piece.id);
                if (tool === "delete") {
                  onDeletePiece?.(piece.id);
                }
              }
            }}
            onHover={(hovered) => setHoveredPieceId(hovered ? piece.id : null)}
            onDragStart={handleDragStart}
            onDrag={(pos) => handlePieceDrag(piece.id, pos)}
            onDragEnd={handleDragEnd}
            gridConfig={gridConfig}
            isDragging={isDragging}
          />
        );
      })}

      {/* Ghost preview when placing */}
      {placingPiece && tool === "place" && (
        <>
          <GhostPreview piece={placingPiece} gridConfig={gridConfig} />
          <PlacementHandler
            piece={placingPiece}
            gridConfig={gridConfig}
            onPlace={(pos) => onPlacePiece(placingPiece, pos)}
          />
        </>
      )}

      <GizmoHelper alignment="bottom-right" margin={[80, 80]}>
        <GizmoViewport
          axisColors={["#ff4444", "#44ff44", "#4444ff"]}
          labelColor="white"
        />
      </GizmoHelper>
    </>
  );
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function StructureViewport({
  structure,
  selectedPieceId,
  onSelectPiece,
  placingPiece,
  onPlacePiece,
  onPlacingComplete: _onPlacingComplete,
  tool,
  transformMode,
  gridConfig,
  onTransformPiece,
  pieceLibrary = [],
  onDuplicatePiece,
  onDeletePiece,
}: StructureViewportProps) {
  // Load piece library if not provided
  const [loadedPieces, setLoadedPieces] = useState<BuildingPiece[]>([]);

  useEffect(() => {
    if (pieceLibrary.length === 0) {
      fetch("/api/structures/pieces")
        .then((res) => res.json())
        .then((data) => setLoadedPieces(data.pieces || []))
        .catch((err) => log.error("Failed to load pieces", { error: err }));
    }
  }, [pieceLibrary.length]);

  const activePieceLibrary =
    pieceLibrary.length > 0 ? pieceLibrary : loadedPieces;

  return (
    <div className="w-full h-full bg-zinc-900">
      <Canvas
        camera={{ position: [10, 10, 10], fov: 50 }}
        shadows
        gl={{ antialias: true, alpha: false }}
        onCreated={({ gl }) => {
          gl.setClearColor("#18181b");
        }}
      >
        <Suspense fallback={null}>
          <SceneContent
            structure={structure}
            selectedPieceId={selectedPieceId}
            onSelectPiece={onSelectPiece}
            placingPiece={placingPiece}
            onPlacePiece={(piece, pos) => {
              onPlacePiece(piece, pos);
            }}
            tool={tool}
            transformMode={transformMode}
            gridConfig={gridConfig}
            onTransformPiece={onTransformPiece}
            pieceLibrary={activePieceLibrary}
            onDuplicatePiece={onDuplicatePiece}
            onDeletePiece={onDeletePiece}
          />
        </Suspense>
      </Canvas>

      {/* Status bar */}
      <div className="absolute bottom-4 left-4 px-3 py-2 rounded-lg bg-black/80 text-xs font-mono border border-zinc-700">
        <div className="flex items-center gap-4">
          <span>
            <span className="text-muted-foreground">Snap: </span>
            <span
              className={gridConfig.enabled ? "text-cyan-400" : "text-zinc-500"}
            >
              {gridConfig.enabled ? `${gridConfig.size}m` : "OFF"}
            </span>
          </span>
          <span>
            <span className="text-muted-foreground">Tool: </span>
            <span className="text-cyan-400">{tool}</span>
          </span>
          {placingPiece && (
            <span>
              <span className="text-muted-foreground">Placing: </span>
              <span className="text-green-400">{placingPiece.name}</span>
            </span>
          )}
          {selectedPieceId && <span className="text-cyan-400">Selected</span>}
        </div>
      </div>

      {/* Keyboard shortcuts help */}
      <div className="absolute bottom-4 right-4 px-3 py-2 rounded-lg bg-black/60 text-xs text-white/40">
        <div className="space-y-0.5">
          <div>Click to select • Drag to move</div>
          <div>R: Rotate • D: Duplicate • Del: Delete</div>
        </div>
      </div>
    </div>
  );
}
