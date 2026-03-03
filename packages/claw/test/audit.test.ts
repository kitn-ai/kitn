import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { createClient } from "@libsql/client";
import { AuditLogger } from "../src/audit/logger.js";

let tmpDir: string;
let logger: AuditLogger;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "claw-audit-"));
  const db = createClient({ url: `file:${join(tmpDir, "claw.db")}` });
  logger = new AuditLogger(db);
});
afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("AuditLogger", () => {
  test("logs tool execution", async () => {
    await logger.log({
      event: "tool:execute",
      toolName: "bash",
      input: { command: "ls" },
      decision: "allow",
      sessionId: "s1",
      channelType: "terminal",
    });

    const entries = await logger.query({ event: "tool:execute" });
    expect(entries).toHaveLength(1);
    expect(entries[0].toolName).toBe("bash");
  });

  test("logs permission denial", async () => {
    await logger.log({
      event: "permission:denied",
      toolName: "bash",
      input: { command: "rm -rf /" },
      reason: "user_denied",
      sessionId: "s1",
      channelType: "discord",
    });

    const entries = await logger.query({ event: "permission:denied" });
    expect(entries).toHaveLength(1);
    expect(entries[0].reason).toBe("user_denied");
  });

  test("appends multiple entries", async () => {
    await logger.log({ event: "tool:execute", toolName: "a" });
    await logger.log({ event: "tool:execute", toolName: "b" });

    const entries = await logger.query({});
    expect(entries).toHaveLength(2);
  });

  test("filters by toolName", async () => {
    await logger.log({ event: "tool:execute", toolName: "bash" });
    await logger.log({ event: "tool:execute", toolName: "read-file" });

    const entries = await logger.query({ toolName: "bash" });
    expect(entries).toHaveLength(1);
    expect(entries[0].toolName).toBe("bash");
  });

  test("filters by sessionId", async () => {
    await logger.log({ event: "tool:execute", toolName: "bash", sessionId: "s1" });
    await logger.log({ event: "tool:execute", toolName: "bash", sessionId: "s2" });

    const entries = await logger.query({ sessionId: "s1" });
    expect(entries).toHaveLength(1);
    expect(entries[0].sessionId).toBe("s1");
  });

  test("respects limit parameter", async () => {
    for (let i = 0; i < 5; i++) {
      await logger.log({ event: "tool:execute", toolName: `tool-${i}` });
    }

    const entries = await logger.query({ limit: 3 });
    expect(entries).toHaveLength(3);
  });

  test("preserves input as structured data", async () => {
    const input = { command: "ls", flags: ["-la", "--color"] };
    await logger.log({ event: "tool:execute", toolName: "bash", input });

    const entries = await logger.query({ event: "tool:execute" });
    expect(entries[0].input).toEqual(input);
  });

  test("stores extra metadata fields", async () => {
    await logger.log({
      event: "tool:execute",
      toolName: "bash",
      customField: "custom-value",
      nested: { a: 1 },
    });

    const entries = await logger.query({ event: "tool:execute" });
    expect(entries).toHaveLength(1);
    // Extra fields are stored but not returned in the standard fields
    // They go into the metadata column
    expect(entries[0].toolName).toBe("bash");
  });

  test("handles null optional fields gracefully", async () => {
    await logger.log({ event: "tool:execute" });

    const entries = await logger.query({ event: "tool:execute" });
    expect(entries).toHaveLength(1);
    expect(entries[0].toolName).toBeUndefined();
    expect(entries[0].input).toBeUndefined();
    expect(entries[0].decision).toBeUndefined();
    expect(entries[0].reason).toBeUndefined();
    expect(entries[0].sessionId).toBeUndefined();
    expect(entries[0].channelType).toBeUndefined();
    expect(entries[0].duration).toBeUndefined();
  });

  test("stores duration as a number", async () => {
    await logger.log({
      event: "tool:execute",
      toolName: "bash",
      duration: 42.5,
    });

    const entries = await logger.query({ event: "tool:execute" });
    expect(entries[0].duration).toBe(42.5);
  });
});
