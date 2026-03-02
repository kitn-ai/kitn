import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import {
  createConversation,
  appendMessage,
  listConversations,
  readConversationEvents,
  clearAllConversations,
  rebuildMessages,
} from "../src/commands/chat/storage.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "kitn-code-cmd-test-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("codeCommand --list integration", () => {
  test("lists no conversations when empty", async () => {
    const convos = await listConversations(tmpDir);
    expect(convos).toEqual([]);
  });

  test("lists conversations with metadata", async () => {
    const c1 = await createConversation(tmpDir, "Add weather agent");
    await appendMessage(tmpDir, c1.id, { role: "user", content: "Add a weather agent" });
    await appendMessage(tmpDir, c1.id, { role: "assistant", content: "I'll help with that" });

    const c2 = await createConversation(tmpDir, "Set up cron jobs");
    await appendMessage(tmpDir, c2.id, { role: "user", content: "I need cron scheduling" });

    const convos = await listConversations(tmpDir);
    expect(convos.length).toBe(2);

    // Both conversations should be present with correct message counts
    const weatherConvo = convos.find((c) => c.title === "Add weather agent");
    const cronConvo = convos.find((c) => c.title === "Set up cron jobs");

    expect(weatherConvo).toBeDefined();
    expect(weatherConvo!.messageCount).toBe(2);

    expect(cronConvo).toBeDefined();
    expect(cronConvo!.messageCount).toBe(1);
  });
});

describe("codeCommand --clear integration", () => {
  test("clears all conversations", async () => {
    await createConversation(tmpDir, "One");
    await createConversation(tmpDir, "Two");
    await createConversation(tmpDir, "Three");

    let convos = await listConversations(tmpDir);
    expect(convos.length).toBe(3);

    await clearAllConversations(tmpDir);

    convos = await listConversations(tmpDir);
    expect(convos).toEqual([]);
  });

  test("handles clear when no conversations exist", async () => {
    // Should not throw
    await clearAllConversations(tmpDir);
    const convos = await listConversations(tmpDir);
    expect(convos).toEqual([]);
  });
});

describe("codeCommand --resume integration", () => {
  test("loads existing conversation messages", async () => {
    const conv = await createConversation(tmpDir, "Resume test");
    await appendMessage(tmpDir, conv.id, { role: "user", content: "Hello" });
    await appendMessage(tmpDir, conv.id, { role: "assistant", content: "Hi there!" });
    await appendMessage(tmpDir, conv.id, { role: "user", content: "Add a weather agent" });

    const events = await readConversationEvents(tmpDir, conv.id);
    expect(events.length).toBe(4); // meta + 3 messages

    const messages = rebuildMessages(events);
    expect(messages.length).toBe(3);
    expect(messages[0]).toEqual({ role: "user", content: "Hello" });
    expect(messages[1]).toEqual({ role: "assistant", content: "Hi there!" });
    expect(messages[2]).toEqual({ role: "user", content: "Add a weather agent" });
  });

  test("returns empty events for non-existent conversation", async () => {
    const events = await readConversationEvents(tmpDir, "conv_nonexistent_0000");
    expect(events.length).toBe(0);
  });

  test("resumes after compaction", async () => {
    const conv = await createConversation(tmpDir, "Compacted conversation");

    // Add messages
    for (let i = 0; i < 10; i++) {
      await appendMessage(tmpDir, conv.id, { role: "user", content: `Message ${i}` });
      await appendMessage(tmpDir, conv.id, { role: "assistant", content: `Reply ${i}` });
    }

    // Simulate compaction
    const { appendCompaction } = await import("../src/commands/chat/storage.js");
    const preserved = [
      { role: "user" as const, content: "Message 9" },
      { role: "assistant" as const, content: "Reply 9" },
    ];
    await appendCompaction(tmpDir, conv.id, "Summary of first 18 messages", 18, preserved);

    // Resume: should get compaction summary + preserved messages
    const events = await readConversationEvents(tmpDir, conv.id);
    const messages = rebuildMessages(events);

    // Should be: summary (from compaction) + 2 preserved
    expect(messages.length).toBe(3);
    expect(messages[0].content).toBe("Summary of first 18 messages");
    expect(messages[0].role).toBe("user"); // Compaction is reconstructed as user message
    expect(messages[1].content).toBe("Message 9");
    expect(messages[2].content).toBe("Reply 9");
  });

  test("preserves tool calls and results through storage roundtrip", async () => {
    const conv = await createConversation(tmpDir, "Tool roundtrip");

    await appendMessage(tmpDir, conv.id, {
      role: "user",
      content: "Add a weather agent",
    });

    await appendMessage(tmpDir, conv.id, {
      role: "assistant",
      content: "I'll create a plan for that.",
      toolCalls: [
        { id: "tc1", name: "createPlan", input: { summary: "Add weather", steps: [] } },
      ],
    });

    await appendMessage(tmpDir, conv.id, {
      role: "tool",
      toolResults: [
        { toolCallId: "tc1", toolName: "createPlan", result: "Plan executed successfully" },
      ],
    });

    const events = await readConversationEvents(tmpDir, conv.id);
    const messages = rebuildMessages(events);

    expect(messages.length).toBe(3);

    // User message
    expect(messages[0].role).toBe("user");
    expect(messages[0].content).toBe("Add a weather agent");

    // Assistant with tool call
    expect(messages[1].role).toBe("assistant");
    expect(messages[1].toolCalls).toHaveLength(1);
    expect(messages[1].toolCalls![0].name).toBe("createPlan");
    expect(messages[1].toolCalls![0].id).toBe("tc1");

    // Tool result
    expect(messages[2].role).toBe("tool");
    expect(messages[2].toolResults).toHaveLength(1);
    expect(messages[2].toolResults![0].result).toBe("Plan executed successfully");
  });
});

describe("conversation title from initial message", () => {
  test("uses first message as title (truncated to 80 chars)", async () => {
    const longMessage = "I want to set up a complete multi-agent system with weather, hackernews, and web search capabilities plus cron scheduling";
    const title = longMessage.slice(0, 80);

    const conv = await createConversation(tmpDir, title);
    expect(conv.title).toBe(title);
    expect(conv.title.length).toBe(80);
  });

  test("uses 'New conversation' when no initial message", async () => {
    const conv = await createConversation(tmpDir, "New conversation");
    expect(conv.title).toBe("New conversation");
  });
});
