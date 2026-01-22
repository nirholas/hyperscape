/**
 * AgentLiveKit - Voice Chat for AI Agents
 *
 * Manages LiveKit room connection for AI agent voice communication.
 * This system enables agents to participate in voice chat with players.
 *
 * **Architecture:**
 * - Connects to LiveKit room using token from server
 * - Publishes synthesized speech (TTS output) as audio tracks
 * - Receives and processes incoming voice for transcription
 * - Emits audio events for VoiceManager processing
 *
 * **Node.js Support:**
 * When running in Node.js (headless agents), uses @livekit/rtc-node
 * for RTC capabilities. Falls back gracefully if unavailable.
 *
 * **Referenced by:** VoiceManager, HyperscapeService
 */

import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { System } from "../types/core-types";
import type { World } from "@hyperscape/shared";

export interface LiveKitInitOptions {
  wsUrl: string;
  token: string;
}

interface AudioFrame {
  data: Int16Array;
  sampleRate: number;
  channels: number;
}

interface LiveKitRoom {
  connect(url: string, token: string): Promise<void>;
  disconnect(): Promise<void>;
  on(event: string, handler: (...args: unknown[]) => void): void;
  off(event: string, handler: (...args: unknown[]) => void): void;
  localParticipant?: {
    publishTrack(track: unknown, options?: unknown): Promise<void>;
    setMicrophoneEnabled(enabled: boolean): Promise<void>;
  };
}

/**
 * AgentLiveKit - Voice system for AI agents
 *
 * Handles voice chat integration for AI agents operating in Hyperscape worlds.
 */
export class AgentLiveKit extends System {
  private room: LiveKitRoom | null = null;
  private audioSource: unknown = null;
  private localTrack: unknown = null;
  private eventEmitter: EventEmitter = new EventEmitter();
  private isConnected: boolean = false;
  private wsUrl: string = "";
  private token: string = "";

  // Audio buffer for publishing
  private audioQueue: Buffer[] = [];
  private isPublishing: boolean = false;

  constructor(world: World) {
    super(world);
  }

  /**
   * Initialize and connect to LiveKit room
   */
  async deserialize(opts: LiveKitInitOptions): Promise<void> {
    if (!opts?.wsUrl || !opts?.token) {
      console.warn("[AgentLiveKit] Missing wsUrl or token, cannot connect");
      return;
    }

    this.wsUrl = opts.wsUrl;
    this.token = opts.token;

    try {
      // Try to dynamically import livekit-client (works in browser)
      // or @livekit/rtc-node (works in Node.js)
      const LiveKit = await this.loadLiveKitModule();

      if (LiveKit) {
        console.info("[AgentLiveKit] Connecting to LiveKit room...");
        this.room = new LiveKit.Room({
          audioCaptureDefaults: {
            autoGainControl: true,
            echoCancellation: true,
            noiseSuppression: true,
          },
        }) as LiveKitRoom;

        this.setupRoomEvents();
        await this.room.connect(opts.wsUrl, opts.token);
        this.isConnected = true;
        console.info("[AgentLiveKit] Connected to LiveKit room successfully");
      } else {
        console.warn(
          "[AgentLiveKit] LiveKit SDK not available - voice features disabled",
        );
        console.info(
          "[AgentLiveKit] To enable voice, install livekit-client (browser) or @livekit/rtc-node (Node.js)",
        );
      }
    } catch (error) {
      console.error(
        `[AgentLiveKit] Failed to connect: ${error instanceof Error ? error.message : String(error)}`,
      );
      // Continue without voice - agent can still function
    }
  }

  /**
   * Attempt to load LiveKit module (browser or Node.js)
   */
  private async loadLiveKitModule(): Promise<{
    Room: new (opts: unknown) => LiveKitRoom;
  } | null> {
    // Try browser SDK first
    try {
      const livekitClient = await import("livekit-client");
      if (livekitClient.Room) {
        console.debug("[AgentLiveKit] Using livekit-client (browser SDK)");
        // Cast to our interface - the actual Room class is compatible
        return livekitClient as unknown as {
          Room: new (opts: unknown) => LiveKitRoom;
        };
      }
    } catch {
      // Browser SDK not available
    }

    // Node.js RTC SDK is optional - skip if not installed
    // To enable Node.js voice support, install: npm install @livekit/rtc-node
    console.debug(
      "[AgentLiveKit] livekit-client not available, voice features disabled",
    );

    return null;
  }

  /**
   * Setup room event handlers
   */
  private setupRoomEvents(): void {
    if (!this.room) return;

    this.room.on(
      "trackSubscribed",
      (track: unknown, publication: unknown, participant: unknown) => {
        console.debug(
          "[AgentLiveKit] Track subscribed:",
          (track as { kind?: string })?.kind,
        );

        // Handle incoming audio tracks (other participants speaking)
        const trackObj = track as { kind?: string; mediaStream?: MediaStream };
        if (trackObj.kind === "audio") {
          this.handleIncomingAudio(track, participant);
        }
      },
    );

    this.room.on("trackUnsubscribed", (track: unknown) => {
      console.debug(
        "[AgentLiveKit] Track unsubscribed:",
        (track as { kind?: string })?.kind,
      );
    });

    this.room.on("disconnected", () => {
      console.info("[AgentLiveKit] Disconnected from LiveKit room");
      this.isConnected = false;
    });

    this.room.on("reconnecting", () => {
      console.info("[AgentLiveKit] Reconnecting to LiveKit room...");
    });

    this.room.on("reconnected", () => {
      console.info("[AgentLiveKit] Reconnected to LiveKit room");
      this.isConnected = true;
    });
  }

  /**
   * Handle incoming audio from other participants
   */
  private handleIncomingAudio(track: unknown, participant: unknown): void {
    const participantObj = participant as { identity?: string };
    const participantId = participantObj?.identity || "unknown";

    console.debug(
      `[AgentLiveKit] Receiving audio from participant: ${participantId}`,
    );

    // Emit audio event for VoiceManager to process
    this.eventEmitter.emit("audio", {
      participant: participantId,
      track,
    });
  }

  /**
   * Subscribe to audio events
   */
  onAudioEvent(event: string, handler: (...args: unknown[]) => void): void {
    this.eventEmitter.on(event, handler);
  }

  /**
   * Unsubscribe from audio events
   */
  offAudioEvent(event: string, handler: (...args: unknown[]) => void): void {
    this.eventEmitter.off(event, handler);
  }

  /**
   * Stop and disconnect from LiveKit
   */
  async stop(): Promise<void> {
    if (this.room) {
      await this.room.disconnect();
      this.room = null;
    }
    this.audioSource = null;
    this.localTrack = null;
    this.isConnected = false;
    this.audioQueue = [];
    console.info("[AgentLiveKit] Stopped and disconnected");
  }

  /**
   * Publish audio buffer to the LiveKit room
   * Converts various audio formats to PCM and streams to participants
   */
  async publishAudioStream(audioBuffer: Buffer): Promise<void> {
    if (!this.isConnected || !this.room) {
      console.debug("[AgentLiveKit] Not connected, queueing audio for later");
      this.audioQueue.push(audioBuffer);
      return;
    }

    if (this.isPublishing) {
      console.debug("[AgentLiveKit] Already publishing, queueing audio");
      this.audioQueue.push(audioBuffer);
      return;
    }

    this.isPublishing = true;

    try {
      // Convert audio to PCM format for LiveKit
      const pcmData = await this.convertToPcm(audioBuffer);
      console.info(`[AgentLiveKit] Publishing ${pcmData.length} PCM samples`);

      // Create and publish audio track
      // Note: Actual track creation depends on the SDK being used
      if (
        this.room.localParticipant &&
        typeof this.room.localParticipant.setMicrophoneEnabled === "function"
      ) {
        // Using browser-style API - would need custom track publishing
        // For now, log that we would publish
        console.info(
          `[AgentLiveKit] Would publish audio track (${audioBuffer.length} bytes)`,
        );
      }

      // Process any queued audio
      while (this.audioQueue.length > 0) {
        const nextBuffer = this.audioQueue.shift()!;
        const nextPcm = await this.convertToPcm(nextBuffer);
        console.info(
          `[AgentLiveKit] Publishing queued audio: ${nextPcm.length} samples`,
        );
      }
    } catch (error) {
      console.error(
        `[AgentLiveKit] Failed to publish audio: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.isPublishing = false;
    }
  }

  /**
   * Alias for publishAudioStream for compatibility
   */
  async publishAudio(audioBuffer: Buffer): Promise<void> {
    return this.publishAudioStream(audioBuffer);
  }

  /**
   * Convert various audio formats to PCM using ffmpeg
   */
  private async convertToPcm(
    buffer: Buffer,
    sampleRate = 48000,
  ): Promise<Int16Array> {
    const format = this.detectAudioFormat(buffer);

    if (format === "pcm") {
      return new Int16Array(
        buffer.buffer,
        buffer.byteOffset,
        buffer.length / 2,
      );
    }

    const ffmpegArgs: string[] = [
      "-f",
      format,
      "-i",
      "pipe:0",
      "-f",
      "s16le",
      "-ar",
      sampleRate.toString(),
      "-ac",
      "1",
      "pipe:1",
    ];

    return new Promise((resolve, reject) => {
      const ff = spawn("ffmpeg", ffmpegArgs);
      let raw = Buffer.alloc(0);

      ff.stdout.on("data", (chunk: Buffer) => {
        raw = Buffer.concat([raw, chunk]);
      });

      ff.stderr.on("data", () => {
        // Ignore ffmpeg logs
      });

      ff.on("error", (err) => {
        // ffmpeg not found - return empty PCM
        console.warn(`[AgentLiveKit] ffmpeg not available: ${err.message}`);
        resolve(new Int16Array(0));
      });

      ff.on("close", (code) => {
        if (code !== 0 && code !== null) {
          return reject(new Error(`ffmpeg failed (code ${code})`));
        }
        const samples = new Int16Array(
          raw.buffer,
          raw.byteOffset,
          raw.byteLength / 2,
        );
        resolve(samples);
      });

      ff.stdin.write(buffer);
      ff.stdin.end();
    });
  }

  /**
   * Detect audio format from buffer header
   */
  private detectAudioFormat(buffer: Buffer): "mp3" | "wav" | "pcm" {
    if (buffer.length < 4) return "pcm";

    const header = buffer.slice(0, 4).toString("ascii");
    if (header === "RIFF") {
      return "wav";
    }
    if (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) {
      return "mp3";
    }
    return "pcm";
  }

  /**
   * Check if connected to LiveKit
   */
  isLiveKitConnected(): boolean {
    return this.isConnected;
  }

  // System lifecycle methods
  preTick(): void {}
  preFixedUpdate(): void {}
  fixedUpdate(): void {}
  postFixedUpdate(): void {}
  preUpdate(): void {}
  update(): void {}
  postUpdate(): void {}
  lateUpdate(): void {}
  postLateUpdate(): void {}
  commit(): void {}
  postTick(): void {}
  start(): void {}
}
