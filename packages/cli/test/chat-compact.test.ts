import { describe, test, expect } from "bun:test";
import type { ChatMessage } from "../src/commands/chat-types.js";

describe("compaction logic", () => {
  test("shouldCompact returns true when over threshold", async () => {
    const { shouldCompact } = await import("../src/commands/chat.js");
    expect(shouldCompact(120_000, 100_000)).toBe(true);
    expect(shouldCompact(50_000, 100_000)).toBe(false);
    expect(shouldCompact(100_000, 100_000)).toBe(true);
  });

  test("applyCompaction replaces history with summary + recent", async () => {
    const { applyCompaction } = await import("../src/commands/chat.js");
    const messages: ChatMessage[] = [
      { role: "user", content: "first message" },
      { role: "assistant", content: "first response" },
      { role: "user", content: "second message" },
      { role: "assistant", content: "second response" },
      { role: "user", content: "third message" },
      { role: "assistant", content: "third response" },
    ];
    const summary = "Previous conversation: user discussed first and second topics.";
    const result = applyCompaction(messages, summary, 2);
    expect(result).toHaveLength(3);
    expect(result[0].role).toBe("user");
    expect(result[0].content).toContain("Previous conversation");
    expect(result[1].role).toBe("user");
    expect(result[1].content).toBe("third message");
    expect(result[2].role).toBe("assistant");
    expect(result[2].content).toBe("third response");
  });
});
