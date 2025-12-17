/**
 * Server Reload API
 * Triggers hot reload of the Hyperscape game server
 */

import { NextRequest, NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import { logger } from "@/lib/utils";

const log = logger.child("API:server:reload");

const execAsync = promisify(exec);

// Server PID file or process name
const SERVER_PORT = process.env.HYPERSCAPE_SERVER_PORT || "5555";

/**
 * POST /api/server/reload
 * Trigger a hot reload of the game server
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { force = false } = body;

    // Find the server process by port
    let pid: number | null = null;

    try {
      // Try to find process listening on server port (macOS/Linux)
      const { stdout } = await execAsync(
        `lsof -ti:${SERVER_PORT} 2>/dev/null || true`,
      );
      const pids = stdout.trim().split("\n").filter(Boolean);
      if (pids.length > 0) {
        pid = parseInt(pids[0], 10);
      }
    } catch {
      // lsof not available or no process found
    }

    if (!pid) {
      // Try alternative: find by process name
      try {
        const { stdout } = await execAsync(
          `pgrep -f "bun.*build/index.js" 2>/dev/null || pgrep -f "node.*server" 2>/dev/null || true`,
        );
        const pids = stdout.trim().split("\n").filter(Boolean);
        if (pids.length > 0) {
          pid = parseInt(pids[0], 10);
        }
      } catch {
        // Process not found
      }
    }

    if (!pid) {
      return NextResponse.json(
        {
          success: false,
          message: "Server process not found. Is the game server running?",
          hint: `Expected server on port ${SERVER_PORT}`,
        },
        { status: 404 },
      );
    }

    // Send SIGUSR2 for hot reload (or SIGTERM for force restart)
    const signal = force ? "SIGTERM" : "SIGUSR2";

    try {
      process.kill(pid, signal);

      return NextResponse.json({
        success: true,
        message: force
          ? "Server restart triggered (SIGTERM)"
          : "Hot reload triggered (SIGUSR2)",
        pid,
        signal,
      });
    } catch (killError) {
      // Check if it's a permission error
      if ((killError as NodeJS.ErrnoException).code === "EPERM") {
        return NextResponse.json(
          {
            success: false,
            error: "Permission denied. Cannot signal server process.",
            pid,
          },
          { status: 403 },
        );
      }
      throw killError;
    }
  } catch (error) {
    log.error("Reload error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to reload server",
        success: false,
      },
      { status: 500 },
    );
  }
}

/**
 * GET /api/server/reload
 * Check server status
 */
export async function GET() {
  try {
    let isRunning = false;
    let pid: number | null = null;

    try {
      const { stdout } = await execAsync(
        `lsof -ti:${SERVER_PORT} 2>/dev/null || true`,
      );
      const pids = stdout.trim().split("\n").filter(Boolean);
      if (pids.length > 0) {
        pid = parseInt(pids[0], 10);
        isRunning = true;
      }
    } catch {
      // Not running or lsof unavailable
    }

    return NextResponse.json({
      success: true,
      server: {
        running: isRunning,
        pid,
        port: SERVER_PORT,
      },
    });
  } catch (error) {
    log.error("Status error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to check server status",
      },
      { status: 500 },
    );
  }
}
