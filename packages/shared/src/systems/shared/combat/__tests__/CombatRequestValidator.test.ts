/**
 * CombatRequestValidator Unit Tests
 *
 * Tests for HMAC-based combat request signing and validation:
 * - Signature generation
 * - Signature validation
 * - Request freshness checks
 * - Timing attack prevention
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  CombatRequestValidator,
  type SignedCombatRequest,
  type UnsignedCombatRequest,
} from "../CombatRequestValidator";

describe("CombatRequestValidator", () => {
  const TEST_SECRET = "this-is-a-test-secret-key-for-hmac";
  let validator: CombatRequestValidator;

  beforeEach(() => {
    validator = new CombatRequestValidator(TEST_SECRET);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-15T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("constructor", () => {
    it("throws error for short secret key", () => {
      expect(() => new CombatRequestValidator("short")).toThrow(
        "secretKey must be at least 16 characters",
      );
    });

    it("accepts valid secret key", () => {
      expect(
        () => new CombatRequestValidator("at-least-16-chars"),
      ).not.toThrow();
    });

    it("accepts custom configuration", () => {
      const customValidator = new CombatRequestValidator(TEST_SECRET, {
        maxRequestAgeMs: 10000,
        maxFutureMs: 2000,
      });
      expect(customValidator).toBeDefined();
    });
  });

  describe("signRequest", () => {
    it("returns a hex string signature", () => {
      const request: UnsignedCombatRequest = {
        playerId: "player1",
        targetId: "mob1",
        action: "attack",
        tick: 100,
        timestamp: Date.now(),
        sessionId: "session123",
      };

      const signature = validator.signRequest(request);

      expect(signature).toMatch(/^[a-f0-9]{64}$/); // SHA-256 produces 64 hex chars
    });

    it("produces consistent signatures for same request", () => {
      const request: UnsignedCombatRequest = {
        playerId: "player1",
        targetId: "mob1",
        action: "attack",
        tick: 100,
        timestamp: 1705320000000,
        sessionId: "session123",
      };

      const sig1 = validator.signRequest(request);
      const sig2 = validator.signRequest(request);

      expect(sig1).toBe(sig2);
    });

    it("produces different signatures for different requests", () => {
      const request1: UnsignedCombatRequest = {
        playerId: "player1",
        targetId: "mob1",
        action: "attack",
        tick: 100,
        timestamp: Date.now(),
        sessionId: "session123",
      };

      const request2: UnsignedCombatRequest = {
        ...request1,
        targetId: "mob2",
      };

      const sig1 = validator.signRequest(request1);
      const sig2 = validator.signRequest(request2);

      expect(sig1).not.toBe(sig2);
    });

    it("produces different signatures with different secret keys", () => {
      const validator2 = new CombatRequestValidator(
        "different-secret-key-here",
      );

      const request: UnsignedCombatRequest = {
        playerId: "player1",
        targetId: "mob1",
        action: "attack",
        tick: 100,
        timestamp: Date.now(),
        sessionId: "session123",
      };

      const sig1 = validator.signRequest(request);
      const sig2 = validator2.signRequest(request);

      expect(sig1).not.toBe(sig2);
    });
  });

  describe("createSignedRequest", () => {
    it("returns complete signed request", () => {
      const request: UnsignedCombatRequest = {
        playerId: "player1",
        targetId: "mob1",
        action: "attack",
        tick: 100,
        timestamp: Date.now(),
        sessionId: "session123",
      };

      const signedRequest = validator.createSignedRequest(request);

      expect(signedRequest.playerId).toBe(request.playerId);
      expect(signedRequest.targetId).toBe(request.targetId);
      expect(signedRequest.action).toBe(request.action);
      expect(signedRequest.tick).toBe(request.tick);
      expect(signedRequest.timestamp).toBe(request.timestamp);
      expect(signedRequest.sessionId).toBe(request.sessionId);
      expect(signedRequest.signature).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe("validateRequest", () => {
    it("accepts valid request", () => {
      const request: UnsignedCombatRequest = {
        playerId: "player1",
        targetId: "mob1",
        action: "attack",
        tick: 100,
        timestamp: Date.now(),
        sessionId: "session123",
      };

      const signedRequest = validator.createSignedRequest(request);
      const result = validator.validateRequest(signedRequest);

      expect(result.valid).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it("rejects expired request (>5 seconds old)", () => {
      const oldTimestamp = Date.now() - 6000; // 6 seconds ago

      const request: SignedCombatRequest = {
        playerId: "player1",
        targetId: "mob1",
        action: "attack",
        tick: 100,
        timestamp: oldTimestamp,
        sessionId: "session123",
        signature: validator.signRequest({
          playerId: "player1",
          targetId: "mob1",
          action: "attack",
          tick: 100,
          timestamp: oldTimestamp,
          sessionId: "session123",
        }),
      };

      const result = validator.validateRequest(request);

      expect(result.valid).toBe(false);
      expect(result.reason).toBe("request_expired");
    });

    it("rejects future request (>1 second in future)", () => {
      const futureTimestamp = Date.now() + 2000; // 2 seconds in future

      const request: SignedCombatRequest = {
        playerId: "player1",
        targetId: "mob1",
        action: "attack",
        tick: 100,
        timestamp: futureTimestamp,
        sessionId: "session123",
        signature: validator.signRequest({
          playerId: "player1",
          targetId: "mob1",
          action: "attack",
          tick: 100,
          timestamp: futureTimestamp,
          sessionId: "session123",
        }),
      };

      const result = validator.validateRequest(request);

      expect(result.valid).toBe(false);
      expect(result.reason).toBe("request_future");
    });

    it("rejects request with invalid signature", () => {
      const request: SignedCombatRequest = {
        playerId: "player1",
        targetId: "mob1",
        action: "attack",
        tick: 100,
        timestamp: Date.now(),
        sessionId: "session123",
        signature: "invalid-signature-that-is-definitely-not-correct-here",
      };

      const result = validator.validateRequest(request);

      expect(result.valid).toBe(false);
      expect(result.reason).toBe("invalid_signature");
    });

    it("rejects request with tampered data", () => {
      const originalRequest: UnsignedCombatRequest = {
        playerId: "player1",
        targetId: "mob1",
        action: "attack",
        tick: 100,
        timestamp: Date.now(),
        sessionId: "session123",
      };

      const signedRequest = validator.createSignedRequest(originalRequest);

      // Tamper with the target
      const tamperedRequest: SignedCombatRequest = {
        ...signedRequest,
        targetId: "mob2", // Changed!
      };

      const result = validator.validateRequest(tamperedRequest);

      expect(result.valid).toBe(false);
      expect(result.reason).toBe("invalid_signature");
    });

    it("rejects request with tampered tick", () => {
      const originalRequest: UnsignedCombatRequest = {
        playerId: "player1",
        targetId: "mob1",
        action: "attack",
        tick: 100,
        timestamp: Date.now(),
        sessionId: "session123",
      };

      const signedRequest = validator.createSignedRequest(originalRequest);

      // Tamper with the tick
      const tamperedRequest: SignedCombatRequest = {
        ...signedRequest,
        tick: 999, // Changed!
      };

      const result = validator.validateRequest(tamperedRequest);

      expect(result.valid).toBe(false);
      expect(result.reason).toBe("invalid_signature");
    });

    it("accepts request at 4.9 seconds old", () => {
      const almostExpiredTimestamp = Date.now() - 4900;

      const request: UnsignedCombatRequest = {
        playerId: "player1",
        targetId: "mob1",
        action: "attack",
        tick: 100,
        timestamp: almostExpiredTimestamp,
        sessionId: "session123",
      };

      const signedRequest = validator.createSignedRequest(request);
      const result = validator.validateRequest(signedRequest);

      expect(result.valid).toBe(true);
    });

    it("accepts request 500ms in future (clock skew tolerance)", () => {
      const slightFutureTimestamp = Date.now() + 500;

      const request: UnsignedCombatRequest = {
        playerId: "player1",
        targetId: "mob1",
        action: "attack",
        tick: 100,
        timestamp: slightFutureTimestamp,
        sessionId: "session123",
      };

      const signedRequest = validator.createSignedRequest(request);
      const result = validator.validateRequest(signedRequest);

      expect(result.valid).toBe(true);
    });
  });

  describe("action types", () => {
    it("accepts attack action", () => {
      const request = validator.createSignedRequest({
        playerId: "player1",
        targetId: "mob1",
        action: "attack",
        tick: 100,
        timestamp: Date.now(),
        sessionId: "session123",
      });

      expect(validator.validateRequest(request).valid).toBe(true);
    });

    it("accepts disengage action", () => {
      const request = validator.createSignedRequest({
        playerId: "player1",
        targetId: "mob1",
        action: "disengage",
        tick: 100,
        timestamp: Date.now(),
        sessionId: "session123",
      });

      expect(validator.validateRequest(request).valid).toBe(true);
    });

    it("accepts retaliate action", () => {
      const request = validator.createSignedRequest({
        playerId: "player1",
        targetId: "mob1",
        action: "retaliate",
        tick: 100,
        timestamp: Date.now(),
        sessionId: "session123",
      });

      expect(validator.validateRequest(request).valid).toBe(true);
    });
  });

  describe("custom configuration", () => {
    it("uses custom maxRequestAgeMs", () => {
      const customValidator = new CombatRequestValidator(TEST_SECRET, {
        maxRequestAgeMs: 10000, // 10 seconds
      });

      // 7 seconds old (would be expired with default 5s, but valid with 10s)
      const request = customValidator.createSignedRequest({
        playerId: "player1",
        targetId: "mob1",
        action: "attack",
        tick: 100,
        timestamp: Date.now() - 7000,
        sessionId: "session123",
      });

      const result = customValidator.validateRequest(request);
      expect(result.valid).toBe(true);
    });

    it("uses custom maxFutureMs", () => {
      const customValidator = new CombatRequestValidator(TEST_SECRET, {
        maxFutureMs: 3000, // 3 seconds
      });

      // 2 seconds in future (would be rejected with default 1s, but valid with 3s)
      const request = customValidator.createSignedRequest({
        playerId: "player1",
        targetId: "mob1",
        action: "attack",
        tick: 100,
        timestamp: Date.now() + 2000,
        sessionId: "session123",
      });

      const result = customValidator.validateRequest(request);
      expect(result.valid).toBe(true);
    });
  });

  describe("edge cases", () => {
    it("handles empty string values in request", () => {
      const request = validator.createSignedRequest({
        playerId: "",
        targetId: "",
        action: "attack",
        tick: 0,
        timestamp: Date.now(),
        sessionId: "",
      });

      const result = validator.validateRequest(request);
      expect(result.valid).toBe(true);
    });

    it("handles special characters in IDs", () => {
      const request = validator.createSignedRequest({
        playerId: "player:1:test",
        targetId: "mob-with-dashes_and_underscores",
        action: "attack",
        tick: 100,
        timestamp: Date.now(),
        sessionId: "session/with/slashes",
      });

      const result = validator.validateRequest(request);
      expect(result.valid).toBe(true);
    });

    it("handles large tick numbers", () => {
      const request = validator.createSignedRequest({
        playerId: "player1",
        targetId: "mob1",
        action: "attack",
        tick: Number.MAX_SAFE_INTEGER,
        timestamp: Date.now(),
        sessionId: "session123",
      });

      const result = validator.validateRequest(request);
      expect(result.valid).toBe(true);
    });
  });
});
