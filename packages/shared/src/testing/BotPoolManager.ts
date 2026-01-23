/**
 * BotPoolManager - Orchestrates multiple LoadTestBot instances
 */

import {
  LoadTestBot,
  type LoadTestBehavior,
  type LoadTestBotMetrics,
} from "./LoadTestBot";

export type BotPoolConfig = {
  wsUrl: string;
  botCount: number;
  behavior: LoadTestBehavior;
  rampUpDelayMs?: number;
  connectTimeoutMs?: number;
  namePrefix?: string;
  updateInterval?: number;
  onProgress?: (connected: number, total: number, errors: number) => void;
  onBotError?: (botName: string, error: Error) => void;
};

export type AggregatedMetrics = {
  totalBots: number;
  connectedBots: number;
  failedConnections: number;
  totalDistanceTraveled: number;
  totalMoveCommands: number;
  totalErrors: number;
  avgConnectionDuration: number;
  poolRuntime: number;
  messagesPerSecond: number;
  networkUnavailableTotal: number;
  positionUnavailableTotal: number;
  botsWithDisconnects: number;
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class BotPoolManager {
  private config: Required<BotPoolConfig>;
  private bots: LoadTestBot[] = [];
  private failedBots = new Set<string>();
  private connectionErrors = 0;
  private startTime = 0;
  private isRunning = false;
  private metricsInterval: ReturnType<typeof setInterval> | null = null;
  private pendingConnections = 0;

  constructor(config: BotPoolConfig) {
    this.config = {
      rampUpDelayMs: 50,
      connectTimeoutMs: 15000,
      namePrefix: "Bot",
      updateInterval: 3000,
      onProgress: () => {},
      onBotError: () => {},
      ...config,
    };
  }

  async start(): Promise<void> {
    if (this.isRunning) throw new Error("Bot pool is already running");

    this.isRunning = true;
    this.startTime = Date.now();
    this.connectionErrors = 0;
    this.bots = [];
    this.failedBots.clear();
    this.pendingConnections = 0;

    const {
      botCount,
      rampUpDelayMs,
      wsUrl,
      behavior,
      updateInterval,
      namePrefix,
    } = this.config;
    console.log(`[BotPool] Starting ${botCount} bots...`);

    const promises: Promise<void>[] = [];

    for (let i = 0; i < botCount && this.isRunning; i++) {
      const bot = new LoadTestBot({
        wsUrl,
        name: `${namePrefix}-${String(i + 1).padStart(4, "0")}`,
        behavior,
        updateInterval,
      });

      this.bots.push(bot);
      this.pendingConnections++;
      promises.push(
        this.connectBot(bot).finally(() => this.pendingConnections--),
      );

      if (rampUpDelayMs > 0 && i < botCount - 1) await sleep(rampUpDelayMs);
      this.config.onProgress(
        this.getConnectedCount(),
        botCount,
        this.connectionErrors,
      );
    }

    await Promise.all(promises);
    await sleep(500);

    this.metricsInterval = setInterval(() => this.logMetrics(), 10000);
    console.log(
      `[BotPool] Done. ${this.getConnectedCount()}/${botCount} connected, ${this.failedBots.size} failed.`,
    );
  }

  private async connectBot(bot: LoadTestBot): Promise<void> {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<void>((_resolve, reject) => {
      timeoutId = setTimeout(() => {
        reject(
          new Error(
            `Connection timed out after ${this.config.connectTimeoutMs}ms`,
          ),
        );
      }, this.config.connectTimeoutMs);
    });

    try {
      await Promise.race([bot.connect(), timeoutPromise]);
    } catch (err) {
      bot.disconnect();
      this.connectionErrors++;
      this.failedBots.add(bot.name);
      const error = err instanceof Error ? err : new Error(String(err));
      this.config.onBotError(bot.name, error);
      console.error(`[BotPool] ${bot.name} failed:`, error.message);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  async stop(): Promise<void> {
    if (!this.isRunning) return;

    console.log(`[BotPool] Stopping ${this.bots.length} bots...`);
    this.isRunning = false;

    if (this.metricsInterval) clearInterval(this.metricsInterval);
    this.metricsInterval = null;

    for (const bot of this.bots) bot.disconnect();
    this.bots = [];
    this.failedBots.clear();
    console.log("[BotPool] Done.");
  }

  getConnectedCount(): number {
    return this.bots.filter((b) => b.connected && !this.failedBots.has(b.name))
      .length;
  }

  getFailedCount(): number {
    return this.failedBots.size;
  }

  getPendingCount(): number {
    return this.pendingConnections;
  }

  getBotMetrics(): {
    name: string;
    metrics: LoadTestBotMetrics;
    failed: boolean;
  }[] {
    return this.bots.map((b) => ({
      name: b.name,
      metrics: b.metrics,
      failed: this.failedBots.has(b.name),
    }));
  }

  getAggregatedMetrics(): AggregatedMetrics {
    const now = Date.now();
    const connectedBots = this.getConnectedCount();
    const poolRuntime = this.startTime > 0 ? now - this.startTime : 0;

    let totalDistanceTraveled = 0,
      totalMoveCommands = 0,
      totalErrors = 0;
    let totalConnectionTime = 0,
      networkUnavailableTotal = 0,
      positionUnavailableTotal = 0,
      botsWithDisconnects = 0;

    for (const bot of this.bots) {
      const m = bot.metrics;
      totalDistanceTraveled += m.distanceTraveled;
      totalMoveCommands += m.moveCommandsSent;
      totalErrors += m.errors;
      networkUnavailableTotal += m.networkUnavailableCount;
      positionUnavailableTotal += m.positionUnavailableCount;
      if (m.connectedAt > 0) totalConnectionTime += now - m.connectedAt;
      if (m.connectionLostAt > 0) botsWithDisconnects++;
    }

    return {
      totalBots: this.config.botCount,
      connectedBots,
      failedConnections: this.connectionErrors,
      totalDistanceTraveled,
      totalMoveCommands,
      totalErrors,
      avgConnectionDuration:
        connectedBots > 0 ? totalConnectionTime / connectedBots : 0,
      poolRuntime,
      messagesPerSecond:
        poolRuntime > 0 ? (totalMoveCommands / poolRuntime) * 1000 : 0,
      networkUnavailableTotal,
      positionUnavailableTotal,
      botsWithDisconnects,
    };
  }

  private logMetrics(): void {
    const m = this.getAggregatedMetrics();
    console.log(`[BotPool]`, {
      connected: `${m.connectedBots}/${m.totalBots}`,
      failed: this.failedBots.size,
      runtime: `${Math.round(m.poolRuntime / 1000)}s`,
      "msg/s": m.messagesPerSecond.toFixed(2),
      moves: m.totalMoveCommands,
      errors: m.totalErrors,
    });
  }

  get running(): boolean {
    return this.isRunning;
  }
}
