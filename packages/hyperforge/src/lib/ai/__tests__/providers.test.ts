/**
 * AI Providers Tests
 *
 * Tests for AI provider configurations, model definitions, and task mappings.
 * Tests validate configuration structure and helper function behavior.
 *
 * Real Issues to Surface:
 * - Missing provider configurations causing runtime errors
 * - Invalid model IDs that AI Gateway won't recognize
 * - Incorrect multimodal detection leading to wrong generation method
 * - Task model preferences not being applied correctly
 */

import { describe, it, expect } from "vitest";

import {
  PROVIDER_MODELS,
  IMAGE_MODELS,
  DEFAULT_TASK_MODELS,
  TASK_MODELS,
  getTaskModel,
  getImageModelConfig,
  isMultimodalImageModel,
  getTextModel,
  getImageModel,
  getVisionModel,
} from "../providers";
import type { AIProvider, TaskType } from "../providers";

describe("AI Providers", () => {
  describe("Provider Models Configuration", () => {
    it("has entries for openai, anthropic, and google", () => {
      expect(PROVIDER_MODELS.openai).toBeDefined();
      expect(PROVIDER_MODELS.anthropic).toBeDefined();
      expect(PROVIDER_MODELS.google).toBeDefined();
    });

    it("each provider has a text model", () => {
      const providers: AIProvider[] = ["openai", "anthropic", "google"];

      providers.forEach((provider) => {
        expect(PROVIDER_MODELS[provider].text).toBeDefined();
        expect(typeof PROVIDER_MODELS[provider].text).toBe("string");
        expect(PROVIDER_MODELS[provider].text.length).toBeGreaterThan(0);
      });
    });

    it("each provider has a vision model", () => {
      const providers: AIProvider[] = ["openai", "anthropic", "google"];

      providers.forEach((provider) => {
        expect(PROVIDER_MODELS[provider].vision).toBeDefined();
        expect(typeof PROVIDER_MODELS[provider].vision).toBe("string");
        expect(PROVIDER_MODELS[provider].vision!.length).toBeGreaterThan(0);
      });
    });

    it("model IDs follow provider/model-name format", () => {
      const providers: AIProvider[] = ["openai", "anthropic", "google"];

      providers.forEach((provider) => {
        const textModel = PROVIDER_MODELS[provider].text;
        // Should start with provider name or valid prefix
        expect(textModel).toMatch(/^[a-z]+\//);
      });
    });

    it("only google has an image model in provider config", () => {
      expect(PROVIDER_MODELS.google.image).toBeDefined();
      expect(PROVIDER_MODELS.openai.image).toBeUndefined();
      expect(PROVIDER_MODELS.anthropic.image).toBeUndefined();
    });
  });

  describe("Image Models Configuration", () => {
    it("has all expected image models defined", () => {
      expect(IMAGE_MODELS.length).toBeGreaterThan(0);

      const modelIds = IMAGE_MODELS.map((m) => m.id);
      expect(modelIds).toContain("google/gemini-2.5-flash-image");
      expect(modelIds).toContain("bfl/flux-2-pro");
      expect(modelIds).toContain("google/imagen-4.0-generate");
    });

    it("each image model has required properties", () => {
      IMAGE_MODELS.forEach((model) => {
        expect(model.id).toBeDefined();
        expect(typeof model.id).toBe("string");
        expect(model.id.length).toBeGreaterThan(0);

        expect(model.name).toBeDefined();
        expect(typeof model.name).toBe("string");

        expect(model.type).toBeDefined();
        expect(["multimodal", "dedicated"]).toContain(model.type);

        expect(model.provider).toBeDefined();
        expect(typeof model.provider).toBe("string");

        expect(model.description).toBeDefined();
        expect(typeof model.description).toBe("string");
      });
    });

    it("each image model has supported dimensions", () => {
      IMAGE_MODELS.forEach((model) => {
        expect(model.supportedSizes).toBeDefined();
        expect(Array.isArray(model.supportedSizes)).toBe(true);
        expect(model.supportedSizes!.length).toBeGreaterThan(0);

        // Validate size format
        model.supportedSizes!.forEach((size) => {
          expect(size).toMatch(/^\d+x\d+$/);
          const [width, height] = size.split("x").map(Number);
          expect(width).toBeGreaterThan(0);
          expect(height).toBeGreaterThan(0);
        });
      });
    });

    it("identifies multimodal vs dedicated models correctly", () => {
      const multimodalModels = IMAGE_MODELS.filter(
        (m) => m.type === "multimodal",
      );
      const dedicatedModels = IMAGE_MODELS.filter(
        (m) => m.type === "dedicated",
      );

      expect(multimodalModels.length).toBeGreaterThan(0);
      expect(dedicatedModels.length).toBeGreaterThan(0);

      // Gemini should be multimodal
      const geminiModel = IMAGE_MODELS.find((m) => m.id.includes("gemini"));
      expect(geminiModel?.type).toBe("multimodal");

      // Flux should be dedicated
      const fluxModel = IMAGE_MODELS.find((m) => m.id.includes("flux"));
      expect(fluxModel?.type).toBe("dedicated");
    });
  });

  describe("Task Models Configuration", () => {
    it("DEFAULT_TASK_MODELS covers all required task types", () => {
      const requiredTasks: TaskType[] = [
        "promptEnhancement",
        "textGeneration",
        "dialogueGeneration",
        "contentGeneration",
        "imageGeneration",
        "vision",
        "reasoning",
      ];

      requiredTasks.forEach((task) => {
        expect(DEFAULT_TASK_MODELS[task]).toBeDefined();
        expect(typeof DEFAULT_TASK_MODELS[task]).toBe("string");
        expect(DEFAULT_TASK_MODELS[task].length).toBeGreaterThan(0);
      });
    });

    it("task models use valid provider/model format", () => {
      Object.values(DEFAULT_TASK_MODELS).forEach((model) => {
        expect(model).toMatch(/^[a-z]+\/[a-z0-9-._]+$/i);
      });
    });

    it("getTaskModel returns correct default model", () => {
      const tasks: TaskType[] = [
        "promptEnhancement",
        "textGeneration",
        "contentGeneration",
        "imageGeneration",
        "vision",
      ];

      tasks.forEach((task) => {
        const model = getTaskModel(task);
        expect(model).toBe(DEFAULT_TASK_MODELS[task]);
      });
    });

    it("TASK_MODELS proxy returns same as getTaskModel", () => {
      expect(TASK_MODELS.textGeneration).toBe(getTaskModel("textGeneration"));
      expect(TASK_MODELS.contentGeneration).toBe(
        getTaskModel("contentGeneration"),
      );
      expect(TASK_MODELS.imageGeneration).toBe(getTaskModel("imageGeneration"));
    });
  });

  describe("Model Capabilities", () => {
    it("getImageModelConfig returns config for known model", () => {
      const config = getImageModelConfig("google/gemini-2.5-flash-image");

      expect(config).toBeDefined();
      expect(config!.id).toBe("google/gemini-2.5-flash-image");
      expect(config!.type).toBe("multimodal");
      expect(config!.provider).toBe("google");
    });

    it("getImageModelConfig returns undefined for unknown model", () => {
      const config = getImageModelConfig("unknown/fake-model");
      expect(config).toBeUndefined();
    });

    it("isMultimodalImageModel returns true for Gemini", () => {
      expect(isMultimodalImageModel("google/gemini-2.5-flash-image")).toBe(
        true,
      );
    });

    it("isMultimodalImageModel returns false for Flux", () => {
      expect(isMultimodalImageModel("bfl/flux-2-pro")).toBe(false);
      expect(isMultimodalImageModel("bfl/flux-2-flex")).toBe(false);
    });

    it("isMultimodalImageModel returns false for Imagen", () => {
      expect(isMultimodalImageModel("google/imagen-4.0-generate")).toBe(false);
      expect(isMultimodalImageModel("google/imagen-4.0-fast-generate")).toBe(
        false,
      );
    });

    it("isMultimodalImageModel returns false for unknown model", () => {
      expect(isMultimodalImageModel("unknown/model")).toBe(false);
    });
  });

  describe("Provider Helper Functions", () => {
    it("getTextModel returns text model for each provider", () => {
      expect(getTextModel("openai")).toBe(PROVIDER_MODELS.openai.text);
      expect(getTextModel("anthropic")).toBe(PROVIDER_MODELS.anthropic.text);
      expect(getTextModel("google")).toBe(PROVIDER_MODELS.google.text);
    });

    it("getVisionModel returns vision model for each provider", () => {
      expect(getVisionModel("openai")).toBe(PROVIDER_MODELS.openai.vision);
      expect(getVisionModel("anthropic")).toBe(
        PROVIDER_MODELS.anthropic.vision,
      );
      expect(getVisionModel("google")).toBe(PROVIDER_MODELS.google.vision);
    });

    it("getImageModel returns image model for google", () => {
      expect(getImageModel("google")).toBe(PROVIDER_MODELS.google.image);
    });

    it("getImageModel throws for providers without image support", () => {
      expect(() => getImageModel("openai")).toThrow(
        "Provider openai does not support image generation",
      );
      expect(() => getImageModel("anthropic")).toThrow(
        "Provider anthropic does not support image generation",
      );
    });
  });

  describe("Model ID Validation", () => {
    it("all model IDs are non-empty strings", () => {
      const allModelIds = [
        ...Object.values(PROVIDER_MODELS).flatMap((p) =>
          [p.text, p.image, p.vision].filter(Boolean),
        ),
        ...IMAGE_MODELS.map((m) => m.id),
        ...Object.values(DEFAULT_TASK_MODELS),
      ];

      allModelIds.forEach((id) => {
        expect(typeof id).toBe("string");
        expect(id.length).toBeGreaterThan(0);
        expect(id.trim()).toBe(id); // No leading/trailing whitespace
      });
    });

    it("model IDs contain no invalid characters", () => {
      const allModelIds = [
        ...IMAGE_MODELS.map((m) => m.id),
        ...Object.values(DEFAULT_TASK_MODELS),
      ];

      allModelIds.forEach((id) => {
        // Should only contain alphanumeric, dash, underscore, dot, slash
        expect(id).toMatch(/^[a-zA-Z0-9\-_./]+$/);
      });
    });
  });

  describe("Size Support", () => {
    it("Flux Pro supports 2048x2048 for high-res textures", () => {
      const fluxPro = getImageModelConfig("bfl/flux-2-pro");
      expect(fluxPro?.supportedSizes).toContain("2048x2048");
    });

    it("Imagen has fixed 1024x1024 output", () => {
      const imagen = getImageModelConfig("google/imagen-4.0-generate");
      expect(imagen?.supportedSizes).toEqual(["1024x1024"]);
    });

    it("all models support at least 1024x1024", () => {
      IMAGE_MODELS.forEach((model) => {
        const supports1024 = model.supportedSizes!.some((size) => {
          const [w, h] = size.split("x").map(Number);
          return w >= 1024 && h >= 1024;
        });
        expect(supports1024).toBe(true);
      });
    });
  });
});
