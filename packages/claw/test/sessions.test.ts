import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { JsonlSessionStore } from "../src/sessions/store.js";
import { SessionManager } from "../src/sessions/manager.js";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

describe("JsonlSessionStore", () => {
  let tmpDir: string;
  let store: JsonlSessionStore;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "claw-sessions-"));
    store = new JsonlSessionStore(tmpDir);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true });
  });

  test("creates and retrieves a conversation", async () => {
    const conv = await store.create("test-1");
    expect(conv.id).toBe("test-1");
    expect(conv.messages).toEqual([]);
  });

  test("appends messages", async () => {
    await store.append("chat-1", {
      role: "user",
      content: "Hello",
      timestamp: new Date().toISOString(),
    });
    await store.append("chat-1", {
      role: "assistant",
      content: "Hi there!",
      timestamp: new Date().toISOString(),
    });

    const conv = await store.get("chat-1");
    expect(conv).not.toBeNull();
    expect(conv!.messages.length).toBe(2);
    expect(conv!.messages[0].role).toBe("user");
    expect(conv!.messages[0].content).toBe("Hello");
    expect(conv!.messages[1].role).toBe("assistant");
    expect(conv!.messages[1].content).toBe("Hi there!");
  });

  test("lists conversations", async () => {
    await store.append("conv-a", {
      role: "user",
      content: "msg 1",
      timestamp: new Date().toISOString(),
    });
    await store.append("conv-b", {
      role: "user",
      content: "msg 2",
      timestamp: new Date().toISOString(),
    });

    const summaries = await store.list();
    expect(summaries.length).toBe(2);
  });

  test("deletes a conversation", async () => {
    await store.append("to-delete", {
      role: "user",
      content: "temp",
      timestamp: new Date().toISOString(),
    });
    const deleted = await store.delete("to-delete");
    expect(deleted).toBe(true);

    const conv = await store.get("to-delete");
    expect(conv).toBeNull();
  });

  test("clears a conversation", async () => {
    await store.append("to-clear", {
      role: "user",
      content: "msg",
      timestamp: new Date().toISOString(),
    });
    const cleared = await store.clear("to-clear");
    expect(cleared.messages).toEqual([]);

    const conv = await store.get("to-clear");
    expect(conv!.messages).toEqual([]);
  });

  test("returns null for non-existent conversation", async () => {
    const conv = await store.get("does-not-exist");
    expect(conv).toBeNull();
  });
});

describe("SessionManager", () => {
  test("executes tasks serially per session", async () => {
    const manager = new SessionManager();
    const order: number[] = [];

    const task = (id: number, delay: number) => async () => {
      await new Promise((r) => setTimeout(r, delay));
      order.push(id);
    };

    // Queue tasks that take different times
    const p1 = manager.enqueue("session-1", task(1, 30));
    const p2 = manager.enqueue("session-1", task(2, 10));
    const p3 = manager.enqueue("session-1", task(3, 5));

    await Promise.all([p1, p2, p3]);

    // Should be in order despite different delays
    expect(order).toEqual([1, 2, 3]);
  });

  test("different sessions run in parallel", async () => {
    const manager = new SessionManager();
    const order: string[] = [];

    const p1 = manager.enqueue("session-a", async () => {
      await new Promise((r) => setTimeout(r, 30));
      order.push("a");
    });

    const p2 = manager.enqueue("session-b", async () => {
      await new Promise((r) => setTimeout(r, 5));
      order.push("b");
    });

    await Promise.all([p1, p2]);

    // Session B should finish first since it's faster and in a different session
    expect(order).toEqual(["b", "a"]);
  });

  test("continues after errors", async () => {
    const manager = new SessionManager();
    const order: number[] = [];

    // First task throws
    const p1 = manager.enqueue("s", async () => {
      order.push(1);
      throw new Error("boom");
    }).catch(() => {});

    // Second task should still run
    const p2 = manager.enqueue("s", async () => {
      order.push(2);
    });

    await Promise.all([p1, p2]);
    expect(order).toEqual([1, 2]);
  });
});
