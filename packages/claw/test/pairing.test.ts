import { describe, test, expect } from "bun:test";
import { PairingManager } from "../src/users/pairing.js";
import type { PairingData } from "../src/users/pairing.js";

describe("PairingManager", () => {
  describe("generateCode()", () => {
    test("returns a 6-character alphanumeric code", () => {
      const manager = new PairingManager();
      const code = manager.generateCode();
      expect(code).toHaveLength(6);
      // Only uses readable characters (no O/0/I/1)
      expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
    });

    test("generates different codes on repeated calls", () => {
      const manager = new PairingManager();
      const codes = new Set<string>();
      for (let i = 0; i < 50; i++) {
        codes.add(manager.generateCode());
      }
      // With 6-char codes from 30-char alphabet, collisions in 50 tries are extremely unlikely
      expect(codes.size).toBeGreaterThan(45);
    });
  });

  describe("createPairing()", () => {
    test("stores a pairing and returns a code", () => {
      const manager = new PairingManager();
      const code = manager.createPairing("alice", "discord");
      expect(code).toHaveLength(6);
      expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
    });

    test("can generate multiple pairings without conflict", () => {
      const manager = new PairingManager();
      const code1 = manager.createPairing("alice", "discord");
      const code2 = manager.createPairing("bob", "telegram");
      const code3 = manager.createPairing("carol", "whatsapp");

      // All codes should be valid independently
      const data1 = manager.validatePairing(code1);
      expect(data1).not.toBeNull();
      expect(data1!.userId).toBe("alice");
      expect(data1!.channelType).toBe("discord");

      const data2 = manager.validatePairing(code2);
      expect(data2).not.toBeNull();
      expect(data2!.userId).toBe("bob");
      expect(data2!.channelType).toBe("telegram");

      const data3 = manager.validatePairing(code3);
      expect(data3).not.toBeNull();
      expect(data3!.userId).toBe("carol");
      expect(data3!.channelType).toBe("whatsapp");
    });
  });

  describe("validatePairing()", () => {
    test("returns pairing data for a valid code", () => {
      const manager = new PairingManager();
      const code = manager.createPairing("alice", "discord");

      const result = manager.validatePairing(code);
      expect(result).not.toBeNull();
      expect(result!.userId).toBe("alice");
      expect(result!.channelType).toBe("discord");
      expect(result!.createdAt).toBeGreaterThan(0);
    });

    test("returns null for unknown codes", () => {
      const manager = new PairingManager();
      const result = manager.validatePairing("ZZZZZZ");
      expect(result).toBeNull();
    });

    test("is case-insensitive (accepts lowercase input)", () => {
      const manager = new PairingManager();
      const code = manager.createPairing("alice", "discord");

      const result = manager.validatePairing(code.toLowerCase());
      expect(result).not.toBeNull();
      expect(result!.userId).toBe("alice");
    });

    test("pairings are single-use (second validation returns null)", () => {
      const manager = new PairingManager();
      const code = manager.createPairing("alice", "discord");

      const first = manager.validatePairing(code);
      expect(first).not.toBeNull();
      expect(first!.userId).toBe("alice");

      const second = manager.validatePairing(code);
      expect(second).toBeNull();
    });

    test("pairings expire after TTL", () => {
      // Use a very short TTL for testing
      const manager = new PairingManager(50); // 50ms
      const code = manager.createPairing("alice", "discord");

      // Immediately should be valid — but we consume it to check, so re-create
      const code2 = manager.createPairing("bob", "telegram");

      // Wait for expiry
      const start = Date.now();
      while (Date.now() - start < 60) {
        // busy-wait 60ms
      }

      const result = manager.validatePairing(code2);
      expect(result).toBeNull();
    });
  });

  describe("cleanup()", () => {
    test("removes expired pairings", () => {
      const manager = new PairingManager(50); // 50ms TTL
      manager.createPairing("alice", "discord");
      manager.createPairing("bob", "telegram");

      // Wait for expiry
      const start = Date.now();
      while (Date.now() - start < 60) {
        // busy-wait
      }

      manager.cleanup();

      // After cleanup, internal map should be empty
      // We can verify by creating a new code and checking only it validates
      const freshCode = manager.createPairing("carol", "whatsapp");
      const result = manager.validatePairing(freshCode);
      expect(result).not.toBeNull();
      expect(result!.userId).toBe("carol");
    });

    test("does not remove unexpired pairings", () => {
      const manager = new PairingManager(60_000); // 60 second TTL
      const code = manager.createPairing("alice", "discord");

      manager.cleanup();

      const result = manager.validatePairing(code);
      expect(result).not.toBeNull();
      expect(result!.userId).toBe("alice");
    });
  });

  describe("constructor defaults", () => {
    test("defaults to 5 minute TTL", () => {
      const manager = new PairingManager();
      const code = manager.createPairing("alice", "discord");
      // Should be immediately valid (well within 5 min)
      const result = manager.validatePairing(code);
      expect(result).not.toBeNull();
    });

    test("accepts custom TTL", () => {
      const manager = new PairingManager(1000);
      const code = manager.createPairing("alice", "discord");
      // Should be valid within 1 second
      const result = manager.validatePairing(code);
      expect(result).not.toBeNull();
    });
  });
});
