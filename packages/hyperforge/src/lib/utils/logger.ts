/**
 * Centralized Logger using Pino
 * Isomorphic - works in both Node.js and browser environments
 *
 * Wraps Pino with a simplified API that matches our existing usage pattern:
 *   const log = logger.child("ModuleName");
 *   log.debug("message", data);
 *
 * @see https://github.com/pinojs/pino
 */

import pino from "pino";

/**
 * Valid log data types for structured logging
 * Covers errors, objects, primitives, and arrays
 */
export type LogData =
  | Error
  | Record<string, unknown>
  | unknown[]
  | string
  | number
  | boolean
  | null
  | unknown;

const isBrowser = typeof window !== "undefined";

/**
 * Determine log level based on environment
 */
function getLogLevel(): pino.Level {
  if (isBrowser) {
    // In browser, check hostname for dev mode
    return window.location.hostname === "localhost" ? "debug" : "info";
  }
  // In Node.js, check environment variables
  const envLevel = process.env.LOG_LEVEL as pino.Level | undefined;
  if (envLevel) {
    return envLevel;
  }
  return process.env.NODE_ENV === "production" ? "info" : "debug";
}

/**
 * Browser configuration for Pino
 * Uses console methods with module prefix for readability
 */
const browserConfig: pino.LoggerOptions["browser"] = {
  asObject: false, // Use native console formatting for better devtools experience
  write: {
    trace: (o: pino.LogDescriptor) =>
      console.debug(`[${o.module || "app"}]`, o.msg, o),
    debug: (o: pino.LogDescriptor) =>
      console.debug(`[${o.module || "app"}]`, o.msg, o),
    info: (o: pino.LogDescriptor) =>
      console.info(`[${o.module || "app"}]`, o.msg, o),
    warn: (o: pino.LogDescriptor) =>
      console.warn(`[${o.module || "app"}]`, o.msg, o),
    error: (o: pino.LogDescriptor) =>
      console.error(`[${o.module || "app"}]`, o.msg, o),
    fatal: (o: pino.LogDescriptor) =>
      console.error(`[FATAL][${o.module || "app"}]`, o.msg, o),
  },
};

/**
 * Create the base Pino logger instance
 */
function createBaseLogger(): pino.Logger {
  const level = getLogLevel();

  if (isBrowser) {
    // Browser: use console-based output
    return pino({
      level,
      browser: browserConfig,
    });
  }

  // Node.js: use pino-pretty in development, JSON in production
  if (process.env.NODE_ENV === "production") {
    return pino({ level });
  }

  // Development: pretty print with colors
  return pino({
    level,
    transport: {
      target: "pino-pretty",
      options: {
        colorize: true,
        translateTime: "HH:MM:ss",
        ignore: "pid,hostname",
      },
    },
  });
}

// Create the base logger instance
const baseLogger = createBaseLogger();

/**
 * Child logger type with our simplified API
 */
export interface ChildLogger {
  trace(messageOrData: string | LogData, data?: LogData): void;
  debug(messageOrData: string | LogData, data?: LogData): void;
  info(messageOrData: string | LogData, data?: LogData): void;
  warn(messageOrData: string | LogData, data?: LogData): void;
  error(messageOrData: string | LogData, data?: LogData): void;
  fatal(messageOrData: string | LogData, data?: LogData): void;
}

/**
 * Create a child logger wrapper that maintains our API
 * Converts: log.debug("message", data) → pino.debug({ data }, "message")
 */
function createChildLogger(pinoChild: pino.Logger): ChildLogger {
  return {
    trace: (messageOrData: string | LogData, data?: LogData) => {
      if (typeof messageOrData === "string") {
        if (data !== undefined) {
          pinoChild.trace(
            typeof data === "object" && data !== null ? data : { data },
            messageOrData,
          );
        } else {
          pinoChild.trace(messageOrData);
        }
      } else {
        pinoChild.trace(messageOrData as object, "");
      }
    },
    debug: (messageOrData: string | LogData, data?: LogData) => {
      if (typeof messageOrData === "string") {
        if (data !== undefined) {
          pinoChild.debug(
            typeof data === "object" && data !== null ? data : { data },
            messageOrData,
          );
        } else {
          pinoChild.debug(messageOrData);
        }
      } else {
        // First arg is data, use it as context
        pinoChild.debug(messageOrData as object, "");
      }
    },
    info: (messageOrData: string | LogData, data?: LogData) => {
      if (typeof messageOrData === "string") {
        if (data !== undefined) {
          pinoChild.info(
            typeof data === "object" && data !== null ? data : { data },
            messageOrData,
          );
        } else {
          pinoChild.info(messageOrData);
        }
      } else {
        pinoChild.info(messageOrData as object, "");
      }
    },
    warn: (messageOrData: string | LogData, data?: LogData) => {
      if (typeof messageOrData === "string") {
        if (data !== undefined) {
          pinoChild.warn(
            typeof data === "object" && data !== null ? data : { data },
            messageOrData,
          );
        } else {
          pinoChild.warn(messageOrData);
        }
      } else {
        pinoChild.warn(messageOrData as object, "");
      }
    },
    error: (messageOrData: string | LogData, data?: LogData) => {
      if (typeof messageOrData === "string") {
        if (data !== undefined) {
          // Handle Error objects specially
          if (data instanceof Error) {
            pinoChild.error({ err: data }, messageOrData);
          } else {
            pinoChild.error(
              typeof data === "object" && data !== null ? data : { data },
              messageOrData,
            );
          }
        } else {
          pinoChild.error(messageOrData);
        }
      } else {
        // First arg is data/error
        if (messageOrData instanceof Error) {
          pinoChild.error({ err: messageOrData }, "");
        } else {
          pinoChild.error(messageOrData as object, "");
        }
      }
    },
    fatal: (messageOrData: string | LogData, data?: LogData) => {
      if (typeof messageOrData === "string") {
        if (data !== undefined) {
          if (data instanceof Error) {
            pinoChild.fatal({ err: data }, messageOrData);
          } else {
            pinoChild.fatal(
              typeof data === "object" && data !== null ? data : { data },
              messageOrData,
            );
          }
        } else {
          pinoChild.fatal(messageOrData);
        }
      } else {
        if (messageOrData instanceof Error) {
          pinoChild.fatal({ err: messageOrData }, "");
        } else {
          pinoChild.fatal(messageOrData as object, "");
        }
      }
    },
  };
}

/**
 * Logger interface matching our existing API
 */
export interface Logger {
  trace(tag: string, message: string, data?: LogData): void;
  debug(tag: string, message: string, data?: LogData): void;
  info(tag: string, message: string, data?: LogData): void;
  warn(tag: string, message: string, data?: LogData): void;
  error(tag: string, message: string, data?: LogData): void;
  fatal(tag: string, message: string, data?: LogData): void;
  child(module: string): ChildLogger;
  isDebugEnabled(): boolean;
  isInfoEnabled(): boolean;
  isTraceEnabled(): boolean;
}

/**
 * Main logger export
 *
 * Usage:
 *   // Direct logging with tag
 *   logger.info("API", "Request completed", { status: 200 });
 *
 *   // Create a child logger for a module
 *   const log = logger.child("ImageGen");
 *   log.debug("Processing image", { width: 512 });
 *   log.error("Failed", error);
 */
export const logger: Logger = {
  trace: (tag: string, message: string, data?: LogData) => {
    const child = baseLogger.child({ module: tag });
    if (data !== undefined) {
      child.trace(
        typeof data === "object" && data !== null ? data : { data },
        message,
      );
    } else {
      child.trace(message);
    }
  },

  debug: (tag: string, message: string, data?: LogData) => {
    const child = baseLogger.child({ module: tag });
    if (data !== undefined) {
      child.debug(
        typeof data === "object" && data !== null ? data : { data },
        message,
      );
    } else {
      child.debug(message);
    }
  },

  info: (tag: string, message: string, data?: LogData) => {
    const child = baseLogger.child({ module: tag });
    if (data !== undefined) {
      child.info(
        typeof data === "object" && data !== null ? data : { data },
        message,
      );
    } else {
      child.info(message);
    }
  },

  warn: (tag: string, message: string, data?: LogData) => {
    const child = baseLogger.child({ module: tag });
    if (data !== undefined) {
      child.warn(
        typeof data === "object" && data !== null ? data : { data },
        message,
      );
    } else {
      child.warn(message);
    }
  },

  error: (tag: string, message: string, data?: LogData) => {
    const child = baseLogger.child({ module: tag });
    if (data !== undefined) {
      if (data instanceof Error) {
        child.error({ err: data }, message);
      } else {
        child.error(
          typeof data === "object" && data !== null ? data : { data },
          message,
        );
      }
    } else {
      child.error(message);
    }
  },

  fatal: (tag: string, message: string, data?: LogData) => {
    const child = baseLogger.child({ module: tag });
    if (data !== undefined) {
      if (data instanceof Error) {
        child.fatal({ err: data }, message);
      } else {
        child.fatal(
          typeof data === "object" && data !== null ? data : { data },
          message,
        );
      }
    } else {
      child.fatal(message);
    }
  },

  /**
   * Create a child logger with a fixed module name
   */
  child: (module: string): ChildLogger => {
    const pinoChild = baseLogger.child({ module });
    return createChildLogger(pinoChild);
  },

  /**
   * Check if debug level is enabled (for conditional expensive logging)
   */
  isDebugEnabled: (): boolean => {
    return baseLogger.isLevelEnabled("debug");
  },

  /**
   * Check if info level is enabled
   */
  isInfoEnabled: (): boolean => {
    return baseLogger.isLevelEnabled("info");
  },

  /**
   * Check if trace level is enabled
   */
  isTraceEnabled: (): boolean => {
    return baseLogger.isLevelEnabled("trace");
  },
};

// Also export the raw Pino logger for advanced use cases
export { baseLogger as pinoLogger };
