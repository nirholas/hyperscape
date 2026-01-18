/**
 * PrayerDataProvider - Runtime Data from Prayer Manifest
 *
 * Loads and provides access to prayer definitions from the prayers.json manifest.
 * This is the single source of truth for all prayer data including:
 * - Prayer definitions (name, level, bonuses, conflicts)
 * - Prayer lookup by ID
 * - Prayer validation
 *
 * Usage:
 *   const provider = PrayerDataProvider.getInstance();
 *   await provider.initialize(); // Called after DataManager loads manifests
 *   const prayer = provider.getPrayer("thick_skin");
 *   const allPrayers = provider.getAllPrayers();
 *
 * @see packages/server/world/assets/manifests/prayers.json for source data
 * @see packages/shared/src/types/game/prayer-types.ts for type definitions
 */

import {
  type PrayerDefinition,
  type PrayerManifest,
  type PrayerBonuses,
  type PrayerCategory,
  isValidPrayerId,
  isValidPrayerBonuses,
  MAX_ACTIVE_PRAYERS,
} from "../types/game/prayer-types";
import { Logger } from "../utils/Logger";

// Re-export types for consumers
export type { PrayerDefinition, PrayerBonuses, PrayerCategory };

// ============================================================================
// MANIFEST TYPE (matches prayers.json structure)
// ============================================================================

/**
 * Full manifest structure for prayers.json
 */
export interface PrayersManifest {
  prayers: PrayerDefinitionInput[];
}

/**
 * Prayer definition as read from JSON (before validation)
 */
interface PrayerDefinitionInput {
  id: string;
  name: string;
  description: string;
  icon: string;
  level: number;
  category: string;
  drainEffect: number;
  bonuses: Record<string, unknown>;
  conflicts: string[];
}

// ============================================================================
// PRAYER DATA PROVIDER
// ============================================================================

/**
 * Runtime data provider for the prayer system.
 * Loads prayers from manifest and provides type-safe access methods.
 *
 * Singleton pattern - use getInstance() to access.
 */
export class PrayerDataProvider {
  private static instance: PrayerDataProvider;
  private isInitialized = false;

  // Prayer lookup tables
  private prayerMap = new Map<string, PrayerDefinition>();
  private prayersByLevel = new Map<number, PrayerDefinition[]>();
  private prayersByCategory = new Map<PrayerCategory, PrayerDefinition[]>();

  // Loaded manifest (set by DataManager)
  private prayerManifest: PrayersManifest | null = null;

  // ============================================================================
  // PRE-ALLOCATED BUFFERS (Memory optimization - avoid allocation in hot paths)
  // ============================================================================

  /**
   * Pre-allocated Set for conflict checking.
   * Reused across getConflictingPrayers calls to avoid allocations.
   */
  private readonly conflictCheckBuffer = new Set<string>();

  /**
   * Pre-allocated array for returning prayers.
   * Used for methods that return arrays to avoid creating new arrays each call.
   * IMPORTANT: Callers should NOT store references to this array long-term.
   */
  private readonly prayerArrayBuffer: PrayerDefinition[] = [];

  private constructor() {
    // Singleton
  }

  public static getInstance(): PrayerDataProvider {
    if (!PrayerDataProvider.instance) {
      PrayerDataProvider.instance = new PrayerDataProvider();
    }
    return PrayerDataProvider.instance;
  }

  // ==========================================================================
  // MANIFEST LOADING (called by DataManager)
  // ==========================================================================

  /**
   * Load prayer definitions from manifest
   */
  public loadPrayers(manifest: PrayersManifest): void {
    this.prayerManifest = manifest;
  }

  /**
   * Check if prayer manifest is loaded
   */
  public hasPrayerManifest(): boolean {
    return this.prayerManifest !== null;
  }

  /**
   * Initialize the data provider by building lookup tables.
   * Must be called AFTER DataManager.initialize() has loaded the manifests.
   */
  public initialize(): void {
    if (this.isInitialized) {
      return;
    }

    if (this.prayerManifest) {
      this.buildPrayerDataFromManifest();
    } else {
      Logger.warn(
        "[PrayerDataProvider] No prayer manifest loaded - prayer system will be unavailable",
      );
    }

    this.isInitialized = true;

    Logger.system(
      "PrayerDataProvider",
      `Initialized: ${this.prayerMap.size} prayers loaded`,
    );
  }

  /**
   * Rebuild data (for hot-reload scenarios)
   */
  public rebuild(): void {
    this.prayerMap.clear();
    this.prayersByLevel.clear();
    this.prayersByCategory.clear();
    this.isInitialized = false;
    this.initialize();
  }

  // ==========================================================================
  // BUILD FROM MANIFEST
  // ==========================================================================

  /**
   * Build prayer lookup tables from prayers.json manifest
   */
  private buildPrayerDataFromManifest(): void {
    if (!this.prayerManifest) return;

    for (const input of this.prayerManifest.prayers) {
      // Validate prayer ID format (security)
      if (!isValidPrayerId(input.id)) {
        Logger.warn(
          `[PrayerDataProvider] Invalid prayer ID format: "${input.id}" - skipping`,
        );
        continue;
      }

      // Validate bonuses
      if (!isValidPrayerBonuses(input.bonuses)) {
        Logger.warn(
          `[PrayerDataProvider] Invalid bonuses for prayer "${input.id}" - skipping`,
        );
        continue;
      }

      // Validate category
      const category = input.category as PrayerCategory;
      if (!["offensive", "defensive", "utility"].includes(category)) {
        Logger.warn(
          `[PrayerDataProvider] Invalid category "${input.category}" for prayer "${input.id}" - skipping`,
        );
        continue;
      }

      // Validate conflicts are valid prayer IDs
      const validConflicts: string[] = [];
      for (const conflictId of input.conflicts) {
        if (isValidPrayerId(conflictId)) {
          validConflicts.push(conflictId);
        } else {
          Logger.warn(
            `[PrayerDataProvider] Invalid conflict ID "${conflictId}" in prayer "${input.id}" - ignoring`,
          );
        }
      }

      // Create validated prayer definition
      const prayer: PrayerDefinition = {
        id: input.id,
        name: input.name,
        description: input.description,
        icon: input.icon,
        level: Math.max(1, Math.min(99, input.level)), // Clamp to valid level range
        category,
        drainEffect: Math.max(0, input.drainEffect), // Ensure non-negative drain
        bonuses: input.bonuses as PrayerBonuses,
        conflicts: Object.freeze(validConflicts) as readonly string[],
      };

      // Add to main map
      this.prayerMap.set(prayer.id, prayer);

      // Add to level-grouped map
      const levelGroup = this.prayersByLevel.get(prayer.level) || [];
      levelGroup.push(prayer);
      this.prayersByLevel.set(prayer.level, levelGroup);

      // Add to category-grouped map
      const categoryGroup = this.prayersByCategory.get(prayer.category) || [];
      categoryGroup.push(prayer);
      this.prayersByCategory.set(prayer.category, categoryGroup);
    }
  }

  // ==========================================================================
  // PRAYER ACCESSORS
  // ==========================================================================

  /**
   * Get a prayer definition by ID
   */
  public getPrayer(prayerId: string): PrayerDefinition | null {
    this.ensureInitialized();
    return this.prayerMap.get(prayerId) || null;
  }

  /**
   * Check if a prayer ID exists
   */
  public prayerExists(prayerId: string): boolean {
    this.ensureInitialized();
    return this.prayerMap.has(prayerId);
  }

  /**
   * Get all prayer definitions
   */
  public getAllPrayers(): readonly PrayerDefinition[] {
    this.ensureInitialized();
    return Array.from(this.prayerMap.values());
  }

  /**
   * Get all prayer IDs
   */
  public getAllPrayerIds(): string[] {
    this.ensureInitialized();
    return Array.from(this.prayerMap.keys());
  }

  /**
   * Get prayers available at a specific level
   */
  public getPrayersAtLevel(level: number): readonly PrayerDefinition[] {
    this.ensureInitialized();
    return this.prayersByLevel.get(level) || [];
  }

  /**
   * Get all prayers the player can use based on their prayer level
   */
  public getAvailablePrayers(prayerLevel: number): PrayerDefinition[] {
    this.ensureInitialized();

    // Clear and reuse buffer
    this.prayerArrayBuffer.length = 0;

    for (const prayer of this.prayerMap.values()) {
      if (prayer.level <= prayerLevel) {
        this.prayerArrayBuffer.push(prayer);
      }
    }

    // Return a copy to prevent external modification of buffer
    return [...this.prayerArrayBuffer];
  }

  /**
   * Get prayers by category
   */
  public getPrayersByCategory(
    category: PrayerCategory,
  ): readonly PrayerDefinition[] {
    this.ensureInitialized();
    return this.prayersByCategory.get(category) || [];
  }

  /**
   * Get the level requirement for a prayer
   */
  public getPrayerLevel(prayerId: string): number {
    const prayer = this.getPrayer(prayerId);
    return prayer?.level ?? 99; // Return 99 (max) if not found to prevent activation
  }

  /**
   * Get the drain rate for a prayer
   */
  public getPrayerDrainRate(prayerId: string): number {
    const prayer = this.getPrayer(prayerId);
    return prayer?.drainEffect ?? 0;
  }

  /**
   * Get the bonuses for a prayer
   */
  public getPrayerBonuses(prayerId: string): PrayerBonuses | null {
    const prayer = this.getPrayer(prayerId);
    return prayer?.bonuses ?? null;
  }

  // ==========================================================================
  // CONFLICT CHECKING
  // ==========================================================================

  /**
   * Get prayers that conflict with a specific prayer
   */
  public getConflictingPrayerIds(prayerId: string): readonly string[] {
    const prayer = this.getPrayer(prayerId);
    return prayer?.conflicts ?? [];
  }

  /**
   * Check if two prayers conflict with each other
   */
  public prayersConflict(prayerIdA: string, prayerIdB: string): boolean {
    const prayerA = this.getPrayer(prayerIdA);
    const prayerB = this.getPrayer(prayerIdB);

    if (!prayerA || !prayerB) {
      return false;
    }

    // Check if A conflicts with B or B conflicts with A
    return (
      prayerA.conflicts.includes(prayerIdB) ||
      prayerB.conflicts.includes(prayerIdA)
    );
  }

  /**
   * Get all prayers from the active set that conflict with a new prayer.
   * Uses pre-allocated buffer to avoid allocations in hot paths.
   *
   * @param newPrayerId - The prayer being activated
   * @param activePrayers - Currently active prayer IDs
   * @returns Array of conflicting prayer IDs (may be empty)
   */
  public getConflictsWithActive(
    newPrayerId: string,
    activePrayers: readonly string[],
  ): string[] {
    const newPrayer = this.getPrayer(newPrayerId);
    if (!newPrayer) {
      return [];
    }

    // Clear and reuse buffer
    this.conflictCheckBuffer.clear();

    // Build set of new prayer's conflicts
    for (const conflictId of newPrayer.conflicts) {
      this.conflictCheckBuffer.add(conflictId);
    }

    // Find which active prayers conflict
    const conflicts: string[] = [];
    for (const activeId of activePrayers) {
      if (this.conflictCheckBuffer.has(activeId)) {
        conflicts.push(activeId);
        continue;
      }

      // Also check if the active prayer lists the new prayer as a conflict
      const activePrayer = this.getPrayer(activeId);
      if (activePrayer?.conflicts.includes(newPrayerId)) {
        conflicts.push(activeId);
      }
    }

    return conflicts;
  }

  /**
   * Check if activating a prayer would exceed the maximum active prayers limit
   */
  public wouldExceedMaxPrayers(
    currentActiveCount: number,
    isActivating: boolean,
  ): boolean {
    if (!isActivating) {
      return false; // Deactivating never exceeds limit
    }
    return currentActiveCount >= MAX_ACTIVE_PRAYERS;
  }

  // ==========================================================================
  // VALIDATION
  // ==========================================================================

  /**
   * Validate if a player can activate a prayer
   * @returns Object with valid flag and reason if invalid
   */
  public canActivatePrayer(
    prayerId: string,
    prayerLevel: number,
    currentPoints: number,
    activePrayers: readonly string[],
  ): { valid: boolean; reason?: string } {
    // Check prayer exists
    const prayer = this.getPrayer(prayerId);
    if (!prayer) {
      return { valid: false, reason: "Prayer does not exist" };
    }

    // Check already active
    if (activePrayers.includes(prayerId)) {
      return { valid: false, reason: "Prayer is already active" };
    }

    // Check level requirement
    if (prayerLevel < prayer.level) {
      return {
        valid: false,
        reason: `Requires prayer level ${prayer.level}`,
      };
    }

    // Check prayer points
    if (currentPoints <= 0) {
      return { valid: false, reason: "No prayer points remaining" };
    }

    // Check max active prayers
    if (activePrayers.length >= MAX_ACTIVE_PRAYERS) {
      return {
        valid: false,
        reason: `Cannot have more than ${MAX_ACTIVE_PRAYERS} prayers active`,
      };
    }

    return { valid: true };
  }

  // ==========================================================================
  // UTILITY
  // ==========================================================================

  /**
   * Ensure initialization has occurred
   */
  private ensureInitialized(): void {
    if (!this.isInitialized) {
      // Auto-initialize on first access (lazy initialization)
      this.initialize();
    }
  }

  /**
   * Check if provider is ready
   */
  public isReady(): boolean {
    return this.isInitialized;
  }

  /**
   * Get summary for debugging
   */
  public getSummary(): {
    totalPrayers: number;
    byCategory: Record<string, number>;
    isInitialized: boolean;
  } {
    this.ensureInitialized();

    const byCategory: Record<string, number> = {};
    for (const [category, prayers] of this.prayersByCategory) {
      byCategory[category] = prayers.length;
    }

    return {
      totalPrayers: this.prayerMap.size,
      byCategory,
      isInitialized: this.isInitialized,
    };
  }
}

// Export singleton instance
export const prayerDataProvider = PrayerDataProvider.getInstance();
