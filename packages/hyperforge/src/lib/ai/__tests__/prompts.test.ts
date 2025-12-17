/**
 * AI Prompts Tests
 *
 * Tests for prompt templates and formatting utilities.
 * Tests validate template structure and variable substitution.
 *
 * Real Issues to Surface:
 * - Missing template placeholders causing broken prompts
 * - Variable substitution not handling edge cases
 * - Templates with formatting issues that affect generation quality
 */

import { describe, it, expect } from "vitest";

import { PROMPTS, formatPrompt } from "../prompts";

describe("AI Prompts", () => {
  describe("Prompt Templates Structure", () => {
    it("PROMPTS has imageGeneration templates", () => {
      expect(PROMPTS.imageGeneration).toBeDefined();
      expect(PROMPTS.imageGeneration.base).toBeDefined();
      expect(PROMPTS.imageGeneration.enhancement).toBeDefined();
    });

    it("PROMPTS has textTo3D templates", () => {
      expect(PROMPTS.textTo3D).toBeDefined();
      expect(PROMPTS.textTo3D.base).toBeDefined();
      expect(PROMPTS.textTo3D.style).toBeDefined();
    });

    it("all templates are non-empty strings", () => {
      const templates = [
        PROMPTS.imageGeneration.base,
        PROMPTS.imageGeneration.enhancement,
        PROMPTS.textTo3D.base,
        PROMPTS.textTo3D.style,
      ];

      templates.forEach((template) => {
        expect(typeof template).toBe("string");
        expect(template.length).toBeGreaterThan(0);
        expect(template.trim().length).toBeGreaterThan(0);
      });
    });
  });

  describe("Template Placeholders", () => {
    it("imageGeneration.base has {description} placeholder", () => {
      expect(PROMPTS.imageGeneration.base).toContain("{description}");
    });

    it("imageGeneration.enhancement has {description} placeholder", () => {
      expect(PROMPTS.imageGeneration.enhancement).toContain("{description}");
    });

    it("textTo3D.base has {description} placeholder", () => {
      expect(PROMPTS.textTo3D.base).toContain("{description}");
    });

    it("textTo3D.style has no placeholders (static)", () => {
      expect(PROMPTS.textTo3D.style).not.toContain("{");
      expect(PROMPTS.textTo3D.style).not.toContain("}");
    });

    it("placeholders use consistent {variable} format", () => {
      const templates = [
        PROMPTS.imageGeneration.base,
        PROMPTS.imageGeneration.enhancement,
        PROMPTS.textTo3D.base,
      ];

      templates.forEach((template) => {
        // Find all placeholders
        const placeholders = template.match(/\{[a-zA-Z_]+\}/g) || [];
        // Each should be well-formed
        placeholders.forEach((placeholder) => {
          expect(placeholder).toMatch(/^\{[a-zA-Z_]+\}$/);
        });
      });
    });
  });

  describe("Template Content Quality", () => {
    it("imageGeneration.base includes quality instructions", () => {
      const template = PROMPTS.imageGeneration.base;
      expect(template.toLowerCase()).toContain("game");
      expect(template.toLowerCase()).toContain("quality");
    });

    it("imageGeneration.enhancement includes enhancement guidance", () => {
      const template = PROMPTS.imageGeneration.enhancement;
      expect(template.toLowerCase()).toContain("material");
      expect(template.toLowerCase()).toContain("texture");
    });

    it("textTo3D.base includes 3D-specific instructions", () => {
      const template = PROMPTS.textTo3D.base;
      expect(template.toLowerCase()).toContain("3d");
      expect(template.toLowerCase()).toContain("topology");
    });

    it("textTo3D.style references RuneScape aesthetic", () => {
      const template = PROMPTS.textTo3D.style;
      expect(template.toLowerCase()).toContain("runescape");
      expect(template.toLowerCase()).toContain("stylized");
    });
  });

  describe("formatPrompt Function", () => {
    it("substitutes single variable correctly", () => {
      const template = "Hello, {name}!";
      const result = formatPrompt(template, { name: "World" });
      expect(result).toBe("Hello, World!");
    });

    it("substitutes multiple variables correctly", () => {
      const template = "{greeting}, {name}! Welcome to {place}.";
      const result = formatPrompt(template, {
        greeting: "Hello",
        name: "Player",
        place: "HyperForge",
      });
      expect(result).toBe("Hello, Player! Welcome to HyperForge.");
    });

    it("substitutes same variable multiple times", () => {
      const template = "{item} is a great {item}. Get your {item} today!";
      const result = formatPrompt(template, { item: "sword" });
      expect(result).toBe("sword is a great sword. Get your sword today!");
    });

    it("preserves template when variable not provided", () => {
      const template = "Hello, {name}! Your {missing} is ready.";
      const result = formatPrompt(template, { name: "Player" });
      expect(result).toBe("Hello, Player! Your {missing} is ready.");
    });

    it("handles empty variables object", () => {
      const template = "Hello, {name}!";
      const result = formatPrompt(template, {});
      expect(result).toBe("Hello, {name}!");
    });

    it("handles template with no placeholders", () => {
      const template = "This is a static template.";
      const result = formatPrompt(template, { unused: "value" });
      expect(result).toBe("This is a static template.");
    });

    it("preserves multiline formatting", () => {
      const template = `Line 1: {var1}
Line 2: {var2}
Line 3: {var1}`;
      const result = formatPrompt(template, { var1: "A", var2: "B" });
      expect(result).toBe(`Line 1: A
Line 2: B
Line 3: A`);
    });

    it("handles special characters in values", () => {
      const template = "Description: {description}";
      const specialValue = "A sword with $100 price & <tags>";
      const result = formatPrompt(template, { description: specialValue });
      expect(result).toBe("Description: A sword with $100 price & <tags>");
    });

    it("handles empty string value", () => {
      const template = "Name: {name}";
      const result = formatPrompt(template, { name: "" });
      expect(result).toBe("Name: ");
    });

    it("handles long values correctly", () => {
      const template = "{content}";
      const longValue = "A".repeat(10000);
      const result = formatPrompt(template, { content: longValue });
      expect(result).toBe(longValue);
      expect(result.length).toBe(10000);
    });
  });

  describe("Real Template Formatting", () => {
    it("formats imageGeneration.base with description", () => {
      const result = formatPrompt(PROMPTS.imageGeneration.base, {
        description: "A medieval sword with glowing runes",
      });

      expect(result).not.toContain("{description}");
      expect(result).toContain("A medieval sword with glowing runes");
      expect(result).toContain("game");
    });

    it("formats imageGeneration.enhancement with description", () => {
      const result = formatPrompt(PROMPTS.imageGeneration.enhancement, {
        description: "Iron helmet",
      });

      expect(result).not.toContain("{description}");
      expect(result).toContain("Iron helmet");
      expect(result).toContain("material");
    });

    it("formats textTo3D.base with description", () => {
      const result = formatPrompt(PROMPTS.textTo3D.base, {
        description: "Wooden treasure chest",
      });

      expect(result).not.toContain("{description}");
      expect(result).toContain("Wooden treasure chest");
      expect(result).toContain("3D");
    });

    it("can combine base and style templates", () => {
      const baseFormatted = formatPrompt(PROMPTS.textTo3D.base, {
        description: "Dragon shield",
      });
      const combined = `${baseFormatted}\n\n${PROMPTS.textTo3D.style}`;

      expect(combined).toContain("Dragon shield");
      expect(combined).toContain("RuneScape");
      expect(combined).toContain("stylized");
    });
  });

  describe("Edge Cases", () => {
    it("handles curly braces that are not placeholders", () => {
      const template = 'JSON: { "key": "{value}" }';
      const result = formatPrompt(template, { value: "test" });
      // Only {value} should be replaced, not the JSON braces
      expect(result).toBe('JSON: { "key": "test" }');
    });

    it("handles underscore in variable names", () => {
      const template = "{my_var} and {another_variable}";
      const result = formatPrompt(template, {
        my_var: "first",
        another_variable: "second",
      });
      expect(result).toBe("first and second");
    });

    it("handles newlines in values", () => {
      const template = "Content: {content}";
      const result = formatPrompt(template, {
        content: "Line 1\nLine 2\nLine 3",
      });
      expect(result).toBe("Content: Line 1\nLine 2\nLine 3");
    });

    it("preserves leading/trailing whitespace in values", () => {
      const template = "[{value}]";
      const result = formatPrompt(template, { value: "  spaced  " });
      expect(result).toBe("[  spaced  ]");
    });
  });
});
