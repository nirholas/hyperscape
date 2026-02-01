/**
 * Leaf Card Cluster Generator
 *
 * AAA technique for efficient foliage rendering:
 * 1. Spatially clusters leaves using octree subdivision
 * 2. Generates billboard cards for each cluster
 * 3. Cards can be used at LOD1/LOD2 for massive draw call reduction
 *
 * Industry references: SpeedTree, Assassin's Creed, Far Cry vegetation systems
 *
 * Performance gains:
 * - 1000 individual leaves → ~50 cluster cards
 * - Single instanced draw call for all clusters
 * - Depth-sorted rendering for correct transparency
 */

import * as THREE from "three";
import type { LeafData, TreeParams } from "../types.js";

// ============================================================================
// TYPES
// ============================================================================

/**
 * A cluster of leaves that will be rendered as a single billboard card.
 */
export interface LeafCluster {
  /** Unique cluster ID */
  id: number;
  /** Center position of the cluster (world space) */
  center: THREE.Vector3;
  /** Bounding box of the cluster */
  bounds: THREE.Box3;
  /** Indices of leaves in this cluster */
  leafIndices: number[];
  /** Average leaf direction (for billboard orientation) */
  averageDirection: THREE.Vector3;
  /** Billboard width (based on cluster extent) */
  width: number;
  /** Billboard height (based on cluster extent) */
  height: number;
  /** Cluster density (leaves per cubic meter) */
  density: number;
  /** LOD level this cluster is optimized for (0=close, 1=medium, 2=far) */
  lodLevel: number;
}

/**
 * Result of leaf clustering operation.
 */
export interface LeafClusterResult {
  /** Generated clusters */
  clusters: LeafCluster[];
  /** Original leaves (for reference) */
  leaves: LeafData[];
  /** Tree parameters used */
  params: TreeParams;
  /** Total leaf count */
  totalLeaves: number;
  /** Clustering statistics */
  stats: {
    avgLeavesPerCluster: number;
    maxLeavesPerCluster: number;
    minLeavesPerCluster: number;
    clusterCount: number;
    reductionRatio: number;
  };
}

/**
 * Options for leaf clustering.
 */
export interface LeafClusterOptions {
  /** Minimum leaves per cluster (smaller clusters are merged) */
  minLeavesPerCluster?: number;
  /** Maximum leaves per cluster (larger clusters are subdivided) */
  maxLeavesPerCluster?: number;
  /** Minimum cluster size in meters (prevents tiny clusters) */
  minClusterSize?: number;
  /** Maximum cluster size in meters (prevents giant clusters) */
  maxClusterSize?: number;
  /** LOD level to optimize for (affects clustering granularity) */
  lodLevel?: number;
}

/**
 * Octree node for spatial partitioning.
 */
interface OctreeNode {
  bounds: THREE.Box3;
  leafIndices: number[];
  children: OctreeNode[] | null;
  depth: number;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_OPTIONS: Required<LeafClusterOptions> = {
  minLeavesPerCluster: 5,
  maxLeavesPerCluster: 100,
  minClusterSize: 0.3,
  maxClusterSize: 2.0,
  lodLevel: 1,
};

const MAX_OCTREE_DEPTH = 6;
const OCTREE_LEAF_THRESHOLD = 20; // Max leaves per octree node before subdivision

// ============================================================================
// LEAF CLUSTER GENERATOR
// ============================================================================

/**
 * Generates leaf clusters from individual leaf data.
 *
 * Algorithm:
 * 1. Build octree from leaf positions
 * 2. Extract clusters from octree nodes
 * 3. Merge small clusters, split large ones
 * 4. Calculate billboard dimensions for each cluster
 */
export class LeafClusterGenerator {
  private options: Required<LeafClusterOptions>;

  constructor(options: LeafClusterOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Generate clusters from leaf data.
   *
   * @param leaves - Array of leaf data from tree generation
   * @param params - Tree parameters for context
   * @returns Cluster result with all generated clusters
   */
  generateClusters(leaves: LeafData[], params: TreeParams): LeafClusterResult {
    if (leaves.length === 0) {
      return this.emptyResult(leaves, params);
    }

    // Step 1: Build octree from leaf positions
    const octree = this.buildOctree(leaves);

    // Step 2: Extract initial clusters from octree leaves
    let clusters = this.extractClustersFromOctree(octree, leaves);

    // Step 3: Merge small clusters
    clusters = this.mergeSmallClusters(clusters, leaves);

    // Step 4: Split large clusters
    clusters = this.splitLargeClusters(clusters, leaves);

    // Step 5: Calculate billboard dimensions
    clusters = clusters.map((c, i) => this.finalizeCluster(c, i, leaves));

    // Step 6: Sort by distance from tree center for better rendering
    const treeCenter = this.calculateTreeCenter(leaves);
    clusters.sort((a, b) => {
      return (
        b.center.distanceToSquared(treeCenter) -
        a.center.distanceToSquared(treeCenter)
      );
    });

    return {
      clusters,
      leaves,
      params,
      totalLeaves: leaves.length,
      stats: this.calculateStats(clusters, leaves.length),
    };
  }

  /**
   * Build an octree from leaf positions for spatial partitioning.
   */
  private buildOctree(leaves: LeafData[]): OctreeNode {
    // Calculate bounding box of all leaves
    const bounds = new THREE.Box3();
    for (const leaf of leaves) {
      bounds.expandByPoint(leaf.position);
    }

    // Expand bounds slightly to avoid edge cases
    bounds.expandByScalar(0.1);

    // Create root node with all leaf indices
    const root: OctreeNode = {
      bounds,
      leafIndices: leaves.map((_, i) => i),
      children: null,
      depth: 0,
    };

    // Recursively subdivide
    this.subdivideOctree(root, leaves);

    return root;
  }

  /**
   * Recursively subdivide an octree node if it has too many leaves.
   */
  private subdivideOctree(node: OctreeNode, leaves: LeafData[]): void {
    // Stop if too deep or few enough leaves
    if (
      node.depth >= MAX_OCTREE_DEPTH ||
      node.leafIndices.length <= OCTREE_LEAF_THRESHOLD
    ) {
      return;
    }

    // Calculate center and create 8 child bounds
    const center = new THREE.Vector3();
    node.bounds.getCenter(center);

    const min = node.bounds.min;
    const max = node.bounds.max;

    // Create 8 octants
    const childBounds: THREE.Box3[] = [
      new THREE.Box3(
        new THREE.Vector3(min.x, min.y, min.z),
        new THREE.Vector3(center.x, center.y, center.z),
      ),
      new THREE.Box3(
        new THREE.Vector3(center.x, min.y, min.z),
        new THREE.Vector3(max.x, center.y, center.z),
      ),
      new THREE.Box3(
        new THREE.Vector3(min.x, center.y, min.z),
        new THREE.Vector3(center.x, max.y, center.z),
      ),
      new THREE.Box3(
        new THREE.Vector3(center.x, center.y, min.z),
        new THREE.Vector3(max.x, max.y, center.z),
      ),
      new THREE.Box3(
        new THREE.Vector3(min.x, min.y, center.z),
        new THREE.Vector3(center.x, center.y, max.z),
      ),
      new THREE.Box3(
        new THREE.Vector3(center.x, min.y, center.z),
        new THREE.Vector3(max.x, center.y, max.z),
      ),
      new THREE.Box3(
        new THREE.Vector3(min.x, center.y, center.z),
        new THREE.Vector3(center.x, max.y, max.z),
      ),
      new THREE.Box3(
        new THREE.Vector3(center.x, center.y, center.z),
        new THREE.Vector3(max.x, max.y, max.z),
      ),
    ];

    // Distribute leaves to children
    node.children = childBounds.map((bounds) => ({
      bounds,
      leafIndices: [] as number[],
      children: null,
      depth: node.depth + 1,
    }));

    for (const leafIdx of node.leafIndices) {
      const pos = leaves[leafIdx].position;
      for (let i = 0; i < 8; i++) {
        if (node.children[i].bounds.containsPoint(pos)) {
          node.children[i].leafIndices.push(leafIdx);
          break;
        }
      }
    }

    // Clear parent's leaf indices (they're now in children)
    node.leafIndices = [];

    // Recursively subdivide non-empty children
    for (const child of node.children) {
      if (child.leafIndices.length > 0) {
        this.subdivideOctree(child, leaves);
      }
    }
  }

  /**
   * Extract clusters from octree leaf nodes.
   */
  private extractClustersFromOctree(
    node: OctreeNode,
    leaves: LeafData[],
  ): LeafCluster[] {
    const clusters: LeafCluster[] = [];

    const traverse = (n: OctreeNode) => {
      if (n.children) {
        // Internal node - traverse children
        for (const child of n.children) {
          traverse(child);
        }
      } else if (n.leafIndices.length > 0) {
        // Leaf node with leaves - create cluster
        const cluster = this.createClusterFromIndices(
          n.leafIndices,
          leaves,
          n.bounds,
        );
        if (cluster) {
          clusters.push(cluster);
        }
      }
    };

    traverse(node);
    return clusters;
  }

  /**
   * Create a cluster from a set of leaf indices.
   */
  private createClusterFromIndices(
    indices: number[],
    leaves: LeafData[],
    _bounds: THREE.Box3,
  ): LeafCluster | null {
    if (indices.length === 0) return null;

    // Calculate center
    const center = new THREE.Vector3();
    for (const idx of indices) {
      center.add(leaves[idx].position);
    }
    center.divideScalar(indices.length);

    // Calculate average direction
    const avgDirection = new THREE.Vector3();
    for (const idx of indices) {
      avgDirection.add(leaves[idx].direction);
    }
    avgDirection.normalize();

    // Calculate tight bounds
    const tightBounds = new THREE.Box3();
    for (const idx of indices) {
      tightBounds.expandByPoint(leaves[idx].position);
    }

    const size = new THREE.Vector3();
    tightBounds.getSize(size);

    // Calculate density
    const volume = Math.max(0.001, size.x * size.y * size.z);
    const density = indices.length / volume;

    return {
      id: 0, // Will be assigned later
      center,
      bounds: tightBounds,
      leafIndices: [...indices],
      averageDirection: avgDirection,
      width: Math.max(size.x, size.z),
      height: size.y,
      density,
      lodLevel: this.options.lodLevel,
    };
  }

  /**
   * Merge clusters that are too small.
   */
  private mergeSmallClusters(
    clusters: LeafCluster[],
    leaves: LeafData[],
  ): LeafCluster[] {
    const minLeaves = this.options.minLeavesPerCluster;
    const maxSize = this.options.maxClusterSize;

    const result: LeafCluster[] = [];
    const merged = new Set<number>();

    for (let i = 0; i < clusters.length; i++) {
      if (merged.has(i)) continue;

      const cluster = clusters[i];

      if (cluster.leafIndices.length >= minLeaves) {
        result.push(cluster);
        continue;
      }

      // Find nearest neighbor to merge with
      let nearestIdx = -1;
      let nearestDist = Infinity;

      for (let j = 0; j < clusters.length; j++) {
        if (i === j || merged.has(j)) continue;

        const dist = cluster.center.distanceToSquared(clusters[j].center);
        if (dist < nearestDist) {
          nearestDist = dist;
          nearestIdx = j;
        }
      }

      if (nearestIdx >= 0) {
        const neighbor = clusters[nearestIdx];

        // Check if merged cluster would be too large
        const mergedBounds = cluster.bounds.clone().union(neighbor.bounds);
        const mergedSize = new THREE.Vector3();
        mergedBounds.getSize(mergedSize);

        if (Math.max(mergedSize.x, mergedSize.y, mergedSize.z) <= maxSize) {
          // Merge clusters
          const mergedIndices = [
            ...cluster.leafIndices,
            ...neighbor.leafIndices,
          ];
          const mergedCluster = this.createClusterFromIndices(
            mergedIndices,
            leaves,
            mergedBounds,
          );

          if (mergedCluster) {
            result.push(mergedCluster);
            merged.add(i);
            merged.add(nearestIdx);
          }
        } else {
          // Can't merge - keep original
          result.push(cluster);
        }
      } else {
        // No neighbor found - keep original
        result.push(cluster);
      }
    }

    return result;
  }

  /**
   * Split clusters that are too large.
   */
  private splitLargeClusters(
    clusters: LeafCluster[],
    leaves: LeafData[],
  ): LeafCluster[] {
    const maxLeaves = this.options.maxLeavesPerCluster;
    const maxSize = this.options.maxClusterSize;

    const result: LeafCluster[] = [];

    for (const cluster of clusters) {
      const size = new THREE.Vector3();
      cluster.bounds.getSize(size);
      const maxDim = Math.max(size.x, size.y, size.z);

      if (cluster.leafIndices.length <= maxLeaves && maxDim <= maxSize) {
        result.push(cluster);
        continue;
      }

      // Split along longest axis
      const center = cluster.center.clone();
      let splitAxis: "x" | "y" | "z" = "x";
      if (size.y > size.x && size.y > size.z) splitAxis = "y";
      else if (size.z > size.x) splitAxis = "z";

      const splitValue = center[splitAxis];

      const leftIndices: number[] = [];
      const rightIndices: number[] = [];

      for (const idx of cluster.leafIndices) {
        if (leaves[idx].position[splitAxis] < splitValue) {
          leftIndices.push(idx);
        } else {
          rightIndices.push(idx);
        }
      }

      // Create sub-clusters
      if (leftIndices.length > 0) {
        const leftBounds = new THREE.Box3();
        for (const idx of leftIndices) {
          leftBounds.expandByPoint(leaves[idx].position);
        }
        const leftCluster = this.createClusterFromIndices(
          leftIndices,
          leaves,
          leftBounds,
        );
        if (leftCluster) {
          result.push(leftCluster);
        }
      }

      if (rightIndices.length > 0) {
        const rightBounds = new THREE.Box3();
        for (const idx of rightIndices) {
          rightBounds.expandByPoint(leaves[idx].position);
        }
        const rightCluster = this.createClusterFromIndices(
          rightIndices,
          leaves,
          rightBounds,
        );
        if (rightCluster) {
          result.push(rightCluster);
        }
      }
    }

    return result;
  }

  /**
   * Finalize cluster with proper ID and billboard dimensions.
   */
  private finalizeCluster(
    cluster: LeafCluster,
    id: number,
    _leaves: LeafData[],
  ): LeafCluster {
    // Update ID
    cluster.id = id;

    // Calculate billboard dimensions with padding
    const size = new THREE.Vector3();
    cluster.bounds.getSize(size);

    // Billboard should encompass cluster with some padding
    const padding = 0.1;
    cluster.width = Math.max(size.x, size.z) + padding * 2;
    cluster.height = size.y + padding * 2;

    // Minimum billboard size
    cluster.width = Math.max(cluster.width, this.options.minClusterSize);
    cluster.height = Math.max(cluster.height, this.options.minClusterSize);

    // Recalculate center to be at bottom-center of billboard
    // (for proper ground placement)
    const boundsCenter = new THREE.Vector3();
    cluster.bounds.getCenter(boundsCenter);
    cluster.center.copy(boundsCenter);
    cluster.center.y = cluster.bounds.min.y;

    return cluster;
  }

  /**
   * Calculate the center of all leaves (tree centroid).
   */
  private calculateTreeCenter(leaves: LeafData[]): THREE.Vector3 {
    const center = new THREE.Vector3();
    for (const leaf of leaves) {
      center.add(leaf.position);
    }
    return center.divideScalar(Math.max(1, leaves.length));
  }

  /**
   * Calculate clustering statistics.
   */
  private calculateStats(
    clusters: LeafCluster[],
    totalLeaves: number,
  ): LeafClusterResult["stats"] {
    if (clusters.length === 0) {
      return {
        avgLeavesPerCluster: 0,
        maxLeavesPerCluster: 0,
        minLeavesPerCluster: 0,
        clusterCount: 0,
        reductionRatio: 0,
      };
    }

    const counts = clusters.map((c) => c.leafIndices.length);
    const sum = counts.reduce((a, b) => a + b, 0);

    return {
      avgLeavesPerCluster: sum / clusters.length,
      maxLeavesPerCluster: Math.max(...counts),
      minLeavesPerCluster: Math.min(...counts),
      clusterCount: clusters.length,
      reductionRatio: totalLeaves / clusters.length,
    };
  }

  /**
   * Return empty result for trees with no leaves.
   */
  private emptyResult(
    leaves: LeafData[],
    params: TreeParams,
  ): LeafClusterResult {
    return {
      clusters: [],
      leaves,
      params,
      totalLeaves: 0,
      stats: {
        avgLeavesPerCluster: 0,
        maxLeavesPerCluster: 0,
        minLeavesPerCluster: 0,
        clusterCount: 0,
        reductionRatio: 0,
      },
    };
  }
}

// ============================================================================
// CLUSTER BILLBOARD GEOMETRY
// ============================================================================

/**
 * Create billboard geometry for a leaf cluster.
 *
 * @param cluster - The cluster to create geometry for
 * @returns BufferGeometry for the billboard
 */
export function createClusterBillboardGeometry(
  cluster: LeafCluster,
): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();

  const w = cluster.width / 2;
  const h = cluster.height;

  // Billboard quad (bottom-center origin)
  const positions = new Float32Array([
    -w,
    0,
    0, // bottom-left
    w,
    0,
    0, // bottom-right
    w,
    h,
    0, // top-right
    -w,
    h,
    0, // top-left
  ]);

  const normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]);

  const uvs = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);

  const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);

  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));

  return geometry;
}

/**
 * Create instance transforms for all clusters.
 *
 * @param clusters - Array of clusters
 * @returns Array of Matrix4 transforms (position + rotation to face camera)
 */
export function createClusterTransforms(
  clusters: LeafCluster[],
): THREE.Matrix4[] {
  return clusters.map((cluster) => {
    const matrix = new THREE.Matrix4();
    matrix.setPosition(cluster.center);
    return matrix;
  });
}

// ============================================================================
// CLUSTER MATERIAL HELPERS
// ============================================================================

/**
 * Options for cluster material creation.
 */
export interface ClusterMaterialOptions {
  /** Base leaf color */
  color?: THREE.Color;
  /** Color variation per-cluster */
  colorVariation?: number;
  /** Alpha test threshold */
  alphaTest?: number;
  /** Enable wind animation */
  enableWind?: boolean;
  /** Wind strength multiplier */
  windStrength?: number;
}

/**
 * Leaf density map info for cluster rendering.
 * Used to vary alpha/opacity based on cluster density.
 */
export interface ClusterDensityInfo {
  /** Cluster ID */
  clusterId: number;
  /** Normalized density (0-1) */
  normalizedDensity: number;
  /** Leaf count in cluster */
  leafCount: number;
}

/**
 * Calculate normalized density for all clusters.
 */
export function calculateClusterDensities(
  clusters: LeafCluster[],
): ClusterDensityInfo[] {
  if (clusters.length === 0) return [];

  const densities = clusters.map((c) => c.density);
  const maxDensity = Math.max(...densities);
  const minDensity = Math.min(...densities);
  const range = Math.max(0.001, maxDensity - minDensity);

  return clusters.map((cluster) => ({
    clusterId: cluster.id,
    normalizedDensity: (cluster.density - minDensity) / range,
    leafCount: cluster.leafIndices.length,
  }));
}

// ============================================================================
// EXPORTS
// ============================================================================

export { LeafClusterGenerator as default };
