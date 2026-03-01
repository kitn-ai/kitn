import { describe, test, expect } from "bun:test";
import { estimateTokens, estimateMessageTokens } from "../src/utils/token-estimate.js";

describe("estimateTokens", () => {
  test("estimates ~1 token per 4 characters", () => {
    expect(estimateTokens("hello world")).toBe(3); // 11 chars → ceil(11/4) = 3
  });

  test("returns 0 for empty string", () => {
    expect(estimateTokens("")).toBe(0);
  });

  test("handles unicode characters", () => {
    const emoji = "Hello 👋🌍"; // emoji are multi-byte but .length counts UTF-16 code units
    expect(estimateTokens(emoji)).toBeGreaterThan(0);
  });

  test("handles long text", () => {
    const text = "a".repeat(400_000); // 400k chars → 100k tokens
    expect(estimateTokens(text)).toBe(100_000);
  });
});

describe("estimateMessageTokens", () => {
  test("sums token estimates across messages", () => {
    const messages = [
      { role: "user" as const, content: "hello", timestamp: "" },
      { role: "assistant" as const, content: "world", timestamp: "" },
    ];
    // "hello" = 2, "world" = 2 → 4
    expect(estimateMessageTokens(messages)).toBe(4);
  });

  test("returns 0 for empty array", () => {
    expect(estimateMessageTokens([])).toBe(0);
  });
});
