/**
 * Utility function tests (buildToolDescription, needsCompaction).
 * Run with: bun test packages/core/test/utils.test.ts
 */
import { describe, test, expect } from "bun:test";
import { buildToolDescription } from "../src/utils/tool-examples.js";
import { needsCompaction } from "../src/utils/compaction.js";
import type { Conversation } from "../src/storage/interfaces.js";

describe("buildToolDescription", () => {
  test("returns base description when no examples", () => {
    expect(buildToolDescription("Get weather")).toBe("Get weather");
  });

  test("returns base description when examples array is empty", () => {
    expect(buildToolDescription("Get weather", [])).toBe("Get weather");
  });

  test("appends XML-formatted examples", () => {
    const result = buildToolDescription("Get weather", [
      { name: "Minimal", input: { city: "London" } },
      { name: "Full", input: { city: "London", units: "metric" }, description: "Explicit metric units" },
    ]);

    expect(result).toContain("Get weather");
    expect(result).toContain("<examples>");
    expect(result).toContain("</examples>");
    expect(result).toContain('<example name="Minimal">');
    expect(result).toContain('{"city":"London"}');
    expect(result).toContain("Explicit metric units");
  });
});

describe("needsCompaction", () => {
  /**
   * Helper that creates a conversation with a known total character count.
   * Token estimate = Math.ceil(totalChars / 4), default limit = 80,000 tokens.
   */
  function makeConversation(totalChars: number, messageCount = 1): Conversation {
    const charsPerMessage = Math.floor(totalChars / messageCount);
    const remainder = totalChars - charsPerMessage * messageCount;
    return {
      id: "test",
      messages: Array.from({ length: messageCount }, (_, i) => ({
        role: "user" as const,
        content: "x".repeat(charsPerMessage + (i === 0 ? remainder : 0)),
        timestamp: new Date().toISOString(),
      })),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  test("returns false when token estimate is under default 80,000 limit", () => {
    // 100 chars -> 25 tokens, well under 80,000
    expect(needsCompaction(makeConversation(100))).toBe(false);
    // 320,000 chars -> 80,000 tokens exactly, not over
    expect(needsCompaction(makeConversation(320_000))).toBe(false);
  });

  test("returns true when token estimate exceeds default 80,000 limit", () => {
    // 400,000 chars -> 100,000 tokens, exceeds 80,000
    expect(needsCompaction(makeConversation(400_000, 10))).toBe(true);
    // 320,001 chars -> 80,001 tokens (Math.ceil), exceeds 80,000
    expect(needsCompaction(makeConversation(320_001))).toBe(true);
  });

  test("respects custom tokenLimit", () => {
    // 2000 chars -> 500 tokens, exceeds custom limit of 400
    expect(needsCompaction(makeConversation(2000, 4), 400)).toBe(true);
    // 1600 chars -> 400 tokens exactly, not over
    expect(needsCompaction(makeConversation(1600, 4), 400)).toBe(false);
    // 100 chars -> 25 tokens, under custom limit of 400
    expect(needsCompaction(makeConversation(100), 400)).toBe(false);
  });
});
