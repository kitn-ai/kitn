import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";
import {
  estimateChatMessageTokens,
  checkCompaction,
  callCompactService,
} from "../src/commands/chat-engine.js";
import type { ChatMessage } from "../src/commands/chat-types.js";

describe("estimateChatMessageTokens", () => {
  test("estimates tokens for user message", () => {
    const messages: ChatMessage[] = [{ role: "user", content: "Hello world" }];
    const tokens = estimateChatMessageTokens(messages);
    // "Hello world" = 11 chars / 4 = 2.75 → ceil = 3
    expect(tokens).toBe(3);
  });

  test("estimates tokens for assistant message", () => {
    const messages: ChatMessage[] = [{ role: "assistant", content: "This is a longer response from the assistant." }];
    const tokens = estimateChatMessageTokens(messages);
    expect(tokens).toBeGreaterThan(0);
    // 46 chars / 4 = 11.5 → ceil = 12
    expect(tokens).toBe(12);
  });

  test("estimates tokens for tool calls", () => {
    const messages: ChatMessage[] = [{
      role: "assistant",
      content: "Let me help",
      toolCalls: [{ id: "tc1", name: "writeFile", input: { path: "test.ts", content: "console.log('hi')" } }],
    }];
    const tokens = estimateChatMessageTokens(messages);
    // content + toolName + JSON.stringify(input)
    expect(tokens).toBeGreaterThan(3);
  });

  test("estimates tokens for tool results", () => {
    const messages: ChatMessage[] = [{
      role: "tool",
      toolResults: [{ toolCallId: "tc1", toolName: "writeFile", result: "Wrote test.ts" }],
    }];
    const tokens = estimateChatMessageTokens(messages);
    expect(tokens).toBeGreaterThan(0);
  });

  test("returns 0 for empty messages", () => {
    expect(estimateChatMessageTokens([])).toBe(0);
  });

  test("accumulates across multiple messages", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "World" },
    ];
    const tokens = estimateChatMessageTokens(messages);
    // "Hello" (5) + "World" (5) = 10 / 4 = 2.5 → ceil = 3
    expect(tokens).toBe(3);
  });
});

describe("checkCompaction", () => {
  test("returns null when under threshold", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "Short message" },
      { role: "assistant", content: "Short reply" },
    ];
    expect(checkCompaction(messages)).toBeNull();
  });

  test("returns null for single message", () => {
    // Even if the single message is huge
    const messages: ChatMessage[] = [
      { role: "user", content: "x".repeat(400_000) },
    ];
    expect(checkCompaction(messages)).toBeNull();
  });

  test("returns correct split when over threshold", () => {
    // Create messages that total > 80k tokens (> 320k chars)
    const messages: ChatMessage[] = [];
    for (let i = 0; i < 50; i++) {
      messages.push({ role: "user", content: "x".repeat(8000) }); // 2000 tokens each
      messages.push({ role: "assistant", content: "y".repeat(8000) });
    }
    // 100 messages * 2000 tokens = 200k tokens > 80k threshold

    const result = checkCompaction(messages);
    expect(result).not.toBeNull();
    expect(result!.toSummarize.length).toBeGreaterThan(0);
    expect(result!.toPreserve.length).toBeGreaterThan(0);
    expect(result!.toSummarize.length + result!.toPreserve.length).toBe(messages.length);
  });

  test("preserves at least one message", () => {
    // Two large messages
    const messages: ChatMessage[] = [
      { role: "user", content: "x".repeat(400_000) },
      { role: "assistant", content: "y".repeat(400_000) },
    ];

    const result = checkCompaction(messages);
    expect(result).not.toBeNull();
    expect(result!.toPreserve.length).toBeGreaterThanOrEqual(1);
    expect(result!.toSummarize.length).toBeGreaterThanOrEqual(1);
  });

  test("preserves recent messages within token budget", () => {
    // Create a mix: many small messages at start, then some at the end
    const messages: ChatMessage[] = [];
    // Add 40 large messages first (160k tokens, well over threshold)
    for (let i = 0; i < 40; i++) {
      messages.push({ role: "user", content: "x".repeat(16000) }); // 4000 tokens each
    }
    // Add 4 small messages at the end (easily within 8k preserve budget)
    for (let i = 0; i < 4; i++) {
      messages.push({ role: "user", content: `Recent message ${i}` });
    }

    const result = checkCompaction(messages);
    expect(result).not.toBeNull();
    // The 4 small recent messages should be preserved
    expect(result!.toPreserve.length).toBeGreaterThanOrEqual(4);
  });

  test("triggers compaction at exactly the threshold", () => {
    // 80k tokens = 320k chars. Two messages at exactly 160k chars each = exactly 80k tokens
    const messages: ChatMessage[] = [
      { role: "user", content: "x".repeat(160_000) },
      { role: "assistant", content: "y".repeat(160_000) },
    ];
    // estimateChatMessageTokens: 320k / 4 = 80k exactly — threshold is >= 80k
    const result = checkCompaction(messages);
    // At exactly 80k it SHOULD trigger
    expect(result).not.toBeNull();
    expect(result!.toSummarize.length).toBe(1);
    expect(result!.toPreserve.length).toBe(1);
  });

  test("does not trigger just under threshold", () => {
    // Just under 80k: 319,996 chars = 79,999 tokens
    const messages: ChatMessage[] = [
      { role: "user", content: "x".repeat(159_998) },
      { role: "assistant", content: "y".repeat(159_998) },
    ];
    const result = checkCompaction(messages);
    expect(result).toBeNull();
  });

  test("handles messages with no content field", () => {
    const messages: ChatMessage[] = [
      { role: "tool", toolResults: [{ toolCallId: "tc1", toolName: "writeFile", result: "ok" }] },
    ];
    const tokens = estimateChatMessageTokens(messages);
    expect(tokens).toBeGreaterThan(0);
  });
});

describe("callCompactService", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("sends correct request shape", async () => {
    let capturedUrl: string | undefined;
    let capturedBody: any;
    let capturedHeaders: any;

    globalThis.fetch = (async (url: any, init: any) => {
      capturedUrl = url;
      capturedBody = JSON.parse(init.body);
      capturedHeaders = init.headers;
      return {
        ok: true,
        json: async () => ({ summary: "Test summary", usage: { inputTokens: 100, outputTokens: 50 } }),
      };
    }) as any;

    const messages: ChatMessage[] = [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there" },
    ];

    const result = await callCompactService("http://localhost:4002", messages);

    expect(capturedUrl).toBe("http://localhost:4002/api/chat/compact");
    expect(capturedBody.messages).toEqual(messages);
    expect(capturedHeaders["Content-Type"]).toBe("application/json");
    expect(result.summary).toBe("Test summary");
    expect(result.usage.inputTokens).toBe(100);
    expect(result.usage.outputTokens).toBe(50);
  });

  test("forwards model parameter when provided", async () => {
    let capturedBody: any;

    globalThis.fetch = (async (_url: any, init: any) => {
      capturedBody = JSON.parse(init.body);
      return {
        ok: true,
        json: async () => ({ summary: "Summary", usage: { inputTokens: 0, outputTokens: 0 } }),
      };
    }) as any;

    await callCompactService("http://localhost:4002", [], "deepseek/deepseek-chat-v3-0324");
    expect(capturedBody.model).toBe("deepseek/deepseek-chat-v3-0324");
  });

  test("omits model when not provided", async () => {
    let capturedBody: any;

    globalThis.fetch = (async (_url: any, init: any) => {
      capturedBody = JSON.parse(init.body);
      return {
        ok: true,
        json: async () => ({ summary: "Summary", usage: { inputTokens: 0, outputTokens: 0 } }),
      };
    }) as any;

    await callCompactService("http://localhost:4002", []);
    expect(capturedBody.model).toBeUndefined();
  });

  test("includes Authorization header when KITN_API_KEY is set", async () => {
    let capturedHeaders: any;
    const origKey = process.env.KITN_API_KEY;

    process.env.KITN_API_KEY = "test-api-key";
    globalThis.fetch = (async (_url: any, init: any) => {
      capturedHeaders = init.headers;
      return {
        ok: true,
        json: async () => ({ summary: "Summary", usage: { inputTokens: 0, outputTokens: 0 } }),
      };
    }) as any;

    await callCompactService("http://localhost:4002", []);
    expect(capturedHeaders["Authorization"]).toBe("Bearer test-api-key");

    // Cleanup
    if (origKey !== undefined) {
      process.env.KITN_API_KEY = origKey;
    } else {
      delete process.env.KITN_API_KEY;
    }
  });

  test("throws on non-OK response", async () => {
    globalThis.fetch = (async () => ({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    })) as any;

    await expect(callCompactService("http://localhost:4002", [])).rejects.toThrow(
      "Compact service returned 500: Internal Server Error",
    );
  });

  test("throws on network error", async () => {
    globalThis.fetch = (async () => {
      throw new Error("fetch failed");
    }) as any;

    await expect(callCompactService("http://localhost:4002", [])).rejects.toThrow("fetch failed");
  });
});
