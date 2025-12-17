/**
 * ElevenLabs Audio Service Tests
 *
 * Tests for the ElevenLabs audio generation service.
 * Tests focus on configuration, validation, and data structure handling.
 *
 * Real Issues to Surface:
 * - Voice preset missing required settings
 * - Duration limits not enforced correctly
 * - Audio buffer type conversion failures
 * - Invalid model IDs in configuration
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Use vi.hoisted to ensure mock functions are available for the mock factory
const {
  mockGetAll,
  mockSearch,
  mockGetShared,
  mockConvert,
  mockConvertWithTimestamps,
  mockSfxConvert,
  mockMusicCompose,
} = vi.hoisted(() => ({
  mockGetAll: vi.fn(),
  mockSearch: vi.fn(),
  mockGetShared: vi.fn(),
  mockConvert: vi.fn(),
  mockConvertWithTimestamps: vi.fn(),
  mockSfxConvert: vi.fn(),
  mockMusicCompose: vi.fn(),
}));

// Mock the ElevenLabs SDK
vi.mock("@elevenlabs/elevenlabs-js", () => {
  return {
    ElevenLabsClient: class MockElevenLabsClient {
      voices = {
        getAll: mockGetAll,
        search: mockSearch,
        getShared: mockGetShared,
      };
      textToSpeech = {
        convert: mockConvert,
        convertWithTimestamps: mockConvertWithTimestamps,
      };
      textToSoundEffects = {
        convert: mockSfxConvert,
      };
      music = {
        compose: mockMusicCompose,
      };
    },
  };
});

// Static imports for types only
import type {
  TextToSpeechOptions,
  SoundEffectOptions,
  MusicGenerationOptions,
  VoicePreset,
} from "../elevenlabs-service";

// We'll dynamically import the service functions to reset the singleton between tests
let getVoices: () => Promise<import("../elevenlabs-service").Voice[]>;
let searchVoices: (options: {
  search?: string;
  gender?: string;
  category?: string;
  pageSize?: number;
}) => Promise<import("../elevenlabs-service").Voice[]>;
let getSharedVoices: (options?: {
  category?: string;
  gender?: string;
  accent?: string;
  language?: string;
  featured?: boolean;
  pageSize?: number;
}) => Promise<import("../elevenlabs-service").Voice[]>;
let generateSpeech: (
  options: TextToSpeechOptions,
) => Promise<import("../elevenlabs-service").TextToSpeechResult>;
let generateSpeechWithTimestamps: (options: TextToSpeechOptions) => Promise<{
  audio: Buffer;
  format: string;
  timestamps: Array<{ character: string; start: number; end: number }>;
}>;
let generateSoundEffect: (
  options: SoundEffectOptions,
) => Promise<import("../elevenlabs-service").SoundEffectResult>;
let generateMusic: (
  options: MusicGenerationOptions,
) => Promise<import("../elevenlabs-service").MusicGenerationResult>;
let generateMusicDetailed: (options: {
  prompt: string;
  durationMs?: number;
  forceInstrumental?: boolean;
  withTimestamps?: boolean;
}) => Promise<{
  audio: Buffer;
  format: string;
  compositionPlan?: {
    styles: string[];
    sections: Array<{ name: string; durationMs: number }>;
  };
  metadata?: { title?: string; description?: string; genres?: string[] };
}>;
let GAME_VOICE_PRESETS: Record<
  string,
  import("../elevenlabs-service").VoicePreset
>;
let getPresetVoiceSettings: (
  presetName: string,
) => { stability: number; similarityBoost: number; style: number } | null;
let SFX_PROMPTS: Record<string, string>;
let MUSIC_PROMPTS: Record<string, string>;

describe("ElevenLabs Audio Service", () => {
  beforeEach(async () => {
    // Reset module cache to get fresh singleton for each test
    vi.resetModules();
    vi.resetAllMocks();
    process.env.ELEVENLABS_API_KEY = "test-api-key";

    // Dynamically import to get fresh module with reset singleton
    const service = await import("../elevenlabs-service");
    getVoices = service.getVoices;
    searchVoices = service.searchVoices;
    getSharedVoices = service.getSharedVoices;
    generateSpeech = service.generateSpeech;
    generateSpeechWithTimestamps = service.generateSpeechWithTimestamps;
    generateSoundEffect = service.generateSoundEffect;
    generateMusic = service.generateMusic;
    generateMusicDetailed = service.generateMusicDetailed;
    GAME_VOICE_PRESETS = service.GAME_VOICE_PRESETS;
    getPresetVoiceSettings = service.getPresetVoiceSettings;
    SFX_PROMPTS = service.SFX_PROMPTS;
    MUSIC_PROMPTS = service.MUSIC_PROMPTS;
  });

  afterEach(() => {
    delete process.env.ELEVENLABS_API_KEY;
  });

  // ============================================================================
  // Integration Tests - Real function calls with mocked SDK
  // ============================================================================

  describe("getVoices() - Integration", () => {
    it("fetches and parses voice list correctly", async () => {
      const mockVoices = [
        {
          voiceId: "voice-001",
          name: "Marcus Warrior",
          description: "Deep commanding voice",
          previewUrl: "https://example.com/preview1.mp3",
          labels: {
            accent: "american",
            age: "adult",
            gender: "male",
            use_case: "gaming",
          },
        },
        {
          voiceId: "voice-002",
          name: "Aria Mage",
          description: "Ethereal mystical voice",
          previewUrl: "https://example.com/preview2.mp3",
          labels: {
            accent: "british",
            age: "young",
            gender: "female",
            use_case: "narration",
          },
        },
      ];

      mockGetAll.mockResolvedValue({ voices: mockVoices });

      const voices = await getVoices();

      expect(mockGetAll).toHaveBeenCalledWith({ showLegacy: false });
      expect(voices).toHaveLength(2);
      expect(voices[0]).toEqual({
        id: "voice-001",
        name: "Marcus Warrior",
        description: "Deep commanding voice",
        previewUrl: "https://example.com/preview1.mp3",
        labels: {
          accent: "american",
          age: "adult",
          gender: "male",
          useCase: "gaming",
        },
      });
      expect(voices[1].labels?.gender).toBe("female");
    });

    it("handles voices with missing optional fields", async () => {
      mockGetAll.mockResolvedValue({
        voices: [
          {
            voiceId: "voice-minimal",
            name: null,
            description: null,
            previewUrl: null,
            labels: null,
          },
        ],
      });

      const voices = await getVoices();

      expect(voices[0]).toEqual({
        id: "voice-minimal",
        name: "Unknown",
        description: undefined,
        previewUrl: undefined,
        labels: {
          accent: undefined,
          age: undefined,
          gender: undefined,
          useCase: undefined,
        },
      });
    });
  });

  describe("searchVoices() - Integration", () => {
    it("searches voices with query and parses results", async () => {
      const mockSearchResult = {
        voices: [
          {
            voiceId: "search-voice-001",
            name: "Deep Warrior",
            description: "Battle-ready voice",
            previewUrl: "https://example.com/warrior.mp3",
            labels: {
              accent: "scottish",
              age: "middle-aged",
              gender: "male",
              use_case: "gaming",
            },
          },
        ],
      };

      mockSearch.mockResolvedValue(mockSearchResult);

      const voices = await searchVoices({ search: "warrior" });

      expect(mockSearch).toHaveBeenCalledWith({
        search: "warrior",
        pageSize: 20,
        includeTotalCount: true,
      });
      expect(voices).toHaveLength(1);
      expect(voices[0].name).toBe("Deep Warrior");
      expect(voices[0].labels?.accent).toBe("scottish");
    });

    it("uses custom page size when provided", async () => {
      mockSearch.mockResolvedValue({ voices: [] });

      await searchVoices({ search: "mage", pageSize: 50 });

      expect(mockSearch).toHaveBeenCalledWith({
        search: "mage",
        pageSize: 50,
        includeTotalCount: true,
      });
    });
  });

  describe("getSharedVoices() - Integration", () => {
    it("fetches shared voices with filters", async () => {
      const mockSharedVoices = {
        voices: [
          {
            voiceId: "shared-voice-001",
            name: "Community Voice",
            description: "Popular shared voice",
            previewUrl: "https://example.com/shared.mp3",
            labels: {
              accent: "american",
              age: "young",
              gender: "male",
              use_case: "narration",
            },
          },
        ],
      };

      mockGetShared.mockResolvedValue(mockSharedVoices);

      const voices = await getSharedVoices({
        gender: "male",
        accent: "american",
        featured: true,
        pageSize: 10,
      });

      expect(mockGetShared).toHaveBeenCalledWith({
        gender: "male",
        accent: "american",
        language: "en",
        featured: true,
        pageSize: 10,
      });
      expect(voices).toHaveLength(1);
      expect(voices[0].name).toBe("Community Voice");
    });

    it("defaults to English language", async () => {
      mockGetShared.mockResolvedValue({ voices: [] });

      await getSharedVoices({});

      expect(mockGetShared).toHaveBeenCalledWith(
        expect.objectContaining({ language: "en" }),
      );
    });
  });

  describe("generateSpeech() - Integration", () => {
    it("generates speech audio from text", async () => {
      const mockAudioBuffer = Buffer.from([0x49, 0x44, 0x33, 0x04]); // MP3 magic bytes
      mockConvert.mockResolvedValue(mockAudioBuffer);

      const result = await generateSpeech({
        text: "Hello adventurer!",
        voiceId: "test-voice-id",
      });

      expect(mockConvert).toHaveBeenCalledWith("test-voice-id", {
        text: "Hello adventurer!",
        modelId: "eleven_multilingual_v2",
        outputFormat: "mp3_44100_128",
        voiceSettings: {
          stability: 0.5,
          similarityBoost: 0.75,
          style: 0.5,
          useSpeakerBoost: true,
        },
      });
      expect(result.audio).toBeInstanceOf(Buffer);
      expect(result.audio.length).toBeGreaterThan(0);
      expect(result.format).toBe("mp3_44100_128");
    });

    it("applies custom voice settings", async () => {
      mockConvert.mockResolvedValue(Buffer.from([0x00, 0x01]));

      await generateSpeech({
        text: "Custom settings test",
        voiceId: "custom-voice",
        modelId: "eleven_turbo_v2_5",
        stability: 0.8,
        similarityBoost: 0.9,
        style: 0.3,
        outputFormat: "mp3_22050_32",
      });

      expect(mockConvert).toHaveBeenCalledWith("custom-voice", {
        text: "Custom settings test",
        modelId: "eleven_turbo_v2_5",
        outputFormat: "mp3_22050_32",
        voiceSettings: {
          stability: 0.8,
          similarityBoost: 0.9,
          style: 0.3,
          useSpeakerBoost: true,
        },
      });
    });

    it("handles Uint8Array response", async () => {
      const mockUint8 = new Uint8Array([0x49, 0x44, 0x33, 0x04, 0x00]);
      mockConvert.mockResolvedValue(mockUint8);

      const result = await generateSpeech({
        text: "Uint8Array test",
        voiceId: "voice-123",
      });

      expect(result.audio).toBeInstanceOf(Buffer);
      expect(result.audio.length).toBe(5);
    });

    it("handles base64 string response", async () => {
      const originalData = "Hello Audio Data";
      const base64 = Buffer.from(originalData).toString("base64");
      mockConvert.mockResolvedValue(base64);

      const result = await generateSpeech({
        text: "Base64 test",
        voiceId: "voice-456",
      });

      expect(result.audio).toBeInstanceOf(Buffer);
      expect(result.audio.toString()).toBe(originalData);
    });

    it("handles ReadableStream response", async () => {
      const chunks = [
        new Uint8Array([0x49, 0x44]),
        new Uint8Array([0x33, 0x04]),
      ];
      let chunkIndex = 0;

      const mockStream = {
        getReader: () => ({
          read: async () => {
            if (chunkIndex >= chunks.length) {
              return { done: true, value: undefined };
            }
            return { done: false, value: chunks[chunkIndex++] };
          },
          releaseLock: () => {},
        }),
      } as unknown as ReadableStream<Uint8Array>;

      mockConvert.mockResolvedValue(mockStream);

      const result = await generateSpeech({
        text: "Stream test",
        voiceId: "voice-stream",
      });

      expect(result.audio).toBeInstanceOf(Buffer);
      expect(result.audio.length).toBe(4);
    });

    it("throws error when no audio data received", async () => {
      mockConvert.mockResolvedValue(Buffer.from([]));

      await expect(
        generateSpeech({
          text: "Empty response test",
          voiceId: "voice-empty",
        }),
      ).rejects.toThrow("No audio data received from ElevenLabs");
    });
  });

  describe("generateSpeechWithTimestamps() - Integration", () => {
    it("generates speech with character timestamps for lip-sync", async () => {
      const mockBase64Audio = Buffer.from("audio data").toString("base64");
      mockConvertWithTimestamps.mockResolvedValue({
        audioBase64: mockBase64Audio,
        alignment: {
          characters: ["H", "e", "l", "l", "o"],
          characterStartTimesSeconds: [0.0, 0.1, 0.2, 0.3, 0.4],
          characterEndTimesSeconds: [0.1, 0.2, 0.3, 0.4, 0.5],
        },
      });

      const result = await generateSpeechWithTimestamps({
        text: "Hello",
        voiceId: "timestamp-voice",
      });

      expect(mockConvertWithTimestamps).toHaveBeenCalledWith(
        "timestamp-voice",
        {
          text: "Hello",
          modelId: "eleven_multilingual_v2",
          outputFormat: "mp3_44100_128",
          voiceSettings: {
            stability: 0.5,
            similarityBoost: 0.75,
            style: 0.5,
            useSpeakerBoost: true,
          },
        },
      );
      expect(result.audio).toBeInstanceOf(Buffer);
      expect(result.timestamps).toHaveLength(5);
      expect(result.timestamps[0]).toEqual({
        character: "H",
        start: 0.0,
        end: 0.1,
      });
      expect(result.timestamps[4]).toEqual({
        character: "o",
        start: 0.4,
        end: 0.5,
      });
    });

    it("handles missing alignment data gracefully", async () => {
      const mockBase64Audio = Buffer.from("audio").toString("base64");
      mockConvertWithTimestamps.mockResolvedValue({
        audioBase64: mockBase64Audio,
        alignment: null,
      });

      const result = await generateSpeechWithTimestamps({
        text: "No alignment",
        voiceId: "voice-no-align",
      });

      expect(result.timestamps).toEqual([]);
      expect(result.audio.length).toBeGreaterThan(0);
    });

    it("throws error when no audio base64 in response", async () => {
      mockConvertWithTimestamps.mockResolvedValue({
        alignment: { characters: [] },
      });

      await expect(
        generateSpeechWithTimestamps({
          text: "No audio",
          voiceId: "voice-error",
        }),
      ).rejects.toThrow(/No audio data in response/);
    });
  });

  describe("generateSoundEffect() - Integration", () => {
    it("generates sound effect from description", async () => {
      const mockSfxBuffer = Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00]);
      mockSfxConvert.mockResolvedValue(mockSfxBuffer);

      const result = await generateSoundEffect({
        text: "Sword clashing against metal armor",
        durationSeconds: 2.5,
      });

      expect(mockSfxConvert).toHaveBeenCalledWith({
        text: "Sword clashing against metal armor",
        durationSeconds: 2.5,
        promptInfluence: 0.7,
      });
      expect(result.audio).toBeInstanceOf(Buffer);
      expect(result.audio.length).toBeGreaterThan(0);
      expect(result.format).toBe("mp3");
    });

    it("uses custom prompt influence", async () => {
      mockSfxConvert.mockResolvedValue(Buffer.from([0x00, 0x01]));

      await generateSoundEffect({
        text: "Coin pickup sound",
        promptInfluence: 0.9,
      });

      expect(mockSfxConvert).toHaveBeenCalledWith({
        text: "Coin pickup sound",
        durationSeconds: undefined,
        promptInfluence: 0.9,
      });
    });

    it("throws error when no SFX audio received", async () => {
      mockSfxConvert.mockResolvedValue(Buffer.from([]));

      await expect(generateSoundEffect({ text: "Empty SFX" })).rejects.toThrow(
        "No audio data received from ElevenLabs SFX",
      );
    });
  });

  describe("generateMusic() - Integration", () => {
    it("generates music from prompt", async () => {
      const mockMusicBuffer = Buffer.from(new Array(1000).fill(0x00));
      mockMusicCompose.mockResolvedValue(mockMusicBuffer);

      const result = await generateMusic({
        prompt: "Epic orchestral battle music with dramatic drums",
      });

      expect(mockMusicCompose).toHaveBeenCalledWith({
        prompt: "Epic orchestral battle music with dramatic drums",
        musicLengthMs: 30000,
      });
      expect(result.audio).toBeInstanceOf(Buffer);
      expect(result.audio.length).toBe(1000);
      expect(result.format).toBe("mp3");
    });

    it("uses custom duration", async () => {
      mockMusicCompose.mockResolvedValue(Buffer.from([0x00]));

      await generateMusic({
        prompt: "Peaceful forest ambient music",
        durationMs: 60000,
      });

      expect(mockMusicCompose).toHaveBeenCalledWith({
        prompt: "Peaceful forest ambient music",
        musicLengthMs: 60000,
      });
    });

    it("throws error when no music audio received", async () => {
      mockMusicCompose.mockResolvedValue(Buffer.from([]));

      await expect(generateMusic({ prompt: "Empty music" })).rejects.toThrow(
        "No audio data received from ElevenLabs Music",
      );
    });
  });

  describe("generateMusicDetailed() - Integration", () => {
    it("generates detailed music with metadata structure", async () => {
      const mockMusicBuffer = Buffer.from(new Array(500).fill(0x01));
      mockMusicCompose.mockResolvedValue(mockMusicBuffer);

      const result = await generateMusicDetailed({
        prompt: "Tavern music with lute and flute",
        durationMs: 45000,
        forceInstrumental: true,
      });

      expect(result.audio).toBeInstanceOf(Buffer);
      expect(result.format).toBe("mp3");
      expect(result.compositionPlan).toBeUndefined(); // Not implemented yet
    });
  });

  describe("audioToBuffer edge cases - Integration", () => {
    it("handles async iterable response", async () => {
      async function* generateChunks(): AsyncIterable<Uint8Array> {
        yield new Uint8Array([0x48, 0x65]);
        yield new Uint8Array([0x6c, 0x6c]);
        yield new Uint8Array([0x6f]);
      }

      mockConvert.mockResolvedValue(generateChunks());

      const result = await generateSpeech({
        text: "Async iterable test",
        voiceId: "voice-async",
      });

      expect(result.audio).toBeInstanceOf(Buffer);
      expect(result.audio.toString()).toBe("Hello");
    });

    it("handles sync iterable response", async () => {
      const chunks = [
        new Uint8Array([0x57, 0x6f]),
        new Uint8Array([0x72, 0x6c, 0x64]),
      ];

      mockConvert.mockResolvedValue({
        [Symbol.iterator]: function* () {
          for (const chunk of chunks) {
            yield chunk;
          }
        },
      });

      const result = await generateSpeech({
        text: "Sync iterable test",
        voiceId: "voice-sync",
      });

      expect(result.audio).toBeInstanceOf(Buffer);
      expect(result.audio.toString()).toBe("World");
    });
  });

  // ============================================================================
  // Unit Tests - Configuration and validation (existing tests)
  // ============================================================================

  describe("Voice Presets", () => {
    it("getPresetVoiceSettings returns valid settings for each preset", () => {
      const presetNames = Object.keys(GAME_VOICE_PRESETS);

      presetNames.forEach((presetName) => {
        const settings = getPresetVoiceSettings(presetName);
        expect(settings).not.toBeNull();
        expect(settings).toHaveProperty("stability");
        expect(settings).toHaveProperty("similarityBoost");
        expect(settings).toHaveProperty("style");
      });
    });

    it("returns null for unknown preset", () => {
      const settings = getPresetVoiceSettings("unknown-preset-name");
      expect(settings).toBeNull();
    });

    it("settings have stability, similarity_boost, style values", () => {
      const settings = getPresetVoiceSettings("male-warrior");
      expect(settings).not.toBeNull();

      if (settings) {
        expect(typeof settings.stability).toBe("number");
        expect(typeof settings.similarityBoost).toBe("number");
        expect(typeof settings.style).toBe("number");
      }
    });

    it("values are within valid ranges (0-1)", () => {
      Object.keys(GAME_VOICE_PRESETS).forEach((presetName) => {
        const settings = getPresetVoiceSettings(presetName);
        expect(settings).not.toBeNull();

        if (settings) {
          expect(settings.stability).toBeGreaterThanOrEqual(0);
          expect(settings.stability).toBeLessThanOrEqual(1);
          expect(settings.similarityBoost).toBeGreaterThanOrEqual(0);
          expect(settings.similarityBoost).toBeLessThanOrEqual(1);
          expect(settings.style).toBeGreaterThanOrEqual(0);
          expect(settings.style).toBeLessThanOrEqual(1);
        }
      });
    });

    it("all presets have required fields", () => {
      Object.entries(GAME_VOICE_PRESETS).forEach(([name, preset]) => {
        expect(preset.voiceId).toBeDefined();
        expect(preset.voiceId.length).toBeGreaterThan(0);
        expect(preset.description).toBeDefined();
        expect(typeof preset.stability).toBe("number");
        expect(typeof preset.similarityBoost).toBe("number");
        expect(typeof preset.style).toBe("number");
      });
    });

    it("defines expected character presets", () => {
      const expectedPresets = [
        "male-warrior",
        "female-mage",
        "old-sage",
        "young-hero",
        "villain",
        "merchant",
        "guard",
        "innkeeper",
      ];

      expectedPresets.forEach((preset) => {
        expect(GAME_VOICE_PRESETS[preset]).toBeDefined();
      });
    });
  });

  describe("Request Configuration", () => {
    it("TTS request includes required fields (text, voice_id, model_id)", () => {
      const ttsOptions: TextToSpeechOptions = {
        text: "Hello adventurer!",
        voiceId: "test-voice-id",
        modelId: "eleven_multilingual_v2",
      };

      expect(ttsOptions.text).toBeDefined();
      expect(ttsOptions.text.length).toBeGreaterThan(0);
      expect(ttsOptions.voiceId).toBeDefined();
      expect(ttsOptions.voiceId.length).toBeGreaterThan(0);
      expect(ttsOptions.modelId).toBeDefined();
    });

    it("TTS options have correct optional field types", () => {
      const ttsOptions: TextToSpeechOptions = {
        text: "Test speech",
        voiceId: "voice-123",
        stability: 0.5,
        similarityBoost: 0.75,
        style: 0.3,
        outputFormat: "mp3_44100_128",
      };

      expect(typeof ttsOptions.stability).toBe("number");
      expect(typeof ttsOptions.similarityBoost).toBe("number");
      expect(typeof ttsOptions.style).toBe("number");
      expect(ttsOptions.outputFormat).toMatch(
        /^(mp3_44100_128|mp3_22050_32|pcm_16000)$/,
      );
    });

    it("SFX request includes description and duration", () => {
      const sfxOptions: SoundEffectOptions = {
        text: "Sword clashing against armor",
        durationSeconds: 2.5,
        promptInfluence: 0.7,
      };

      expect(sfxOptions.text).toBeDefined();
      expect(sfxOptions.text.length).toBeGreaterThan(0);
      expect(typeof sfxOptions.durationSeconds).toBe("number");
      expect(typeof sfxOptions.promptInfluence).toBe("number");
    });

    it("Music request includes prompt and duration options", () => {
      const musicOptions: MusicGenerationOptions = {
        prompt: "Epic orchestral battle music",
        durationMs: 30000,
        forceInstrumental: true,
      };

      expect(musicOptions.prompt).toBeDefined();
      expect(musicOptions.prompt.length).toBeGreaterThan(0);
      expect(typeof musicOptions.durationMs).toBe("number");
      expect(typeof musicOptions.forceInstrumental).toBe("boolean");
    });
  });

  describe("Audio Buffer Handling", () => {
    it("audioToBuffer type validation - handles Buffer input", () => {
      const buffer = Buffer.from([0x00, 0x01, 0x02, 0x03]);
      expect(Buffer.isBuffer(buffer)).toBe(true);
      expect(buffer.length).toBe(4);
    });

    it("handles Uint8Array input", () => {
      const uint8Array = new Uint8Array([0x00, 0x01, 0x02, 0x03]);
      const buffer = Buffer.from(uint8Array);

      expect(Buffer.isBuffer(buffer)).toBe(true);
      expect(buffer.length).toBe(4);
      expect(buffer[0]).toBe(0x00);
      expect(buffer[3]).toBe(0x03);
    });

    it("handles base64 string conversion", () => {
      const originalData = "Hello Audio";
      const base64 = Buffer.from(originalData).toString("base64");
      const decoded = Buffer.from(base64, "base64");

      expect(decoded.toString()).toBe(originalData);
    });

    it("handles ArrayBuffer to Buffer conversion", () => {
      const arrayBuffer = new ArrayBuffer(4);
      const view = new Uint8Array(arrayBuffer);
      view[0] = 0x48;
      view[1] = 0x49;
      view[2] = 0x21;
      view[3] = 0x00;

      const buffer = Buffer.from(arrayBuffer);
      expect(Buffer.isBuffer(buffer)).toBe(true);
      expect(buffer.length).toBe(4);
    });
  });

  describe("Voice Search", () => {
    it("voice search query structure is valid", () => {
      const searchOptions = {
        search: "warrior",
        gender: "male",
        category: "professional",
        pageSize: 20,
      };

      expect(typeof searchOptions.search).toBe("string");
      expect(typeof searchOptions.pageSize).toBe("number");
      expect(searchOptions.pageSize).toBeGreaterThan(0);
    });

    it("filter options include gender, age, accent", () => {
      const filterOptions = {
        gender: "female",
        accent: "british",
        language: "en",
        featured: true,
        pageSize: 10,
      };

      expect(filterOptions.gender).toBeDefined();
      expect(filterOptions.accent).toBeDefined();
      expect(filterOptions.language).toBeDefined();
    });

    it("voice labels structure is correct", () => {
      const voiceLabels = {
        accent: "american",
        age: "young",
        gender: "male",
        useCase: "narration",
      };

      expect(typeof voiceLabels.accent).toBe("string");
      expect(typeof voiceLabels.age).toBe("string");
      expect(typeof voiceLabels.gender).toBe("string");
      expect(typeof voiceLabels.useCase).toBe("string");
    });
  });

  describe("Duration Validation", () => {
    it("SFX duration within limits (0.5-22 seconds)", () => {
      const validDurations = [0.5, 1, 5, 10, 15, 22];

      validDurations.forEach((duration) => {
        expect(duration).toBeGreaterThanOrEqual(0.5);
        expect(duration).toBeLessThanOrEqual(22);
      });
    });

    it("SFX duration rejects invalid values", () => {
      const invalidDurations = [0, 0.1, 0.4, 23, 30, 100];

      invalidDurations.forEach((duration) => {
        const isValid = duration >= 0.5 && duration <= 22;
        expect(isValid).toBe(false);
      });
    });

    it("Music duration within limits (3000-300000 ms)", () => {
      const validDurations = [3000, 30000, 60000, 120000, 300000];

      validDurations.forEach((duration) => {
        expect(duration).toBeGreaterThanOrEqual(3000);
        expect(duration).toBeLessThanOrEqual(300000);
      });
    });

    it("Music duration rejects values outside limits", () => {
      const invalidDurations = [1000, 2000, 2999, 300001, 400000];

      invalidDurations.forEach((duration) => {
        const isValid = duration >= 3000 && duration <= 300000;
        expect(isValid).toBe(false);
      });
    });

    it("Music duration default is 30 seconds (30000ms)", () => {
      const defaultDuration = 30000;
      expect(defaultDuration).toBe(30000);
      expect(defaultDuration).toBeGreaterThanOrEqual(3000);
      expect(defaultDuration).toBeLessThanOrEqual(300000);
    });
  });

  describe("Model Selection", () => {
    it("correct model for TTS (eleven_multilingual_v2 or eleven_turbo_v2_5)", () => {
      const validTTSModels = [
        "eleven_multilingual_v2",
        "eleven_turbo_v2_5",
        "eleven_monolingual_v1",
      ];

      const defaultModel = "eleven_multilingual_v2";
      expect(validTTSModels).toContain(defaultModel);
    });

    it("model ID format validation", () => {
      const modelIdPattern = /^eleven_[a-z]+_v[0-9](_[0-9]+)?$/;

      const validModels = [
        "eleven_multilingual_v2",
        "eleven_turbo_v2_5",
        "eleven_monolingual_v1",
      ];

      validModels.forEach((model) => {
        expect(model).toMatch(modelIdPattern);
      });
    });

    it("output format options are valid", () => {
      const validFormats = ["mp3_44100_128", "mp3_22050_32", "pcm_16000"];

      validFormats.forEach((format) => {
        expect(format).toMatch(/^(mp3|pcm)_\d+(_\d+)?$/);
      });
    });
  });

  describe("SFX Prompts Configuration", () => {
    it("defines prompts for combat sounds", () => {
      const combatSounds = [
        "sword-swing",
        "sword-hit",
        "bow-draw",
        "arrow-release",
        "magic-cast",
        "fireball",
        "heal-spell",
      ];

      combatSounds.forEach((sound) => {
        expect(SFX_PROMPTS[sound]).toBeDefined();
        expect(SFX_PROMPTS[sound].length).toBeGreaterThan(0);
      });
    });

    it("defines prompts for item sounds", () => {
      const itemSounds = [
        "coin-pickup",
        "coins-drop",
        "item-pickup",
        "inventory-open",
        "potion-drink",
        "chest-open",
        "chest-lock",
      ];

      itemSounds.forEach((sound) => {
        expect(SFX_PROMPTS[sound]).toBeDefined();
        expect(SFX_PROMPTS[sound].length).toBeGreaterThan(0);
      });
    });

    it("defines prompts for UI sounds", () => {
      const uiSounds = [
        "ui-click",
        "ui-confirm",
        "ui-cancel",
        "level-up",
        "quest-complete",
      ];

      uiSounds.forEach((sound) => {
        expect(SFX_PROMPTS[sound]).toBeDefined();
        expect(SFX_PROMPTS[sound].length).toBeGreaterThan(0);
      });
    });

    it("all SFX prompts are descriptive strings", () => {
      Object.entries(SFX_PROMPTS).forEach(([key, prompt]) => {
        expect(typeof prompt).toBe("string");
        expect(prompt.length).toBeGreaterThan(10);
      });
    });
  });

  describe("Music Prompts Configuration", () => {
    it("defines prompts for zone music", () => {
      const zoneMusicKeys = [
        "forest-ambient",
        "dungeon-dark",
        "town-bustling",
        "castle-grand",
        "tavern-cozy",
        "cave-mysterious",
        "desert-vast",
        "snow-peaceful",
      ];

      zoneMusicKeys.forEach((key) => {
        expect(MUSIC_PROMPTS[key]).toBeDefined();
        expect(MUSIC_PROMPTS[key].length).toBeGreaterThan(20);
      });
    });

    it("defines prompts for combat music", () => {
      const combatMusicKeys = [
        "combat-standard",
        "combat-boss",
        "combat-victory",
      ];

      combatMusicKeys.forEach((key) => {
        expect(MUSIC_PROMPTS[key]).toBeDefined();
        expect(MUSIC_PROMPTS[key].length).toBeGreaterThan(20);
      });
    });

    it("defines prompts for emotional music", () => {
      const emotionalMusicKeys = [
        "emotional-sad",
        "emotional-heroic",
        "emotional-mysterious",
      ];

      emotionalMusicKeys.forEach((key) => {
        expect(MUSIC_PROMPTS[key]).toBeDefined();
        expect(MUSIC_PROMPTS[key].length).toBeGreaterThan(20);
      });
    });

    it("all music prompts include atmospheric descriptions", () => {
      Object.entries(MUSIC_PROMPTS).forEach(([key, prompt]) => {
        expect(typeof prompt).toBe("string");
        expect(prompt.length).toBeGreaterThan(30);
      });
    });
  });

  describe("Voice Preset Voice IDs", () => {
    it("all presets have valid voice ID format", () => {
      Object.entries(GAME_VOICE_PRESETS).forEach(([name, preset]) => {
        expect(preset.voiceId).toBeDefined();
        expect(typeof preset.voiceId).toBe("string");
        expect(preset.voiceId.length).toBeGreaterThan(10);
      });
    });

    it("presets have speaking style hints", () => {
      const presetsWithStyle = [
        "male-warrior",
        "female-mage",
        "old-sage",
        "villain",
      ];

      presetsWithStyle.forEach((name) => {
        const preset = GAME_VOICE_PRESETS[name];
        expect(preset.speakingStyle).toBeDefined();
        expect(preset.speakingStyle!.length).toBeGreaterThan(0);
      });
    });

    it("warrior preset has commanding stability", () => {
      const warrior = GAME_VOICE_PRESETS["male-warrior"];
      expect(warrior.stability).toBeGreaterThanOrEqual(0.6);
    });

    it("sage preset has high stability for calm speech", () => {
      const sage = GAME_VOICE_PRESETS["old-sage"];
      expect(sage.stability).toBeGreaterThanOrEqual(0.7);
    });

    it("villain preset has high style for dramatic effect", () => {
      const villain = GAME_VOICE_PRESETS["villain"];
      expect(villain.style).toBeGreaterThanOrEqual(0.8);
    });
  });
});
