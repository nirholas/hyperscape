/**
 * StationDataProvider - Runtime Data for World Stations
 *
 * Provides model paths and configuration for permanent world stations:
 * - Anvils (smithing)
 * - Furnaces (smelting)
 * - Ranges (cooking)
 * - Bank booths
 *
 * This follows the same data-driven pattern as ProcessingDataProvider,
 * loading station definitions from manifests/stations.json.
 *
 * Usage:
 *   const provider = StationDataProvider.getInstance();
 *   const anvilData = provider.getStationData("anvil");
 *   const model = anvilData?.model; // "asset://models/anvil/anvil.glb"
 *
 * @see packages/server/world/assets/manifests/stations.json
 */

// ============================================================================
// STATION MANIFEST TYPES
// ============================================================================

/**
 * Station definition from manifests/stations.json
 */
export interface StationManifestEntry {
  /** Station type identifier (anvil, furnace, range, bank) */
  type: string;
  /** Display name */
  name: string;
  /** Model path (asset:// URL) or null for placeholder geometry */
  model: string | null;
  /** Model scale factor */
  modelScale: number;
  /** Model Y offset to raise model so base sits on ground */
  modelYOffset: number;
  /** Examine text */
  examine: string;
}

/**
 * Full manifest structure for manifests/stations.json
 */
export interface StationsManifest {
  stations: StationManifestEntry[];
}

/**
 * Runtime station data with resolved values
 */
export interface StationData {
  type: string;
  name: string;
  model: string | null;
  modelScale: number;
  modelYOffset: number;
  examine: string;
}

// ============================================================================
// DEFAULT STATION DATA (fallback if manifest not loaded)
// ============================================================================

const DEFAULT_STATIONS: StationManifestEntry[] = [
  {
    type: "anvil",
    name: "Anvil",
    model: "asset://models/anvil/anvil.glb",
    modelScale: 0.5,
    modelYOffset: 0.4,
    examine: "An anvil for smithing metal bars into weapons and tools.",
  },
  {
    type: "furnace",
    name: "Furnace",
    model: "asset://models/furnace/furnace.glb",
    modelScale: 1.5,
    modelYOffset: 1.0,
    examine: "A furnace for smelting ores into metal bars.",
  },
  {
    type: "range",
    name: "Cooking Range",
    model: null,
    modelScale: 1.0,
    modelYOffset: 0,
    examine: "A range for cooking food. Reduces burn chance.",
  },
  {
    type: "bank",
    name: "Bank Booth",
    model: null,
    modelScale: 1.0,
    modelYOffset: 0,
    examine: "A bank booth for storing items.",
  },
];

// ============================================================================
// STATION DATA PROVIDER
// ============================================================================

/**
 * Runtime data provider for world station entities.
 * Provides model paths and configuration for anvils, furnaces, ranges, etc.
 */
export class StationDataProvider {
  private static instance: StationDataProvider;

  // Station lookup by type
  private stationsByType = new Map<string, StationData>();

  // Initialization state
  private isInitialized = false;

  private constructor() {
    // Initialize with defaults immediately
    this.buildFromManifest({ stations: DEFAULT_STATIONS });
  }

  /**
   * Get singleton instance
   */
  public static getInstance(): StationDataProvider {
    if (!StationDataProvider.instance) {
      StationDataProvider.instance = new StationDataProvider();
    }
    return StationDataProvider.instance;
  }

  // ==========================================================================
  // MANIFEST LOADING (called by DataManager)
  // ==========================================================================

  /**
   * Load station definitions from manifest.
   * Called by DataManager after loading manifests/stations.json.
   */
  public loadStations(manifest: StationsManifest): void {
    this.buildFromManifest(manifest);
  }

  /**
   * Build lookup tables from manifest data.
   */
  private buildFromManifest(manifest: StationsManifest): void {
    this.stationsByType.clear();

    for (const entry of manifest.stations) {
      const stationData: StationData = {
        type: entry.type,
        name: entry.name,
        model: entry.model,
        modelScale: entry.modelScale,
        modelYOffset: entry.modelYOffset ?? 0,
        examine: entry.examine,
      };

      this.stationsByType.set(entry.type, stationData);
    }

    this.isInitialized = true;
  }

  /**
   * Rebuild lookup tables (e.g., after manifest reload)
   */
  public rebuild(): void {
    // If we have loaded manifest data, it's already built
    // This method exists for consistency with ProcessingDataProvider
    this.isInitialized = true;
  }

  // ==========================================================================
  // DATA ACCESS METHODS
  // ==========================================================================

  /**
   * Get station data by type.
   * @param stationType - Station type (anvil, furnace, range, bank)
   * @returns Station data or undefined if not found
   */
  public getStationData(stationType: string): StationData | undefined {
    return this.stationsByType.get(stationType);
  }

  /**
   * Get model path for a station type.
   * @param stationType - Station type
   * @returns Model path or null if no model / not found
   */
  public getModelPath(stationType: string): string | null {
    return this.stationsByType.get(stationType)?.model ?? null;
  }

  /**
   * Get model scale for a station type.
   * @param stationType - Station type
   * @returns Model scale or 1.0 if not found
   */
  public getModelScale(stationType: string): number {
    return this.stationsByType.get(stationType)?.modelScale ?? 1.0;
  }

  /**
   * Get model Y offset for a station type.
   * Used to raise the model so its base sits on the ground.
   * @param stationType - Station type
   * @returns Y offset or 0 if not found
   */
  public getModelYOffset(stationType: string): number {
    return this.stationsByType.get(stationType)?.modelYOffset ?? 0;
  }

  /**
   * Get examine text for a station type.
   * @param stationType - Station type
   * @returns Examine text or default string if not found
   */
  public getExamineText(stationType: string): string {
    return (
      this.stationsByType.get(stationType)?.examine ??
      "A station for processing items."
    );
  }

  /**
   * Check if a station type exists in the manifest.
   * @param stationType - Station type to check
   */
  public hasStation(stationType: string): boolean {
    return this.stationsByType.has(stationType);
  }

  /**
   * Get all station types.
   */
  public getAllStationTypes(): string[] {
    return Array.from(this.stationsByType.keys());
  }

  /**
   * Check if provider is initialized.
   */
  public isReady(): boolean {
    return this.isInitialized;
  }
}

// Export singleton instance
export const stationDataProvider = StationDataProvider.getInstance();
