import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, readFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import {
  generateConversationId,
  createConversation,
  appendMessage,
  readConversationEvents,
  rebuildMessages,
  listConversations,
  getLastConversation,
  deleteConversation,
  clearAllConversations,
  appendCompaction,
  exportConversation,
  ensureConversationsDir,
} from "../src/commands/chat/storage.js";
import type { ChatMessage } from "../src/commands/chat-types.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "kitn-storage-test-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("generateConversationId", () => {
  test("matches expected format", () => {
    const id = generateConversationId();
    expect(id).toMatch(/^conv_\d+_[0-9a-f]{4}$/);
  });

  test("generates unique IDs", () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateConversationId()));
    expect(ids.size).toBe(100);
  });
});

describe("createConversation", () => {
  test("creates JSONL file and index entry", async () => {
    const meta = await createConversation(tmpDir, "Test conversation");

    expect(meta.id).toMatch(/^conv_/);
    expect(meta.title).toBe("Test conversation");
    expect(meta.messageCount).toBe(0);
    expect(meta.tokenEstimate).toBe(0);

    // Verify JSONL file exists with meta event
    const events = await readConversationEvents(tmpDir, meta.id);
    expect(events.length).toBe(1);
    expect(events[0].type).toBe("meta");
    if (events[0].type === "meta") {
      expect(events[0].id).toBe(meta.id);
      expect(events[0].title).toBe("Test conversation");
    }

    // Verify index
    const convos = await listConversations(tmpDir);
    expect(convos.length).toBe(1);
    expect(convos[0].id).toBe(meta.id);
  });
});

describe("appendMessage", () => {
  test("appends message to JSONL and updates index", async () => {
    const conv = await createConversation(tmpDir, "Append test");

    await appendMessage(tmpDir, conv.id, { role: "user", content: "Hello" });
    await appendMessage(tmpDir, conv.id, { role: "assistant", content: "Hi there!" });

    const events = await readConversationEvents(tmpDir, conv.id);
    // meta + 2 messages
    expect(events.length).toBe(3);
    expect(events[1].type).toBe("msg");
    if (events[1].type === "msg") {
      expect(events[1].role).toBe("user");
      expect(events[1].content).toBe("Hello");
    }
    expect(events[2].type).toBe("msg");
    if (events[2].type === "msg") {
      expect(events[2].role).toBe("assistant");
      expect(events[2].content).toBe("Hi there!");
    }

    // Index should be updated
    const convos = await listConversations(tmpDir);
    expect(convos[0].messageCount).toBe(2);
  });

  test("handles tool calls and results", async () => {
    const conv = await createConversation(tmpDir, "Tool test");

    const assistantMsg: ChatMessage = {
      role: "assistant",
      content: "Let me help",
      toolCalls: [{ id: "tc1", name: "writeFile", input: { path: "test.ts", content: "hi" } }],
    };
    await appendMessage(tmpDir, conv.id, assistantMsg);

    const toolMsg: ChatMessage = {
      role: "tool",
      toolResults: [{ toolCallId: "tc1", toolName: "writeFile", result: "Wrote test.ts" }],
    };
    await appendMessage(tmpDir, conv.id, toolMsg);

    const events = await readConversationEvents(tmpDir, conv.id);
    expect(events.length).toBe(3); // meta + 2 messages
  });
});

describe("readConversationEvents", () => {
  test("returns empty array for non-existent conversation", async () => {
    const events = await readConversationEvents(tmpDir, "conv_nonexistent_0000");
    expect(events).toEqual([]);
  });

  test("parses all event types correctly", async () => {
    const conv = await createConversation(tmpDir, "Parse test");
    await appendMessage(tmpDir, conv.id, { role: "user", content: "Hello" });

    const events = await readConversationEvents(tmpDir, conv.id);
    expect(events.length).toBe(2);
    expect(events[0].type).toBe("meta");
    expect(events[1].type).toBe("msg");
  });
});

describe("rebuildMessages", () => {
  test("rebuilds from meta and msg events", async () => {
    const conv = await createConversation(tmpDir, "Rebuild test");
    await appendMessage(tmpDir, conv.id, { role: "user", content: "Hello" });
    await appendMessage(tmpDir, conv.id, { role: "assistant", content: "Hi" });

    const events = await readConversationEvents(tmpDir, conv.id);
    const messages = rebuildMessages(events);

    expect(messages.length).toBe(2);
    expect(messages[0]).toEqual({ role: "user", content: "Hello" });
    expect(messages[1]).toEqual({ role: "assistant", content: "Hi" });
  });

  test("handles compaction events as user messages", () => {
    const events = [
      { type: "meta" as const, id: "conv_1_abcd", createdAt: "2026-01-01T00:00:00Z", title: "Test" },
      { type: "compaction" as const, summary: "Previous summary...", summarizedCount: 5, ts: "2026-01-01T00:01:00Z" },
      { type: "msg" as const, role: "user" as const, content: "Follow-up", ts: "2026-01-01T00:02:00Z" },
    ];

    const messages = rebuildMessages(events);
    expect(messages.length).toBe(2);
    expect(messages[0]).toEqual({ role: "user", content: "Previous summary..." });
    expect(messages[1]).toEqual({ role: "user", content: "Follow-up" });
  });

  test("handles tool calls and results", () => {
    const events = [
      { type: "meta" as const, id: "conv_1_abcd", createdAt: "2026-01-01T00:00:00Z", title: "Test" },
      {
        type: "msg" as const,
        role: "assistant" as const,
        content: "Let me check",
        toolCalls: [{ id: "tc1", name: "readFile", input: { path: "test.ts" } }],
        ts: "2026-01-01T00:01:00Z",
      },
      {
        type: "msg" as const,
        role: "tool" as const,
        toolResults: [{ toolCallId: "tc1", toolName: "readFile", result: "file contents" }],
        ts: "2026-01-01T00:02:00Z",
      },
    ];

    const messages = rebuildMessages(events);
    expect(messages.length).toBe(2);
    expect(messages[0].toolCalls).toHaveLength(1);
    expect(messages[1].toolResults).toHaveLength(1);
  });
});

describe("listConversations", () => {
  test("returns empty array when no conversations", async () => {
    const convos = await listConversations(tmpDir);
    expect(convos).toEqual([]);
  });

  test("returns conversations sorted by most recent first", async () => {
    await createConversation(tmpDir, "First");
    await new Promise((r) => setTimeout(r, 10)); // Small delay for timestamp ordering
    await createConversation(tmpDir, "Second");

    const convos = await listConversations(tmpDir);
    expect(convos.length).toBe(2);
    expect(convos[0].title).toBe("Second");
    expect(convos[1].title).toBe("First");
  });
});

describe("getLastConversation", () => {
  test("returns null when no conversations", async () => {
    const last = await getLastConversation(tmpDir);
    expect(last).toBeNull();
  });

  test("returns most recent conversation", async () => {
    await createConversation(tmpDir, "First");
    await new Promise((r) => setTimeout(r, 10));
    await createConversation(tmpDir, "Second");

    const last = await getLastConversation(tmpDir);
    expect(last?.title).toBe("Second");
  });
});

describe("deleteConversation", () => {
  test("removes conversation file and index entry", async () => {
    const conv = await createConversation(tmpDir, "To delete");
    await deleteConversation(tmpDir, conv.id);

    const convos = await listConversations(tmpDir);
    expect(convos.length).toBe(0);

    const events = await readConversationEvents(tmpDir, conv.id);
    expect(events).toEqual([]);
  });

  test("handles non-existent conversation gracefully", async () => {
    // Should not throw
    await deleteConversation(tmpDir, "conv_nonexistent_0000");
  });
});

describe("clearAllConversations", () => {
  test("removes all conversations", async () => {
    await createConversation(tmpDir, "One");
    await createConversation(tmpDir, "Two");
    await createConversation(tmpDir, "Three");

    await clearAllConversations(tmpDir);

    const convos = await listConversations(tmpDir);
    expect(convos).toEqual([]);
  });

  test("handles empty directory gracefully", async () => {
    await clearAllConversations(tmpDir);
    // Should not throw
  });
});

describe("appendCompaction", () => {
  test("rewrites file with compaction event", async () => {
    const conv = await createConversation(tmpDir, "Compact test");

    // Add several messages
    for (let i = 0; i < 5; i++) {
      await appendMessage(tmpDir, conv.id, { role: "user", content: `Message ${i}` });
      await appendMessage(tmpDir, conv.id, { role: "assistant", content: `Reply ${i}` });
    }

    // Compact, preserving last 2 messages
    const preserved: ChatMessage[] = [
      { role: "user", content: "Message 4" },
      { role: "assistant", content: "Reply 4" },
    ];

    await appendCompaction(tmpDir, conv.id, "Summary of messages 0-3", 8, preserved);

    const events = await readConversationEvents(tmpDir, conv.id);
    // meta + compaction + 2 preserved messages
    expect(events.length).toBe(4);
    expect(events[0].type).toBe("meta");
    expect(events[1].type).toBe("compaction");
    if (events[1].type === "compaction") {
      expect(events[1].summary).toBe("Summary of messages 0-3");
      expect(events[1].summarizedCount).toBe(8);
    }
    expect(events[2].type).toBe("msg");
    expect(events[3].type).toBe("msg");

    // Rebuild should produce 3 messages: summary + 2 preserved
    const messages = rebuildMessages(events);
    expect(messages.length).toBe(3);
    expect(messages[0].content).toBe("Summary of messages 0-3");
  });
});

describe("exportConversation", () => {
  test("generates markdown file", async () => {
    const conv = await createConversation(tmpDir, "Export test");
    await appendMessage(tmpDir, conv.id, { role: "user", content: "How do I add a weather agent?" });
    await appendMessage(tmpDir, conv.id, { role: "assistant", content: "I'll help you set that up." });

    const exportPath = await exportConversation(tmpDir, conv.id);
    expect(exportPath).toContain(".kitn/exports/");
    expect(exportPath).toEndWith(".md");

    const content = await readFile(exportPath, "utf-8");
    expect(content).toContain("# Export test");
    expect(content).toContain("**User**");
    expect(content).toContain("How do I add a weather agent?");
    expect(content).toContain("**Assistant**");
    expect(content).toContain("I'll help you set that up.");
  });
});
