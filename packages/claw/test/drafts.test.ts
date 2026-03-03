import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { createClient } from "@libsql/client";
import { DraftQueue } from "../src/governance/drafts.js";

let tmpDir: string;
let queue: DraftQueue;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "claw-drafts-"));
  const db = createClient({ url: `file:${join(tmpDir, "claw.db")}` });
  queue = new DraftQueue(db);
});
afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("DraftQueue", () => {
  test("creates a draft entry", async () => {
    const draft = await queue.create({
      action: "send-email",
      toolName: "send-message",
      input: { to: "alice@example.com", body: "Hello Alice" },
      preview: "Send email to alice@example.com: Hello Alice",
      sessionId: "sess-1",
    });
    expect(draft.id).toBeDefined();
    expect(draft.status).toBe("pending");
  });

  test("lists pending drafts", async () => {
    await queue.create({
      action: "send-email",
      toolName: "send-message",
      input: {},
      preview: "Send email",
      sessionId: "s1",
    });
    await queue.create({
      action: "post-tweet",
      toolName: "post-social",
      input: {},
      preview: "Post tweet",
      sessionId: "s1",
    });
    const pending = await queue.listPending();
    expect(pending).toHaveLength(2);
  });

  test("approves a draft", async () => {
    const draft = await queue.create({
      action: "send-email",
      toolName: "send-message",
      input: { body: "Hello" },
      preview: "Send email",
      sessionId: "s1",
    });
    const approved = await queue.approve(draft.id);
    expect(approved).not.toBeNull();
    expect(approved!.status).toBe("approved");
    expect(approved!.input).toEqual({ body: "Hello" });
  });

  test("rejects a draft", async () => {
    const draft = await queue.create({
      action: "send-email",
      toolName: "send-message",
      input: {},
      preview: "Send email",
      sessionId: "s1",
    });
    await queue.reject(draft.id);
    const pending = await queue.listPending();
    expect(pending).toHaveLength(0);
  });

  test("approved drafts no longer appear in pending", async () => {
    const draft = await queue.create({
      action: "send-email",
      toolName: "send-message",
      input: {},
      preview: "Send email",
      sessionId: "s1",
    });
    await queue.approve(draft.id);
    const pending = await queue.listPending();
    expect(pending).toHaveLength(0);
  });
});
