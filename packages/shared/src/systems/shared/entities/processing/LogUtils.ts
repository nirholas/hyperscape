/**
 * Log Utilities
 *
 * Validation and lookup utilities for log items.
 * Uses data from items.json manifest via ProcessingDataProvider.
 */

import { processingDataProvider } from "../../../../data/ProcessingDataProvider";

/**
 * Check if an item ID is a valid log type for firemaking.
 *
 * @param itemId - Item ID to check
 * @returns True if valid log
 */
export function isValidLog(itemId: string): boolean {
  return processingDataProvider.isBurnableLog(itemId);
}

/**
 * Get all valid log IDs.
 *
 * @returns Set of valid log item IDs
 */
export function getValidLogIds(): Set<string> {
  return processingDataProvider.getBurnableLogIds();
}

/**
 * Log data for display purposes.
 */
export interface LogDisplayData {
  id: string;
  levelRequired: number;
  xp: number;
}

/**
 * Get display data for a log type.
 *
 * @param logId - Log item ID
 * @returns Log display data, or null if invalid
 */
export function getLogDisplayData(logId: string): LogDisplayData | null {
  const firemakingData = processingDataProvider.getFiremakingData(logId);

  if (!firemakingData) {
    return null;
  }

  return {
    id: logId,
    levelRequired: firemakingData.levelRequired,
    xp: firemakingData.xp,
  };
}

/**
 * Get all log types sorted by level requirement.
 *
 * @returns Array of log data sorted by level
 */
export function getAllLogsSortedByLevel(): LogDisplayData[] {
  const logs: LogDisplayData[] = [];

  for (const logId of processingDataProvider.getBurnableLogIds()) {
    const data = getLogDisplayData(logId);
    if (data) {
      logs.push(data);
    }
  }

  return logs.sort((a, b) => a.levelRequired - b.levelRequired);
}
