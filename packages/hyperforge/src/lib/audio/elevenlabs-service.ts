/**
 * ElevenLabs Audio Service
 * Integrates with ElevenLabs API for:
 * - Text-to-Speech (dialogue voice generation)
 * - Sound Effects (game SFX)
 * - Music Generation (background music, themes)
 *
 * @see https://elevenlabs.io/docs/overview/intro
 */

import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

// Initialize client - uses ELEVENLABS_API_KEY env var by default
let client: ElevenLabsClient | null = null;

function getClient(): ElevenLabsClient {
  if (!client) {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      throw new Error(
        "ELEVENLABS_API_KEY environment variable is not set. Get one at https://elevenlabs.io",
      );
    }
    client = new ElevenLabsClient({ apiKey });
  }
  return client;
}

// ============================================================================
// Types
// ============================================================================

export interface Voice {
  id: string;
  name: string;
  description?: string;
  previewUrl?: string;
  labels?: {
    accent?: string;
    age?: string;
    gender?: string;
    useCase?: string;
  };
}

export interface TextToSpeechOptions {
  voiceId: string;
  text: string;
  modelId?: string; // Default: eleven_multilingual_v2
  stability?: number; // 0-1, default 0.5
  similarityBoost?: number; // 0-1, default 0.75
  style?: number; // 0-1, default 0
  outputFormat?: "mp3_44100_128" | "mp3_22050_32" | "pcm_16000";
}

export interface TextToSpeechResult {
  audio: Buffer;
  format: string;
}

export interface SoundEffectOptions {
  text: string; // Description of the sound effect
  durationSeconds?: number; // 0.5-22 seconds
  promptInfluence?: number; // 0-1, how closely to follow the prompt
}

export interface SoundEffectResult {
  audio: Buffer;
  format: string;
}

export interface MusicGenerationOptions {
  prompt: string; // Description of the music
  durationMs?: number; // 3000-300000 ms (3 seconds to 5 minutes)
  forceInstrumental?: boolean; // No vocals if true
}

export interface MusicGenerationResult {
  audio: Buffer;
  format: string;
  metadata?: {
    title?: string;
    genres?: string[];
  };
}

// ============================================================================
// Voice Management
// ============================================================================

/**
 * Get all available voices
 */
export async function getVoices(): Promise<Voice[]> {
  const elevenlabs = getClient();

  const result = await elevenlabs.voices.getAll({
    showLegacy: false,
  });

  return result.voices.map((v) => ({
    id: v.voiceId,
    name: v.name || "Unknown",
    description: v.description || undefined,
    previewUrl: v.previewUrl || undefined,
    labels: {
      accent: v.labels?.accent,
      age: v.labels?.age,
      gender: v.labels?.gender,
      useCase: v.labels?.use_case,
    },
  }));
}

/**
 * Search for voices with filtering
 */
export async function searchVoices(options: {
  search?: string;
  gender?: string;
  category?: string;
  pageSize?: number;
}): Promise<Voice[]> {
  const elevenlabs = getClient();

  const result = await elevenlabs.voices.search({
    search: options.search,
    // Note: gender/category filters may not be supported in all SDK versions
    pageSize: options.pageSize || 20,
    includeTotalCount: true,
  } as Parameters<typeof elevenlabs.voices.search>[0]);

  return result.voices.map((v) => ({
    id: v.voiceId,
    name: v.name || "Unknown",
    description: v.description || undefined,
    previewUrl: v.previewUrl || undefined,
    labels: {
      accent: v.labels?.accent,
      age: v.labels?.age,
      gender: v.labels?.gender,
      useCase: v.labels?.use_case,
    },
  }));
}

/**
 * Voice labels structure from ElevenLabs SDK
 */
interface VoiceLabels {
  accent?: string;
  age?: string;
  gender?: string;
  use_case?: string;
}

/**
 * Extended voice params including optional category field
 * Some SDK versions may not include category in type definition
 */
type SharedVoiceParams = Parameters<
  ElevenLabsClient["voices"]["getShared"]
>[0] & {
  category?: string;
};

/**
 * Get shared/community voices (useful for game character voices)
 */
export async function getSharedVoices(options?: {
  category?: string;
  gender?: string;
  accent?: string;
  language?: string;
  featured?: boolean;
  pageSize?: number;
}): Promise<Voice[]> {
  const elevenlabs = getClient();

  const params: SharedVoiceParams = {
    gender: options?.gender,
    accent: options?.accent,
    language: options?.language || "en",
    featured: options?.featured,
    pageSize: options?.pageSize || 20,
  };

  // Add category if provided (cast to expected type)
  if (options?.category) {
    (params as Record<string, unknown>).category = options.category;
  }

  const result = await elevenlabs.voices.getShared(params);

  return result.voices.map((v) => {
    // Access labels with proper type assertion
    const labels = (v as typeof v & { labels?: VoiceLabels }).labels;
    return {
      id: v.voiceId,
      name: v.name || "Unknown",
      description: v.description || undefined,
      previewUrl: v.previewUrl || undefined,
      labels: labels
        ? {
            accent: labels.accent,
            age: labels.age,
            gender: labels.gender,
            useCase: labels.use_case,
          }
        : undefined,
    };
  });
}

// ============================================================================
// Text-to-Speech (Voice Generation)
// ============================================================================

/**
 * Supported audio response types from ElevenLabs SDK
 * The SDK may return different types depending on the API endpoint and version
 */
type AudioResponse =
  | Buffer
  | Uint8Array
  | string // base64 encoded
  | ReadableStream<Uint8Array>
  | NodeJS.ReadableStream
  | AsyncIterable<Uint8Array>
  | Iterable<Uint8Array>;

/**
 * Helper to convert various audio response types to Buffer
 * Handles: Buffer, Uint8Array, string (base64), ReadableStream, AsyncIterable
 */
async function audioToBuffer(audio: AudioResponse): Promise<Buffer> {
  if (!audio) {
    throw new Error("No audio data received");
  }

  if (audio instanceof Buffer) {
    return audio;
  }

  if (audio instanceof Uint8Array) {
    return Buffer.from(audio);
  }

  if (typeof audio === "string") {
    // Assume base64
    return Buffer.from(audio, "base64");
  }

  // Handle Web ReadableStream (from fetch/ElevenLabs SDK)
  if (
    typeof audio === "object" &&
    audio !== null &&
    "getReader" in audio &&
    typeof (audio as ReadableStream<Uint8Array>).getReader === "function"
  ) {
    const stream = audio as ReadableStream<Uint8Array>;
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
        }
      }
    } finally {
      reader.releaseLock();
    }

    if (chunks.length === 0) {
      throw new Error("ReadableStream produced no data");
    }

    return Buffer.concat(chunks);
  }

  // Handle Node.js Readable stream
  if (
    typeof audio === "object" &&
    audio !== null &&
    "pipe" in audio &&
    typeof (audio as NodeJS.ReadableStream).pipe === "function"
  ) {
    const nodeStream = audio as NodeJS.ReadableStream;
    const chunks: Buffer[] = [];

    return new Promise((resolve, reject) => {
      nodeStream.on("data", (chunk: Buffer | Uint8Array) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      nodeStream.on("end", () => {
        if (chunks.length === 0) {
          reject(new Error("Node stream produced no data"));
        } else {
          resolve(Buffer.concat(chunks));
        }
      });
      nodeStream.on("error", reject);
    });
  }

  // Handle async iterables
  if (
    typeof audio === "object" &&
    audio !== null &&
    Symbol.asyncIterator in audio
  ) {
    const chunks: Uint8Array[] = [];
    for await (const chunk of audio as AsyncIterable<Uint8Array>) {
      if (chunk) {
        chunks.push(
          chunk instanceof Uint8Array
            ? chunk
            : Buffer.from(chunk as ArrayBuffer),
        );
      }
    }
    if (chunks.length === 0) {
      throw new Error("Async iterable produced no data");
    }
    return Buffer.concat(chunks);
  }

  // Handle sync iterables
  if (typeof audio === "object" && audio !== null && Symbol.iterator in audio) {
    const chunks: Uint8Array[] = [];
    for (const chunk of audio as Iterable<Uint8Array>) {
      if (chunk) {
        chunks.push(
          chunk instanceof Uint8Array
            ? chunk
            : Buffer.from(chunk as ArrayBuffer),
        );
      }
    }
    if (chunks.length === 0) {
      throw new Error("Iterable produced no data");
    }
    return Buffer.concat(chunks);
  }

  // This should never happen if AudioResponse type is complete
  const audioObj = audio as unknown as Record<string, unknown>;
  throw new Error(
    `Unexpected audio response type: ${typeof audio}, keys: ${Object.keys(audioObj).join(", ")}`,
  );
}

/**
 * Generate speech from text using a specified voice
 * Perfect for NPC dialogue
 */
export async function generateSpeech(
  options: TextToSpeechOptions,
): Promise<TextToSpeechResult> {
  const elevenlabs = getClient();

  const audioResponse = await elevenlabs.textToSpeech.convert(options.voiceId, {
    text: options.text,
    modelId: options.modelId || "eleven_multilingual_v2",
    outputFormat: options.outputFormat || "mp3_44100_128",
    // Voice settings for character expression
    voiceSettings: {
      stability: options.stability ?? 0.5,
      similarityBoost: options.similarityBoost ?? 0.75,
      style: options.style ?? 0.5,
      useSpeakerBoost: true,
    },
  });

  const buffer = await audioToBuffer(audioResponse);

  if (!buffer || buffer.length === 0) {
    throw new Error("No audio data received from ElevenLabs");
  }

  return {
    audio: buffer,
    format: options.outputFormat || "mp3_44100_128",
  };
}

/**
 * Generate speech with timestamps for lip-sync
 * Returns audio with character-level timing
 */
export async function generateSpeechWithTimestamps(
  options: TextToSpeechOptions,
): Promise<{
  audio: Buffer;
  format: string;
  timestamps: Array<{ character: string; start: number; end: number }>;
}> {
  const elevenlabs = getClient();

  const result = await elevenlabs.textToSpeech.convertWithTimestamps(
    options.voiceId,
    {
      text: options.text,
      modelId: options.modelId || "eleven_multilingual_v2",
      outputFormat: options.outputFormat || "mp3_44100_128",
      // Voice settings for character expression
      voiceSettings: {
        stability: options.stability ?? 0.5,
        similarityBoost: options.similarityBoost ?? 0.75,
        style: options.style ?? 0.5,
        useSpeakerBoost: true,
      },
    },
  );

  // SDK returns audioBase64 (base64 encoded string)
  const audioBase64 = (result as { audioBase64?: string }).audioBase64;

  if (!audioBase64) {
    throw new Error(
      `No audio data in response. Available keys: ${Object.keys(result).join(", ")}`,
    );
  }

  // Convert base64 to buffer
  const audio = Buffer.from(audioBase64, "base64");

  if (!audio || audio.length === 0) {
    throw new Error("No audio data received from ElevenLabs");
  }

  const timestamps =
    result.alignment?.characters?.map((char, idx) => ({
      character: char,
      start: result.alignment?.characterStartTimesSeconds?.[idx] || 0,
      end: result.alignment?.characterEndTimesSeconds?.[idx] || 0,
    })) || [];

  return {
    audio,
    format: options.outputFormat || "mp3_44100_128",
    timestamps,
  };
}

// ============================================================================
// Sound Effects
// ============================================================================

/**
 * Generate sound effects from text description
 * Perfect for game SFX like "sword swing", "coin pickup", "door creak"
 */
export async function generateSoundEffect(
  options: SoundEffectOptions,
): Promise<SoundEffectResult> {
  const elevenlabs = getClient();

  const audioResponse = await elevenlabs.textToSoundEffects.convert({
    text: options.text,
    durationSeconds: options.durationSeconds,
    promptInfluence: options.promptInfluence || 0.7,
  });

  const buffer = await audioToBuffer(audioResponse);

  if (!buffer || buffer.length === 0) {
    throw new Error("No audio data received from ElevenLabs SFX");
  }

  return {
    audio: buffer,
    format: "mp3",
  };
}

// ============================================================================
// Music Generation
// ============================================================================

/**
 * Generate music from a text prompt
 * Perfect for background music, themes, combat music, etc.
 */
export async function generateMusic(
  options: MusicGenerationOptions,
): Promise<MusicGenerationResult> {
  const elevenlabs = getClient();

  const audioResponse = await elevenlabs.music.compose({
    prompt: options.prompt,
    musicLengthMs: options.durationMs || 30000, // Default 30 seconds
  });

  const buffer = await audioToBuffer(audioResponse);

  if (!buffer || buffer.length === 0) {
    throw new Error("No audio data received from ElevenLabs Music");
  }

  return {
    audio: buffer,
    format: "mp3",
  };
}

/**
 * Generate music with detailed composition plan and metadata
 */
export async function generateMusicDetailed(options: {
  prompt: string;
  durationMs?: number;
  forceInstrumental?: boolean;
  withTimestamps?: boolean;
}): Promise<{
  audio: Buffer;
  format: string;
  compositionPlan?: {
    styles: string[];
    sections: Array<{ name: string; durationMs: number }>;
  };
  metadata?: {
    title?: string;
    description?: string;
    genres?: string[];
  };
}> {
  // The detailed endpoint returns both audio and metadata
  // For now, use the simple compose endpoint and return basic structure
  const result = await generateMusic({
    prompt: options.prompt,
    durationMs: options.durationMs,
    forceInstrumental: options.forceInstrumental,
  });

  return {
    audio: result.audio,
    format: result.format,
    compositionPlan: undefined, // Would come from detailed API
    metadata: result.metadata,
  };
}

// ============================================================================
// Predefined Voice Presets for Game Characters
// ============================================================================

export type VoicePreset = {
  voiceId: string;
  description: string;
  // Voice settings for character type
  stability: number; // 0-1, higher = more consistent
  similarityBoost: number; // 0-1, how much to match original voice
  style: number; // 0-1, higher = more expressive/exaggerated
  // Prompt hints for the text (ElevenLabs reads emotional cues from text)
  speakingStyle?: string;
};

export const GAME_VOICE_PRESETS: Record<string, VoicePreset> = {
  // These are placeholder IDs - real IDs should be fetched from ElevenLabs
  // or configured in environment variables
  "male-warrior": {
    voiceId:
      process.env.ELEVENLABS_VOICE_MALE_WARRIOR || "21m00Tcm4TlvDq8ikWAM",
    description: "Deep, commanding male voice for warriors and fighters",
    stability: 0.7, // Commanding presence
    similarityBoost: 0.8,
    style: 0.6, // Strong delivery
    speakingStyle: "with a deep, commanding warrior's tone",
  },
  "female-mage": {
    voiceId: process.env.ELEVENLABS_VOICE_FEMALE_MAGE || "EXAVITQu4vr4xnSDxMaL",
    description: "Mystical, ethereal female voice for mages and spellcasters",
    stability: 0.5, // More ethereal variation
    similarityBoost: 0.75,
    style: 0.7, // Mystical expression
    speakingStyle: "with a mystical, ethereal enchantress quality",
  },
  "old-sage": {
    voiceId: process.env.ELEVENLABS_VOICE_OLD_SAGE || "pNInz6obpgDQGcFmaJgB",
    description: "Wise, elderly voice for sages and mentors",
    stability: 0.8, // Measured, calm
    similarityBoost: 0.7,
    style: 0.4, // Subtle wisdom
    speakingStyle: "slowly and thoughtfully, like a wise elder",
  },
  "young-hero": {
    voiceId: process.env.ELEVENLABS_VOICE_YOUNG_HERO || "yoZ06aMxZJJ28mfd3POQ",
    description: "Energetic, youthful voice for heroes and adventurers",
    stability: 0.5, // Dynamic energy
    similarityBoost: 0.8,
    style: 0.8, // Enthusiastic
    speakingStyle: "with youthful energy and determination",
  },
  villain: {
    voiceId: process.env.ELEVENLABS_VOICE_VILLAIN || "VR6AewLTigWG4xSOukaG",
    description: "Dark, menacing voice for villains and antagonists",
    stability: 0.6,
    similarityBoost: 0.85,
    style: 0.9, // Dramatic villainy
    speakingStyle: "with a dark, menacing villain's presence",
  },
  merchant: {
    voiceId: process.env.ELEVENLABS_VOICE_MERCHANT || "pqHfZKP75CvOlQylNhV4",
    description: "Friendly, persuasive voice for merchants and shopkeepers",
    stability: 0.6,
    similarityBoost: 0.75,
    style: 0.5, // Friendly persuasion
    speakingStyle: "in a friendly, persuasive merchant's manner",
  },
  guard: {
    voiceId: process.env.ELEVENLABS_VOICE_GUARD || "N2lVS1w4EtoT3dr4eOWO",
    description: "Authoritative voice for guards and soldiers",
    stability: 0.75, // Firm authority
    similarityBoost: 0.8,
    style: 0.5,
    speakingStyle: "with firm authority like a guard on duty",
  },
  innkeeper: {
    voiceId: process.env.ELEVENLABS_VOICE_INNKEEPER || "AZnzlk1XvdvUeBnXmlld",
    description: "Warm, welcoming voice for innkeepers and bartenders",
    stability: 0.65,
    similarityBoost: 0.7,
    style: 0.4, // Warm hospitality
    speakingStyle: "warmly and welcomingly, like a friendly innkeeper",
  },
};

/**
 * Get voice settings for a preset, applying character-specific tuning
 */
export function getPresetVoiceSettings(presetName: string): {
  stability: number;
  similarityBoost: number;
  style: number;
} | null {
  const preset = GAME_VOICE_PRESETS[presetName];
  if (!preset) return null;
  return {
    stability: preset.stability,
    similarityBoost: preset.similarityBoost,
    style: preset.style,
  };
}

// ============================================================================
// Predefined SFX Categories
// ============================================================================

export const SFX_PROMPTS: Record<string, string> = {
  // Combat
  "sword-swing": "Sharp metallic sword swing through air, fast whoosh",
  "sword-hit": "Metal sword hitting armor with clang and impact",
  "bow-draw": "Wooden bow string being drawn back, tension building",
  "arrow-release": "Arrow being released from bow with twang and whoosh",
  "magic-cast": "Mystical spell casting with ethereal sparkle and energy surge",
  fireball: "Fiery whoosh of a fireball spell being launched",
  "heal-spell": "Gentle, warm healing magic with soft chimes",

  // Items
  "coin-pickup": "Single gold coin being picked up, satisfying ding",
  "coins-drop": "Multiple coins falling and clinking together",
  "item-pickup": "Generic item pickup with subtle confirmation sound",
  "inventory-open": "Leather bag being opened, rustling fabric",
  "potion-drink": "Liquid being drunk from a glass bottle, gulp",
  "chest-open": "Wooden treasure chest creaking open",
  "chest-lock": "Metal lock clicking closed",

  // Environment
  "door-open": "Heavy wooden door creaking open slowly",
  "door-close": "Wooden door shutting with solid thud",
  "footsteps-stone": "Boots walking on stone floor, echoing steps",
  "footsteps-grass": "Soft footsteps on grass and leaves",
  "footsteps-wood": "Hollow wooden floor creaking under boots",
  "water-splash": "Small splash in water, rippling",
  "campfire-crackle": "Warm campfire crackling and popping",
  "wind-outdoor": "Gentle outdoor wind with leaves rustling",
  "rain-light": "Light rain falling on roof and ground",

  // UI
  "ui-click": "Clean, subtle UI button click",
  "ui-confirm": "Positive confirmation chime",
  "ui-cancel": "Soft cancel or back sound",
  "level-up": "Triumphant fanfare for leveling up",
  "quest-complete": "Satisfying quest completion jingle",
  achievement: "Achievement unlock with shimmer effect",
};

// ============================================================================
// Predefined Music Prompts
// ============================================================================

export const MUSIC_PROMPTS: Record<string, string> = {
  // Zones/Areas
  "forest-ambient":
    "Peaceful medieval forest ambiance with soft bird songs, gentle wind through leaves, and distant water stream. Calm and serene atmosphere for exploration.",
  "dungeon-dark":
    "Dark, ominous dungeon music with echoing drips, low drones, and tension building. Mysterious and dangerous atmosphere.",
  "town-bustling":
    "Lively medieval town music with lute, flute, and light percussion. Cheerful marketplace atmosphere with a Renaissance feel.",
  "castle-grand":
    "Majestic castle throne room music with orchestral strings, brass fanfares, and noble atmosphere. Regal and impressive.",
  "tavern-cozy":
    "Warm tavern music with acoustic instruments, jolly rhythm, and medieval pub atmosphere. Folk-inspired and inviting.",
  "cave-mysterious":
    "Mysterious cave ambiance with echoing sounds, crystalline tones, and underground atmosphere. Curious and exploratory.",
  "desert-vast":
    "Arabian-inspired desert music with ethnic percussion, wind instruments, and vast open space feeling. Hot and adventurous.",
  "snow-peaceful":
    "Peaceful winter landscape music with gentle bells, soft strings, and cold but beautiful atmosphere. Serene and quiet.",

  // Combat
  "combat-standard":
    "Intense orchestral battle music with driving drums, urgent strings, and heroic brass. Fast-paced combat encounter.",
  "combat-boss":
    "Epic boss battle music with powerful choir, thundering percussion, and dramatic orchestral hits. Life-or-death struggle.",
  "combat-victory":
    "Triumphant victory fanfare with brass flourishes, uplifting melody, and celebration. Short 10-second jingle.",

  // Emotional
  "emotional-sad":
    "Melancholic piano-led piece with soft strings for sad story moments. Gentle and sorrowful.",
  "emotional-heroic":
    "Inspiring heroic theme with soaring strings, brass, and building intensity. Courageous and determined.",
  "emotional-mysterious":
    "Enigmatic music with unusual harmonies, sparse instrumentation, and mysterious atmosphere. Puzzling and intriguing.",

  // Menu/UI
  "menu-main":
    "Epic fantasy main menu theme with full orchestra, memorable melody, and grand atmosphere. Sets the tone for adventure.",
  "menu-pause":
    "Calm ambient music for pause menu, simple and non-intrusive. Background atmosphere.",
};
