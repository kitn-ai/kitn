import { describe, test, expect } from "bun:test";
import type { ChatMessage, ChatServiceResponse } from "../src/commands/chat-types.js";

describe("conversation loop helpers", () => {
  test("buildServicePayload constructs correct shape", async () => {
    const { buildServicePayload } = await import("../src/commands/chat.js");
    const messages: ChatMessage[] = [{ role: "user", content: "hello" }];
    const metadata = { registryIndex: [], installed: [] as string[] };
    const payload = buildServicePayload(messages, metadata);
    expect(payload.messages).toHaveLength(1);
    expect(payload.metadata).toEqual(metadata);
  });

  test("hasToolCalls detects tool calls", async () => {
    const { hasToolCalls } = await import("../src/commands/chat.js");
    const withCalls: ChatServiceResponse = {
      message: { role: "assistant", content: "", toolCalls: [{ id: "1", name: "askUser", input: {} }] },
      usage: { promptTokens: 100, completionTokens: 50 },
    };
    const withoutCalls: ChatServiceResponse = {
      message: { role: "assistant", content: "Done!" },
      usage: { promptTokens: 100, completionTokens: 50 },
    };
    expect(hasToolCalls(withCalls)).toBe(true);
    expect(hasToolCalls(withoutCalls)).toBe(false);
  });

  test("formatTokens formats counts", async () => {
    const { formatTokens } = await import("../src/commands/chat.js");
    expect(formatTokens(1500)).toBe("1.5k");
    expect(formatTokens(500)).toBe("500");
    expect(formatTokens(10000)).toBe("10.0k");
  });

  test("formatElapsed formats milliseconds", async () => {
    const { formatElapsed } = await import("../src/commands/chat.js");
    expect(formatElapsed(3500)).toBe("3s");
    expect(formatElapsed(65000)).toBe("1m 5s");
    expect(formatElapsed(500)).toBe("0s");
  });

  test("formatSessionStats combines elapsed and tokens", async () => {
    const { formatSessionStats } = await import("../src/commands/chat.js");
    const result = formatSessionStats(32000, 6800);
    expect(result).toContain("32s");
    expect(result).toContain("6.8k");
  });
});
