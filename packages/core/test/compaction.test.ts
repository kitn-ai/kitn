import { describe, test, expect, mock } from "bun:test";
import { needsCompaction, compactConversation, COMPACTION_METADATA_KEY } from "../src/utils/compaction.js";
import { estimateTokens } from "../src/utils/token-estimate.js";
import type { Conversation, ConversationMessage } from "../src/storage/interfaces.js";

function makeMessage(role: "user" | "assistant", charCount: number, meta?: Record<string, unknown>): ConversationMessage {
  return {
    role,
    content: "x".repeat(charCount),
    timestamp: new Date().toISOString(),
    metadata: meta,
  };
}

function makeConversation(messages: ConversationMessage[]): Conversation {
  return { id: "test-conv", messages, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
}

describe("needsCompaction (token-based)", () => {
  test("returns true when conversation tokens exceed limit", () => {
    const messages = Array.from({ length: 10 }, (_, i) => makeMessage(i % 2 === 0 ? "user" : "assistant", 400));
    const conv = makeConversation(messages);
    expect(needsCompaction(conv, 500)).toBe(true);
  });

  test("returns false when conversation tokens are under limit", () => {
    const messages = [makeMessage("user", 40), makeMessage("assistant", 40)];
    const conv = makeConversation(messages);
    expect(needsCompaction(conv, 500)).toBe(false);
  });

  test("uses default token limit when none provided", () => {
    const messages = [makeMessage("user", 100)];
    const conv = makeConversation(messages);
    expect(needsCompaction(conv)).toBe(false);
  });
});

describe("compactConversation (token-based)", () => {
  test("returns null for missing conversation", async () => {
    const ctx = {
      config: { compaction: {} },
      storage: { conversations: { get: mock(async () => null) } },
      model: () => ({}) as any,
    } as any;

    const result = await compactConversation(ctx, "nonexistent");
    expect(result).toBeNull();
  });

  test("skips compaction when all messages fit in preserve budget", async () => {
    const messages = [makeMessage("user", 40), makeMessage("assistant", 40)];
    const ctx = {
      config: { compaction: { tokenLimit: 500, preserveTokens: 100 } },
      storage: { conversations: { get: mock(async () => makeConversation(messages)) } },
      model: () => ({}) as any,
    } as any;

    const result = await compactConversation(ctx, "test-conv");
    expect(result).not.toBeNull();
    expect(result!.summarizedCount).toBe(0);
    expect(result!.preservedCount).toBe(2);
  });
});
