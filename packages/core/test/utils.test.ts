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
  function makeConversation(messageCount: number): Conversation {
    return {
      id: "test",
      messages: Array.from({ length: messageCount }, (_, i) => ({
        role: "user" as const,
        content: `msg ${i}`,
        timestamp: new Date().toISOString(),
      })),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  test("returns false when under default threshold", () => {
    expect(needsCompaction(makeConversation(10))).toBe(false);
    expect(needsCompaction(makeConversation(20))).toBe(false);
  });

  test("returns true when over default threshold", () => {
    expect(needsCompaction(makeConversation(21))).toBe(true);
  });

  test("respects custom threshold", () => {
    expect(needsCompaction(makeConversation(5), 4)).toBe(true);
    expect(needsCompaction(makeConversation(4), 4)).toBe(false);
  });
});
