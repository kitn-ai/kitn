import { describe, test, expect, mock } from "bun:test";
import { loadConversationWithCompaction } from "../src/utils/conversation-helpers.js";
import type { Conversation, ConversationMessage } from "../src/storage/interfaces.js";

function makeConversation(messages: ConversationMessage[]): Conversation {
  return { id: "test-conv", messages, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
}

describe("loadConversationWithCompaction (token-based)", () => {
  test("returns undefined for new conversation (first message)", async () => {
    const ctx = {
      config: {},
      storage: {
        conversations: {
          get: mock(async () => null),
          append: mock(async () => {}),
        },
      },
    } as any;

    const result = await loadConversationWithCompaction(ctx, "new-conv", "hello");
    expect(result).toBeUndefined();
    expect(ctx.storage.conversations.append).toHaveBeenCalled();
  });

  test("returns messages without compaction when under token limit", async () => {
    const messages: ConversationMessage[] = [
      { role: "user", content: "hello", timestamp: new Date().toISOString() },
      { role: "assistant", content: "hi there", timestamp: new Date().toISOString() },
    ];
    const ctx = {
      config: { compaction: { enabled: true, tokenLimit: 80_000 } },
      storage: {
        conversations: {
          get: mock(async () => makeConversation(messages)),
          append: mock(async () => {}),
        },
      },
    } as any;

    const result = await loadConversationWithCompaction(ctx, "test-conv", "what's up");
    expect(result).toBeDefined();
    expect(result!.length).toBe(3); // 2 existing + 1 new
    expect(result![2].content).toBe("what's up");
  });

  test("respects custom tokenLimit (regression: was ignoring user-configured limit)", async () => {
    // Create messages that total ~5,000 tokens (20,000 chars / 4).
    // tokenLimit=1000 should trigger compaction; default 80k would not.
    // preserveTokens=100 ensures not everything fits in preserve budget,
    // so compactConversation proceeds to the LLM call and hits our mock.
    const messages: ConversationMessage[] = [
      { role: "user", content: "a".repeat(10_000), timestamp: new Date().toISOString() },
      { role: "assistant", content: "b".repeat(10_000), timestamp: new Date().toISOString() },
    ];

    const ctx = {
      config: {
        compaction: { enabled: true, tokenLimit: 1_000, preserveTokens: 100 },
        resilience: { maxRetries: 0 },
      },
      storage: {
        conversations: {
          get: mock(async () => makeConversation(messages)),
          append: mock(async () => {}),
          clear: mock(async () => {}),
        },
      },
      model: () => {
        // compactConversation calls generateText which needs a model
        // Throw a marker error so we know compaction was attempted
        throw new Error("compaction-attempted");
      },
    } as any;

    // With the bug: compaction is NOT triggered (threshold is undefined -> 80k default)
    // With the fix: compaction IS triggered (tokenLimit = 1000), which calls model() and throws
    try {
      await loadConversationWithCompaction(ctx, "test-conv", "hi");
      // If we get here, compaction was NOT triggered — that's the bug
      throw new Error("Expected compaction to be triggered with custom tokenLimit=1000 but it was not");
    } catch (e: any) {
      expect(e.message).toBe("compaction-attempted");
    }
  });

  test("does not compact when compaction is disabled", async () => {
    const messages: ConversationMessage[] = [
      { role: "user", content: "x".repeat(400_000), timestamp: new Date().toISOString() },
    ];
    const ctx = {
      config: { compaction: { enabled: false, tokenLimit: 100 } },
      storage: {
        conversations: {
          get: mock(async () => makeConversation(messages)),
          append: mock(async () => {}),
        },
      },
    } as any;

    const result = await loadConversationWithCompaction(ctx, "test-conv", "hi");
    expect(result).toBeDefined();
    // Should NOT have compacted despite being over limit, because enabled: false
    expect(result!.length).toBe(2);
  });
});
