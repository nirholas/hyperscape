/**
 * Log Utilities
 *
 * Validation and lookup utilities for log items.
 * Used by firemaking system for item validation.
 */

import {
  PROCESSING_CONSTANTS,
  type LogId,
} from "../../../../constants/ProcessingConstants";

/**
 * Check if an item ID is a valid log type for firemaking.
 *
 * @param itemId - Item ID to check
 * @returns True if valid log
 */
export function isValidLog(itemId: string): itemId is LogId {
  return PROCESSING_CONSTANTS.VALID_LOG_IDS.has(itemId);
}

/**
 * Get all valid log IDs.
 *
 * @returns Set of valid log item IDs
 */
export function getValidLogIds(): ReadonlySet<string> {
  return PROCESSING_CONSTANTS.VALID_LOG_IDS;
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
  if (!isValidLog(logId)) {
    return null;
  }

  return {
    id: logId,
    levelRequired:
      PROCESSING_CONSTANTS.FIREMAKING_LEVELS[
        logId as keyof typeof PROCESSING_CONSTANTS.FIREMAKING_LEVELS
      ],
    xp: PROCESSING_CONSTANTS.FIREMAKING_XP[
      logId as keyof typeof PROCESSING_CONSTANTS.FIREMAKING_XP
    ],
  };
}

/**
 * Get all log types sorted by level requirement.
 *
 * @returns Array of log data sorted by level
 */
export function getAllLogsSortedByLevel(): LogDisplayData[] {
  const logs: LogDisplayData[] = [];

  for (const logId of PROCESSING_CONSTANTS.VALID_LOG_IDS) {
    const data = getLogDisplayData(logId);
    if (data) {
      logs.push(data);
    }
  }

  return logs.sort((a, b) => a.levelRequired - b.levelRequired);
}
