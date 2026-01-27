/**
 * Logger - Structured Logging Service
 *
 * Provides log-level filtering and structured JSON output for production logs.
 * Debug logs are suppressed in production mode.
 *
 * Usage:
 * ```typescript
 * Logger.debug('DuelSystem', 'Processing challenge', { challengerId, targetId });
 * Logger.info('DuelSystem', 'Duel started', { duelId });
 * Logger.warn('DuelSystem', 'Player disconnected during duel', { playerId });
 * Logger.error('DuelSystem', 'Failed to transfer stakes', error, { duelId });
 * ```
 */

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

/**
 * Structured Logger with level filtering
 *
 * In production (NODE_ENV=production), DEBUG logs are suppressed.
 * In development, all logs are shown.
 */
export class Logger {
  private static level: LogLevel =
    process.env.NODE_ENV === "production" ? LogLevel.INFO : LogLevel.DEBUG;

  /**
   * Set the minimum log level
   */
  static setLevel(level: LogLevel): void {
    this.level = level;
  }

  /**
   * Get the current log level
   */
  static getLevel(): LogLevel {
    return this.level;
  }

  /**
   * Log a debug message (suppressed in production)
   */
  static debug(
    system: string,
    message: string,
    data?: Record<string, unknown>,
  ): void {
    if (this.level <= LogLevel.DEBUG) {
      this.log("DEBUG", system, message, data);
    }
  }

  /**
   * Log an info message
   */
  static info(
    system: string,
    message: string,
    data?: Record<string, unknown>,
  ): void {
    if (this.level <= LogLevel.INFO) {
      this.log("INFO", system, message, data);
    }
  }

  /**
   * Log a warning message
   */
  static warn(
    system: string,
    message: string,
    data?: Record<string, unknown>,
  ): void {
    if (this.level <= LogLevel.WARN) {
      this.log("WARN", system, message, data);
    }
  }

  /**
   * Log an error message with optional Error object
   */
  static error(
    system: string,
    message: string,
    error?: Error | null,
    data?: Record<string, unknown>,
  ): void {
    const errorData = error
      ? {
          ...data,
          errorMessage: error.message,
          errorStack: error.stack,
        }
      : data;

    this.log("ERROR", system, message, errorData);
  }

  /**
   * Internal log method that formats and outputs the log entry
   */
  private static log(
    level: string,
    system: string,
    message: string,
    data?: Record<string, unknown>,
  ): void {
    const timestamp = new Date().toISOString();
    const prefix = `[${system}]`;

    if (data && Object.keys(data).length > 0) {
      // Structured output for log aggregation
      console.log(`${prefix} ${message}`, JSON.stringify(data));
    } else {
      console.log(`${prefix} ${message}`);
    }
  }
}
