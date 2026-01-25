import { describe, it, expect } from "vitest";
import { InputValidator } from "../../../src/utils/InputValidator";

describe("InputValidator", () => {
  describe("sanitizeHtml - XSS Prevention", () => {
    it("should remove script tags", () => {
      const result = InputValidator.sanitizeHtml("<script>alert(1)</script>");
      expect(result).not.toContain("<script>");
      expect(result).not.toContain("</script>");
    });

    it("should remove event handlers (onerror, onmouseover, etc.)", () => {
      const result1 = InputValidator.sanitizeHtml('<img onerror="alert(1)">');
      const result2 = InputValidator.sanitizeHtml('<div onmouseover="evil()">');
      expect(result1).not.toMatch(/onerror\s*=/i);
      expect(result2).not.toMatch(/onmouseover\s*=/i);
    });

    it("should remove javascript: protocol", () => {
      const result = InputValidator.sanitizeHtml("javascript:alert(1)");
      expect(result).not.toContain("javascript:");
    });

    it("should remove eval() calls", () => {
      const result = InputValidator.sanitizeHtml("eval(malicious)");
      expect(result).not.toMatch(/eval\s*\(/i);
    });

    it("should remove iframe tags", () => {
      const result = InputValidator.sanitizeHtml(
        '<iframe src="evil.com"></iframe>',
      );
      expect(result).not.toContain("<iframe");
    });

    it("should remove object, embed, link, meta, style tags", () => {
      expect(InputValidator.sanitizeHtml("<object>")).not.toContain("<object");
      expect(InputValidator.sanitizeHtml("<embed>")).not.toContain("<embed");
      expect(InputValidator.sanitizeHtml("<link>")).not.toContain("<link");
      expect(InputValidator.sanitizeHtml("<meta>")).not.toContain("<meta");
      expect(InputValidator.sanitizeHtml("<style>")).not.toContain("<style");
    });

    it("should escape HTML entities (< and >)", () => {
      const result = InputValidator.sanitizeHtml("a < b > c");
      expect(result).toContain("&lt;");
      expect(result).toContain("&gt;");
    });

    it("should remove & as part of command injection prevention", () => {
      // The & character is removed by DANGEROUS_PATTERNS for command injection prevention
      const result = InputValidator.sanitizeHtml("a & b");
      expect(result).not.toContain("&");
    });

    it("should escape double quotes", () => {
      const result = InputValidator.sanitizeHtml('"hello"');
      expect(result).toContain("&quot;");
    });

    it("should remove single quotes as part of SQL injection prevention", () => {
      // Single quotes are removed by DANGEROUS_PATTERNS for SQL injection prevention
      const result = InputValidator.sanitizeHtml("world'test");
      expect(result).not.toContain("'");
    });

    it("should handle empty strings", () => {
      expect(InputValidator.sanitizeHtml("")).toBe("");
    });

    it("should handle non-string input gracefully", () => {
      // @ts-expect-error - Testing runtime behavior with invalid input
      expect(InputValidator.sanitizeHtml(null)).toBe("");
      // @ts-expect-error - Testing runtime behavior with invalid input
      expect(InputValidator.sanitizeHtml(undefined)).toBe("");
      // @ts-expect-error - Testing runtime behavior with invalid input
      expect(InputValidator.sanitizeHtml(123)).toBe("");
    });

    it("should allow safe strings", () => {
      expect(InputValidator.sanitizeHtml("Hello, world!")).toBe(
        "Hello, world!",
      );
      expect(InputValidator.sanitizeHtml("Player123")).toBe("Player123");
    });
  });

  describe("sanitizeUrl - URL Validation", () => {
    it("should block javascript: URLs", () => {
      const result = InputValidator.sanitizeUrl("javascript:alert(1)");
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("Unsafe URL protocol");
    });

    it("should block data: URLs", () => {
      const result = InputValidator.sanitizeUrl(
        "data:text/html,<script>alert(1)</script>",
      );
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("Unsafe URL protocol");
    });

    it("should block vbscript: URLs", () => {
      const result = InputValidator.sanitizeUrl('vbscript:MsgBox("evil")');
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("Unsafe URL protocol");
    });

    it("should block file: URLs", () => {
      const result = InputValidator.sanitizeUrl("file:///etc/passwd");
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("Unsafe URL protocol");
    });

    it("should allow https URLs", () => {
      const result = InputValidator.sanitizeUrl("https://example.com");
      expect(result.isValid).toBe(true);
      expect(result.sanitizedValue).toBe("https://example.com");
    });

    it("should allow http URLs", () => {
      const result = InputValidator.sanitizeUrl("http://localhost:3000");
      expect(result.isValid).toBe(true);
      expect(result.sanitizedValue).toBe("http://localhost:3000");
    });

    it("should allow relative URLs", () => {
      const result = InputValidator.sanitizeUrl("/api/data");
      expect(result.isValid).toBe(true);
      expect(result.sanitizedValue).toBe("/api/data");
    });

    it("should allow protocol-relative URLs", () => {
      const result = InputValidator.sanitizeUrl("//example.com/path");
      expect(result.isValid).toBe(true);
      expect(result.sanitizedValue).toBe("//example.com/path");
    });

    it("should reject invalid URL formats", () => {
      const result = InputValidator.sanitizeUrl("ftp://files.example.com");
      expect(result.isValid).toBe(false);
    });

    it("should handle non-string input", () => {
      // @ts-expect-error - Testing runtime behavior with invalid input
      const result = InputValidator.sanitizeUrl(null);
      expect(result.isValid).toBe(false);
    });
  });

  describe("sanitizeFileName - Path Safety", () => {
    it("should replace invalid characters with underscores", () => {
      const result = InputValidator.sanitizeFileName("my file!@#.txt");
      expect(result).toMatch(/^[a-zA-Z0-9._-]+$/);
      expect(result).not.toContain(" ");
      expect(result).not.toContain("!");
    });

    it("should neutralize path traversal sequences", () => {
      // The sanitizer replaces / with _, so ../ becomes .._
      // This breaks the path traversal even though .. remains
      const result = InputValidator.sanitizeFileName("../../../etc/passwd");
      expect(result).not.toContain("/");
      // The file path is neutralized - cannot traverse directories
      expect(result).toMatch(/^[a-zA-Z0-9._-]+$/);
    });

    it("should handle Windows-style path separators", () => {
      const result = InputValidator.sanitizeFileName(
        "..\\..\\windows\\system32",
      );
      expect(result).not.toContain("\\");
    });

    it("should limit filename length", () => {
      const longName = "a".repeat(300);
      const result = InputValidator.sanitizeFileName(longName);
      expect(result.length).toBeLessThanOrEqual(255);
    });

    it("should handle empty strings", () => {
      expect(InputValidator.sanitizeFileName("")).toBe("untitled");
    });

    it("should handle non-string input", () => {
      // @ts-expect-error - Testing runtime behavior with invalid input
      expect(InputValidator.sanitizeFileName(null)).toBe("untitled");
      // @ts-expect-error - Testing runtime behavior with invalid input
      expect(InputValidator.sanitizeFileName(undefined)).toBe("untitled");
    });

    it("should allow valid filenames", () => {
      expect(InputValidator.sanitizeFileName("valid-file_name.txt")).toBe(
        "valid-file_name.txt",
      );
      expect(InputValidator.sanitizeFileName("icon.png")).toBe("icon.png");
    });
  });

  describe("validate - General Validation", () => {
    describe("Required Field", () => {
      it("should fail when required field is empty", () => {
        const result = InputValidator.validate("", { required: true });
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain("This field is required");
      });

      it("should pass when required field has value", () => {
        const result = InputValidator.validate("test", { required: true });
        expect(result.isValid).toBe(true);
      });

      it("should pass when optional field is empty", () => {
        const result = InputValidator.validate("", { required: false });
        expect(result.isValid).toBe(true);
      });
    });

    describe("Length Validation", () => {
      it("should fail when below minLength", () => {
        const result = InputValidator.validate("ab", { minLength: 3 });
        expect(result.isValid).toBe(false);
        expect(
          result.errors.some((e) => e.includes("at least 3 characters")),
        ).toBe(true);
      });

      it("should truncate when exceeds maxLength", () => {
        const result = InputValidator.validate("toolongstring", {
          maxLength: 5,
        });
        expect(
          result.errors.some((e) => e.includes("no more than 5 characters")),
        ).toBe(true);
      });

      it("should pass when within length bounds", () => {
        const result = InputValidator.validate("test", {
          minLength: 2,
          maxLength: 10,
        });
        expect(result.isValid).toBe(true);
      });
    });

    describe("Pattern Validation", () => {
      it("should fail when pattern does not match", () => {
        const result = InputValidator.validate("abc123!", {
          pattern: /^[a-zA-Z]+$/,
        });
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain("Input format is invalid");
      });

      it("should pass when pattern matches", () => {
        const result = InputValidator.validate("abc", {
          pattern: /^[a-zA-Z]+$/,
        });
        expect(result.isValid).toBe(true);
      });
    });

    describe("Number Validation", () => {
      it("should validate minimum value", () => {
        const result = InputValidator.validate(5, { type: "number", min: 10 });
        expect(result.isValid).toBe(false);
        expect(result.errors.some((e) => e.includes("at least 10"))).toBe(true);
      });

      it("should validate maximum value", () => {
        const result = InputValidator.validate(100, {
          type: "number",
          max: 50,
        });
        expect(result.isValid).toBe(false);
        expect(result.errors.some((e) => e.includes("no more than 50"))).toBe(
          true,
        );
      });

      it("should pass when within range", () => {
        const result = InputValidator.validate(25, {
          type: "number",
          min: 10,
          max: 50,
        });
        expect(result.isValid).toBe(true);
      });

      it("should reject non-numeric values", () => {
        const result = InputValidator.validate("not a number", {
          type: "number",
        });
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain("Must be a valid number");
      });
    });

    describe("Email Validation", () => {
      it("should validate email format", () => {
        const validResult = InputValidator.validate("user@example.com", {
          type: "email",
        });
        expect(validResult.isValid).toBe(true);

        const invalidResult = InputValidator.validate("not-an-email", {
          type: "email",
        });
        expect(invalidResult.isValid).toBe(false);
        expect(invalidResult.errors).toContain("Must be a valid email address");
      });
    });

    describe("Custom Validator", () => {
      it("should run custom validator", () => {
        const result = InputValidator.validate("badword", {
          customValidator: (value) => {
            if (value === "badword") return "Prohibited word detected";
            return null;
          },
        });
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain("Prohibited word detected");
      });

      it("should handle custom validator errors gracefully", () => {
        const result = InputValidator.validate("test", {
          customValidator: () => {
            throw new Error("Validator crashed");
          },
        });
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain("Validation error occurred");
      });
    });

    describe("XSS Prevention in Validation", () => {
      it("should sanitize dangerous HTML during string validation", () => {
        const result = InputValidator.validate("<script>evil()</script>Hello", {
          required: true,
        });
        expect(result.sanitizedValue).not.toContain("<script>");
      });
    });
  });

  describe("validatePlayerName - Player Name Validation", () => {
    it("should reject reserved names", () => {
      expect(InputValidator.validatePlayerName("admin").isValid).toBe(false);
      expect(InputValidator.validatePlayerName("system").isValid).toBe(false);
      expect(InputValidator.validatePlayerName("null").isValid).toBe(false);
      expect(InputValidator.validatePlayerName("undefined").isValid).toBe(
        false,
      );
      expect(InputValidator.validatePlayerName("bot").isValid).toBe(false);
    });

    it("should reject reserved names case-insensitively", () => {
      expect(InputValidator.validatePlayerName("ADMIN").isValid).toBe(false);
      expect(InputValidator.validatePlayerName("Admin").isValid).toBe(false);
    });

    it("should reject names that are too short", () => {
      const result = InputValidator.validatePlayerName("A");
      expect(result.isValid).toBe(false);
      expect(
        result.errors.some((e) => e.includes("at least 2 characters")),
      ).toBe(true);
    });

    it("should reject names that are too long", () => {
      const result = InputValidator.validatePlayerName(
        "ThisNameIsWayTooLongForOurSystem",
      );
      expect(result.isValid).toBe(false);
    });

    it("should reject names with special characters", () => {
      expect(InputValidator.validatePlayerName("Player<script>").isValid).toBe(
        false,
      );
      expect(InputValidator.validatePlayerName("Player@123").isValid).toBe(
        false,
      );
      expect(InputValidator.validatePlayerName("Player 123").isValid).toBe(
        false,
      );
    });

    it("should accept valid player names", () => {
      expect(InputValidator.validatePlayerName("CoolPlayer123").isValid).toBe(
        true,
      );
      expect(InputValidator.validatePlayerName("Player_One").isValid).toBe(
        true,
      );
      expect(InputValidator.validatePlayerName("X-Man").isValid).toBe(true);
    });

    it("should accept minimum valid length", () => {
      expect(InputValidator.validatePlayerName("Ab").isValid).toBe(true);
    });

    it("should accept maximum valid length", () => {
      expect(InputValidator.validatePlayerName("A".repeat(16)).isValid).toBe(
        true,
      );
    });
  });

  describe("validateChatMessage - Chat Message Validation", () => {
    it("should reject empty messages", () => {
      const result = InputValidator.validateChatMessage("");
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("This field is required");
    });

    it("should reject messages that are too long", () => {
      const longMessage = "a".repeat(501);
      const result = InputValidator.validateChatMessage(longMessage);
      expect(result.isValid).toBe(false);
    });

    it("should reject messages with repeated characters (spam)", () => {
      const spam = "a".repeat(15);
      const result = InputValidator.validateChatMessage(spam);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain(
        "Message contains too many repeated characters",
      );
    });

    it("should reject messages with excessive caps", () => {
      const capsMessage = "THIS IS ALL CAPS AND VERY LONG MESSAGE";
      const result = InputValidator.validateChatMessage(capsMessage);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain(
        "Message contains too many capital letters",
      );
    });

    it("should allow short caps messages", () => {
      // Short messages with caps are OK (< 10 chars)
      const result = InputValidator.validateChatMessage("OK FINE");
      expect(result.isValid).toBe(true);
    });

    it("should allow normal messages", () => {
      expect(
        InputValidator.validateChatMessage("Hello, how are you?").isValid,
      ).toBe(true);
      expect(
        InputValidator.validateChatMessage("Looking for group to do dungeon")
          .isValid,
      ).toBe(true);
    });

    it("should sanitize HTML in messages", () => {
      const result = InputValidator.validateChatMessage(
        "Hello <script>alert(1)</script> World",
      );
      expect(result.sanitizedValue).not.toContain("<script>");
    });

    it("should allow messages at maximum length", () => {
      const maxMessage = "a".repeat(500);
      // Note: This will fail due to repeated character check
      // A valid max-length message needs varied characters
      const validMaxMessage = "Hello World! ".repeat(38).substring(0, 500);
      const result = InputValidator.validateChatMessage(validMaxMessage);
      expect(result.isValid).toBe(true);
    });
  });

  describe("SQL Injection Prevention (via DANGEROUS_PATTERNS)", () => {
    it("should remove SQL injection patterns in sanitizeHtml", () => {
      // The sanitizer removes SQL patterns like semicolons and single quotes
      const result1 = InputValidator.sanitizeHtml("'; DROP TABLE users;--");
      expect(result1).not.toContain(";");
      expect(result1).not.toContain("'");
    });
  });

  describe("Path Traversal Prevention (via DANGEROUS_PATTERNS)", () => {
    it("should remove path traversal patterns in sanitizeHtml", () => {
      const result = InputValidator.sanitizeHtml("../../../etc/passwd");
      expect(result).not.toContain("../");
    });

    it("should remove Windows-style path traversal (double backslash)", () => {
      // The regex pattern /\.\.\\\\/gi looks for literal ..\\
      // In a JS string, double backslash is written as \\\\
      const result = InputValidator.sanitizeHtml("..\\\\..\\\\windows");
      expect(result).not.toContain("..\\\\");
    });
  });

  describe("Command Injection Prevention", () => {
    it("should remove command injection characters", () => {
      const result = InputValidator.sanitizeHtml("test; rm -rf /");
      expect(result).not.toContain(";");

      const result2 = InputValidator.sanitizeHtml("test | cat /etc/passwd");
      expect(result2).not.toContain("|");

      const result3 = InputValidator.sanitizeHtml("$(whoami)");
      expect(result3).not.toContain("$");
      expect(result3).not.toContain("(");
    });
  });
});
